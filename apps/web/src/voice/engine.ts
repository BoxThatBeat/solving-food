// The hands-free engine (lazy chunk; PRD R4.31–R4.34, TECHNICAL_SPECS §12 "Hands-free mode"). Three parts with their
// own lifecycles: the speaker (speech synthesis on the main thread, cancellable at once), the microphone (capture and
// voice activity detection on the main thread, closed whenever hands-free is off) and the recogniser (Whisper in a Web
// Worker). A transcript becomes a command by `parseVoiceCommand()` after `stripEcho()` removes what the app itself said.
import { parseVoiceCommand, stripEcho, type VoiceCommand } from "@solving-food/core";
import { Speaker } from "./speaker";
import { VoiceError } from "./errors";

export interface VoiceInput {
  /** Opens the microphone and loads the model; transcripts go to `onText`. Resolves once both are ready. */
  start(onText: (text: string) => void, onError: (e: unknown) => void): Promise<void>;
  /** Closes the microphone at once (every track stopped). The model stays loaded. */
  stop(): void;
  /** Closes the microphone and ends the worker. */
  dispose(): void;
}

export interface Engine {
  say(texts: string[]): void;
  cancel(): void;
  listen(): Promise<void>;
  stop(): void;
  dispose(): void;
}

export async function createEngine(cb: { onCommand: (c: VoiceCommand) => void; onSpeaking: (s: boolean) => void; onError: (e: unknown) => void }): Promise<Engine> {
  if (typeof window.speechSynthesis === "undefined" || typeof window.SpeechSynthesisUtterance !== "function") {
    throw new VoiceError("This browser can't read aloud, so hands-free mode is off.");
  }
  const speaker = new Speaker(cb.onSpeaking);
  // The e2e seam (emulator builds only, and only when a test asks for it): a fake mic and recogniser. In a production
  // build the condition is the constant `false`, so the fake isn't bundled.
  const fake = import.meta.env.VITE_USE_EMULATORS === "true" && (window as { __handsFreeFake?: boolean }).__handsFreeFake === true;
  const input: VoiceInput = fake ? (await import("./fake")).fakeInput() : (await import("./input")).realInput();
  let listening = false;

  const onText = (text: string) => {
    if (!listening) return;
    const command = parseVoiceCommand(stripEcho(text, speaker.recent()));
    if (command !== "none") cb.onCommand(command);
  };

  return {
    say: (texts) => speaker.say(texts),
    cancel: () => speaker.cancel(),
    async listen() {
      listening = true;
      try {
        await input.start(onText, (e) => {
          listening = false;
          cb.onError(e);
        });
      } catch (e) {
        listening = false;
        input.stop();
        throw e;
      }
    },
    stop() {
      listening = false;
      speaker.cancel();
      input.stop();
    },
    dispose() {
      listening = false;
      speaker.cancel();
      input.dispose();
    },
  };
}
