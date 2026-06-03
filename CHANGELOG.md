# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [0.3.1] — 2026-06-03

### Added
- **Qwen Code** support (`QWEN.md`) — convert to/from it like any other format;
  ninth supported tool. Detected by filename and included in `agentsync formats`.

## [0.3.0] — 2026-06-01

### Added
- **`agentsync setup`** — one-command onboarding: generates `AGENTS.md` (by scanning
  the repo), writes `agentsync.json`, runs the first sync, and installs a
  zero-dependency git pre-commit hook. `--auto` lets the hook accept edits to any
  rule file; `--no-hook` skips it.
- **`agentsync sync --init`** — scaffold `agentsync.json`, auto-detecting which rule
  files already exist (no hand-writing).
- **`sync --stage`** — git-add the regenerated files (used by the hook so it stages
  only what it changed).

### Fixed
- Converting e.g. `CLAUDE.md` → `AGENTS.md` no longer carries the source filename
  across as the document title (`# CLAUDE`); generic tool filenames fall back to the
  target's own title, while real project titles are preserved.

## [0.2.0] — 2026-06-01

### Added
- **`sync`** — one source of truth (`agentsync.json`) regenerates every target;
  `--check` for CI, `--watch` for local dev.
- **`sync --auto`** — edit any rule file; a snapshot detects which one changed and
  regenerates the rest. Two simultaneous edits raise a conflict instead of
  overwriting (resolve with `--source`).
- **`merge`** — fold several rule files into one.
- Three more formats: `.clinerules` (Cline), `CONVENTIONS.md` (Aider),
  `GEMINI.md` (Gemini CLI) — eight total.
- `--json` output for `convert` / `merge` / `detect` / `lint`.
- Smarter `init`: generated/ignored dirs (from `.gitignore`) go into a Do-not section.
- Semantic parsing: flat rule files are split into Build / Style / Do-not sections.

## [0.1.0] — 2026-06-01

### Added
- Initial release: `init` (scan repo → AGENTS.md), `convert` between formats,
  `generate`, `lint`, `detect`, `formats`.
- Zero-dependency engine shared by the CLI and a browser playground.
- Reusable `lint` GitHub Action; CI on Node 18/20/22.
