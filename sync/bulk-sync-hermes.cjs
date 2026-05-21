// bulk-sync-hermes.cjs
// One-time bulk sync of all Claude Code agents, hooks, and skills to ~/.hermes/skills/
//
// Usage:
//   node bulk-sync-hermes.cjs [--dir <path-to-.claude>]
//
// If --dir is not specified, auto-detects from:
//   1. <cwd>/.claude
//   2. %USERPROFILE%/.claude  (Windows home)
//   3. ~/.claude              (Linux/Mac home)
//   4. CLAUDE_CONFIG_DIR env var
//
// Config via environment variables (all optional — auto-detected if not set):
//   HERMES_WSL_DISTRO        WSL distro name (default: Ubuntu)
//   HERMES_WSL_USER          WSL username (default: auto-detected via whoami)
//   HERMES_CATEGORY_AGENTS   Hermes category name for agents (default: cc-agents)
//   HERMES_CATEGORY_HOOKS    Hermes category name for hooks  (default: cc-hooks)
//   HERMES_CATEGORY_SKILLS   Hermes category name for skills (default: cc-skills)
//
// Example with explicit dir:
//   node bulk-sync-hermes.cjs --dir "C:/Users/YourName/MyProject/.claude"
//
// Example with env vars:
//   HERMES_WSL_USER=alice HERMES_CATEGORY_AGENTS=my-agents node bulk-sync-hermes.cjs

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { createHash } = require('crypto');

// [P1-B] Only alphanumeric, dots, dashes, underscores allowed in IDs used in shell commands.
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;
function assertSafeId(value, label) {
  if (!SAFE_ID_RE.test(value)) {
    process.stderr.write(`[bulk-sync] ERROR: unsafe ${label}: ${JSON.stringify(value)} — only [A-Za-z0-9._-] allowed\n`);
    process.exit(1);
  }
}

const WSL_DISTRO = process.env.HERMES_WSL_DISTRO     || 'Ubuntu';
const CAT_AGENTS = process.env.HERMES_CATEGORY_AGENTS || 'cc-agents';
const CAT_HOOKS  = process.env.HERMES_CATEGORY_HOOKS  || 'cc-hooks';
const CAT_SKILLS = process.env.HERMES_CATEGORY_SKILLS || 'cc-skills';

// Validate env-var-derived IDs at startup so misconfiguration is caught immediately.
assertSafeId(WSL_DISTRO, 'HERMES_WSL_DISTRO');
assertSafeId(CAT_AGENTS, 'HERMES_CATEGORY_AGENTS');
assertSafeId(CAT_HOOKS,  'HERMES_CATEGORY_HOOKS');
assertSafeId(CAT_SKILLS, 'HERMES_CATEGORY_SKILLS');

let _wslUser = process.env.HERMES_WSL_USER || null;

function getWslUser() {
  if (_wslUser) return _wslUser;
  try {
    _wslUser = execSync(
      `wsl -d ${WSL_DISTRO} -- whoami`,
      { encoding: 'utf8', timeout: 5_000, stdio: 'pipe', windowsHide: true }
    ).trim();
  } catch (err) {
    // [P1-C] Do not cache a fallback username — syncs to a non-existent path would silently
    // succeed. Exit immediately so the user sets HERMES_WSL_USER.
    process.stderr.write(`[bulk-sync] ERROR: could not auto-detect WSL user: ${err.message}\n`);
    process.stderr.write(`[bulk-sync] Set HERMES_WSL_USER env var and retry.\n`);
    process.exit(1);
  }
  return _wslUser;
}

// ── Resolve .claude directory ────────────────────────────────────────────────

const dirArgIdx = process.argv.indexOf('--dir');
let claudeDir   = dirArgIdx !== -1 ? process.argv[dirArgIdx + 1] : null;

if (!claudeDir) {
  const candidates = [
    path.join(process.cwd(), '.claude'),
    process.env.CLAUDE_CONFIG_DIR,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.claude') : null,
    path.join(os.homedir(), '.claude'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      claudeDir = candidate;
      break;
    }
  }
}

if (!claudeDir || !fs.existsSync(claudeDir)) {
  process.stderr.write(`[bulk-sync] ERROR: .claude directory not found.\n`);
  process.stderr.write(`[bulk-sync] Try: node bulk-sync-hermes.cjs --dir /path/to/.claude\n`);
  process.exit(1);
}

process.stdout.write(`[bulk-sync] Source: ${claudeDir}\n`);

// ── Helpers ──────────────────────────────────────────────────────────────────

function wslUnixPath(winPath) {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
}

function extractFirstComment(src) {
  const lines = src.split('\n');
  const block = [];
  for (const line of lines) {
    if (line.startsWith('//')) {
      block.push(line.replace(/^\/\/ ?/, ''));
    } else if (block.length > 0) {
      break;
    }
  }
  return block.join('\n').trim();
}

// [Perf Fix 1] Batch all copies into one WSL command per category.
// Cuts ~95 sequential WSL spawns to 3 (one per category).
// Chunks at 50 files to stay within ARG_MAX.
const CHUNK_SIZE = 50;

