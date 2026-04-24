import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Set "mo:core/Set";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Blob "mo:core/Blob";
import Array "mo:core/Array";

import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import MixinObjectStorage "mo:caffeineai-object-storage/Mixin";
import AccessControl "mo:caffeineai-authorization/access-control";

// ─────────────────────────────────────────────────────────────────────────────
// Payments Canister — SketchLair
//
// Handles Stripe checkout session creation (via ICP HTTPS outcalls) and
// webhook processing to grant entitlements on-chain.
//
// HARDCODED ADMIN PRINCIPALS:
//   1. l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae  (gen / production)
//   2. 4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe  (draft / preview)
// ─────────────────────────────────────────────────────────────────────────────

actor {
  // Platform-required mixins
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);
  include MixinObjectStorage();

  // ───────────────────────────────────────────────────────────────────────────
  // ICP Management Canister — used for HTTPS outcalls
  // ───────────────────────────────────────────────────────────────────────────

  type HttpHeader = { name : Text; value : Text };

  type HttpRequestResult = {
    status  : Nat;
    headers : [HttpHeader];
    body    : Blob;
  };

  type TransformArgs = {
    response : HttpRequestResult;
    context  : Blob;
  };

  type HttpRequestArgs = {
    url                : Text;
    max_response_bytes : ?Nat64;
    method             : { #get; #head; #post };
    headers            : [HttpHeader];
    body               : ?Blob;
    transform          : ?{
      function : shared query (TransformArgs) -> async HttpRequestResult;
      context  : Blob;
    };
    is_replicated : ?Bool;
  };

  let ic : actor {
    http_request : HttpRequestArgs -> async HttpRequestResult;
  } = actor "aaaaa-aa";

  // ───────────────────────────────────────────────────────────────────────────
  // HTTP interface types (required for ICP HTTP gateway compatibility)
  // ───────────────────────────────────────────────────────────────────────────

  public type HttpRequest = {
    method  : Text;
    url     : Text;
    headers : [(Text, Text)];
    body    : Blob;
  };

  public type HttpResponse = {
    status_code : Nat16;
    headers     : [(Text, Text)];
    body        : Blob;
    upgrade     : ?Bool;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Internal session record — generic itemType/itemId for future extensibility
  // ───────────────────────────────────────────────────────────────────────────

  type PendingSession = {
    sessionId : Text;
    buyer     : Principal;
    itemType  : Text; // e.g. "image_pack"
    itemId    : Text; // e.g. pack ID
  };

  // ───────────────────────────────────────────────────────────────────────────
  // State — persisted via enhanced orthogonal persistence.
  // stripeSecretKey_ and stripeWebhookSecret_ are write-only: never returned.
  // ───────────────────────────────────────────────────────────────────────────

  var stripeSecretKey_     : Text = "";
  var stripeWebhookSecret_ : Text = "";

  let pendingSessions_   = Map.empty<Text, PendingSession>(); // sessionId → session
  let completedSessions_ = Set.empty<Text>();                 // idempotency guard
  let packPrices_        = Map.empty<Text, Nat>();            // packId → priceUsdCents

  // Backend canister ID — set by admin after deploy via setBackendCanisterId
  var backendCanisterId_ : Text = "";

  // ───────────────────────────────────────────────────────────────────────────
  // Admin helpers
  // ───────────────────────────────────────────────────────────────────────────

  let HARDCODED_ADMINS : [Text] = [
    "l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae",
    "4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe",
  ];

  func isAdmin(p : Principal) : Bool {
    let pText = p.toText();
    HARDCODED_ADMINS.any(func(a : Text) : Bool { a == pText });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Admin-only configuration
  // ───────────────────────────────────────────────────────────────────────────

  /// Store the Stripe secret key. Admin only. Write-only — never returned.
  public shared ({ caller }) func setStripeSecretKey(key : Text) : async Bool {
    if (not isAdmin(caller)) return false;
    stripeSecretKey_ := key;
    true;
  };

  /// Store the Stripe webhook signing secret. Admin only. Write-only — never returned.
  public shared ({ caller }) func setStripeWebhookSecret(secret : Text) : async Bool {
    if (not isAdmin(caller)) return false;
    stripeWebhookSecret_ := secret;
    true;
  };

  /// Set the price (in USD cents) for a purchasable pack. Admin only.
  public shared ({ caller }) func setPackPrice(packId : Text, priceUsdCents : Nat) : async Bool {
    if (not isAdmin(caller)) return false;
    packPrices_.add(packId, priceUsdCents);
    true;
  };

  /// Return all pack IDs and their current prices (USD cents). Public.
  public query func getPackPrices() : async [(Text, Nat)] {
    packPrices_.entries().toArray();
  };

  /// Set the backend canister ID for inter-canister entitlement calls. Admin only.
  public shared ({ caller }) func setBackendCanisterId(canisterId : Text) : async Bool {
    if (not isAdmin(caller)) return false;
    backendCanisterId_ := canisterId;
    true;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // SHA-256 (pure Motoko — RFC 6234)
  // Used for HMAC-SHA256 Stripe webhook signature verification.
  // ───────────────────────────────────────────────────────────────────────────

  // Initial hash values (first 32 bits of fractional parts of sqrt of first 8 primes)
  let SHA256_H0 : [Nat32] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  // Round constants (first 32 bits of fractional parts of cube roots of first 64 primes)
  let SHA256_K : [Nat32] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // Right-rotate a Nat32 by n bits
  func rotr32(x : Nat32, n : Nat32) : Nat32 {
    (x >> n) | (x << (32 - n));
  };

  // Bitwise NOT for Nat32
  func bitnot32(x : Nat32) : Nat32 {
    x ^ (0xFFFFFFFF : Nat32);
  };

  // SHA-256: compress one 64-byte block into the running hash state h[0..7]
  func sha256CompressBlock(h : [var Nat32], block : [Nat8]) {
    // Build message schedule W[0..63]
    let w = Array.tabulate(64, func(i : Nat) : Nat32 { (0 : Nat32) });
    let wm = w.toVarArray();
    var i : Nat = 0;
    while (i < 16) {
      let b = i * 4;
      wm[i] := (Nat32.fromNat(block[b].toNat()) << 24)
             | (Nat32.fromNat(block[b + 1].toNat()) << 16)
             | (Nat32.fromNat(block[b + 2].toNat()) << 8)
             |  Nat32.fromNat(block[b + 3].toNat());
      i += 1;
    };
    i := 16;
    while (i < 64) {
      let s0 = rotr32(wm[i - 15], 7) ^ rotr32(wm[i - 15], 18) ^ (wm[i - 15] >> 3);
      let s1 = rotr32(wm[i - 2], 17) ^ rotr32(wm[i - 2], 19)  ^ (wm[i - 2] >> 10);
      wm[i] := wm[i - 16] +% s0 +% wm[i - 7] +% s1;
      i += 1;
    };

    // Working variables
    var a = h[0]; var b = h[1]; var c = h[2]; var d = h[3];
    var e = h[4]; var f = h[5]; var g = h[6]; var hh = h[7];

    // 64 compression rounds
    var round : Nat = 0;
    while (round < 64) {
      let s1    = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      let ch    = (e & f) ^ (bitnot32(e) & g);
      let temp1 = hh +% s1 +% ch +% SHA256_K[round] +% wm[round];
      let s0    = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      let maj   = (a & b) ^ (a & c) ^ (b & c);
      let temp2 = s0 +% maj;

      hh := g; g := f; f := e; e := d +% temp1;
      d  := c; c := b; b := a; a := temp1 +% temp2;
      round += 1;
    };

    h[0] +%= a; h[1] +%= b; h[2] +%= c; h[3] +%= d;
    h[4] +%= e; h[5] +%= f; h[6] +%= g; h[7] +%= hh;
  };

  // SHA-256 over a byte array — returns 32-byte digest
  func sha256(data : [Nat8]) : [Nat8] {
    let len = data.size();

    // Bit length as 64-bit big-endian
    let bitLen64 : Nat64 = Nat64.fromNat(len) * (8 : Nat64);

    // Padding: message || 0x80 || zeros || 8-byte-big-endian-bit-length
    // Total padded length must be a multiple of 64.
    let padded0 = len + 1; // after appending 0x80
    let zeroPad : Nat = do {
      let r = padded0 % 64;
      if (r <= 56) 56 - r else 64 + 56 - r;
    };
    let paddedLen = padded0 + zeroPad + 8;

    let padded = Array.tabulate(paddedLen, func(idx : Nat) : Nat8 {
      if (idx < len) {
        data[idx];
      } else if (idx == len) {
        (0x80 : Nat8);
      } else if (idx < len + 1 + zeroPad) {
        (0x00 : Nat8);
      } else {
        // Last 8 bytes: big-endian bit length
        let bytePos = idx - (len + 1 + zeroPad); // 0..7
        let shift = Nat64.fromNat((7 - bytePos) * 8);
        ((bitLen64 >> shift) & (0xFF : Nat64)).toNat().toNat8();
      }
    });

    // Initialize state
    let h : [var Nat32] = SHA256_H0.toVarArray();

    // Process 64-byte blocks
    var blockStart : Nat = 0;
    while (blockStart < paddedLen) {
      let block = Array.tabulate(64, func(j : Nat) : Nat8 { padded[blockStart + j] });
      sha256CompressBlock(h, block);
      blockStart += 64;
    };

    // Produce 32-byte digest (big-endian words)
    Array.tabulate<Nat8>(32, func(idx : Nat) : Nat8 {
      let word  = h[idx / 4];
      let shift = Nat32.fromNat((3 - (idx % 4)) * 8);
      ((word >> shift) & (0xFF : Nat32)).toNat().toNat8();
    });
  };

  // HMAC-SHA256 — RFC 2104
  func hmacSha256(key : [Nat8], message : [Nat8]) : [Nat8] {
    // Normalize key to block size (64 bytes)
    let normKey : [Nat8] = if (key.size() > 64) sha256(key) else key;
    let paddedKey = Array.tabulate(64, func(i : Nat) : Nat8 {
      if (i < normKey.size()) normKey[i] else (0x00 : Nat8);
    });

    let ipad = paddedKey.map(func(b : Nat8) : Nat8 { b ^ (0x36 : Nat8) });
    let opad = paddedKey.map(func(b : Nat8) : Nat8 { b ^ (0x5c : Nat8) });

    let innerHash = sha256(ipad.concat(message));
    sha256(opad.concat(innerHash));
  };

  // Byte array → lowercase hex string
  func bytesToHex(bytes : [Nat8]) : Text {
    let hexChars = ['0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'];
    var result = "";
    for (b in bytes.values()) {
      let n = b.toNat();
      result := result # Text.fromChar(hexChars[n / 16]) # Text.fromChar(hexChars[n % 16]);
    };
    result;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // JSON helpers — minimal extraction for Stripe API responses
  // ───────────────────────────────────────────────────────────────────────────

  // Extract the first string value for a given key from JSON text.
  // Works for: "key":"value" — handles nested structures by finding first occurrence.
  func jsonGetString(json : Text, key : Text) : ?Text {
    let needle = "\"" # key # "\":\"";
    let parts  = json.split(#text needle).toArray();
    if (parts.size() < 2) return null;
    // parts[1] starts right after the opening quote of the value
    let valueParts = parts[1].split(#text "\"").toArray();
    if (valueParts.size() < 1) return null;
    ?valueParts[0];
  };

  // Extract the event type field
  func jsonGetEventType(json : Text) : ?Text {
    jsonGetString(json, "type");
  };

  // Extract the first string value for a key that appears INSIDE the "data" block.
  // Stripe webhook events have structure: { "id": "evt_...", ..., "data": { "object": { "id": "cs_...", ... } } }
  // This function splits at the first occurrence of "\"data\":" to isolate the data block
  // before searching for the key — preventing the top-level "id" (evt_...) from being returned
  // when we want data.object.id (cs_...).
  func jsonGetStringInData(json : Text, key : Text) : ?Text {
    let dataParts = json.split(#text "\"data\":").toArray();
    if (dataParts.size() < 2) return null;
    // dataParts[1] is everything from "data": onward — search within this block only
    jsonGetString(dataParts[1], key);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Stripe-Signature header parser
  // Format: t=1234567890,v1=abc123def456...
  // ───────────────────────────────────────────────────────────────────────────

  func parseStripeSignature(header : Text) : { timestamp : ?Text; v1 : ?Text } {
    var timestamp : ?Text = null;
    var v1 : ?Text = null;
    let parts = header.split(#text ",");
    for (part in parts) {
      let kv = part.split(#text "=").toArray();
      if (kv.size() >= 2) {
        let k = kv[0];
        // Value may contain '=' so rejoin from index 1 onward
        var v = kv[1];
        var idx = 2;
        while (idx < kv.size()) {
          v := v # "=" # kv[idx];
          idx += 1;
        };
        if (k == "t" and timestamp == null) { timestamp := ?v };
        if (k == "v1" and v1 == null)       { v1 := ?v };
      };
    };
    { timestamp; v1 };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // HTTPS outcall transform — strips non-deterministic headers
  // ───────────────────────────────────────────────────────────────────────────

  public query func transformStripeResponse(args : TransformArgs) : async HttpRequestResult {
    {
      status  = args.response.status;
      body    = args.response.body;
      headers = []; // strip all response headers — body is what matters
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Checkout
  // ───────────────────────────────────────────────────────────────────────────

  /// Create a Stripe Checkout session for a given pack.
  /// - Rejects anonymous callers.
  /// - Uses ICP HTTPS outcalls to call Stripe's API.
  /// - Stores the session → (principal, itemType, itemId) mapping.
  /// - Returns the Stripe-hosted Checkout URL on success.
  /// - successUrl and cancelUrl must be provided by the frontend caller
  ///   (e.g. window.location.origin + "/marketplace?purchase=success&pack=" + packId).
  public shared ({ caller }) func createCheckoutSession(packId : Text, successUrl : Text, cancelUrl : Text) : async { #ok : Text; #err : Text } {
    if (caller.isAnonymous()) return #err "Authentication required";

    let priceUsdCents = switch (packPrices_.get(packId)) {
      case (null) return #err ("Pack price not configured: " # packId);
      case (?p)   p;
    };

    if (stripeSecretKey_ == "") return #err "Stripe not configured";

    let callerText  = caller.toText();
    let productName = packId # " Reference Pack";

    let formBody =
        "mode=payment"
      # "&success_url=" # successUrl
      # "&cancel_url=" # cancelUrl
      # "&line_items[0][price_data][currency]=usd"
      # "&line_items[0][price_data][unit_amount]=" # priceUsdCents.toText()
      # "&line_items[0][price_data][product_data][name]=" # productName
      # "&line_items[0][quantity]=1"
      # "&metadata[principal]=" # callerText
      # "&metadata[itemType]=image_pack"
      # "&metadata[itemId]=" # packId;

    let response = try {
      await (with cycles = 2_000_000_000) ic.http_request({
        url                = "https://api.stripe.com/v1/checkout/sessions";
        max_response_bytes = ?16_384;
        method             = #post;
        headers            = [
          { name = "Content-Type";  value = "application/x-www-form-urlencoded" },
          { name = "Authorization"; value = "Bearer " # stripeSecretKey_ },
        ];
        body               = ?formBody.encodeUtf8();
        transform          = ?{
          function  = transformStripeResponse;
          context   = Blob.fromArray([]);
        };
        is_replicated = ?true;
      });
    } catch (_) {
      return #err "HTTPS outcall to Stripe failed";
    };

    let responseText = switch (response.body.decodeUtf8()) {
      case (null) return #err "Could not decode Stripe response";
      case (?t)   t;
    };

    if (response.status < 200 or response.status >= 300) {
      return #err ("Stripe API error (HTTP " # response.status.toText() # "): " # responseText);
    };

    let sessionId = switch (jsonGetString(responseText, "id")) {
      case (null) return #err "Could not parse session ID from Stripe response";
      case (?id)  id;
    };

    let sessionUrl = switch (jsonGetString(responseText, "url")) {
      case (null) return #err "Could not parse session URL from Stripe response";
      case (?u)   u;
    };

    pendingSessions_.add(sessionId, {
      sessionId;
      buyer    = caller;
      itemType = "image_pack";
      itemId   = packId;
    });

    #ok sessionUrl;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // HTTP gateway helpers
  // ───────────────────────────────────────────────────────────────────────────

  func httpOk() : HttpResponse {
    {
      status_code = 200;
      headers     = [("Content-Type", "text/plain")];
      body        = "OK".encodeUtf8();
      upgrade     = null;
    };
  };

  func httpErr(code : Nat16, msg : Text) : HttpResponse {
    {
      status_code = code;
      headers     = [("Content-Type", "text/plain")];
      body        = msg.encodeUtf8();
      upgrade     = null;
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // ICP HTTP gateway — webhook receiver
  // ───────────────────────────────────────────────────────────────────────────

  /// Standard ICP HTTP query handler.
  /// Upgrades POST /stripe/webhook to an update call.
  public query func http_request(request : HttpRequest) : async HttpResponse {
    if (request.method == "POST" and request.url == "/stripe/webhook") {
      return {
        status_code = 200;
        headers     = [("Content-Type", "text/plain")];
        body        = "".encodeUtf8();
        upgrade     = ?true; // signal gateway to call http_request_update
      };
    };
    httpErr(404, "Not found");
  };

  /// Update handler for POST /stripe/webhook.
  /// Verifies Stripe HMAC-SHA256 signature, handles checkout.session.completed,
  /// enforces idempotency, grants entitlement via inter-canister call.
  public func http_request_update(request : HttpRequest) : async HttpResponse {
    if (request.method != "POST" or request.url != "/stripe/webhook") {
      return httpErr(404, "Not found");
    };

    if (stripeWebhookSecret_ == "") {
      return httpErr(500, "Webhook secret not configured");
    };

    // ── Find Stripe-Signature header ──────────────────────────────────────
    var sigHeader : ?Text = null;
    for ((name, value) in request.headers.values()) {
      if (name.toLower() == "stripe-signature" and sigHeader == null) {
        sigHeader := ?value;
      };
    };

    let sigValue = switch (sigHeader) {
      case (null) return httpErr(400, "Missing Stripe-Signature header");
      case (?s)   s;
    };

    let parsed = parseStripeSignature(sigValue);

    let timestamp = switch (parsed.timestamp) {
      case (null) return httpErr(400, "Missing timestamp in Stripe-Signature");
      case (?t)   t;
    };

    let expectedSig = switch (parsed.v1) {
      case (null) return httpErr(400, "Missing v1 in Stripe-Signature");
      case (?v)   v;
    };

    // ── Verify HMAC-SHA256 signature ──────────────────────────────────────
    let bodyText = switch (request.body.decodeUtf8()) {
      case (null) return httpErr(400, "Invalid UTF-8 body");
      case (?t)   t;
    };

    let signedPayload     = timestamp # "." # bodyText;
    let signedPayloadBytes = signedPayload.encodeUtf8().toArray();
    let secretBytes        = stripeWebhookSecret_.encodeUtf8().toArray();
    let computedHex        = bytesToHex(hmacSha256(secretBytes, signedPayloadBytes));

    if (computedHex != expectedSig) {
      return httpErr(400, "Signature verification failed");
    };

    // ── Parse event type ──────────────────────────────────────────────────
    let eventType = switch (jsonGetEventType(bodyText)) {
      case (null) return httpOk(); // Unknown event — acknowledge and ignore
      case (?t)   t;
    };

    if (eventType != "checkout.session.completed") {
      return httpOk(); // Not our event type — acknowledge and ignore
    };

    // ── Extract session data ──────────────────────────────────────────────
    // The top-level "id" is the Stripe event ID (evt_...).
    // The checkout session ID (cs_...) lives at data.object.id — search within the data block only.
    let sessionId = switch (jsonGetStringInData(bodyText, "id")) {
      case (null) return httpErr(400, "Missing session ID in event");
      case (?id)  id;
    };

    // ── Idempotency check ─────────────────────────────────────────────────
    if (completedSessions_.contains(sessionId)) {
      return httpOk();
    };

    // ── Extract metadata fields ───────────────────────────────────────────
    let buyerPrincipalText = switch (jsonGetString(bodyText, "principal")) {
      case (null) return httpErr(400, "Missing principal in metadata");
      case (?p)   p;
    };

    let itemId = switch (jsonGetString(bodyText, "itemId")) {
      case (null) return httpErr(400, "Missing itemId in metadata");
      case (?id)  id;
    };

    let buyerPrincipal = try {
      Principal.fromText(buyerPrincipalText);
    } catch (_) {
      return httpErr(400, "Invalid principal in metadata: " # buyerPrincipalText);
    };

    // ── Grant entitlement via inter-canister call ─────────────────────────
    if (backendCanisterId_ == "") {
      return httpErr(500, "Backend canister ID not configured");
    };

    let backend : actor {
      grantPackEntitlement : (Principal, Text) -> async Bool;
    } = actor (backendCanisterId_);

    let _ = try {
      await backend.grantPackEntitlement(buyerPrincipal, itemId);
    } catch (_) {
      return httpErr(500, "Failed to call grantPackEntitlement on backend");
    };

    // ── Mark session completed (idempotency) ──────────────────────────────
    completedSessions_.add(sessionId);
    // Remove from pending — no longer needed
    pendingSessions_.remove(sessionId);

    httpOk();
  };

};
