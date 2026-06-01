# agentsync

[![npm version](https://img.shields.io/npm/v/@panishandsome/agentsync)](https://www.npmjs.com/package/@panishandsome/agentsync)
[![npm downloads](https://img.shields.io/npm/dm/@panishandsome/agentsync)](https://www.npmjs.com/package/@panishandsome/agentsync)
[![CI](https://github.com/PanisHandsome/ai-rules-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/PanisHandsome/ai-rules-sync/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

**One source of truth for your AI coding-agent rules.**

🔗 **Live playground: https://panishandsome.github.io/ai-rules-sync/**

![agentsync playground](docs/playground.png)

Codex reads `AGENTS.md`. Claude Code reads `CLAUDE.md`. Cursor reads `.cursorrules`.
Copilot reads `.github/copilot-instructions.md`. Keeping them in sync by hand is
tedious and they drift. `agentsync` **converts between all of them** — or
**generates a clean `AGENTS.md`** from a short spec.

Zero dependencies. The exact same engine (`src/core/agentsync.js`) powers both the
CLI and the browser playground.

## Install

```bash
npm install -g @panishandsome/agentsync   # installs the `agentsync` command
# or run without installing:
npx @panishandsome/agentsync --help
```

Or just clone and run from source — there are no dependencies:

```bash
git clone https://github.com/PanisHandsome/ai-rules-sync
cd ai-rules-sync
node bin/agentsync.mjs --help
```

## Quick start

```bash
# Point it at your repo and let it write AGENTS.md for you
agentsync init

# Convert an existing rule file
agentsync convert .cursorrules --to agents -o AGENTS.md
agentsync convert CLAUDE.md --to copilot

# Generate from explicit fields instead of scanning
agentsync generate --name my-app --language TypeScript --framework Next.js \
    --test "pnpm test" --build "pnpm build" -o AGENTS.md

# Check an AGENTS.md for stale commands / missing paths
agentsync lint AGENTS.md
```

## Keep one source of truth, sync the rest

Write `AGENTS.md` once and let the other tools' files be generated from it. Add an
`agentsync.json`:

```json
{
  "source": "AGENTS.md",
  "targets": ["CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"]
}
```

```bash
agentsync sync            # regenerate every target from AGENTS.md
agentsync sync --watch    # regenerate on every save
agentsync sync --check    # CI: exit non-zero if anything is out of sync
```

Make it automatic with a pre-commit hook (so the committed files are always in sync):

```bash
npx husky init
echo "npx agentsync sync && git add -A" > .husky/pre-commit
```

Edit only `AGENTS.md` from then on — the other files are generated outputs.

## Merge existing files into one

Already have several rule files? Fold them into a single `AGENTS.md`:

```bash
agentsync merge CLAUDE.md .cursorrules -o AGENTS.md
```

## Try it in the browser

**→ https://panishandsome.github.io/ai-rules-sync/** — paste any rule file on the
left, see the converted output on the right, or switch to **Generate** mode and
fill in a short form. Runs entirely client-side; nothing is uploaded.

To run the playground locally:

```bash
npm run web      # → http://localhost:5173
```

## Supported formats

| id        | file                                  | tool          |
|-----------|---------------------------------------|---------------|
| `agents`  | `AGENTS.md`                           | Codex / open standard |
| `claude`  | `CLAUDE.md`                           | Claude Code   |
| `cursor`  | `.cursorrules`                        | Cursor        |
| `copilot` | `.github/copilot-instructions.md`     | GitHub Copilot|
| `windsurf`| `.windsurfrules`                      | Windsurf      |
| `cline`   | `.clinerules`                         | Cline         |
| `aider`   | `CONVENTIONS.md`                      | Aider         |
| `gemini`  | `GEMINI.md`                           | Gemini CLI    |

Run `agentsync formats` to list them.

## How it works

Every format is parsed into one normalized intermediate representation (sections,
intro, file globs, warnings), then rendered into the target format. Adding a new
tool means writing one parser and one renderer — nothing else changes. Tool-specific
constructs that don't translate (Cursor's `globs` frontmatter, Claude's `@path`
imports) surface as **warnings** instead of being silently dropped.

Flat, heading-less rule files are classified semantically: command lines, style
notes, and prohibitions are sorted into proper `Build & test commands`, `Code style`
and `Do not` sections rather than dumped into one blob.

## CLI reference

```
agentsync init [dir] [-o <out>] [--force]
agentsync sync [--check] [--watch]
agentsync convert <file> [--to <fmt>] [--from <fmt>] [-o <out>] [--json]
agentsync merge <file> <file> ... [--to <fmt>] [-o <out>] [--json]
agentsync generate --name <n> [--language ..] [--framework ..] [--test ..] [-o <out>]
agentsync lint <file> [--strict] [--json]
agentsync detect <file> [--json]
agentsync formats
```

## Tests

```bash
npm test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The repo's own [`AGENTS.md`](AGENTS.md) was
generated by agentsync itself (`agentsync generate`), so a coding agent can pick up
the conventions before touching anything.

## License

MIT — see [LICENSE](LICENSE).
