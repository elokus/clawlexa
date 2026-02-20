# Documentation Index

This directory is the canonical documentation hub for the repository.

## Start Here

- `README.md`: repository entrypoint and quick-start.
- `AGENTS.md`: project-level working rules and architecture summary.

## Core Architecture

- `docs/SESSION_MANAGEMENT.md`: session model (`voice`, `subagent`, `terminal`) and lifecycle.
- `docs/TOOLS_AND_SUBAGENTS.md`: tool execution and delegated subagent flow.
- `docs/CODE_PATTERNS.md`: important patterns and previous bug fixes.
- `docs/VOICE_PROVIDER_INTEGRATION.md`: app-level config, control APIs, and operational commands.
- `docs/COMPONENT_DEV.md`: frontend and backend component development.

## Voice Runtime Package

- `docs/voice-runtime/README.md`: package overview and reading order.
- `docs/voice-runtime/ARCHITECTURE.md`: runtime internals and control/media/provider planes.
- `docs/voice-runtime/PROVIDERS.md`: adapter catalog and capability differences.
- `docs/voice-runtime/INTERRUPTION_TRACKING.md`: framework-level interruption resolution.
- `docs/voice-runtime/INTEGRATION.md`: `pi-agent` integration points and migration notes.
- `docs/PIPECAT_RTVI_PROVIDER.md`: Pipecat-specific adapter behavior and operational checklist.
- `docs/VOICE_BENCHMARKS.md`: benchmark metrics, thresholds, and report workflow.

## Canonical Rule

- `docs/voice-runtime/*` is the source of truth for runtime internals and adapter behavior.
- `docs/VOICE_PROVIDER_INTEGRATION.md` is intentionally a thin app-operations layer to avoid duplicate technical detail.
