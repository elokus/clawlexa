from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from .tts.registry import resolve_model_id

ModelKind = Literal["stt", "tts"]


@dataclass(frozen=True)
class ModelCatalogEntry:
    kind: ModelKind
    model_id: str
    label: str
    family: str
    quantization: str
    estimated_size_gb: float | None = None
    supports_streaming: bool = False
    default_voice: str | None = None
    aliases: tuple[str, ...] = ()
    notes: str | None = None


MODEL_CATALOG: tuple[ModelCatalogEntry, ...] = (
    ModelCatalogEntry(
        kind="stt",
        model_id="mlx-community/parakeet-tdt-0.6b-v3",
        label="Parakeet TDT 0.6B v3",
        family="parakeet",
        quantization="bf16",
        estimated_size_gb=1.4,
        notes="Streaming-capable STT model.",
    ),
    ModelCatalogEntry(
        kind="tts",
        model_id="mlx-community/Kokoro-82M-bf16",
        label="Kokoro 82M (bf16)",
        family="kokoro",
        quantization="bf16",
        estimated_size_gb=0.25,
        default_voice="af_heart",
    ),
    ModelCatalogEntry(
        kind="tts",
        model_id="mlx-community/Kokoro-82M-8bit",
        label="Kokoro 82M (8bit)",
        family="kokoro",
        quantization="8bit",
        estimated_size_gb=0.14,
        default_voice="af_heart",
    ),
    ModelCatalogEntry(
        kind="tts",
        model_id="mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
        label="Qwen3 TTS 0.6B Base (bf16)",
        family="qwen3-base-0.6b",
        quantization="bf16",
        estimated_size_gb=1.5,
        supports_streaming=True,
        aliases=("qwen3-0.6b",),
    ),
    ModelCatalogEntry(
        kind="tts",
        model_id="mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
        label="Qwen3 TTS 0.6B Base (8bit)",
        family="qwen3-base-0.6b",
        quantization="8bit",
        estimated_size_gb=0.85,
        supports_streaming=True,
        aliases=("qwen3-0.6b-8bit",),
    ),
    ModelCatalogEntry(
        kind="tts",
        model_id="mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        label="Qwen3 TTS 0.6B Base (4bit)",
        family="qwen3-base-0.6b",
        quantization="4bit",
        estimated_size_gb=0.55,
        supports_streaming=True,
        aliases=("qwen3-0.6b-4bit",),
    ),
    ModelCatalogEntry(
        kind="tts",
        model_id="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
        label="Qwen3 TTS 1.7B Base (bf16)",
        family="qwen3-base-1.7b",
        quantization="bf16",
        estimated_size_gb=3.8,
        supports_streaming=True,
        aliases=("qwen3-1.7b",),
    ),
    ModelCatalogEntry(
        kind="tts",
        model_id="mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
        label="Qwen3 TTS 1.7B VoiceDesign (bf16)",
        family="qwen3-voice-design-1.7b",
        quantization="bf16",
        estimated_size_gb=3.9,
        aliases=("qwen3-1.7b-vd",),
        notes="Quality-focused VoiceDesign model (non-streaming).",
    ),
)


def canonicalize_model_id(kind: ModelKind, model_id: str) -> str:
    normalized = model_id.strip()
    if kind == "tts":
        return resolve_model_id(normalized)
    return normalized


def get_catalog_for_kind(kind: ModelKind) -> list[ModelCatalogEntry]:
    return [entry for entry in MODEL_CATALOG if entry.kind == kind]


def find_catalog_entry(kind: ModelKind, model_id: str) -> ModelCatalogEntry | None:
    canonical = canonicalize_model_id(kind, model_id)
    for entry in MODEL_CATALOG:
        if entry.kind != kind:
            continue
        if canonicalize_model_id(kind, entry.model_id) == canonical:
            return entry
        if canonical in entry.aliases:
            return entry
    return None


def entry_to_payload(entry: ModelCatalogEntry) -> dict[str, object]:
    payload = asdict(entry)
    payload["canonical_model_id"] = canonicalize_model_id(entry.kind, entry.model_id)
    return payload


def _huggingface_hub_cache_root() -> Path:
    explicit = os.getenv("HUGGINGFACE_HUB_CACHE")
    if explicit:
        return Path(explicit).expanduser()

    hf_home = os.getenv("HF_HOME")
    if hf_home:
        return Path(hf_home).expanduser() / "hub"

    return Path.home() / ".cache" / "huggingface" / "hub"


def _scan_cache_for_repo(repo_id: str) -> bool:
    try:
        from huggingface_hub import scan_cache_dir

        cache = scan_cache_dir()
    except Exception:
        return False

    for repo in cache.repos:
        if repo.repo_id != repo_id:
            continue
        if getattr(repo, "repo_type", "model") != "model":
            continue
        if len(getattr(repo, "revisions", ())) > 0:
            return True
    return False


def is_model_installed(model_id: str) -> bool:
    if not model_id:
        return False

    local_path = Path(model_id).expanduser()
    if local_path.exists():
        return True

    if _scan_cache_for_repo(model_id):
        return True

    cache_root = _huggingface_hub_cache_root()
    repo_dir = cache_root / f"models--{model_id.replace('/', '--')}"
    if not repo_dir.exists():
        return False

    snapshots_dir = repo_dir / "snapshots"
    if snapshots_dir.is_dir():
        return any(snapshots_dir.iterdir())

    return True


def directory_size_bytes(path: Path) -> int:
    total = 0
    for root, _, files in os.walk(path):
        root_path = Path(root)
        for filename in files:
            file_path = root_path / filename
            try:
                total += file_path.stat().st_size
            except OSError:
                continue
    return total


def download_snapshot(
    model_id: str,
    *,
    revision: str | None = None,
    force_download: bool = False,
) -> Path:
    try:
        from huggingface_hub import snapshot_download
    except Exception as error:
        raise RuntimeError(
            "Model downloads require huggingface_hub. Install local-inference[mlx] first."
        ) from error

    snapshot_path = snapshot_download(
        repo_id=model_id,
        revision=revision,
        resume_download=True,
        force_download=force_download,
    )
    return Path(snapshot_path)
