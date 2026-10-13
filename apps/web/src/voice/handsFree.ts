// Hands-free mode, the part in the main bundle (PRD R4.31–R4.34, TECHNICAL_SPECS §12 "Hands-free mode"): the device
// setting, the state the toggle shows, what the open cooking page wants read, and the lifecycle. The engine (microphone,
// speech recognition worker, speech synthesis) is a separate chunk, imported the first time hands-free is switched on.
//
// The engine runs only while hands-free is on AND a cooking page that shows the toggle is open (mise en place, step
// mode, the review). Anywhere else the microphone is closed, whatever the setting says. It is switched on only by a tap
// (M12): a fresh page load starts with it off, and a start that crashed the page is detected on the next load.
import * as React from "react";
import type { VoiceCommand } from "@solving-food/core";
import type { Engine } from "./engine";

/** What the open cooking page offers the voice (R4.33). Texts are display text; the engine makes them speakable. */
export interface VoiceScript {
  /** Changes when the user enters a new page or step: the intro is read again. */
  id: string;
  /** Read on entering, and when hands-free is switched on: mise en place → the prep list; a step → ingredients, then instructions. */
  intro: string[];
  ingredients: string[];
  steps: string[];
  next?: (() => void) | undefined;
  previous?: (() => void) | undefined;
}

export type HandsFreeStatus = "off" | "loading" | "on";

/**
 * What went wrong, for the toggle's error look (M12): `speech` = this device can't read aloud (hands-free stays on and
 * listens); `start` = it couldn't start (microphone, model, or the last start crashed the page; hands-free is off).
 * Cleared by the next tap on the toggle.
 */
export type HandsFreeProblem = "speech" | "start" | null;

export interface HandsFreeState {
  /** On for this page session: set only by a tap on the toggle, never restored on a fresh page load (M12). */
  enabled: boolean;
  status: HandsFreeStatus;
  muted: boolean;
  speaking: boolean;
  problem: HandsFreeProblem;
  /** The last failure, for the toggle to announce once (`id` changes per failure). */
  error: { id: number; message: string } | null;
}

/** M11 remembered the setting per device; M12 never restores it (a start needs a tap), so the old key is removed. */
const LEGACY_KEY = "sf.handsFree";
/** Set while the engine is starting: still set on the next page load means that start crashed the page (M12). */
export const STARTING_KEY = "sf.handsFree.starting";
const GRACE_MS = 800;

const CRASHED = "Hands-free couldn't start on this device, so it's off.";
const SPEECHLESS = "This device can't read aloud right now. Hands-free is still listening.";

function storage(fn: (s: Storage) => void) {
  try {
    fn(localStorage);
  } catch {
    /* private mode or storage blocked: the guard lasts for this page only */
  }
}

/** True once: the previous page load set the starting flag and never cleared it (the page crashed or was killed). */
function crashedLastTime(): boolean {
  let crashed = false;
  storage((s) => {
    crashed = s.getItem(STARTING_KEY) === "1";
    s.removeItem(STARTING_KEY);
    s.removeItem(LEGACY_KEY);
  });
  return crashed;
}

/** The utterance spoken in the tap, kept referenced until it ends (Chrome can collect it otherwise). */
let unlocking: SpeechSynthesisUtterance | null = null;

/**
 * Safari only lets a page speak after `speak()` has been called inside a user gesture, and the engine's first read
 * comes after lazy imports (the gesture has expired by then). So the tap itself speaks a single space (M12).
 */
function unlockSpeech() {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== "function") return;
    if (synth.paused) synth.resume();
    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "en-CA";
    unlocking = u;
    u.onend = u.onerror = () => {
      if (unlocking === u) unlocking = null;
    };
    synth.speak(u);
  } catch {
    /* nothing to unlock */
  }
}

class HandsFree {
  private state: HandsFreeState = { enabled: false, status: "off", muted: false, speaking: false, problem: null, error: null };
  private listeners = new Set<() => void>();
  private hosts = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private engine: Engine | null = null;
  private running = false;
  /** Bumped on every stop: a start that finishes after it is abandoned. */
  private generation = 0;
  private script: VoiceScript | null = null;
  private lastReadId: string | null = null;
  private errors = 0;

  constructor() {
    if (typeof window === "undefined") return;
    if (crashedLastTime()) {
      console.warn("[hands-free] the last start didn't finish (the page crashed or was closed while loading); not starting");
      this.state = { ...this.state, problem: "start", error: { id: ++this.errors, message: CRASHED } };
    }
    // A normal reload or close while loading isn't a crash.
    window.addEventListener("pagehide", () => storage((s) => s.removeItem(STARTING_KEY)));
  }

  get = (): HandsFreeState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<HandsFreeState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /**
   * The toggle's tap (R4.31): the only way hands-free starts. Must run inside the click handler: on, it speaks the
   * Safari unlock before anything is awaited. Off stops speech and closes the microphone at once.
   */
  setEnabled(on: boolean) {
    if (on) unlockSpeech();
    this.set({ enabled: on, muted: false, problem: null });
    this.reconcile();
  }

