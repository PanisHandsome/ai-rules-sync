#!/usr/bin/env node
// Build a flat, static dist/ for the playground (GitHub Pages / any static host).
// The engine lives at src/core/agentsync.js; locally the page imports it via
// ../src/core. For deployment we copy it next to the page and rewrite that import
// so everything sits under one folder and works on a project subpath.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

copyFileSync(join(root, 'web/index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'web/style.css'), join(dist, 'style.css'));
copyFileSync(join(root, 'src/core/agentsync.js'), join(dist, 'agentsync.js'));

const app = readFileSync(join(root, 'web/app.js'), 'utf8')
  .replace('../src/core/agentsync.js', './agentsync.js');
writeFileSync(join(dist, 'app.js'), app);

// .nojekyll keeps GitHub Pages from mangling the static files.
writeFileSync(join(dist, '.nojekyll'), '');

console.log('Built dist/ →', ['index.html', 'style.css', 'app.js', 'agentsync.js'].join(', '));
