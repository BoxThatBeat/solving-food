// Speech recognition for hands-free mode (R4.32, R4.34): Whisper tiny.en through Transformers.js, in this Web Worker so
// inference never blocks the cooking controls. In: 16 kHz mono Float32 PCM from the page. Out: text. Nothing else goes
// in or out; the audio is never stored or sent. The model files (and ONNX Runtime's WASM) download once from the
// Hugging Face Hub / jsDelivr CDNs and are kept by the library in the browser's Cache API (`transformers-cache`).
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type SttRequest = { type: "load"; gpu: boolean } | { type: "transcribe"; id: number; audio: Float32Array };
export type SttResponse =
  | { type: "ready"; device: "webgpu" | "wasm" }
  /** WebGPU exists but `requestAdapter()` gave nothing: the page remembers it so the next start doesn't ask (M12). */
  | { type: "no-gpu" }
  | { type: "text"; id: number; text: string }
  | { type: "error"; id?: number; message: string };

const MODEL = "onnx-community/whisper-tiny.en";

env.allowLocalModels = false;
// No cross-origin isolation (no COOP/COEP headers), so no SharedArrayBuffer: one WASM thread, plenty for tiny.en.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

let asr: Promise<{ run: AutomaticSpeechRecognitionPipeline; device: "webgpu" | "wasm" }> | null = null;

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
  if (gpu && (await webgpu())) {
    try {
      const run = await pipeline("automatic-speech-recognition", MODEL, { device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } });
      return { run, device: "webgpu" as const };
    } catch (e) {
      console.warn("[hands-free] WebGPU failed, using WASM", e);
    }
  }
  const run = await pipeline("automatic-speech-recognition", MODEL, { device: "wasm", dtype: "q8" });
  return { run, device: "wasm" as const };
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
      post({ type: "ready", device: (await asr).device });
    } catch (err) {
      asr = null;
      post({ type: "error", message: String(err) });
    }
    return;
  }
  try {
    const { run } = await asr;
    const out = await run(m.audio);
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
    post({ type: "text", id: m.id, text });
  } catch (err) {
    post({ type: "error", id: m.id, message: String(err) });
  }
};
