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
import Time "mo:core/Time";
import Debug "mo:core/Debug";

import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import MixinObjectStorage "mo:caffeineai-object-storage/Mixin";
import AccessControl "mo:caffeineai-authorization/access-control";
import PaymentsApiMixin "mixins/payments-api";
import PaymentsLib "lib/payments";
import PaymentsTypes "types/payments";

// ───────────────────────────────────────────────────────────────────────────────
// Payments Canister — SketchLair
//
// Handles Stripe checkout session creation (via ICP HTTPS outcalls) and
// webhook processing to grant entitlements on-chain.
//
// HARDCODED ADMIN PRINCIPALS:
//   1. l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae  (gen / production)
//   2. 4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe  (draft / preview)
// ───────────────────────────────────────────────────────────────────────────────

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
  // PendingSession imported from types/payments.mo (includes isSubscription field)
  // ───────────────────────────────────────────────────────────────────────────

  type PendingSession = PaymentsTypes.PendingSession;

  // ───────────────────────────────────────────────────────────────────────────
  // State — persisted via enhanced orthogonal persistence.
  // stripeSecretKey_ and stripeWebhookSecret_ are write-only: never returned.
  // ───────────────────────────────────────────────────────────────────────────

  var stripeSecretKey_     : Text = "";
  var stripeWebhookSecret_ : Text = "";

  // MEDIUM-1: Audit trail for secret key setters — records who set each key and when.
  // Key values are NEVER stored or returned; only setter principal and timestamp.
  var stripeSecretKeyAudit_     : ?{ setter : Text; timestamp : Int } = null;
  var stripeWebhookSecretAudit_ : ?{ setter : Text; timestamp : Int } = null;

  let pendingSessions_   = Map.empty<Text, PendingSession>(); // sessionId → session
  let completedSessions_ = Set.empty<Text>();                 // idempotency guard
  let packPrices_        = Map.empty<Text, Nat>();            // packId → priceUsdCents

  // Subscription price — set by admin via setSubscriptionPrice()
  let subscriptionPriceRef_ = { var val : Nat = 0 };

  // Stripe customerId → principalText reverse-lookup for subscription webhooks
  let customerPrincipalMap_ = Map.empty<Text, Text>();

  // INCONSIST-2: Stable backing store for packPrices_ — persists across canister upgrades.
  stable var packPricesStable_ : [(Text, Nat)] = [];

  // Backend canister ID — set by admin after deploy via setBackendCanisterId,
  // or automatically during the 10-minute init window via initFromEnv().
  var backendCanisterId_ : Text = "";

  // MEDIUM-2: Dynamic admin set
  let dynamicAdmins_ = Set.empty<Text>();

  // MEDIUM-3: Deploy timestamp
  var deployTimestamp_ : Int = 0;
  var deployTimestampSet_ : Bool = false;

  // MEDIUM-3: Audit trail for initFromEnv calls
  var initFromEnvAudit_ : ?{ caller : Text; timestamp : Int; canisterId : Text } = null;

  // ───────────────────────────────────────────────────────────────────────────
  // Admin helpers
  // ───────────────────────────────────────────────────────────────────────────

  let HARDCODED_ADMINS : [Text] = [
    "l4bkr-kc7sl-rwtfp-35m3x-tehtd-ncdll-3lkn3-6im7y-uabuj-wci4d-tae",
    "4oonm-seqtd-whea7-bwcol-elxvd-dlik6-lha53-v6irf-oq6ao-ygjes-eqe",
  ];

  func isHardcodedAdmin(p : Principal) : Bool {
    let pText = p.toText();
    HARDCODED_ADMINS.any(func(a : Text) : Bool { a == pText });
  };

  func isAdmin(p : Principal) : async Bool {
    if (isHardcodedAdmin(p)) return true;
    if (backendCanisterId_ != "") {
      let backend : actor {
        isAdmin : (Principal) -> async Bool;
      } = actor (backendCanisterId_);
      try {
        return await backend.isAdmin(p);
      } catch (_) {};
    };
    dynamicAdmins_.contains(p.toText());
  };

  // Wire subscription API mixin — must come after isAdmin is defined
  include PaymentsApiMixin(subscriptionPriceRef_, isAdmin);

  // ───────────────────────────────────────────────────────────────────────────
  // Dynamic admin management
  // ───────────────────────────────────────────────────────────────────────────

  public shared ({ caller }) func addPaymentsAdmin(principal : Text) : async Bool {
    if (not isHardcodedAdmin(caller)) return false;
    dynamicAdmins_.add(principal);
    true;
  };

  public shared ({ caller }) func removePaymentsAdmin(principal : Text) : async Bool {
    if (not isHardcodedAdmin(caller)) return false;
    dynamicAdmins_.remove(principal);
    true;
  };

  public shared ({ caller }) func listPaymentsAdmins() : async [Text] {
    if (not isHardcodedAdmin(caller)) return [];
    dynamicAdmins_.toArray();
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Admin-only configuration
  // ───────────────────────────────────────────────────────────────────────────

  public shared ({ caller }) func setStripeSecretKey(key : Text) : async Bool {
    if (not (await isAdmin(caller))) return false;
    stripeSecretKey_ := key;
    stripeSecretKeyAudit_ := ?{ setter = caller.toText(); timestamp = Time.now() };
    true;
  };

  public shared ({ caller }) func setStripeWebhookSecret(secret : Text) : async Bool {
    if (not (await isAdmin(caller))) return false;
    stripeWebhookSecret_ := secret;
    stripeWebhookSecretAudit_ := ?{ setter = caller.toText(); timestamp = Time.now() };
    true;
  };

  public shared ({ caller }) func getStripeKeyAudit() : async {
    secretKey     : ?{ setter : Text; timestamp : Int };
    webhookSecret : ?{ setter : Text; timestamp : Int };
  } {
    if (not (await isAdmin(caller))) return { secretKey = null; webhookSecret = null };
    { secretKey = stripeSecretKeyAudit_; webhookSecret = stripeWebhookSecretAudit_ };
  };

  /// Set the price (in USD cents) for a purchasable pack. Admin only.
  public shared ({ caller }) func setPackPrice(packId : Text, priceUsdCents : Nat) : async { #ok; #err : Text } {
    if (not (await isAdmin(caller))) return #err "Unauthorized";
    if (packId == "") return #err "Pack ID cannot be empty";
    if (priceUsdCents == 0) return #err "Price cannot be zero. Use a positive value in USD cents (e.g. 999 for $9.99)";
    if (priceUsdCents > 9_999_999) return #err "Price exceeds the maximum allowed value of $99,999.99 (9999999 cents)";
    packPrices_.add(packId, priceUsdCents);
    #ok;
  };

  public query func getPackPrices() : async [(Text, Nat)] {
    packPrices_.entries().toArray();
  };

  public shared ({ caller }) func setBackendCanisterId(canisterId : Text) : async Bool {
    if (not (await isAdmin(caller))) return false;
    backendCanisterId_ := canisterId;
    true;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // One-shot auto-wiring for deploy pipeline
  // ───────────────────────────────────────────────────────────────────────────

  func ensureDeployTimestamp() {
    if (not deployTimestampSet_) {
      deployTimestamp_ := Time.now();
      deployTimestampSet_ := true;
    };
  };

  let INIT_WINDOW_NANOS : Int = 10 * 60 * 1_000_000_000;

  public shared ({ caller }) func initFromEnv(backendId : Text) : async { #ok; #err : Text } {
    ensureDeployTimestamp();
    if (backendCanisterId_ != "") {
      return #err "backendCanisterId is already set; use setBackendCanisterId() to update";
    };
    let elapsed = Time.now() - deployTimestamp_;
    if (elapsed > INIT_WINDOW_NANOS) {
      return #err "initFromEnv window has expired (10 minutes after deploy); use setBackendCanisterId() from an admin principal";
    };
    if (backendId == "") {
      return #err "backendId must not be empty";
    };
    backendCanisterId_ := backendId;
    initFromEnvAudit_ := ?{
      caller    = caller.toText();
      timestamp = Time.now();
      canisterId = backendId;
    };
    #ok;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Health check
  // ───────────────────────────────────────────────────────────────────────────

  public query func getCanisterHealth() : async {
    isConfigured          : Bool;
    hasStripeSecretKey    : Bool;
    hasWebhookSecret      : Bool;
    hasBackendCanisterId  : Bool;
    deployTimestamp       : Int;
    initWindowOpen        : Bool;
    missingConfig         : [Text];
  } {
    let hasKey      = stripeSecretKey_ != "";
    let hasWebhook  = stripeWebhookSecret_ != "";
    let hasBackend  = backendCanisterId_ != "";
    let configured  = hasKey and hasWebhook and hasBackend;
    let windowOpen = deployTimestampSet_ and (Time.now() - deployTimestamp_ <= INIT_WINDOW_NANOS) and not hasBackend;
    let missing = [
        if (hasKey)     "" else "Stripe secret key not set",
        if (hasWebhook) "" else "Stripe webhook secret not set",
        if (hasBackend) "" else "Backend canister ID not set",
      ].filter(func(s : Text) : Bool { s != "" });
    {
      isConfigured         = configured;
      hasStripeSecretKey   = hasKey;
      hasWebhookSecret     = hasWebhook;
      hasBackendCanisterId = hasBackend;
      deployTimestamp      = deployTimestamp_;
      initWindowOpen       = windowOpen;
      missingConfig        = missing;
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // SHA-256 (pure Motoko — RFC 6234)
  // ───────────────────────────────────────────────────────────────────────────

  let SHA256_H0 : [Nat32] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

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

  func rotr32(x : Nat32, n : Nat32) : Nat32 {
    (x >> n) | (x << (32 - n));
  };

  func bitnot32(x : Nat32) : Nat32 {
    x ^ (0xFFFFFFFF : Nat32);
  };

  func sha256CompressBlock(h : [var Nat32], block : [Nat8]) {
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
    var a = h[0]; var b = h[1]; var c = h[2]; var d = h[3];
    var e = h[4]; var f = h[5]; var g = h[6]; var hh = h[7];
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

  func sha256(data : [Nat8]) : [Nat8] {
    let len = data.size();
    let bitLen64 : Nat64 = Nat64.fromNat(len) * (8 : Nat64);
    let padded0 = len + 1;
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
        let bytePos = idx - (len + 1 + zeroPad);
        let shift = Nat64.fromNat((7 - bytePos) * 8);
        ((bitLen64 >> shift) & (0xFF : Nat64)).toNat().toNat8();
      }
    });
    let h : [var Nat32] = SHA256_H0.toVarArray();
    var blockStart : Nat = 0;
    while (blockStart < paddedLen) {
      let block = Array.tabulate(64, func(j : Nat) : Nat8 { padded[blockStart + j] });
      sha256CompressBlock(h, block);
      blockStart += 64;
    };
    Array.tabulate<Nat8>(32, func(idx : Nat) : Nat8 {
      let word  = h[idx / 4];
      let shift = Nat32.fromNat((3 - (idx % 4)) * 8);
      ((word >> shift) & (0xFF : Nat32)).toNat().toNat8();
    });
  };

  func hmacSha256(key : [Nat8], message : [Nat8]) : [Nat8] {
    let normKey : [Nat8] = if (key.size() > 64) sha256(key) else key;
    let paddedKey = Array.tabulate(64, func(i : Nat) : Nat8 {
      if (i < normKey.size()) normKey[i] else (0x00 : Nat8);
    });
    let ipad = paddedKey.map(func(b : Nat8) : Nat8 { b ^ (0x36 : Nat8) });
    let opad = paddedKey.map(func(b : Nat8) : Nat8 { b ^ (0x5c : Nat8) });
    let innerHash = sha256(ipad.concat(message));
    sha256(opad.concat(innerHash));
  };

  func constantTimeEqual(a : [Nat8], b : [Nat8]) : Bool {
    if (a.size() != b.size()) { return false };
    var result : Nat8 = 0;
    var i = 0;
    for (ab in a.vals()) {
      result := result | (ab ^ b[i]);
      i += 1;
    };
    result == 0
  };

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

  func jsonGetString(json : Text, key : Text) : ?Text {
    let needle = "\"" # key # "\":\"";
    let parts  = json.split(#text needle).toArray();
    if (parts.size() < 2) return null;
    let valueParts = parts[1].split(#text "\"").toArray();
    if (valueParts.size() < 1) return null;
    ?valueParts[0];
  };

  func jsonGetEventType(json : Text) : ?Text {
    jsonGetString(json, "type");
  };

  func jsonGetStringInData(json : Text, key : Text) : ?Text {
    let dataParts = json.split(#text "\"data\":").toArray();
    if (dataParts.size() < 2) return null;
    jsonGetString(dataParts[1], key);
  };

  // Extract an unquoted numeric value inside the "data" block.
  // Stripe encodes timestamps as bare integers: "current_period_end":1234567890
  func jsonGetNumberInData(json : Text, key : Text) : ?Text {
    let dataParts = json.split(#text "\"data\":").toArray();
    if (dataParts.size() < 2) return null;
    let needle = "\"" # key # "\":";
    let parts = dataParts[1].split(#text needle).toArray();
    if (parts.size() < 2) return null;
    let stripped = parts[1].trimStart(#predicate (func(c) { c == ' ' or c == '\t' or c == '\n' }));
    let tokens = stripped.split(#predicate (func(c) { not (c >= '0' and c <= '9') })).toArray();
    if (tokens.size() == 0) return null;
    let digits = tokens[0];
    if (digits == "") return null;
    ?digits;
  };

  func jsonGetDataObjectId(json : Text) : ?Text {
    let dataParts = json.split(#text "\"data\":").toArray();
    if (dataParts.size() < 2) return null;
    let afterData = dataParts[1];
    let objectParts = afterData.split(#text "\"object\":").toArray();
    if (objectParts.size() < 2) return null;
    let afterObject = objectParts[1];
    let idNeedle = "\"id\":\"";
    let idParts = afterObject.split(#text idNeedle).toArray();
    if (idParts.size() < 2) return null;
    let valueParts = idParts[1].split(#text "\"").toArray();
    if (valueParts.size() < 1) return null;
    let value = valueParts[0];
    if (value.startsWith(#text "cs_live_") or value.startsWith(#text "cs_test_")) {
      ?value
    } else {
      null
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Stripe-Signature header parser
  // ───────────────────────────────────────────────────────────────────────────

  func parseStripeSignature(header : Text) : { timestamp : ?Text; v1 : ?Text } {
    var timestamp : ?Text = null;
    var v1 : ?Text = null;
    let parts = header.split(#text ",");
    for (part in parts) {
      let kv = part.split(#text "=").toArray();
      if (kv.size() >= 2) {
        let k = kv[0];
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
      headers = [];
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Checkout
  // ───────────────────────────────────────────────────────────────────────────

  /// Create a Stripe Checkout session.
  /// - When isSubscription = true: recurring monthly subscription at global price.
  /// - When isSubscription = false: one-time purchase for the given packId.
  /// Returns #ok with the Stripe-hosted URL, or #err with a reason.
  public shared ({ caller }) func createCheckoutSession(
    packId        : Text,
    successUrl    : Text,
    cancelUrl     : Text,
    isSubscription : Bool
  ) : async { #ok : Text; #err : Text } {
    if (caller.isAnonymous()) return #err "Authentication required";
    if (stripeSecretKey_ == "") return #err "Stripe not configured";

    let callerText = caller.toText();

    if (isSubscription) {
      // ── Subscription checkout ──────────────────────────────────────
      let priceUsdCents = subscriptionPriceRef_.val;
      if (priceUsdCents == 0) return #err "Subscription price not configured";

      // Idempotency: return existing pending subscription session if any
      switch (PaymentsLib.findPendingSubscriptionSession(pendingSessions_, caller)) {
        case (?url) return #ok url;
        case null {};
      };

      let formBody = PaymentsLib.buildSubscriptionFormBody(callerText, priceUsdCents, successUrl, cancelUrl);

      let subResponse = try {
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

      if (subResponse.body.size() >= 16_384) {
        return #err "Stripe response was truncated";
      };

      let subResponseText = switch (subResponse.body.decodeUtf8()) {
        case (null) return #err "Could not decode Stripe response";
        case (?t)   t;
      };

      if (subResponse.status < 200 or subResponse.status >= 300) {
        return #err ("Stripe API error (HTTP " # subResponse.status.toText() # "): " # subResponseText);
      };

      let subTrimmed = subResponseText.trimStart(#predicate (func(c) { c == ' ' or c == '\n' or c == '\r' or c == '\t' }));
      if (not subTrimmed.startsWith(#text "{")) {
        return #err ("Stripe returned a non-JSON response: " # subResponseText);
      };

      let subSessionId = switch (jsonGetString(subResponseText, "id")) {
        case (null) return #err "Could not parse session ID from Stripe response";
        case (?id)  id;
      };

      let subSessionUrl = switch (jsonGetString(subResponseText, "url")) {
        case (null) return #err "Could not parse session URL from Stripe response";
        case (?u)   u;
      };

      pendingSessions_.add(subSessionId, {
        sessionId     = subSessionId;
        buyer         = caller;
        itemType      = "subscription";
        itemId        = "subscription";
        sessionUrl    = subSessionUrl;
        isSubscription = true;
      });

      return #ok subSessionUrl;

    } else {
      // ── One-time purchase checkout ────────────────────────────────
      let priceUsdCents = switch (packPrices_.get(packId)) {
        case (null) return #err ("Pack price not configured: " # packId);
        case (?p)   p;
      };

      // Idempotency: return existing session URL if one is already pending
      for ((_, session) in pendingSessions_.entries()) {
        if (Principal.equal(session.buyer, caller) and session.itemId == packId and session.itemType == "image_pack") {
          return #ok (session.sessionUrl);
        };
      };

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
          // 16KB is well above any expected Stripe response for our use cases.
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

      if (response.body.size() >= 16_384) {
        return #err "Stripe response was truncated (body reached max_response_bytes limit of 16384)";
      };

      let responseText = switch (response.body.decodeUtf8()) {
        case (null) return #err "Could not decode Stripe response";
        case (?t)   t;
      };

      if (response.status < 200 or response.status >= 300) {
        return #err ("Stripe API error (HTTP " # response.status.toText() # "): " # responseText);
      };

      let trimmed = responseText.trimStart(#predicate (func(c) { c == ' ' or c == '\n' or c == '\r' or c == '\t' }));
      if (not trimmed.startsWith(#text "{")) {
        return #err ("Stripe returned a non-JSON response (possible HTML error page): " # responseText);
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
        buyer         = caller;
        itemType      = "image_pack";
        itemId        = packId;
        sessionUrl;
        isSubscription = false;
      });

      return #ok sessionUrl;
    };
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

  public query func http_request(request : HttpRequest) : async HttpResponse {
    if (request.method == "POST" and request.url == "/stripe/webhook") {
      return {
        status_code = 200;
        headers     = [("Content-Type", "text/plain")];
        body        = "".encodeUtf8();
        upgrade     = ?true;
      };
    };
    httpErr(404, "Not found");
  };

  /// Update handler for POST /stripe/webhook.
  /// Verifies Stripe HMAC-SHA256 signature on ALL events before processing.
  /// Handles: checkout.session.completed, customer.subscription.created/updated/deleted,
  /// invoice.payment_succeeded.
  public func http_request_update(request : HttpRequest) : async HttpResponse {
    if (request.method != "POST" or request.url != "/stripe/webhook") {
      return httpErr(404, "Not found");
    };

    if (stripeWebhookSecret_ == "") {
      return httpErr(500, "Webhook secret not configured");
    };

    // ── Find Stripe-Signature header ─────────────────────────────────────────
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

    // ── Verify HMAC-SHA256 signature ───────────────────────────────────────
    let bodyText = switch (request.body.decodeUtf8()) {
      case (null) return httpErr(400, "Invalid UTF-8 body");
      case (?t)   t;
    };

    let signedPayload      = timestamp # "." # bodyText;
    let signedPayloadBytes = signedPayload.encodeUtf8().toArray();
    let secretBytes        = stripeWebhookSecret_.encodeUtf8().toArray();
    let computedHex        = bytesToHex(hmacSha256(secretBytes, signedPayloadBytes));

    let computedBytes = computedHex.encodeUtf8().toArray();
    let expectedBytes = expectedSig.encodeUtf8().toArray();
    if (not constantTimeEqual(computedBytes, expectedBytes)) {
      return httpErr(400, "Signature verification failed");
    };

    // ── Parse event type ──────────────────────────────────────────────────
    let eventType = switch (jsonGetEventType(bodyText)) {
      case (null) {
        Debug.print("[Payments] Received Stripe webhook with unrecognized event type — acknowledged and ignored");
        return httpOk();
      };
      case (?t)   t;
    };

    // ── Subscription lifecycle events ───────────────────────────────────────
    if (eventType == "customer.subscription.created" or eventType == "customer.subscription.updated") {
      let customerId = switch (jsonGetStringInData(bodyText, "customer")) {
        case (null) return httpErr(400, "Missing customer in subscription event");
        case (?c)   c;
      };
      let stripeSubId = switch (jsonGetStringInData(bodyText, "id")) {
        case (null) return httpErr(400, "Missing subscription id in event");
        case (?s)   s;
      };
      let periodEndText = switch (jsonGetNumberInData(bodyText, "current_period_end")) {
        case (null) return httpErr(400, "Missing current_period_end in subscription event");
        case (?t)   t;
      };
      let periodEndSeconds = switch (Nat.fromText(periodEndText)) {
        case (null) return httpErr(400, "Invalid current_period_end value: " # periodEndText);
        case (?n)   n;
      };
      let expiryDateMs : Int = periodEndSeconds * 1_000;

      let principalText = switch (PaymentsLib.resolveCustomerPrincipal(customerPrincipalMap_, customerId)) {
        case (null) {
          // Fallback: subscription.created may carry metadata.principal
          switch (jsonGetStringInData(bodyText, "principal")) {
            case (?p) p;
            case (null) return httpErr(400, "Cannot resolve principal for customer: " # customerId);
          };
        };
        case (?p) p;
      };

      let subBuyerPrincipal = try {
        Principal.fromText(principalText);
      } catch (_) {
        return httpErr(400, "Invalid principal: " # principalText);
      };

      if (backendCanisterId_ == "") return httpErr(500, "Backend canister ID not configured");

      let subBackend : actor {
        grantSubscription        : (Principal, Text, Int) -> async Bool;
        updateSubscriptionExpiry : (Principal, Int)       -> async Bool;
      } = actor (backendCanisterId_);

      let subSuccess = try {
        if (eventType == "customer.subscription.created") {
          await subBackend.grantSubscription(subBuyerPrincipal, stripeSubId, expiryDateMs);
        } else {
          await subBackend.updateSubscriptionExpiry(subBuyerPrincipal, expiryDateMs);
        };
      } catch (_) {
        return httpErr(500, "Failed to call backend for subscription event");
      };

      if (not subSuccess) {
        return httpErr(500, "Backend returned false for subscription event");
      };

      // Record customer → principal mapping for future events
      PaymentsLib.recordCustomerPrincipal(customerPrincipalMap_, customerId, principalText);
      return httpOk();
    };

    if (eventType == "customer.subscription.deleted") {
      let delCustomerId = switch (jsonGetStringInData(bodyText, "customer")) {
        case (null) return httpErr(400, "Missing customer in subscription.deleted event");
        case (?c)   c;
      };

      let delPrincipalText = switch (PaymentsLib.resolveCustomerPrincipal(customerPrincipalMap_, delCustomerId)) {
        case (null) return httpErr(400, "Cannot resolve principal for customer: " # delCustomerId);
        case (?p)   p;
      };

      let delBuyerPrincipal = try {
        Principal.fromText(delPrincipalText);
      } catch (_) {
        return httpErr(400, "Invalid principal: " # delPrincipalText);
      };

      if (backendCanisterId_ == "") return httpErr(500, "Backend canister ID not configured");

      let delBackend : actor {
        revokeSubscription : (Principal) -> async Bool;
      } = actor (backendCanisterId_);

      let delSuccess = try {
        await delBackend.revokeSubscription(delBuyerPrincipal);
      } catch (_) {
        return httpErr(500, "Failed to call revokeSubscription on backend");
      };

      if (not delSuccess) {
        return httpErr(500, "revokeSubscription returned false");
      };

      return httpOk();
    };

    if (eventType == "invoice.payment_succeeded") {
      // Only process subscription invoices (have a subscription field)
      let invCustomerId = switch (jsonGetStringInData(bodyText, "customer")) {
        case (null) return httpOk();
        case (?c)   c;
      };

      // subscription field present → this is a subscription renewal
      switch (jsonGetStringInData(bodyText, "subscription")) {
        case (null) return httpOk(); // one-time invoice, nothing to do
        case (?_) {};
      };

      let invPeriodEndText = switch (jsonGetNumberInData(bodyText, "period_end")) {
        case (null) return httpOk();
        case (?t)   t;
      };
      let invPeriodEndSeconds = switch (Nat.fromText(invPeriodEndText)) {
        case (null) return httpOk();
        case (?n)   n;
      };
      let newExpiryMs : Int = invPeriodEndSeconds * 1_000;

      let invPrincipalText = switch (PaymentsLib.resolveCustomerPrincipal(customerPrincipalMap_, invCustomerId)) {
        case (null) return httpOk(); // customer not in map yet — subscription.created will handle
        case (?p)   p;
      };

      let invBuyerPrincipal = try {
        Principal.fromText(invPrincipalText);
      } catch (_) {
        return httpOk();
      };

      if (backendCanisterId_ == "") return httpErr(500, "Backend canister ID not configured");

      let invBackend : actor {
        updateSubscriptionExpiry : (Principal, Int) -> async Bool;
      } = actor (backendCanisterId_);

      let _ = try {
        await invBackend.updateSubscriptionExpiry(invBuyerPrincipal, newExpiryMs);
      } catch (_) {
        // Best-effort — don't fail the webhook for renewal update errors
      };

      return httpOk();
    };

    if (eventType != "checkout.session.completed") {
      Debug.print("[Payments] Unhandled Stripe event type: " # eventType # " — acknowledged and ignored");
      return httpOk();
    };

    // ── checkout.session.completed ──────────────────────────────────────────
    // Uses jsonGetDataObjectId which scopes to data.object and validates
    // the cs_live_/cs_test_ prefix — prevents wrong ID extraction.
    let sessionId = switch (jsonGetDataObjectId(bodyText)) {
      case (null) return httpErr(400, "Missing or invalid session ID in event (expected cs_live_/cs_test_ prefix)");
      case (?id)  id;
    };

    // Idempotency check
    if (completedSessions_.contains(sessionId)) {
      return httpOk();
    };

    let buyerPrincipalText = switch (jsonGetStringInData(bodyText, "principal")) {
      case (null) return httpErr(400, "Missing principal in metadata");
      case (?p)   p;
    };

    let itemId = switch (jsonGetStringInData(bodyText, "itemId")) {
      case (null) return httpErr(400, "Missing itemId in metadata");
      case (?id)  id;
    };

    let buyerPrincipal = try {
      Principal.fromText(buyerPrincipalText);
    } catch (_) {
      return httpErr(400, "Invalid principal in metadata: " # buyerPrincipalText);
    };

    if (backendCanisterId_ == "") {
      return httpErr(500, "Backend canister ID not configured");
    };

    // Record customer → principal mapping (present in subscription checkouts)
    switch (jsonGetStringInData(bodyText, "customer")) {
      case (?cid) {
        PaymentsLib.recordCustomerPrincipal(customerPrincipalMap_, cid, buyerPrincipalText);
      };
      case null {};
    };

    let backend : actor {
      grantPackEntitlement : (Principal, Text) -> async Bool;
    } = actor (backendCanisterId_);

    let granted = try {
      await backend.grantPackEntitlement(buyerPrincipal, itemId);
    } catch (_) {
      return httpErr(500, "Failed to call grantPackEntitlement on backend");
    };

    if (not granted) {
      return httpErr(500, "grantPackEntitlement returned false");
    };

    // Mark session completed (idempotency)
    completedSessions_.add(sessionId);
    pendingSessions_.remove(sessionId);

    httpOk();
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Upgrade persistence hooks for packPrices_
  // ───────────────────────────────────────────────────────────────────────────

  system func preupgrade() {
    packPricesStable_ := packPrices_.entries().toArray();
  };

  system func postupgrade() {
    for ((k, v) in packPricesStable_.vals()) {
      packPrices_.add(k, v);
    };
    packPricesStable_ := [];
  };

};
