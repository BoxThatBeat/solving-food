// The hands-free engine (lazy chunk; PRD R4.31–R4.34, TECHNICAL_SPECS §12 "Hands-free mode"). Three parts with their
// own lifecycles: the speaker (speech synthesis on the main thread, cancellable at once), the microphone (capture and
// voice activity detection on the main thread, closed whenever hands-free is off) and the recogniser (Moonshine since M13, Whisper before, in a Web
// Worker). A transcript becomes a command by `parseVoiceCommand()` after `stripEcho()` removes what the app itself said.
import { parseVoiceCommand, stripEcho, type VoiceCommand } from "@solving-food/core";
import { diag } from "./diag";
import { Speaker } from "./speaker";

export interface InputHooks {
  /** A transcript (possibly empty: nothing understood, or a failed pass). `endedAt`: when the speech ended. */
  text(text: string, info: { endedAt: number }): void;
  /** Speech was heard and is waiting for, or in, the recogniser (true) / nothing is pending any more (false). */
  busy(on: boolean): void;
  /** The microphone or the model failed: hands-free switches off. */
  error(e: unknown): void;
}

export interface VoiceInput {
  /** Opens the microphone and loads the model. Resolves once both are ready. */
  start(hooks: InputHooks): Promise<void>;
  /** The app started or stopped reading aloud (M13: the microphone recovers after a read; iOS pauses during one). */
  speaking(on: boolean): void;
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

export interface EngineCallbacks {
  onCommand: (c: VoiceCommand) => void;
  onSpeaking: (s: boolean) => void;
  /** A command was heard and is being worked out (M13: the toggle's "heard" look). */
  onHeard: (on: boolean) => void;
  /** The microphone or the model failed: hands-free switches off. */
  onError: (e: unknown) => void;
  /** Reading aloud doesn't work here (M12): hands-free stays on and keeps listening. */
  onSpeechUnavailable: (reason: string) => void;
}

/** A speaker for a browser without speech synthesis: says nothing, reports itself unavailable on first use. */
function silentSpeaker(onUnavailable: (reason: string) => void): Pick<Speaker, "say" | "cancel" | "reset" | "recent" | "dispose"> {
  let told = false;
  return {
    say: () => {
      if (!told) onUnavailable("no speechSynthesis in this browser");
      told = true;
    },
    cancel: () => undefined,
    reset: () => {
      told = false;
    },
    recent: () => [],
    dispose: () => undefined,
  };
}

/** The "heard" look never outlasts this, whatever happens to the transcription. */
const HEARD_MAX_MS = 10_000;

export async function createEngine(cb: EngineCallbacks): Promise<Engine> {
  const canSpeak = typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance === "function";
  let input: VoiceInput | null = null;
  const onSpeaking = (s: boolean) => {
    diag(s ? "speech started" : "speech ended");
    cb.onSpeaking(s);
    input?.speaking(s);
  };
  const onUnavailable = (reason: string) => {
    diag("speech unavailable", reason);
    cb.onSpeechUnavailable(reason);
  };
  const speaker = canSpeak ? new Speaker({ onSpeaking, onUnavailable }) : silentSpeaker(onUnavailable);
  // The e2e seam (emulator builds only, and only when a test asks for it): a fake mic and recogniser. In a production
  // build the condition is the constant `false`, so the fake isn't bundled.
  const fake = import.meta.env.VITE_USE_EMULATORS === "true" && (window as { __handsFreeFake?: boolean }).__handsFreeFake === true;
  input = fake ? (await import("./fake")).fakeInput() : (await import("./input")).realInput();
  const voice = input;
  let listening = false;
  let heard = false;
  let heardTimer: ReturnType<typeof setTimeout> | null = null;

  const setHeard = (on: boolean) => {
    if (heardTimer) clearTimeout(heardTimer);
    heardTimer = on ? setTimeout(() => setHeard(false), HEARD_MAX_MS) : null;
    if (on === heard) return;
    heard = on;
    cb.onHeard(on);
  };

  const hooks: InputHooks = {
    text(text, { endedAt }) {
      if (!listening) return;
      const recent = speaker.recent();
      const kept = stripEcho(text, recent);
      const command = parseVoiceCommand(kept);
      if (command === "none" && parseVoiceCommand(text) !== "none") diag("echo filter dropped", { heard: JSON.stringify(text), kept: JSON.stringify(kept) });
      if (command !== "none") {
        cb.onCommand(command);
        diag("command applied", { command, ms_after_speech: Math.round(performance.now() - endedAt) });
      } else if (text) diag("no command", JSON.stringify(text));
    },
    busy(on) {
      if (listening) setHeard(on);
    },
    error(e) {
      listening = false;
      setHeard(false);
      cb.onError(e);
    },
  };

  return {
    say: (texts) => speaker.say(texts),
    cancel: () => {
      speaker.cancel();
      // A cancel with nothing queued fires no speaking(false): nudge the microphone anyway (M13).
      voice.speaking(false);
    },
    async listen() {
      listening = true;
      try {
        await voice.start(hooks);
      } catch (e) {
        listening = false;
        voice.stop();
        throw e;
      }
    },
    stop() {
      listening = false;
      setHeard(false);
      speaker.reset();
      voice.stop();
    },
    dispose() {
      listening = false;
      setHeard(false);
      speaker.dispose();
      voice.dispose();
    },
  };
}
