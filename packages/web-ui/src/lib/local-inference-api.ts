const API_BASE = process.env.PUBLIC_API_URL || '';

export type LocalModelKind = 'stt' | 'tts';

export interface LocalModelCatalogEntry {
  kind: LocalModelKind;
  model_id: string;
  canonical_model_id: string;
  label: string;
  family: string;
  quantization: string;
  estimated_size_gb?: number | null;
  supports_streaming?: boolean;
  default_voice?: string | null;
  aliases?: string[];
  notes?: string | null;
  installed: boolean;
  loaded: boolean;
}

export interface LocalModelCatalogResponse {
  stt: LocalModelCatalogEntry[];
  tts: LocalModelCatalogEntry[];
  loaded: {
    stt: string | null;
    tts: string | null;
  };
  defaults: {
    stt: string;
    tts: string;
  };
}

export interface LocalModelStateResponse {
  loaded: {
    stt: string | null;
    tts: string | null;
  };
  installed: Record<string, boolean>;
  updated_at: number;
}

export interface LocalModelDownloadRequest {
  kind: LocalModelKind;
  model: string;
  revision?: string;
  force?: boolean;
  preload?: boolean;
}

export interface LocalModelLoadRequest {
  kind: LocalModelKind;
  model: string;
  warmup?: boolean;
}

export interface LocalTtsBenchmarkRequest {
  model: string;
  text: string;
  voice?: string;
  language?: string;
  temperature?: number;
  seed?: number;
  instruct?: string;
  stream?: boolean;
  streaming_interval?: number;
  runs?: number;
}

export interface LocalTtsBenchmarkRun {
  run: number;
  ttfb_ms: number | null;
  total_ms: number;
  audio_ms: number;
  rtf: number | null;
  chunk_count: number;
  pcm_bytes: number;
}

export interface LocalTtsBenchmarkResponse {
  model: string;
  canonical_model_id: string;
  sample_rate: number;
  streaming: {
    requested: boolean;
    active: boolean;
    supported: boolean;
    interval: number | null;
    average_chunk_count: number;
    max_chunk_count: number;
  };
  runs: LocalTtsBenchmarkRun[];
  aggregate: {
    ttfb_ms: number | null;
    total_ms: number;
    audio_ms: number;
    rtf: number | null;
    chars_per_second: number;
    tokens_per_second_estimate: number;
  };
  guidance: {
    summary: string;
    recommended_streaming_interval: number | null;
    recommended_quant_model: string | null;
    tips: string[];
  };
}

export interface LocalTtsSpeechRequest {
  model: string;
  input: string;
  voice?: string;
  language?: string;
  stream?: boolean;
  streaming_interval?: number;
  seed?: number;
  temperature?: number;
  instruct?: string;
  response_format?: 'pcm';
}

async function readJsonOrThrow<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${context} (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchLocalModelCatalog(): Promise<LocalModelCatalogResponse> {
  const res = await fetch(`${API_BASE}/api/local-inference/models/catalog`);
  return readJsonOrThrow<LocalModelCatalogResponse>(res, 'Failed to fetch local model catalog');
}

export async function fetchLocalModelState(): Promise<LocalModelStateResponse> {
  const res = await fetch(`${API_BASE}/api/local-inference/models/state`);
  return readJsonOrThrow<LocalModelStateResponse>(res, 'Failed to fetch local model state');
}

export async function downloadLocalModel(input: LocalModelDownloadRequest): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/local-inference/models/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJsonOrThrow<Record<string, unknown>>(res, 'Failed to download local model');
}

export async function loadLocalModel(input: LocalModelLoadRequest): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/local-inference/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJsonOrThrow<Record<string, unknown>>(res, 'Failed to load local model');
}

export async function benchmarkLocalTts(input: LocalTtsBenchmarkRequest): Promise<LocalTtsBenchmarkResponse> {
  const res = await fetch(`${API_BASE}/api/local-inference/playground/tts/benchmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJsonOrThrow<LocalTtsBenchmarkResponse>(res, 'Failed to run local TTS benchmark');
}

export async function synthesizeLocalTtsSample(
  input: LocalTtsSpeechRequest
): Promise<{ pcm: ArrayBuffer; sampleRate: number }> {
  const res = await fetch(`${API_BASE}/api/local-inference/playground/tts/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, response_format: 'pcm' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to synthesize local TTS sample (${res.status}): ${text}`);
  }
  const sampleRateHeader = res.headers.get('x-audio-sample-rate');
  const sampleRate = Number(sampleRateHeader ?? '24000');
  return {
    pcm: await res.arrayBuffer(),
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000,
  };
}
