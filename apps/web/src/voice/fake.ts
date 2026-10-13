// The e2e seam for hands-free mode (TECHNICAL_SPECS §14.1 `hands-free.spec.ts`). Loaded only by emulator builds and
// only when a test sets `window.__handsFreeFake = true`: Playwright has no microphone and can't run the model, so a
// test says what was "heard" with `window.__handsFree.hear("ok next")` and reads `window.__handsFree.mic` ("on" /
// "off") to check the microphone is closed. `segment()` is speech heard but not yet transcribed (M13: the toggle's
// "heard" look until the next `hear()`). Speech synthesis is stubbed by the test itself.
import { diag } from "./diag";
import { VoiceError } from "./errors";
import type { VoiceInput } from "./engine";

interface Hook {
  mic: "on" | "off";
  loads: number;
  /** Set by a test: the microphone is refused. */
  denyMic?: boolean;
  /** Speech ended and went to the (fake) recogniser. */
  segment: () => void;
  /** The recogniser's transcript (clears a pending `segment()`). */
  hear: (text: string) => void;
  /** What the engine told the microphone about reading aloud (M13). */
  speaking: boolean[];
}

export function fakeInput(): VoiceInput {
  const w = window as unknown as { __handsFree?: Hook };
  const hook: Hook = (w.__handsFree ??= { mic: "off", loads: 0, segment: () => undefined, hear: () => undefined, speaking: [] });
  hook.speaking ??= [];
  let pending = 0;
  const stop = () => {
    hook.mic = "off";
    hook.hear = () => undefined;
    hook.segment = () => undefined;
    pending = 0;
  };
  return {
    async start(h) {
      if (hook.denyMic) throw new VoiceError("Hands-free mode needs the microphone. Allow it for this site in the browser's settings.");
      hook.loads++;
      hook.mic = "on";
      diag("mic opened", "fake");
      hook.segment = () => {
        pending++;
        diag("segment", "fake");
        h.busy(true);
      };
      hook.hear = (text) => {
        diag("transcribed", JSON.stringify(text));
        h.text(text, { endedAt: performance.now() });
        pending = Math.max(0, pending - 1);
        h.busy(pending > 0);
      };
    },
    speaking(on) {
      hook.speaking.push(on);
    },
    stop,
    dispose: stop,
  };
}