  /** A page showing the toggle is open. Returns the unmount. */
  host(): () => void {
    this.hosts++;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.reconcile();
    return () => {
      this.hosts--;
      // Moving from the cook view to the review unmounts one toggle and mounts the next: keep the mic open across it.
      if (this.graceTimer) clearTimeout(this.graceTimer);
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        this.reconcile();
      }, GRACE_MS);
    };
  }

  setScript(s: VoiceScript | null) {
    this.script = s;
    if (!s || s.id === this.lastReadId) return;
    this.lastReadId = s.id;
    // Entering a new step or page reads it (R4.33).
    if (this.running && this.engine && !this.state.muted) this.engine.say(s.intro);
  }

  clearScript(id: string) {
    if (this.script?.id === id) this.script = null;
  }

  private reconcile() {
    const want = this.state.enabled && this.hosts > 0;
    if (want && !this.running) void this.start();
    else if (!want && this.running) this.stop();
    if (this.hosts === 0 && !this.graceTimer && this.engine && !this.running) {
      this.engine.dispose();
      this.engine = null;
    }
  }

  private async start() {
    this.running = true;
    const gen = ++this.generation;
    this.set({ status: "loading", speaking: false });
    storage((s) => s.setItem(STARTING_KEY, "1"));
    try {
      if (!this.engine) {
        const { createEngine } = await import("./engine");
        if (gen !== this.generation) return;
        this.engine = await createEngine({
          onCommand: (c) => this.command(c),
          onSpeaking: (speaking) => this.set({ speaking }),
          onError: (e) => this.failure(e),
          onSpeechUnavailable: (reason) => this.speechUnavailable(reason),
        });
        if (gen !== this.generation) return;
      }
      const engine = this.engine;
      // Read right away (the model may still be loading): the mise en place list, or the step (R4.33).
      if (this.script && !this.state.muted) {
        this.lastReadId = this.script.id;
        engine.say(this.script.intro);
      }
      await engine.listen();
      if (gen !== this.generation) return;
      storage((s) => s.removeItem(STARTING_KEY));
      this.set({ status: "on" });
    } catch (e) {
      if (gen !== this.generation) return;
      this.fail(e);
    }
  }

  private stop() {
    this.running = false;
    this.generation++;
    storage((s) => s.removeItem(STARTING_KEY));
    this.engine?.stop();
    this.set({ status: "off", speaking: false });
    this.reconcile();
  }

  /** The microphone or the model failed (never speech: see `speechUnavailable`): switch off with a banner. */
  private fail(e: unknown) {
    const message = e instanceof Error && e.message ? e.message : "Hands-free mode isn't available here";
    console.warn("[hands-free]", e);
    this.set({ enabled: false, muted: false, problem: "start", error: { id: ++this.errors, message } });
    this.stop();
  }

  /** Reading aloud doesn't work here (M12): say so once, show it on the toggle, keep listening for commands. */
  private speechUnavailable(reason: string) {
    console.warn(`[hands-free] reading aloud isn't available: ${reason}`);
    if (!this.running || this.state.problem === "speech") return;
    this.set({ problem: "speech", speaking: false, error: { id: ++this.errors, message: SPEECHLESS } });
  }

  /** A spoken command (R4.32). */
  private command(c: VoiceCommand) {
    if (!this.running || !this.engine) return;
    const s = this.script;
    switch (c) {
      case "next":
        s?.next?.();
        return;
      case "previous":
        s?.previous?.();
        return;
      case "ingredients":
        if (s && !this.state.muted) this.engine.say(s.ingredients);
        return;
      case "steps":
        if (s && !this.state.muted) this.engine.say(s.steps);
        return;
      case "stop":
        this.engine.cancel();
        return;
      case "mute":
        this.engine.cancel();
        this.set({ muted: true });
        return;
      case "unmute":
        this.set({ muted: false });
        return;
    }
  }

  /** An engine failure after start (the mic was unplugged, the model failed to load). */
  failure(e: unknown) {
    if (this.running) this.fail(e);
  }
}

export const handsFree = new HandsFree();

export function useHandsFree(): HandsFreeState {
  return React.useSyncExternalStore(handsFree.subscribe, handsFree.get, handsFree.get);
}

/**
 * Registers what the page offers the voice. `script.id` changing means a new step or page (read it). The texts can
 * change under the same id (servings, data arriving) without re-reading; the handlers always call the latest props.
 */
export function useVoiceScript(script: VoiceScript | null) {
  const ref = React.useRef(script);
  React.useLayoutEffect(() => {
    ref.current = script;
  });
  const id = script?.id ?? null;
  const texts = script ? JSON.stringify([script.intro, script.ingredients, script.steps]) : "";
  React.useEffect(() => {
    const s = ref.current;
    if (!s || id === null) return;
    handsFree.setScript({ ...s, next: () => ref.current?.next?.(), previous: () => ref.current?.previous?.() });
    return () => handsFree.clearScript(id);
  }, [id, texts]);
}
