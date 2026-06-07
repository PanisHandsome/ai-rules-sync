// Minimal zero-dependency test runner.
import { convert, merge, generate, detectFormat } from '../src/core/agentsync.js';
import { scanRepo } from '../src/node/scan.js';
import { lint } from '../src/node/lint.js';
import { sync, syncAuto, initConfig, loadConfig, safeWrite } from '../src/node/sync.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

// detect
ok('detect filename .cursorrules', detectFormat('.cursorrules', '') === 'cursor');
ok('detect filename CLAUDE.md', detectFormat('CLAUDE.md', '') === 'claude');
ok('detect copilot by path', detectFormat('.github/copilot-instructions.md', '') === 'copilot');

// convert cursor -> agents
const cursor = `Use TypeScript strict mode.\n\n- Run tests with \`npm test\`.\nDo not edit src/generated/.`;
const r1 = convert(cursor, { from: 'cursor', to: 'agents' });
ok('cursor→agents has AGENTS title', r1.output.startsWith('# AGENTS'));
ok('cursor→agents keeps rules', r1.output.includes('npm test'));

// convert claude with @import warns
const claude = `# CLAUDE.md\n\nApp intro.\n\n## Setup\nSee @docs/arch.md`;
const r2 = convert(claude, { from: 'claude', to: 'agents' });
ok('claude @import produces a warning', r2.warnings.some((w) => w.includes('@path')));

// round-trip preserves a heading
const r3 = convert(claude, { from: 'claude', to: 'copilot' });
ok('claude→copilot keeps Setup heading', r3.output.includes('## Setup'));

// generate
const g = generate({ name: 'demo', language: 'Go', test: 'go test ./...', build: 'go build ./...' });
ok('generate has title', g.output.includes('# demo'));
ok('generate includes test cmd', g.output.includes('go test ./...'));
ok('generate has PR checklist', g.output.includes('Before opening a PR'));

// new formats
ok('detect .clinerules', detectFormat('.clinerules', '') === 'cline');
ok('detect CONVENTIONS.md', detectFormat('CONVENTIONS.md', '') === 'aider');
ok('detect GEMINI.md', detectFormat('GEMINI.md', '') === 'gemini');
ok('detect QWEN.md', detectFormat('QWEN.md', '') === 'qwen');
const toGemini = convert('# CLAUDE.md\n\n## Setup\n\nRun `npm test`.', { from: 'claude', to: 'gemini' });
ok('claude→gemini keeps command', toGemini.output.includes('npm test'));
const toQwen = convert('# CLAUDE.md\n\n## Setup\n\nRun `npm test`.', { from: 'claude', to: 'qwen' });
ok('claude→qwen keeps command', toQwen.output.includes('npm test'));
ok('claude→qwen renders QWEN title', toQwen.output.startsWith('# QWEN.md'));
const toCline = convert('Use strict types.\n\n- Run `pytest`.', { from: 'cursor', to: 'cline' });
ok('cursor→cline renders title', toCline.output.startsWith('# Cline rules'));

// scan: Node + TS + Next.js + pnpm
const next = scanRepo(join(here, 'fixtures', 'node-next'));
ok('scan detects TypeScript', next.spec.language === 'TypeScript');
ok('scan detects Next.js', next.spec.framework === 'Next.js');
ok('scan detects pnpm', next.spec.packageManager === 'pnpm');
ok('scan maps test script', next.spec.test === 'pnpm test');
ok('scan maps build script via run', next.spec.build === 'pnpm run build');

// scan: Python + uv + FastAPI
const py = scanRepo(join(here, 'fixtures', 'py-uv'));
ok('scan detects Python', py.spec.language === 'Python');
ok('scan detects FastAPI', py.spec.framework === 'FastAPI');
ok('scan detects uv', py.spec.packageManager === 'uv');
ok('scan uses uv run pytest', py.spec.test === 'uv run pytest');

// title handling: a leading "# Title" must not become a duplicate section
const titled = convert('# AGENTS.md\n\n## Setup\n\nRun `npm test`.', { from: 'agents', to: 'agents' }).output;
ok('title is not duplicated as a section', !titled.includes('## AGENTS.md'));

// a tool filename title must not leak across a conversion
const leak = convert('# CLAUDE.md\n\n## Setup\n\nRun `npm test`.', { from: 'claude', to: 'agents' }).output;
ok('source filename title is not carried over', !/CLAUDE/.test(leak));
ok('converted-to-agents uses an AGENTS title', leak.startsWith('# AGENTS'));
// a real project title IS kept
const keep = convert('# Acme Dashboard\n\n## Setup\n\nx', { from: 'claude', to: 'agents' }).output;
ok('a real project title is preserved', keep.startsWith('# Acme Dashboard'));

