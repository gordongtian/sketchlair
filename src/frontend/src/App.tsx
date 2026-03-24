import { PaintingApp } from "@/components/PaintingApp";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

const queryClient = new QueryClient();

export default function App() {
  const [softwareWebGL, setSoftwareWebGL] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const renderer = gl.getParameter(
          debugInfo.UNMASKED_RENDERER_WEBGL,
        ) as string;
        const isSoftware = /swiftshader|llvmpipe|software|mesa offscreen/i.test(
          renderer,
        );
        if (isSoftware) setSoftwareWebGL(true);
      }
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {softwareWebGL && !dismissed && (
        <div
          data-ocid="software_webgl.toast"
          className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-amber-400 px-4 py-2 text-amber-950 shadow-md"
        >
          <span className="text-sm font-medium">
            ⚠️ Hardware acceleration is disabled in your browser. SketchLair may
            feel slow. To fix this, enable hardware acceleration in your browser
            settings.
          </span>
          <button
            type="button"
            data-ocid="software_webgl.close_button"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-500 transition-colors"
            aria-label="Dismiss warning"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <PaintingApp />
      <Toaster />
    </QueryClientProvider>
  );
}
