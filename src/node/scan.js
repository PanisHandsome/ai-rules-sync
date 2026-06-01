// Repo scanner (Node only — uses node:fs). Inspects a project directory and
// produces a spec for generate(). Browser code must NOT import this file.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

function read(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}
function readJSON(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// `pm test` / `pm start` are universal aliases; everything else needs `run`.
function runCmd(pm, script) {
  if (script === 'test' || script === 'start') return `${pm} ${script}`;
  return `${pm} run ${script}`;
}

const JS_FRAMEWORKS = [
  ['next', 'Next.js'],
  ['@nestjs/core', 'NestJS'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['nuxt', 'Nuxt'],
  ['astro', 'Astro'],
  ['@angular/core', 'Angular'],
  ['remix', 'Remix'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['react', 'React'],
];

function scanNode(dir, pkg) {
  const detected = [];
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  let pm = 'npm';
  if (pkg.packageManager) pm = String(pkg.packageManager).split('@')[0];
  else if (existsSync(join(dir, 'pnpm-lock.yaml'))) pm = 'pnpm';
  else if (existsSync(join(dir, 'yarn.lock'))) pm = 'yarn';
  else if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) pm = 'bun';

  const isTS = existsSync(join(dir, 'tsconfig.json')) || 'typescript' in deps;
  const language = isTS ? 'TypeScript' : 'JavaScript';
  detected.push(language);

  let framework;
  for (const [key, name] of JS_FRAMEWORKS) {
    if (key in deps) { framework = name; break; }
  }
  if (framework) detected.push(framework);
  detected.push(pm);

  const scripts = pkg.scripts || {};
  const spec = {
    name: pkg.name || basename(resolve(dir)),
    language,
    framework,
    packageManager: pm,
    install: `${pm} install`,
    dev: scripts.dev ? runCmd(pm, 'dev') : scripts.start ? runCmd(pm, 'start') : undefined,
    build: scripts.build ? runCmd(pm, 'build') : undefined,
    test: scripts.test ? runCmd(pm, 'test') : undefined,
    lint: scripts.lint ? runCmd(pm, 'lint') : undefined,
  };
  return { spec, detected };
}

function scanPython(dir) {
  const detected = ['Python'];
  const pyproject = read(join(dir, 'pyproject.toml'));
  const reqs = read(join(dir, 'requirements.txt'));
  const haystack = (pyproject + '\n' + reqs).toLowerCase();

  let pm = 'pip';
  if (existsSync(join(dir, 'uv.lock'))) pm = 'uv';
  else if (existsSync(join(dir, 'poetry.lock')) || haystack.includes('[tool.poetry]')) pm = 'poetry';
  detected.push(pm);

  let framework;
  if (haystack.includes('fastapi')) framework = 'FastAPI';
  else if (haystack.includes('django')) framework = 'Django';
  else if (haystack.includes('flask')) framework = 'Flask';
  if (framework) detected.push(framework);

  const name =
    (pyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m) || [])[1] || basename(resolve(dir));

  const prefix = pm === 'uv' ? 'uv run ' : pm === 'poetry' ? 'poetry run ' : '';
  const install = pm === 'uv' ? 'uv sync' : pm === 'poetry' ? 'poetry install' : 'pip install -r requirements.txt';

  return {
    spec: {
      name, language: 'Python', framework, packageManager: pm,
      install,
      test: `${prefix}pytest`,
      lint: `${prefix}ruff check`,
    },
    detected,
  };
}

function scanGo(dir) {
  const mod = read(join(dir, 'go.mod'));
  const modPath = (mod.match(/^module\s+(\S+)/m) || [])[1] || basename(resolve(dir));
  return {
    spec: {
      name: basename(modPath), language: 'Go',
      install: 'go mod download',
      build: 'go build ./...',
      test: 'go test ./...',
      lint: 'go vet ./...',
    },
    detected: ['Go'],
  };
}

function scanRust(dir) {
  const cargo = read(join(dir, 'Cargo.toml'));
  const name = (cargo.match(/^\s*name\s*=\s*["']([^"']+)["']/m) || [])[1] || basename(resolve(dir));
  return {
    spec: {
      name, language: 'Rust',
      build: 'cargo build',
      test: 'cargo test',
      lint: 'cargo clippy',
    },
    detected: ['Rust'],
  };
}

/**
 * Inspect a directory and return { spec, detected }.
 * `spec` feeds generate(); `detected` is a human-readable list of findings.
 */
export function scanRepo(dir = '.') {
  const pkg = readJSON(join(dir, 'package.json'));
  if (pkg) return scanNode(dir, pkg);
  if (existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'requirements.txt')) || existsSync(join(dir, 'setup.py')))
    return scanPython(dir);
  if (existsSync(join(dir, 'go.mod'))) return scanGo(dir);
  if (existsSync(join(dir, 'Cargo.toml'))) return scanRust(dir);

  return {
    spec: { name: basename(resolve(dir)) },
    detected: ['no recognized manifest — generated a generic template'],
  };
}
