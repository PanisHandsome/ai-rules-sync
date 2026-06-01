#!/usr/bin/env node
// agentsync CLI — convert between AI agent rule files, or generate AGENTS.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { watch } from 'node:fs';
import { convert, merge, generate, detectFormat, FORMATS } from '../src/core/agentsync.js';
import { scanRepo } from '../src/node/scan.js';
import { lintFile } from '../src/node/lint.js';
import { sync, syncAuto, loadConfig, configFiles } from '../src/node/sync.js';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name, short) {
  const i = args.findIndex((a) => a === `--${name}` || (short && a === `-${short}`));
  return i >= 0 ? args[i + 1] : undefined;
}
function has(name) {
  return args.includes(`--${name}`);
}

const HELP = `agentsync — one source of truth for your AI coding-agent rules

Usage:
  agentsync init [dir] [-o <out>] [--force]    scan a repo and write AGENTS.md
  agentsync sync [--check] [--watch]            regenerate targets from the source in agentsync.json
  agentsync sync --auto [--source <file>]       edit ANY file; the changed one wins, others follow
  agentsync convert <file> [--to agents|claude|cursor|copilot|windsurf|cline|aider|gemini] [--from <fmt>] [-o <out>]
  agentsync merge <file> <file> ... [--to <fmt>] [-o <out>]
  agentsync generate --name <n> [--language ts] [--framework next] [--test "npm test"] ... [-o <out>]
  agentsync lint <file> [--strict]              check an AGENTS.md for staleness
  agentsync detect <file>
  agentsync formats

  convert / merge / detect / lint accept --json for machine-readable output.

Examples:
  agentsync init                                # scans the current repo
  agentsync sync                                # AGENTS.md -> all targets
  agentsync sync --check                        # CI: fail if anything is out of sync
  agentsync convert .cursorrules --to agents -o AGENTS.md
  agentsync merge CLAUDE.md .cursorrules -o AGENTS.md
`;

function out(text, target) {
  if (target) {
    writeFileSync(target, text);
    process.stderr.write(`✓ wrote ${target}\n`);
  } else {
    process.stdout.write(text);
  }
}

