#!/usr/bin/env node
// agentsync CLI — convert between AI agent rule files, or generate AGENTS.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { convert, generate, detectFormat, FORMATS } from '../src/core/agentsync.js';
import { scanRepo } from '../src/node/scan.js';
import { lintFile } from '../src/node/lint.js';

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
  agentsync convert <file> [--to agents|claude|cursor|copilot|windsurf] [--from <fmt>] [-o <out>]
  agentsync generate --name <n> [--language ts] [--framework next] [--test "npm test"] ... [-o <out>]
  agentsync lint <file>                         check an AGENTS.md for staleness
  agentsync detect <file>
  agentsync formats

Examples:
  agentsync init                                # scans the current repo
  agentsync convert .cursorrules --to agents -o AGENTS.md
  agentsync convert CLAUDE.md --to copilot
  agentsync generate --name "my-app" --language TypeScript --framework Next.js \\
      --test "npm test" --build "npm run build" -o AGENTS.md
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
    case 'lint': {
      const file = args[1];
      if (!file || !existsSync(file)) throw new Error(`file not found: ${file}`);
      const { findings } = lintFile(file);
      const icon = { error: '✗', warn: '⚠', info: 'ℹ' };
      for (const f of findings) process.stderr.write(`${icon[f.level]} ${f.message}\n`);
      const errors = findings.filter((f) => f.level === 'error').length;
      const warns = findings.filter((f) => f.level === 'warn').length;
      if (!findings.length) process.stdout.write(`✓ ${file} looks good\n`);
      else process.stderr.write(`\n${errors} error(s), ${warns} warning(s)\n`);
      const failed = errors > 0 || (has('strict') && warns > 0);
      process.exit(failed ? 1 : 0);
    }
    case 'detect': {
      const file = args[1];
      if (!file || !existsSync(file)) throw new Error(`file not found: ${file}`);
      const text = readFileSync(file, 'utf8');
      const fmt = detectFormat(basename(file), text);
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
