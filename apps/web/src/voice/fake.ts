// The e2e seam for hands-free mode (TECHNICAL_SPECS §14.1 `hands-free.spec.ts`). Loaded only by emulator builds and
// only when a test sets `window.__handsFreeFake = true`: Playwright has no microphone and can't run the model, so a
// test says what was "heard" with `window.__handsFree.hear("ok next")` and reads `window.__handsFree.mic` ("on" /
// "off") to check the microphone is closed. Speech synthesis is stubbed by the test itself.
import { VoiceError } from "./errors";
import type { VoiceInput } from "./engine";

interface Hook {
  mic: "on" | "off";
  loads: number;
  /** Set by a test: the microphone is refused. */
  denyMic?: boolean;
  hear: (text: string) => void;
}

export function fakeInput(): VoiceInput {
  const w = window as unknown as { __handsFree?: Hook };
  const hook: Hook = (w.__handsFree ??= { mic: "off", loads: 0, hear: () => undefined });
  const stop = () => {
    hook.mic = "off";
    hook.hear = () => undefined;
  };
  return {
    async start(onText) {
      if (hook.denyMic) throw new VoiceError("Hands-free mode needs the microphone. Allow it for this site in the browser's settings.");
      hook.loads++;
      hook.mic = "on";
      hook.hear = (text) => onText(text);
    },
    stop,
    dispose: stop,
  };
}