function batchSyncToHermes(items, category) {
  assertSafeId(category, 'category');
  const wslUser = getWslUser();
  assertSafeId(wslUser, 'WSL username');

  const results = [];

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const pairs = chunk.map(({ name, content }) => {
      assertSafeId(name, 'skill name');
      const tmpId  = createHash('sha256').update(`${Date.now()}-${name}-${Math.random()}`).digest('hex').slice(0, 16);
      const tmpWin = path.join(os.tmpdir(), `hermes-bulk-${tmpId}.md`);
      fs.writeFileSync(tmpWin, content, 'utf8');
      const destDir  = `/home/${wslUser}/.hermes/skills/${category}/${name}`;
      const destFile = `${destDir}/SKILL.md`;
      return { name, tmpWin, tmpUnix: wslUnixPath(tmpWin), destDir, destFile };
    });

    const cmds = pairs
      .map(p => `mkdir -p '${p.destDir}' && cp '${p.tmpUnix}' '${p.destFile}'`)
      .join(' && ');

    try {
      execSync(`wsl -d ${WSL_DISTRO} -- bash -c "${cmds}"`,
        { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
      for (const p of pairs) results.push({ name: p.name, ok: true });
    } catch (err) {
      process.stderr.write(`[bulk-sync] FAIL batch ${category} chunk ${Math.floor(i / CHUNK_SIZE)}: ${err.message}\n`);
      for (const p of pairs) results.push({ name: p.name, ok: false });
    } finally {
      for (const p of pairs) try { fs.unlinkSync(p.tmpWin); } catch {}
    }
  }

  return results;
}

// ── Initialize ───────────────────────────────────────────────────────────────

// [P1-C] getWslUser() exits 1 on failure — no silent fallback to 'user'.
const wslUser = getWslUser();
process.stdout.write(`[bulk-sync] WSL distro: ${WSL_DISTRO}, user: ${wslUser}\n`);
process.stdout.write(`[bulk-sync] Categories: ${CAT_AGENTS} | ${CAT_HOOKS} | ${CAT_SKILLS}\n\n`);

let synced = 0;
let failed = 0;

// ── Agents ───────────────────────────────────────────────────────────────────

const agentsDir = path.join(claudeDir, 'agents');
if (fs.existsSync(agentsDir)) {
  process.stdout.write(`── Agents ──\n`);
  const agentItems = [];
  for (const file of fs.readdirSync(agentsDir).sort()) {
    if (!file.endsWith('.md')) continue;
    const name = file.replace(/\.md$/, '');
    const raw  = fs.readFileSync(path.join(agentsDir, file), 'utf8');
    const content = [
      `# ${name}`,
      '',
      `> Claude Code agent — auto-synced from .claude/agents/${file}`,
      `> Last sync: ${new Date().toISOString()}`,
      '',
      raw,
    ].join('\n');
    agentItems.push({ name, content });
  }
  if (agentItems.length > 0) {
    const results = batchSyncToHermes(agentItems, CAT_AGENTS);
    for (const r of results) {
      if (r.ok) { synced++; process.stdout.write(`  ✓ ${r.name}\n`); }
      else      { failed++; }
    }
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

const hooksDir = path.join(claudeDir, 'hooks');
if (fs.existsSync(hooksDir)) {
  process.stdout.write(`\n── Hooks ──\n`);
  const hookItems = [];
  for (const file of fs.readdirSync(hooksDir).sort()) {
    if (!file.endsWith('.cjs')) continue;
    if (file.startsWith('_')) continue; // skip archived hooks
    const name = file.replace(/\.cjs$/, '');
    const raw  = fs.readFileSync(path.join(hooksDir, file), 'utf8');
    const description = extractFirstComment(raw);
    const snippet     = raw.slice(0, 3000);
    const content = [
      `# Hook: ${name}`,
      '',
      `> Claude Code hook — auto-synced from .claude/hooks/${file}`,
      `> Last sync: ${new Date().toISOString()}`,
      '',
      '## Description',
      '',
      description || name,
      '',
      '## Source (first 3000 chars)',
      '',
      '```javascript',
      snippet,
      raw.length > 3000 ? `\n// ... (${raw.length - 3000} chars truncated)` : '',
      '```',
    ].join('\n');
    hookItems.push({ name, content });
  }
  if (hookItems.length > 0) {
    const results = batchSyncToHermes(hookItems, CAT_HOOKS);
    for (const r of results) {
      if (r.ok) { synced++; process.stdout.write(`  ✓ ${r.name}\n`); }
      else      { failed++; }
    }
  }
}

// ── Skills ───────────────────────────────────────────────────────────────────

const skillsDir = path.join(claudeDir, 'skills');
if (fs.existsSync(skillsDir)) {
  process.stdout.write(`\n── Skills ──\n`);
  const skillItems = [];
  for (const entry of fs.readdirSync(skillsDir).sort()) {
    const skillFile = path.join(skillsDir, entry, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const raw = fs.readFileSync(skillFile, 'utf8');
    const content = [
      `# Skill: ${entry}`,
      '',
      `> Claude Code skill — auto-synced from .claude/skills/${entry}/SKILL.md`,
      `> Last sync: ${new Date().toISOString()}`,
      '',
      raw,
    ].join('\n');
    skillItems.push({ name: entry, content });
  }
  if (skillItems.length > 0) {
    const results = batchSyncToHermes(skillItems, CAT_SKILLS);
    for (const r of results) {
      if (r.ok) { synced++; process.stdout.write(`  ✓ ${r.name}\n`); }
      else      { failed++; }
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

process.stdout.write(`\n[bulk-sync] Done — ${synced} synced, ${failed} failed\n`);
process.stdout.write(`[bulk-sync] Skills installed at: /home/${wslUser}/.hermes/skills/\n`);
process.stdout.write(`[bulk-sync] Verify: wsl -d ${WSL_DISTRO} -- ls ~/.hermes/skills/\n`);
process.exit(failed > 0 ? 1 : 0);
