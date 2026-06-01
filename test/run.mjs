// Minimal zero-dependency test runner.
import { convert, generate, detectFormat } from '../src/core/agentsync.js';
import { scanRepo } from '../src/node/scan.js';
import { lint } from '../src/node/lint.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// lint
const goodDoc = '# AGENTS.md\n\n## Build\n\n- Test: `npm test`\n';
ok('lint passes a healthy doc', lint(goodDoc, here).filter((f) => f.level === 'error').length === 0);
const badDoc = 'no headings here\nsee `src/nope.ts`\n';
const badFindings = lint(badDoc, here);
ok('lint flags missing headings as error', badFindings.some((f) => f.level === 'error'));
ok('lint flags a missing path', badFindings.some((f) => f.message.includes('nope.ts')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
