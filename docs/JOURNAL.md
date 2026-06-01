# Build journal — 2026-06-01

A record of how this project came to be, what was built, and the honest
conclusions we reached about its place in the ecosystem.

## Origin

The goal started as: apply to OpenAI's **Codex for OSS** program, which backs
maintainers of open-source projects with *meaningful usage / broad adoption*. Since
that program rewards existing traction (stars, downloads), building a brand-new
project to apply with is a long game. We picked an idea in OpenAI's lane:
tooling around **AGENTS.md** (the rules file Codex reads).

## What we built (one day)

`agentsync` — one source of truth for AI coding-agent rule files.

- **Engine** (`src/core/agentsync.js`): zero-dependency, isomorphic (runs in Node
  and the browser). Parses any rule file into a normalized IR, then renders to any
  target format. Semantic parsing splits flat files into Build / Style / Do-not.
- **CLI** (`bin/agentsync.mjs`): `setup`, `init`, `sync` (+ `--auto` / `--check` /
  `--watch` / `--stage` / `--init`), `convert`, `merge`, `generate`, `lint`,
  `detect`, `formats`. `--json` where it makes sense.
- **Repo scanner** (`src/node/scan.js`): detects language / framework / package
  manager / build-test-lint commands; adds generated dirs to a Do-not section.
- **Sync engine** (`src/node/sync.js`): config-driven (`agentsync.json`), with a
  snapshot-based `--auto` mode and conflict protection.
- **Linter** (`src/node/lint.js`): flags missing paths, absent commands, stale
  placeholders. Shipped as a reusable GitHub Action.
- **Playground** (`web/`): browser UI on the same engine, deployed to GitHub Pages.
- **Infra**: 64 tests, CI on Node 18/20/22, release workflow, npm publishing
  (`@panishandsome/agentsync`), three GitHub Releases (0.1.0 → 0.3.0).

## The honest market check

Before promoting, we researched the landscape. Findings:

- **Convert / sync between rule files** is dominated by **rulesync** (~1,135★,
  ~213k npm downloads/week) — far more featured (MCP, subagents, skills, commands).
- **Claude Code → Codex migration** has no dominant player, but the niche is small
  and already has 6–8 lookalikes (ccode-to-codex ~51★, coder-config, cc2codex,
  codex-export, …) that already do MCP/config.toml conversion and migration reports.
- **AGENTS.md linting / quality** is also occupied by several polished tools
  (agentlint.app, ctxlint, agents-lint, agentlinter.com).
- Crucially, **AGENTS.md is becoming the native standard** (read by Cursor, Copilot,
  Codex, Gemini, Aider, Windsurf, Zed; Linux Foundation; 60k+ repos). Standardization
  is *shrinking* the need for conversion/sync tooling. The only real holdout is
  Claude Code, which a symlink solves.

**Conclusion:** the entire "AGENTS.md tooling" category is saturated and small —
not because no one noticed it, but because the underlying need is being collapsed by
standardization. Continuing to extend this project would not reach the adoption bar
Codex for OSS requires.

## Decision

Keep `agentsync` as a **finished portfolio / learning project** — it is fully
shipped, tested, documented, and demonstrable. We chose not to invest in external
promotion. The real value captured here is the **reusable template**: a complete
"ship a zero-dependency OSS CLI + browser playground + npm + CI + Pages + releases"
pipeline that makes the next project much faster.

## Lessons

- For an adoption-gated goal (like Codex for OSS), **idea selection and a competitive
  check should come before building**, not after.
- "No dominant player" can mean "small market," not "open opportunity." Check size,
  not just leaders.
- Standardization (AGENTS.md, MCP) tends to eat "translate between tools" products.
  Build *with* the trend, not against it.