try {
  switch (cmd) {
    case 'init': {
      const dir = args[1] && !args[1].startsWith('-') ? args[1] : '.';
      const { spec, detected } = scanRepo(dir);
      const res = generate(spec);
      const target = flag('o', 'o') || 'AGENTS.md';
      process.stderr.write(`Detected: ${detected.join(' · ')}\n`);
      if (existsSync(target) && !has('force')) {
        process.stderr.write(`✗ ${target} already exists. Re-run with --force to overwrite, or use -o <file>.\n`);
        process.exit(1);
      }
      writeFileSync(target, res.output);
      process.stderr.write(`✓ wrote ${target}\n`);
      break;
    }
    case 'convert': {
      const file = args[1];
      if (!file || !existsSync(file)) throw new Error(`file not found: ${file}`);
      const text = readFileSync(file, 'utf8');
      const from = flag('from') || detectFormat(basename(file), text);
      const to = flag('to') || 'agents';
      const res = convert(text, { from, to });
      if (has('json')) {
        process.stdout.write(JSON.stringify({ from, to, warnings: res.warnings, output: res.output }, null, 2) + '\n');
        break;
      }
      res.warnings.forEach((w) => process.stderr.write(`⚠ ${w}\n`));
      process.stderr.write(`→ ${from} → ${to}\n`);
      out(res.output, flag('o', 'o'));
      break;
    }
    case 'generate': {
      const spec = {
        name: flag('name'),
        description: flag('description'),
        language: flag('language'),
        framework: flag('framework'),
        packageManager: flag('pm'),
        install: flag('install'),
        build: flag('build'),
        test: flag('test'),
        lint: flag('lint'),
        dev: flag('dev'),
      };
      const res = generate(spec);
      out(res.output, flag('o', 'o'));
      break;
    }
    case 'sync': {
      const auto = has('auto');
      const runOnce = () => {
        let res;
        try {
          res = auto
            ? syncAuto({ write: !has('check'), source: flag('source') })
            : sync({ write: !has('check') });
        } catch (e) {
          if (e.code === 'CONFLICT') { process.stderr.write(`✗ ${e.message}\n`); process.exit(2); }
          throw e;
        }
        if (res.noop) { process.stderr.write('· nothing changed\n'); return 0; }
        res.warnings.forEach((w) => process.stderr.write(`⚠ ${w}\n`));
        if (auto && res.winner) process.stderr.write(`source this run: ${res.winner}\n`);
        const changed = res.results.filter((r) => r.changed);
        for (const r of res.results) {
          const mark = r.changed ? (has('check') ? '✗ out of sync' : '✓ updated') : '· up to date';
          process.stderr.write(`  ${mark}  ${r.file}\n`);
        }
        if (has('check') && changed.length) {
          process.stderr.write(`\n${changed.length} file(s) out of sync. Run \`agentsync sync${auto ? ' --auto' : ''}\`.\n`);
          process.exit(1);
        }
        return changed.length;
      };
      if (has('watch')) {
        runOnce();
        const cfg = loadConfig('.');
        const watched = auto ? configFiles(cfg).map((f) => f.file) : [cfg.source];
        process.stderr.write(`\n👀 watching ${watched.join(', ')} … (Ctrl-C to stop)\n`);
        let busy = false;
        for (const f of watched) {
          if (!existsSync(f)) continue;
          watch(f, () => {
            if (busy) return;
            busy = true;
            setTimeout(() => { try { runOnce(); } catch (e) { process.stderr.write(`Error: ${e.message}\n`); } busy = false; }, 80);
          });
        }
      } else {
        runOnce();
        process.exit(0);
      }
      break;
    }
    case 'merge': {
      const files = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('-')) break;
        files.push(args[i]);
      }
      if (files.length < 2) throw new Error('merge needs at least two files');
      const inputs = files.map((f) => {
        if (!existsSync(f)) throw new Error(`file not found: ${f}`);
        const text = readFileSync(f, 'utf8');
        return { text, from: detectFormat(basename(f), text) };
      });
      const to = flag('to') || 'agents';
      const res = merge(inputs, { to });
      if (has('json')) {
        process.stdout.write(JSON.stringify({ to, warnings: res.warnings, output: res.output }, null, 2) + '\n');
        break;
      }
      res.warnings.forEach((w) => process.stderr.write(`⚠ ${w}\n`));
      process.stderr.write(`↳ merged ${files.length} files → ${to}\n`);
      out(res.output, flag('o', 'o'));
      break;
    }
    case 'lint': {
      const file = args[1];
      if (!file || !existsSync(file)) throw new Error(`file not found: ${file}`);
      const { findings } = lintFile(file);
      const errors = findings.filter((f) => f.level === 'error').length;
      const warns = findings.filter((f) => f.level === 'warn').length;
      const failed = errors > 0 || (has('strict') && warns > 0);
      if (has('json')) {
        process.stdout.write(JSON.stringify({ file, errors, warnings: warns, findings, ok: !failed }, null, 2) + '\n');
        process.exit(failed ? 1 : 0);
      }
      const icon = { error: '✗', warn: '⚠', info: 'ℹ' };
      for (const f of findings) process.stderr.write(`${icon[f.level]} ${f.message}\n`);
      if (!findings.length) process.stdout.write(`✓ ${file} looks good\n`);
      else process.stderr.write(`\n${errors} error(s), ${warns} warning(s)\n`);
      process.exit(failed ? 1 : 0);
    }
    case 'detect': {
      const file = args[1];
      if (!file || !existsSync(file)) throw new Error(`file not found: ${file}`);
      const text = readFileSync(file, 'utf8');
      const fmt = detectFormat(basename(file), text);
      if (has('json')) {
        process.stdout.write(JSON.stringify({ format: fmt, label: FORMATS[fmt].label }) + '\n');
        break;
      }
      process.stdout.write(`${fmt} — ${FORMATS[fmt].label}\n`);
      break;
    }
    case 'formats': {
      for (const f of Object.values(FORMATS)) {
        process.stdout.write(`${f.id.padEnd(10)} ${f.filename.padEnd(34)} ${f.label}\n`);
      }
      break;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write(HELP);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
