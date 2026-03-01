import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CONFIG_DIR = process.env.VOICE_CONFIG_DIR ?? path.join(REPO_ROOT, '.voiceclaw');
const VOICES_DIR = path.join(CONFIG_DIR, 'voices');

export interface VoiceMeta {
  label: string;
  refText: string;
  language: string;
  instruct?: string;
  model?: string;
  seed?: number;
  createdAt: string;
}

export interface VoiceEntry {
  meta: VoiceMeta;
  refAudioPath: string;
}

function ensureVoicesDir(): void {
  if (!fs.existsSync(VOICES_DIR)) {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
  }
}

function voiceDir(label: string): string {
  return path.join(VOICES_DIR, label);
}

function metaPath(label: string): string {
  return path.join(voiceDir(label), 'meta.json');
}

function refWavPath(label: string): string {
  return path.join(voiceDir(label), 'ref.wav');
}

export function listVoices(): VoiceMeta[] {
  ensureVoicesDir();
  const entries: VoiceMeta[] = [];
  for (const name of fs.readdirSync(VOICES_DIR)) {
    const mp = metaPath(name);
    if (!fs.existsSync(mp)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(mp, 'utf8')) as VoiceMeta;
      entries.push(raw);
    } catch {
      // skip malformed entries
    }
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

export function getVoice(label: string): VoiceEntry | null {
  const mp = metaPath(label);
  if (!fs.existsSync(mp)) return null;
  const rp = refWavPath(label);
  if (!fs.existsSync(rp)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(mp, 'utf8')) as VoiceMeta;
    return { meta, refAudioPath: rp };
  } catch {
    return null;
  }
}

export function saveVoice(label: string, meta: Omit<VoiceMeta, 'label' | 'createdAt'>, wavBuffer: Buffer): VoiceMeta {
  ensureVoicesDir();
  const dir = voiceDir(label);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fullMeta: VoiceMeta = {
    ...meta,
    label,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(metaPath(label), `${JSON.stringify(fullMeta, null, 2)}\n`, 'utf8');
  fs.writeFileSync(refWavPath(label), wavBuffer);
  return fullMeta;
}

export function deleteVoice(label: string): boolean {
  const dir = voiceDir(label);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function getVoicesDir(): string {
  ensureVoicesDir();
  return VOICES_DIR;
}