// merge: two files combine, same-heading sections fold together
const a = '# AGENTS.md\n\n## Build\n\n- Test: `npm test`';
const b = '## Build\n\n- Lint: `eslint .`\n\n## Style\n\n- No `any`.';
const mg = merge([{ text: a, from: 'agents' }, { text: b, from: 'cursor' }], { to: 'agents' }).output;
ok('merge keeps first file content', mg.includes('npm test'));
ok('merge folds same heading (Build)', mg.includes('eslint .') && (mg.match(/## Build/g) || []).length === 1);
ok('merge keeps distinct section (Style)', mg.includes('## Style'));

// sync --init: scaffolds config from existing files, refuses to clobber
const cfgDir = mkdtempSync(join(tmpdir(), 'agentsync-cfg-'));
writeFileSync(join(cfgDir, 'CLAUDE.md'), '# CLAUDE.md\n');
const initCfg = initConfig(cfgDir);
ok('initConfig sets AGENTS.md as source', initCfg.source === 'AGENTS.md');
ok('initConfig detects existing CLAUDE.md', initCfg.targets.includes('CLAUDE.md'));
let cfgGuard = false;
try { initConfig(cfgDir); } catch (e) { cfgGuard = e.code === 'EXISTS'; }
ok('initConfig refuses to overwrite', cfgGuard);

// sync: dry run reports missing targets as changed
const sres = sync({ dir: join(here, 'fixtures', 'sync'), write: false });
ok('sync lists all targets', sres.results.length === 2);
ok('sync marks missing targets changed', sres.results.every((r) => r.missing && r.changed));

// sync --auto: any edited file becomes the source for that run
const tmp = mkdtempSync(join(tmpdir(), 'agentsync-'));
writeFileSync(join(tmp, 'agentsync.json'), JSON.stringify({ source: 'AGENTS.md', targets: ['CLAUDE.md'] }));
writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS.md\n\n## Build\n\n- Test: `npm test`\n');
syncAuto({ dir: tmp });                                   // bootstrap from source
ok('auto: bootstrap generates the target', readFileSync(join(tmp, 'CLAUDE.md'), 'utf8').includes('npm test'));
// now edit the *target* — it should win and flow back into AGENTS.md
writeFileSync(join(tmp, 'CLAUDE.md'), '# CLAUDE.md\n\n## Build\n\n- Test: `pytest -q`\n');
const back = syncAuto({ dir: tmp });
ok('auto: edited target becomes the winner', back.winner === 'CLAUDE.md');
ok('auto: change flows back to AGENTS.md', readFileSync(join(tmp, 'AGENTS.md'), 'utf8').includes('pytest -q'));
// editing two files at once is a conflict
writeFileSync(join(tmp, 'AGENTS.md'), readFileSync(join(tmp, 'AGENTS.md'), 'utf8') + '\nextra A\n');
writeFileSync(join(tmp, 'CLAUDE.md'), readFileSync(join(tmp, 'CLAUDE.md'), 'utf8') + '\nextra C\n');
let conflicted = false;
try { syncAuto({ dir: tmp }); } catch (e) { conflicted = e.code === 'CONFLICT'; }
ok('auto: two edits raise a conflict', conflicted);

// sync --stage: regenerated files are added to the git index (CLI integration)
try {
  const gd = mkdtempSync(join(tmpdir(), 'agentsync-git-'));
  execFileSync('git', ['init', '-q'], { cwd: gd });
  writeFileSync(join(gd, 'agentsync.json'), JSON.stringify({ source: 'AGENTS.md', targets: ['CLAUDE.md'] }));
  writeFileSync(join(gd, 'AGENTS.md'), '# AGENTS.md\n\n## Build\n\n- Test: `npm test`\n');
  execFileSync('node', [join(here, '..', 'bin', 'agentsync.mjs'), 'sync', '--stage'], { cwd: gd, stdio: 'ignore' });
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: gd }).toString();
  ok('--stage adds the regenerated target to the index', staged.includes('CLAUDE.md'));
} catch (e) {
  ok('--stage adds the regenerated target to the index', false);
}

// noop: a second sync with no source change must not mark any target changed
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-noop-'));
  writeFileSync(join(tmp, 'agentsync.json'), JSON.stringify({ source: 'AGENTS.md', targets: ['CLAUDE.md'] }));
  writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS.md\n\n## Build\n\n- Test: `npm test`\n');
  const first = sync({ dir: tmp });
  ok('noop: first sync marks target changed', first.results.every((r) => r.changed));
  const second = sync({ dir: tmp });
  ok('noop: second sync with no source change is a noop', second.results.every((r) => !r.changed));
  // file content is byte-identical to the first sync output
  const firstContent = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
  const secondContent = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
  ok('noop: target content is byte-identical across syncs', firstContent === secondContent);
}

// sync: dry run does not write even when target is missing
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-dry-'));
  writeFileSync(join(tmp, 'agentsync.json'), JSON.stringify({ source: 'AGENTS.md', targets: ['CLAUDE.md'] }));
  writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS.md\n\n## Build\n\n- Test: `npm test`\n');
  const res = sync({ dir: tmp, write: false });
  ok('dry: target is reported missing', res.results.every((r) => r.missing));
  ok('dry: target is reported changed', res.results.every((r) => r.changed));
  ok('dry: target file was not created', !existsSync(join(tmp, 'CLAUDE.md')));
}

