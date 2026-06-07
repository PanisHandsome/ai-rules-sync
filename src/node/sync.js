// Sync engine (Node only). Reads agentsync.json and regenerates every target
// file from a single source of truth.
//
//   { "source": "AGENTS.md",
//     "targets": ["CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"] }
//
// A target may also be an object: { "file": "X", "to": "<format>" } to force the
// output format instead of inferring it from the filename.
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdtempSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { convert, detectFormat } from '../core/agentsync.js';

export const CONFIG_NAME = 'agentsync.json';
export const STATE_NAME = '.agentsync-state.json';

const sha = (s) => createHash('sha1').update(s).digest('hex');

/**
 * Atomically write `content` to `path`.
 *
 * Strategy: write to a temp file in the same directory as the target, then
 * rename it on top of the target. On any error, the temp file is removed and
 * the original target (if any) is left untouched. A `.bak` of the previous
 * content is kept next to the target so a user can recover with `mv file.bak
 * file` if the new content was unintended.
 *
 * Same-directory rename is atomic on POSIX and on NTFS, so partial writes
 * never produce a half-written target.
 */
export function safeWrite(path, content) {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, content);
  try {
    if (existsSync(path)) {
      const bak = `${path}.bak`;
      writeFileSync(bak, readFileSync(path));
    }
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

export const EXAMPLE_CONFIG = {
  source: 'AGENTS.md',
  targets: ['CLAUDE.md', '.cursorrules', '.github/copilot-instructions.md'],
};

// Target files we know how to generate, in a sensible default order.
const KNOWN_TARGETS = [
  'CLAUDE.md', '.cursorrules', '.github/copilot-instructions.md',
  '.windsurfrules', '.clinerules', 'CONVENTIONS.md', 'GEMINI.md',
];

/**
 * Scaffold an agentsync.json. Targets default to whichever known rule files
 * already exist in the repo; if none do, a sensible starter set is used.
 */
export function initConfig(dir = '.') {
  const path = join(dir, CONFIG_NAME);
  if (existsSync(path)) {
    const err = new Error(`${CONFIG_NAME} already exists`);
    err.code = 'EXISTS';
    throw err;
  }
  const present = KNOWN_TARGETS.filter((f) => existsSync(join(dir, f)));
  const cfg = { source: 'AGENTS.md', targets: present.length ? present : ['CLAUDE.md', '.cursorrules'] };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

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

// Every file the config touches, with its resolved format. Source first.
export function configFiles(cfg) {
  const files = [{ file: cfg.source, to: detectFormat(basename(cfg.source)) }];
  for (const t of cfg.targets) {
    const file = typeof t === 'string' ? t : t.file;
    files.push({ file, to: (typeof t === 'object' && t.to) || detectFormat(basename(file)) });
  }
  return files;
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
    if (write && changed) safeWrite(path, res.output);
    results.push({ file, to, changed, missing: before === null });
  }
  return { source: cfg.source, results, warnings };
}

/**
 * Auto mode: any file may be edited. The one that changed since the last sync
 * becomes the source for this run; the others are regenerated from it. A snapshot
 * in .agentsync-state.json tracks "what changed". If two files changed at once it
 * refuses and asks which wins (pass `source` to force).
 *
 * @param {{dir?: string, write?: boolean, source?: string}} opts
 */
export function syncAuto({ dir = '.', write = true, source: forced } = {}) {
  const cfg = loadConfig(dir);
  const all = configFiles(cfg);
  const fmtOf = (f) => (all.find((x) => x.file === f) || {}).to || detectFormat(basename(f));

  const statePath = join(dir, STATE_NAME);
  let state = {};
  if (existsSync(statePath)) { try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { state = {}; } }

  const cur = {};
  for (const { file } of all) {
    const p = join(dir, file);
    const exists = existsSync(p);
    const text = exists ? readFileSync(p, 'utf8') : null;
    cur[file] = { exists, text, hash: exists ? sha(text) : null };
  }

  const names = all.map((x) => x.file);
  const hasState = Object.keys(state).length > 0;

  let winner;
  if (forced) {
    winner = forced;
  } else if (!hasState) {
    winner = cfg.source; // bootstrap from the configured source
  } else {
    const changed = names.filter((f) => cur[f].exists && state[f] !== cur[f].hash);
    if (changed.length === 1) {
      winner = changed[0];
    } else if (changed.length === 0) {
      const missing = names.filter((f) => !cur[f].exists);
      if (!missing.length) return { mode: 'auto', winner: null, noop: true, results: [], warnings: [] };
      winner = cfg.source;
    } else {
      const err = new Error(`Multiple files changed since last sync: ${changed.join(', ')}. Re-run with --source <file> to choose which wins.`);
      err.code = 'CONFLICT';
      throw err;
    }
  }

  if (!cur[winner] || !cur[winner].exists) throw new Error(`source not found: ${winner}`);

  const from = fmtOf(winner);
  const results = [];
  const warnings = [];
  const newState = { [winner]: cur[winner].hash };
  for (const { file } of all) {
    if (file === winner) continue;
    const to = fmtOf(file);
    const res = convert(cur[winner].text, { from, to });
    res.warnings.forEach((w) => warnings.push(`${file}: ${w}`));
    const changed = cur[file].text !== res.output;
    if (write && changed) safeWrite(join(dir, file), res.output);
    newState[file] = sha(res.output);
    results.push({ file, to, changed, missing: !cur[file].exists });
  }
  if (write) safeWrite(statePath, JSON.stringify(newState, null, 2) + '\n');
  return { mode: 'auto', winner, results, warnings };
}
