// Linter for AGENTS.md-style files (Node only — checks the filesystem).
// Catches the most common kind of rot: a rules file that drifts away from the
// repo it describes (missing paths, no commands, leftover placeholders).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const PATH_EXT = /\.(m?[jt]sx?|cjs|py|go|rs|json|md|toml|ya?ml|lock|txt|sh|cfg|ini)$/;

/**
 * @param {string} text   file contents
 * @param {string} baseDir directory the file lives in (for resolving paths)
 * @returns {{level: 'error'|'warn'|'info', message: string}[]}
 */
export function lint(text, baseDir = '.') {
  const findings = [];
  const add = (level, message) => findings.push({ level, message });

  if (!text.trim()) {
    add('error', 'File is empty.');
    return findings;
  }
  if (!/^#{1,6}\s+/m.test(text)) {
    add('error', 'No markdown headings found — agents read structure from headings.');
  }

  const hasCmd = /`[^`]*\b(test|build|run|install|dev|start|lint|pytest|cargo|go|make)\b[^`]*`/i.test(text);
  if (!hasCmd) {
    add('warn', 'No setup/build/test commands found. Spell them out so agents do not guess.');
  }

  // Referenced paths inside backticks.
  const seen = new Set();
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    let tok = m[1];
    if (/^https?:/.test(tok)) continue;
    const looksPath = tok.includes('/') || PATH_EXT.test(tok);
    if (!looksPath) continue;
    const clean = tok.replace(/^\.\//, '').replace(/[)\].,*]+$/, '').replace(/\/$/, '');
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    const abs = isAbsolute(clean) ? clean : join(baseDir, clean);
    if (!existsSync(abs)) add('warn', `Referenced path not found: \`${tok}\``);
  }

  // Claude-style @path imports (only flag things that look like real paths).
  for (const m of text.matchAll(/(?:^|\s)@([\w./-]+)/g)) {
    const p = m[1];
    if (!p.includes('/') && !/\.\w+$/.test(p)) continue; // skip words like "@imports"
    const abs = isAbsolute(p) ? p : join(baseDir, p);
    if (!existsSync(abs)) add('warn', `@import path not found: \`@${p}\``);
  }

  if (/\bTODO\b|\bFIXME\b|<[A-Za-z][^>]*>/.test(text)) {
    add('info', 'Contains TODO/FIXME or <placeholder> text.');
  }

  return findings;
}

export function lintFile(file) {
  const text = readFileSync(file, 'utf8');
  return { findings: lint(text, dirname(file)), text };
}
