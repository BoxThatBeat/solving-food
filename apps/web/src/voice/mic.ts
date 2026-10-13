// Microphone capture for hands-free mode (R4.32, R4.34), on the main thread and apart from the model worker. Audio is
// read at the device's rate by an AudioWorklet (a ScriptProcessor where there is none), downsampled to 16 kHz mono,
// and cut into utterances by `SpeechSegmenter` (1.5 s of silence ends one). Nothing is stored or sent anywhere: each
// segment goes straight to `onSegment` (the worker), and `stop()` ends every track so the browser's recording
// indicator goes away.
import { downsample, SpeechSegmenter } from "@solving-food/core";
import { VoiceError } from "./errors";

/** The worklet: batches the 128-sample render quanta into ~2048-sample chunks and posts them to the page. */
const WORKLET = `
class SfCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(2048); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("sf-capture", SfCapture);
`;

export interface Mic {
  stop(): void;
}

export async function openMic(onSegment: (pcm: Float32Array) => void, onError: (e: unknown) => void): Promise<Mic> {
  const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !AC) throw new VoiceError("This browser can't listen, so hands-free mode is off.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new VoiceError("Hands-free mode needs the microphone. Allow it for this site in the browser's settings.");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new VoiceError("No microphone was found, so hands-free mode is off.");
    throw new VoiceError("The microphone couldn't be opened, so hands-free mode is off.");
  }
  const ctx = new AC();
  let stopped = false;
  const segmenter = new SpeechSegmenter();
  const handle = (chunk: Float32Array) => {
    if (stopped) return;
    for (const seg of segmenter.push(downsample(chunk, ctx.sampleRate))) onSegment(seg);
  };
  // Without a user gesture the context can start suspended (hands-free came back on by itself): resume on the next tap.
  const resume = () => void ctx.resume().catch(() => undefined);
  if (ctx.state === "suspended") resume();
  window.addEventListener("pointerdown", resume, { once: true, capture: true });
  window.addEventListener("keydown", resume, { once: true, capture: true });

  const source = ctx.createMediaStreamSource(stream);
  const sink = ctx.createGain();
  sink.gain.value = 0; // pulls the graph without playing the microphone back
  sink.connect(ctx.destination);
  let node: AudioNode;
  try {
    if (!ctx.audioWorklet) throw new Error("no worklet");
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const w = new AudioWorkletNode(ctx, "sf-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    w.port.onmessage = (e: MessageEvent<Float32Array>) => handle(e.data);
    node = w;
  } catch {
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
    node = sp;
  }
  source.connect(node);
  node.connect(sink);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointerdown", resume, { capture: true });
    window.removeEventListener("keydown", resume, { capture: true });
    for (const t of stream.getTracks()) t.stop();
    try {
      source.disconnect();
      node.disconnect();
    } catch {
      /* already disconnected */
    }
    void ctx.close().catch(() => undefined);
    segmenter.reset();
  };
  // Another app took the microphone, or it was unplugged.
  for (const t of stream.getAudioTracks()) {
    t.addEventListener("ended", () => {
      if (stopped) return;
      stop();
      onError(new VoiceError("The microphone stopped, so hands-free mode is off."));
    });
  }
  return { stop };
}
