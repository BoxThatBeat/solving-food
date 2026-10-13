// Speech recognition for hands-free mode (R4.32, R4.34): Whisper tiny.en through Transformers.js, in this Web Worker so
// inference never blocks the cooking controls. In: 16 kHz mono Float32 PCM from the page. Out: text. Nothing else goes
// in or out; the audio is never stored or sent. The model files (and ONNX Runtime's WASM) download once from the
// Hugging Face Hub / jsDelivr CDNs and are kept by the library in the browser's Cache API (`transformers-cache`).
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type SttRequest = { type: "load"; gpu: boolean } | { type: "transcribe"; id: number; audio: Float32Array };
export type SttResponse =
  /** `loadMs`: the pipeline (download or cache); `warmMs`: the warm-up pass on a second of silence (M13). */
  | { type: "ready"; device: "webgpu" | "wasm"; model: string; loadMs: number; warmMs: number }
  /** WebGPU exists but `requestAdapter()` gave nothing: the page remembers it so the next start doesn't ask (M12). */
  | { type: "no-gpu" }
  /** `ms`: the inference alone, in the worker. */
  | { type: "text"; id: number; text: string; ms: number }
  | { type: "error"; id?: number; message: string };

const MODEL = "onnx-community/whisper-tiny.en";

env.allowLocalModels = false;
// No cross-origin isolation (no COOP/COEP headers), so no SharedArrayBuffer: one WASM thread, plenty for tiny.en.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

let asr: Promise<{ run: AutomaticSpeechRecognitionPipeline; device: "webgpu" | "wasm"; loadMs: number; warmMs: number }> | null = null;

/**
 * Decoding for short commands (M13): greedy, no timestamps, no chunking (one window), and a token budget that grows
 * with the audio (≈ 5 tokens a second of speech, at least 16, at most 64) so a command costs a handful of decoder steps
 * while a long sentence still reaches its last keyword (the last one wins).
 */
export function decodeOptions(samples: number) {
  const seconds = samples / 16_000;
  return { max_new_tokens: Math.min(64, Math.max(16, Math.ceil(seconds * 5))), num_beams: 1, do_sample: false, return_timestamps: false } as const;
}

async function webgpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    if (await gpu.requestAdapter()) return true;
  } catch {
    /* treated as no adapter */
  }
  post({ type: "no-gpu" });
  return false;
}

/**
 * `gpu` comes from the page (M12): false on Safari / iOS (WebKit), where loading the fp32 encoder on the GPU took the
 * whole page down on an iPhone, and on a device that already reported no adapter. Then it's WASM with q8 weights.
 */
async function load(gpu: boolean) {
  const t0 = performance.now();
  let loaded: { run: AutomaticSpeechRecognitionPipeline; device: "webgpu" | "wasm" } | null = null;
  if (gpu && (await webgpu())) {
    try {
      const run = await pipeline("automatic-speech-recognition", MODEL, { device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } });
      loaded = { run, device: "webgpu" };
    } catch (e) {
      console.warn("[hands-free] WebGPU failed, using WASM", e);
    }
  }
  loaded ??= { run: await pipeline("automatic-speech-recognition", MODEL, { device: "wasm", dtype: "q8" }), device: "wasm" };
  const t1 = performance.now();
  // Warm-up (M13): the first inference compiles kernels and allocates; do it now so the first command isn't the slow one.
  const silence = new Float32Array(16_000);
  await loaded.run(silence, decodeOptions(silence.length));
  return { ...loaded, loadMs: t1 - t0, warmMs: performance.now() - t1 };
}

const post = (m: SttResponse) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<SttRequest>) => {
  const m = e.data;
  try {
    asr ??= load(m.type === "load" ? m.gpu : false);
  } catch (err) {
    post({ type: "error", message: String(err) });
    return;
  }
  if (m.type === "load") {
    try {
      const a = await asr;
      post({ type: "ready", device: a.device, model: MODEL, loadMs: Math.round(a.loadMs), warmMs: Math.round(a.warmMs) });
    } catch (err) {
      asr = null;
      post({ type: "error", message: String(err) });
    }
    return;
  }
  try {
    const { run } = await asr;
    const t0 = performance.now();
    const out = await run(m.audio, decodeOptions(m.audio.length));
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
    post({ type: "text", id: m.id, text, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: "error", id: m.id, message: String(err) });
  }
};
