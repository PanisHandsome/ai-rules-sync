// Sync engine (Node only). Reads agentsync.json and regenerates every target
// file from a single source of truth.
//
//   { "source": "AGENTS.md",
//     "targets": ["CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"] }
//
// A target may also be an object: { "file": "X", "to": "<format>" } to force the
// output format instead of inferring it from the filename.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { convert, detectFormat } from '../core/agentsync.js';

export const CONFIG_NAME = 'agentsync.json';

export const EXAMPLE_CONFIG = {
  source: 'AGENTS.md',
  targets: ['CLAUDE.md', '.cursorrules', '.github/copilot-instructions.md'],
};

export function loadConfig(dir = '.') {
  const path = join(dir, CONFIG_NAME);
  if (!existsSync(path)) {
    const err = new Error(`No ${CONFIG_NAME} found. Create one, e.g.:\n${JSON.stringify(EXAMPLE_CONFIG, null, 2)}`);
    err.code = 'NO_CONFIG';
    throw err;
  }
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  if (!cfg.source || !Array.isArray(cfg.targets)) {
    throw new Error(`${CONFIG_NAME} must have a "source" string and a "targets" array.`);
  }
  return cfg;
}

/**
 * Regenerate all targets from the source.
 * @param {{dir?: string, write?: boolean}} opts  write=false → dry run (for --check)
 * @returns {{ source: string, results: {file: string, to: string, changed: boolean, missing: boolean}[], warnings: string[] }}
 */
export function sync({ dir = '.', write = true } = {}) {
  const cfg = loadConfig(dir);
  const srcPath = join(dir, cfg.source);
  if (!existsSync(srcPath)) throw new Error(`source not found: ${cfg.source}`);
  const srcText = readFileSync(srcPath, 'utf8');
  const from = detectFormat(basename(cfg.source), srcText);

  const results = [];
  const warnings = [];
  for (const t of cfg.targets) {
    const file = typeof t === 'string' ? t : t.file;
    const to = (typeof t === 'object' && t.to) || detectFormat(basename(file));
    const res = convert(srcText, { from, to });
    res.warnings.forEach((w) => warnings.push(`${file}: ${w}`));
    const path = join(dir, file);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const changed = before !== res.output;
    if (write && changed) writeFileSync(path, res.output);
    results.push({ file, to, changed, missing: before === null });
  }
  return { source: cfg.source, results, warnings };
}