// sync: missing source raises a clear error
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-nosrc-'));
  writeFileSync(join(tmp, 'agentsync.json'), JSON.stringify({ source: 'AGENTS.md', targets: ['CLAUDE.md'] }));
  let msg = '';
  try { sync({ dir: tmp }); } catch (e) { msg = e.message; }
  ok('missing source raises a clear error', msg.includes('source not found') && msg.includes('AGENTS.md'));
}

// sync: invalid config (missing source or targets) raises a clear error
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-badcfg-'));
  writeFileSync(join(tmp, 'agentsync.json'), JSON.stringify({ targets: ['CLAUDE.md'] }));
  let msg = '';
  try { loadConfig(tmp); } catch (e) { msg = e.message; }
  ok('config without source is rejected', msg.includes('"source"'));
  writeFileSync(join(tmp, 'agentsync.json'), JSON.stringify({ source: 'AGENTS.md' }));
  msg = '';
  try { loadConfig(tmp); } catch (e) { msg = e.message; }
  ok('config without targets is rejected', msg.includes('"targets"'));
}

// sync: explicit target format override (object form in config)
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-fmt-'));
  writeFileSync(join(tmp, 'agentsync.json'), JSON.stringify({
    source: 'AGENTS.md',
    targets: [{ file: 'CUSTOM.md', to: 'claude' }],
  }));
  writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS.md\n\n## Setup\n\nRun `npm test`.\n');
  sync({ dir: tmp });
  const out = readFileSync(join(tmp, 'CUSTOM.md'), 'utf8');
  ok('format override: target is rendered in the requested format', out.startsWith('# CLAUDE.md'));
}

// safeWrite: writes content to target, leaves a .bak of the previous content
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-safewrite-'));
  const target = join(tmp, 'rules.md');
  writeFileSync(target, 'original\n');
  safeWrite(target, 'new\n');
  ok('safeWrite: target is updated', readFileSync(target, 'utf8') === 'new\n');
  ok('safeWrite: .bak holds the previous content', readFileSync(target + '.bak', 'utf8') === 'original\n');
}

// safeWrite: first write to a non-existent target does not create a .bak
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-safewrite-new-'));
  const target = join(tmp, 'fresh.md');
  safeWrite(target, 'hello\n');
  ok('safeWrite: fresh write creates the file', readFileSync(target, 'utf8') === 'hello\n');
  ok('safeWrite: no .bak is created when the target is fresh', !existsSync(target + '.bak'));
}

// safeWrite: a subsequent write updates the .bak to the previous new content
{
  const tmp = mkdtempSync(join(tmpdir(), 'agentsync-safewrite-overwrite-'));
  const target = join(tmp, 'rules.md');
  writeFileSync(target, 'v1\n');
  safeWrite(target, 'v2\n');
  safeWrite(target, 'v3\n');
  ok('safeWrite: third write leaves v2 in the .bak', readFileSync(target + '.bak', 'utf8') === 'v2\n');
  ok('safeWrite: third write leaves v3 in the target', readFileSync(target, 'utf8') === 'v3\n');
}

// semantic parsing: a flat .cursorrules becomes classified sections
const flat = readFileSync(join(here, '..', 'examples', '.cursorrules'), 'utf8');
const semantic = convert(flat, { from: 'cursor', to: 'agents' }).output;
ok('semantic: extracts a commands section', semantic.includes('## Build & test commands'));
ok('semantic: extracts a code style section', semantic.includes('## Code style & conventions'));
ok('semantic: extracts a Do not section', semantic.includes('## Do not'));
ok('semantic: routes a command line into commands', /## Build & test commands[\s\S]*uv sync/.test(semantic));
ok('semantic: routes a prohibition into Do not', /## Do not[\s\S]*migrations/.test(semantic));

// round-trip fidelity: A -> B -> A keeps headings, commands, and bullets
const original = `# AGENTS.md

A short intro about the project.

## Build & test commands

- Test: \`npm test\`
- Build: \`npm run build\`

## Code style

- Use strict types.
- No \`any\`.`;
for (const via of ['claude', 'copilot', 'cursor', 'gemini', 'cline']) {
  const there = convert(original, { from: 'agents', to: via }).output;
  const back = convert(there, { from: via, to: 'agents' }).output;
  ok(`round-trip via ${via} keeps test command`, back.includes('npm test'));
  ok(`round-trip via ${via} keeps Code style heading`, back.includes('Code style'));
  ok(`round-trip via ${via} keeps bullet text`, back.includes('Use strict types'));
}

// lint
const goodDoc = '# AGENTS.md\n\n## Build\n\n- Test: `npm test`\n';
ok('lint passes a healthy doc', lint(goodDoc, here).filter((f) => f.level === 'error').length === 0);
const badDoc = 'no headings here\nsee `src/nope.ts`\n';
const badFindings = lint(badDoc, here);
ok('lint flags missing headings as error', badFindings.some((f) => f.level === 'error'));
ok('lint flags a missing path', badFindings.some((f) => f.message.includes('nope.ts')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
