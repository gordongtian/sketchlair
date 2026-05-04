/**
 * useGuide — fetches the guide script from the backend and plays it via
 * DialoguePlayer. Shows a toast if no guide is available yet.
 *
 * Usage:
 *   const { openGuide } = useGuide();
 *   <button onClick={openGuide}>Guide</button>
 */

import { useDialogue } from "@/components/dialogue/DialogueContext";
import { parseDialogueScript } from "@/components/dialogue/parseDialogueScript";
import { createActorWithConfig } from "@/config";
import { useCallback } from "react";
import { toast } from "sonner";

export function useGuide() {
  const { play } = useDialogue();

  const openGuide = useCallback(async () => {
    try {
      const actor = await createActorWithConfig();
      const scriptText = await actor.getModuleScript("guide");

      if (!scriptText || scriptText.trim() === "") {
        toast.info("No guide available yet");
        return;
      }

      const { blocks } = parseDialogueScript(scriptText);
      if (blocks.length === 0) {
        toast.info("No guide available yet");
        return;
      }

      // Production mode — missing assets are silently skipped
      play(blocks, { isPreview: false });
    } catch {
      toast.error("Could not load guide — please try again");
    }
  }, [play]);

  return { openGuide };
}
