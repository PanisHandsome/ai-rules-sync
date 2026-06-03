// agentsync core engine — zero-dependency ESM, runs in Node and the browser.
//
// Two capabilities:
//   A) convert(text, {to})  — translate between AI coding-agent rule files
//   B) generate(spec)       — build a high-quality AGENTS.md from a spec
//
// Strategy: every format is parsed into one normalized intermediate
// representation (IR), then rendered into the target format. Adding a new
// tool = one parser + one renderer, nothing else changes.

/** @typedef {{heading: string, body: string}} Section */
/** @typedef {{
 *   title: string,
 *   intro: string,
 *   sections: Section[],
 *   globs: string[],
 *   sourceFormat: string,
 *   warnings: string[]
 * }} IR
 */

export const FORMATS = {
  agents: {
    id: 'agents',
    label: 'AGENTS.md (Codex / open standard)',
    filename: 'AGENTS.md',
  },
  claude: {
    id: 'claude',
    label: 'CLAUDE.md (Claude Code)',
    filename: 'CLAUDE.md',
  },
  cursor: {
    id: 'cursor',
    label: '.cursorrules (Cursor)',
    filename: '.cursorrules',
  },
  copilot: {
    id: 'copilot',
    label: 'copilot-instructions.md (GitHub Copilot)',
    filename: '.github/copilot-instructions.md',
  },
  windsurf: {
    id: 'windsurf',
    label: '.windsurfrules (Windsurf)',
    filename: '.windsurfrules',
  },
  cline: {
    id: 'cline',
    label: '.clinerules (Cline)',
    filename: '.clinerules',
  },
  aider: {
    id: 'aider',
    label: 'CONVENTIONS.md (Aider)',
    filename: 'CONVENTIONS.md',
  },
  gemini: {
    id: 'gemini',
    label: 'GEMINI.md (Gemini CLI)',
    filename: 'GEMINI.md',
  },
  qwen: {
    id: 'qwen',
    label: 'QWEN.md (Qwen Code)',
    filename: 'QWEN.md',
  },
};

// Titles that are really just a tool's own filename/heading — not a project name.
// We don't carry these across a conversion (converting CLAUDE.md -> AGENTS.md
// should not produce a doc titled "CLAUDE").
const GENERIC_TITLES = new Set([
  'agents', 'claude', 'gemini', 'qwen', 'conventions', 'windsurf',
  'copilot instructions', 'copilot-instructions', 'cline rules', 'coding conventions',
  '.cursorrules', '.windsurfrules', '.clinerules',
]);
function isGenericTitle(t) {
  return GENERIC_TITLES.has(t.trim().toLowerCase().replace(/\.md$/, ''));
}

/** Guess the source format from a filename and/or its contents. */
export function detectFormat(filenameOrContent = '', content = '') {
  const name = filenameOrContent.toLowerCase();
  if (name.endsWith('agents.md')) return 'agents';
  if (name.endsWith('claude.md')) return 'claude';
  if (name.includes('copilot-instructions')) return 'copilot';
  if (name.includes('.cursorrules') || name.includes('.cursor/rules')) return 'cursor';
  if (name.includes('.windsurfrules')) return 'windsurf';
  if (name.includes('.clinerules')) return 'cline';
  if (name.endsWith('conventions.md')) return 'aider';
  if (name.endsWith('gemini.md')) return 'gemini';
  if (name.endsWith('qwen.md')) return 'qwen';

  // Fall back to sniffing the body.
  const body = (content || filenameOrContent).toLowerCase();
  if (body.includes('# agents.md') || body.includes('# agents')) return 'agents';
  if (body.includes('# claude.md') || body.includes('claude code')) return 'claude';
  if (body.includes('copilot')) return 'copilot';
  return 'agents';
}

// ---------------------------------------------------------------------------
// Parsing: any markdown-ish instruction file -> IR
// ---------------------------------------------------------------------------

