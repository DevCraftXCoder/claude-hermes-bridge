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

const WSL_DISTRO = process.env.HERMES_WSL_DISTRO     || 'Ubuntu';
const CAT_AGENTS = process.env.HERMES_CATEGORY_AGENTS || 'cc-agents';
const CAT_HOOKS  = process.env.HERMES_CATEGORY_HOOKS  || 'cc-hooks';
const CAT_SKILLS = process.env.HERMES_CATEGORY_SKILLS || 'cc-skills';

let _wslUser = process.env.HERMES_WSL_USER || null;

function getWslUser() {
  if (_wslUser) return _wslUser;
  try {
    _wslUser = execSync(
      `wsl -d ${WSL_DISTRO} -- whoami`,
      { encoding: 'utf8', timeout: 5_000, stdio: 'pipe', windowsHide: true }
    ).trim();
  } catch {
    _wslUser = 'user';
    process.stderr.write(`[bulk-sync] WARN: could not auto-detect WSL user. Set HERMES_WSL_USER env var.\n`);
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

function syncToHermes(name, content, category) {
  const wslUser   = getWslUser();
  const skillDir  = `/home/${wslUser}/.hermes/skills/${category}/${name}`;
  const skillFile = `${skillDir}/SKILL.md`;

  const tmpWin  = path.join(os.tmpdir(), `hermes-bulk-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  const tmpUnix = wslUnixPath(tmpWin);
  fs.writeFileSync(tmpWin, content, 'utf8');

  try {
    execSync(
      `wsl -d ${WSL_DISTRO} -- bash -c "mkdir -p '${skillDir}' && cp '${tmpUnix}' '${skillFile}'"`,
      { windowsHide: true, stdio: 'pipe', timeout: 15_000 }
    );
    return true;
  } catch (err) {
    process.stderr.write(`[bulk-sync] FAIL ${category}/${name}: ${err.message}\n`);
    return false;
  } finally {
    try { fs.unlinkSync(tmpWin); } catch { /* ignore */ }
  }
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

// ── Initialize ───────────────────────────────────────────────────────────────

const wslUser = getWslUser();
process.stdout.write(`[bulk-sync] WSL distro: ${WSL_DISTRO}, user: ${wslUser}\n`);
process.stdout.write(`[bulk-sync] Categories: ${CAT_AGENTS} | ${CAT_HOOKS} | ${CAT_SKILLS}\n\n`);

let synced = 0;
let failed = 0;

// ── Agents ───────────────────────────────────────────────────────────────────

const agentsDir = path.join(claudeDir, 'agents');
if (fs.existsSync(agentsDir)) {
  process.stdout.write(`── Agents ──\n`);
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
    const ok = syncToHermes(name, content, CAT_AGENTS);
    if (ok) { synced++; process.stdout.write(`  ✓ ${name}\n`); }
    else     { failed++; }
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

const hooksDir = path.join(claudeDir, 'hooks');
if (fs.existsSync(hooksDir)) {
  process.stdout.write(`\n── Hooks ──\n`);
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
    const ok = syncToHermes(name, content, CAT_HOOKS);
    if (ok) { synced++; process.stdout.write(`  ✓ ${name}\n`); }
    else     { failed++; }
  }
}

// ── Skills ───────────────────────────────────────────────────────────────────

const skillsDir = path.join(claudeDir, 'skills');
if (fs.existsSync(skillsDir)) {
  process.stdout.write(`\n── Skills ──\n`);
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
    const ok = syncToHermes(entry, content, CAT_SKILLS);
    if (ok) { synced++; process.stdout.write(`  ✓ ${entry}\n`); }
    else     { failed++; }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

process.stdout.write(`\n[bulk-sync] Done — ${synced} synced, ${failed} failed\n`);
process.stdout.write(`[bulk-sync] Skills installed at: /home/${wslUser}/.hermes/skills/\n`);
process.stdout.write(`[bulk-sync] Verify: wsl -d ${WSL_DISTRO} -- ls ~/.hermes/skills/\n`);
process.exit(failed > 0 ? 1 : 0);
