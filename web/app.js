// Browser playground — imports the exact same engine the CLI uses.
import { convert, generate, detectFormat, FORMATS } from '../src/core/agentsync.js';

const $ = (id) => document.getElementById(id);

// Populate format dropdowns from the engine's FORMATS registry.
const fromSel = $('fromFmt');
const toSel = $('toFmt');
for (const f of Object.values(FORMATS)) {
  fromSel.add(new Option(f.label, f.id));
  toSel.add(new Option(f.label, f.id));
}
toSel.value = 'agents';

// Format chips in the hero, straight from the engine's registry.
const chips = $('formatChips');
if (chips) {
  for (const f of Object.values(FORMATS)) {
    const el = document.createElement('span');
    el.className = 'chip';
    el.textContent = f.filename;
    chips.appendChild(el);
  }
}

// A realistic CLAUDE.md so visitors immediately see a meaningful conversion.
const EXAMPLE = `# CLAUDE.md

This is the web dashboard for Acme, a Next.js 14 app (App Router) written in TypeScript.

## Commands
- Install with \`pnpm install\`
- Dev server: \`pnpm dev\`
- Build: \`pnpm build\`
- Run tests: \`pnpm test\` (Vitest)
- Lint: \`pnpm lint\` (ESLint + Prettier)

## Code style
- TypeScript strict mode; never use \`any\`.
- Server Components by default; add \`"use client"\` only when needed.
- Co-locate tests as \`*.test.ts\` next to the source file.

## Important
- Do not edit files under \`src/generated/\`.
- See @docs/architecture.md for the data-flow overview.`;

function renderConvert() {
  const text = $('input').value;
  if (!text.trim()) {
    $('output').textContent = '';
    $('warnings').innerHTML = '';
    return;
  }
  const from = fromSel.value === 'auto' ? detectFormat('', text) : fromSel.value;
  const to = toSel.value;
  const res = convert(text, { from, to });
  $('output').textContent = res.output;
  $('outLabel').textContent = FORMATS[to].filename;
  $('warnings').innerHTML = res.warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join('');
}

function renderGenerate() {
  const spec = {
    name: $('g_name').value,
    description: $('g_description').value,
    language: $('g_language').value,
    framework: $('g_framework').value,
    packageManager: $('g_pm').value,
    install: $('g_install').value,
    dev: $('g_dev').value,
    build: $('g_build').value,
    test: $('g_test').value,
    lint: $('g_lint').value,
  };
  $('genOutput').textContent = generate(spec).output;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Wire up events
$('input').addEventListener('input', renderConvert);
fromSel.addEventListener('change', renderConvert);
toSel.addEventListener('change', renderConvert);
$('loadExample').addEventListener('click', () => {
  $('input').value = EXAMPLE;
  fromSel.value = 'auto';
  renderConvert();
});

['g_name', 'g_description', 'g_language', 'g_framework', 'g_pm', 'g_install', 'g_dev', 'g_build', 'g_test', 'g_lint'].forEach(
  (id) => $(id).addEventListener('input', renderGenerate)
);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    document.querySelectorAll('[data-panel]').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.panel !== mode);
    });
  });
});

function copyFrom(elId, btn) {
  navigator.clipboard.writeText($(elId).textContent).then(() => {
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = old), 1200);
  });
}
$('copy').addEventListener('click', (e) => copyFrom('output', e.target));
$('copyGen').addEventListener('click', (e) => copyFrom('genOutput', e.target));

const copyInstall = $('copyInstall');
if (copyInstall) {
  copyInstall.addEventListener('click', (e) => {
    navigator.clipboard.writeText($('installCmd').textContent).then(() => {
      e.target.textContent = 'copied';
      setTimeout(() => (e.target.textContent = 'copy'), 1200);
    });
  });
}

// Seed both panels so the page is never empty.
$('input').value = EXAMPLE;
renderConvert();
$('g_name').value = 'acme-dashboard';
$('g_language').value = 'TypeScript';
$('g_framework').value = 'Next.js';
$('g_pm').value = 'pnpm';
$('g_test').value = 'pnpm test';
$('g_build').value = 'pnpm build';
$('g_lint').value = 'pnpm lint';
renderGenerate();

// ---- Theme toggle (persisted) ----
const themeBtn = $('themeToggle');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === 'light' ? '☀️' : '🌙';
}
applyTheme(localStorage.getItem('agentsync-theme') || 'dark');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('agentsync-theme', next);
  applyTheme(next);
});

// ---- Drag & drop a file onto the input ----
const inputEl = $('input');
inputEl.addEventListener('dragover', (e) => { e.preventDefault(); inputEl.classList.add('dragover'); });
inputEl.addEventListener('dragleave', () => inputEl.classList.remove('dragover'));
inputEl.addEventListener('drop', (e) => {
  e.preventDefault();
  inputEl.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    inputEl.value = reader.result;
    const guess = detectFormat(file.name, reader.result);
    if (FORMATS[guess]) fromSel.value = guess;
    renderConvert();
  };
  reader.readAsText(file);
});

// ---- Download the output as the target filename ----
function download(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
$('download').addEventListener('click', () => {
  const name = FORMATS[toSel.value].filename.split('/').pop();
  download($('output').textContent, name);
});
$('downloadGen').addEventListener('click', () => download($('genOutput').textContent, 'AGENTS.md'));

// ---- Shareable link (state encoded in the URL hash) ----
function encodeState(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function decodeState(s) {
  try { return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch { return null; }
}
$('share').addEventListener('click', (e) => {
  const state = { i: inputEl.value, f: fromSel.value, t: toSel.value };
  const url = `${location.origin}${location.pathname}#s=${encodeState(state)}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = e.target;
    const old = btn.textContent;
    btn.textContent = 'Link copied!';
    setTimeout(() => (btn.textContent = old), 1400);
  });
});

// On load, restore state from a shared link.
if (location.hash.startsWith('#s=')) {
  const state = decodeState(location.hash.slice(3));
  if (state && typeof state.i === 'string') {
    inputEl.value = state.i;
    if (FORMATS[state.f] || state.f === 'auto') fromSel.value = state.f;
    if (FORMATS[state.t]) toSel.value = state.t;
    renderConvert();
  }
}