/** Strip a leading YAML frontmatter block, returning {meta, body}. */
function stripFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Split markdown into sections keyed by their `##`/`#` headings. */
function splitSections(body) {
  const lines = body.split('\n');
  const sections = [];
  let intro = [];
  let current = null;

  for (const line of lines) {
    // Only ## / ### start sections; a leading # is the document title (kept in intro).
    const h = line.match(/^#{2,3}\s+(.*)$/);
    if (h) {
      if (current) sections.push(current);
      else intro = intro; // keep collected intro
      current = { heading: h[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      intro.push(line);
    }
  }
  if (current) sections.push(current);

  return {
    intro: intro.join('\n').trim(),
    sections: sections.map((s) => ({
      heading: s.heading,
      body: s.bodyLines.join('\n').trim(),
    })),
  };
}

// Heuristic classification of a single line into a semantic bucket.
function classifyLine(line) {
  const lower = line.toLowerCase();
  if (/\b(do not|don't|never|avoid|must not|forbidden)\b/.test(lower)) return 'donts';
  if (/`[^`]+`/.test(line) && /\b(run|install|build|test|dev|start|lint|server|deps|format|compile|migrate)\b/.test(lower)) return 'commands';
  return null; // null = stay in the current mode
}

// A "Heading:" label line switches the active bucket.
function labelToMode(line) {
  const m = line.match(/^([A-Za-z][\w \/&-]*):\s*$/);
  if (!m) return null;
  const l = m[1].toLowerCase();
  if (/convention|style|guideline|format/.test(l)) return 'style';
  if (/command|setup|build|test|script|getting started/.test(l)) return 'commands';
  if (/do ?not|don't|avoid|never|forbidden/.test(l)) return 'donts';
  if (/overview|about|context|introduction/.test(l)) return 'overview';
  return null;
}

// Turn an unstructured rule file into semantic sections instead of one blob.
function parsePlainText(body) {
  const buckets = { overview: [], commands: [], style: [], donts: [] };
  let mode = 'overview';
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const labelMode = labelToMode(line.trim());
    if (labelMode) { mode = labelMode; continue; }
    const forced = classifyLine(line);
    buckets[forced || mode].push(line);
  }
  const sections = [];
  if (buckets.commands.length) sections.push({ heading: 'Build & test commands', body: buckets.commands.join('\n') });
  if (buckets.style.length) sections.push({ heading: 'Code style & conventions', body: buckets.style.join('\n') });
  if (buckets.donts.length) sections.push({ heading: 'Do not', body: buckets.donts.join('\n') });
  return { intro: buckets.overview.join('\n').trim(), sections };
}

/**
 * @param {string} text
 * @param {string} format
 * @returns {IR}
 */
export function parse(text, format) {
  const warnings = [];
  const globs = [];
  const { meta, body } = stripFrontmatter(text);

  // Cursor's new .mdc rules carry `globs:` in frontmatter.
  if (meta.globs) {
    globs.push(...meta.globs.replace(/[[\]'"]/g, '').split(',').map((s) => s.trim()).filter(Boolean));
  }
  if (meta.description && format === 'cursor') {
    warnings.push('Cursor `description`/`globs` frontmatter has no AGENTS.md equivalent; folded into a note.');
  }

  // Claude's @path imports don't carry over to other tools.
  if (format === 'claude' && /(^|\s)@[\w./-]+/.test(body)) {
    warnings.push('Found Claude `@path` imports — other agents won\'t resolve these; inline the content if needed.');
  }

  let { intro, sections } = splitSections(body);

  // A leading "# Title" belongs to the title, not the body — pull it out of intro.
  let titleFromBody = '';
  const h1 = intro.match(/^#\s+(.+)\n?/);
  if (h1) {
    titleFromBody = h1[1].trim();
    intro = intro.slice(h1[0].length).trim();
  }

  // Plain-text rule files (classic .cursorrules) often have no headings.
  // Classify the prose into semantic sections instead of one opaque blob.
  if (sections.length === 0 && intro.trim()) {
    const p = parsePlainText(intro);
    if (p.sections.length) {
      intro = p.intro;
      sections = p.sections;
    } else {
      sections = [{ heading: 'Project rules', body: intro }];
      intro = '';
    }
  }

  return {
    title: meta.title || (isGenericTitle(titleFromBody) ? '' : titleFromBody),
    intro,
    sections,
    globs,
    sourceFormat: format,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Rendering: IR -> any target format
// ---------------------------------------------------------------------------

function renderSections(ir) {
  return ir.sections
    .map((s) => `## ${s.heading}\n\n${s.body}`.trim())
    .join('\n\n');
}

function renderAgents(ir) {
  const parts = [`# ${ir.title || 'AGENTS.md'}`];
  if (ir.intro) parts.push(ir.intro);
  if (ir.globs.length) {
    parts.push(`> **Applies to:** \`${ir.globs.join('`, `')}\``);
  }
  parts.push(renderSections(ir));
  return collapse(parts);
}

function renderClaude(ir) {
  const parts = [`# ${ir.title || 'CLAUDE.md'}`];
  if (ir.intro) parts.push(ir.intro);
  parts.push(renderSections(ir));
  return collapse(parts);
}

function renderCopilot(ir) {
  // Copilot expects a single instructions doc; keep it flat and imperative.
  const parts = ['# Copilot instructions'];
  if (ir.intro) parts.push(ir.intro);
  parts.push(renderSections(ir));
  return collapse(parts);
}

function renderCursor(ir) {
  const fm = [];
  if (ir.globs.length) fm.push(`globs: ${ir.globs.join(',')}`);
  const head = fm.length ? `---\n${fm.join('\n')}\n---\n\n` : '';
  const parts = [];
  if (ir.title) parts.push(`# ${ir.title}`);
  if (ir.intro) parts.push(ir.intro);
  parts.push(renderSections(ir));
  return head + collapse(parts);
}

function collapse(parts) {
  return parts.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Most tools just read a titled markdown doc; one factory covers them.
function renderTitled(defaultTitle) {
  return (ir) => {
    const parts = [`# ${ir.title || defaultTitle}`];
    if (ir.intro) parts.push(ir.intro);
    parts.push(renderSections(ir));
    return collapse(parts);
  };
}

const RENDERERS = {
  agents: renderAgents,
  claude: renderClaude,
  copilot: renderCopilot,
  cursor: renderCursor,
  windsurf: renderCursor, // Windsurf uses the same plain-markdown shape
  cline: renderTitled('Cline rules'),
  aider: renderTitled('Coding conventions'),
  gemini: renderTitled('GEMINI.md'),
  qwen: renderTitled('QWEN.md'),
};

export function render(ir, to) {
  const fn = RENDERERS[to];
  if (!fn) throw new Error(`Unknown target format: ${to}`);
  return fn(ir);
}

/**
 * Convert raw rule-file text from one format to another.
 * @returns {{output: string, warnings: string[], from: string, to: string}}
 */
export function convert(text, { from, to = 'agents' } = {}) {
  const source = from || detectFormat('', text);
  const ir = parse(text, source);
  return {
    output: render(ir, to),
    warnings: ir.warnings,
    from: source,
    to,
  };
}

/**
 * Merge several rule files into one. Sections with the same heading are combined
 * (deduping identical lines); intros, globs and warnings are unioned.
 * @param {{text: string, from?: string}[]} inputs
 * @returns {{output: string, warnings: string[], to: string}}
 */
export function merge(inputs, { to = 'agents' } = {}) {
  const merged = { title: '', intro: '', sections: [], globs: [], sourceFormat: 'merge', warnings: [] };
  const byHeading = new Map();
  const intros = [];

  for (const { text, from } of inputs) {
    const fmt = from || detectFormat('', text);
    const ir = parse(text, fmt);
    if (!merged.title && ir.title) merged.title = ir.title;
    if (ir.intro) intros.push(ir.intro);
    for (const g of ir.globs) if (!merged.globs.includes(g)) merged.globs.push(g);
    for (const w of ir.warnings) merged.warnings.push(w);
    for (const s of ir.sections) {
      const key = s.heading.toLowerCase().trim();
      if (byHeading.has(key)) {
        const existing = byHeading.get(key);
        existing.body = dedupeLines(existing.body + '\n' + s.body);
      } else {
        const copy = { heading: s.heading, body: s.body };
        byHeading.set(key, copy);
        merged.sections.push(copy);
      }
    }
  }
  merged.intro = [...new Set(intros)].join('\n\n');
  return { output: render(merged, to), warnings: merged.warnings, to };
}

function dedupeLines(text) {
  const seen = new Set();
  return text
    .split('\n')
    .filter((line) => {
      const k = line.trim();
      if (!k) return true; // keep blank lines for spacing
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Generation (capability B): spec -> AGENTS.md
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   name?: string,
 *   description?: string,
 *   language?: string,
 *   framework?: string,
 *   packageManager?: string,
 *   install?: string,
 *   build?: string,
 *   test?: string,
 *   lint?: string,
 *   dev?: string,
 *   conventions?: string[],
 *   doNots?: string[],
 *   prChecklist?: string[],
 * }} spec
 */
export function generate(spec = {}) {
  const pm = spec.packageManager || 'npm';
  const ir = {
    title: spec.name || 'AGENTS.md',
    intro:
      spec.description ||
      `Guidance for AI coding agents working in this repository.${
        spec.language ? ` Primary language: ${spec.language}.` : ''
      }${spec.framework ? ` Framework: ${spec.framework}.` : ''}`,
    globs: [],
    sourceFormat: 'generate',
    warnings: [],
    sections: [],
  };

  const cmds = [];
  if (spec.install) cmds.push(`- Install: \`${spec.install}\``);
  else cmds.push(`- Install: \`${pm} install\``);
  if (spec.dev) cmds.push(`- Dev server: \`${spec.dev}\``);
  if (spec.build) cmds.push(`- Build: \`${spec.build}\``);
  if (spec.test) cmds.push(`- Test: \`${spec.test}\``);
  if (spec.lint) cmds.push(`- Lint: \`${spec.lint}\``);
  ir.sections.push({
    heading: 'Build & test commands',
    body: cmds.join('\n') + '\n\nAlways run the test and lint commands before finishing a task.',
  });

  const style = (spec.conventions && spec.conventions.length
    ? spec.conventions
    : [
        'Match the style of surrounding code; do not reformat unrelated lines.',
        'Prefer small, focused changes and clear names over cleverness.',
        spec.language ? `Write idiomatic ${spec.language}.` : 'Follow the project\'s existing idioms.',
      ]
  )
    .map((c) => `- ${c}`)
    .join('\n');
  ir.sections.push({ heading: 'Code style & conventions', body: style });

  if (spec.doNots && spec.doNots.length) {
    ir.sections.push({
      heading: 'Do not',
      body: spec.doNots.map((d) => `- ${d}`).join('\n'),
    });
  }

  const checklist = (spec.prChecklist && spec.prChecklist.length
    ? spec.prChecklist
    : [
        'Tests and lint pass locally.',
        'No unrelated files changed.',
        'Public APIs and docs updated if behavior changed.',
      ]
  )
    .map((c) => `- [ ] ${c}`)
    .join('\n');
  ir.sections.push({ heading: 'Before opening a PR', body: checklist });

  return { output: render(ir, 'agents'), warnings: [], ir };
}
