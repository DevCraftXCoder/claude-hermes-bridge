// sync-hermes.cjs
// Claude Code → Hermes Agent skill sync hook
// PostToolUse (Write|Edit) — auto-syncs .claude/agents/*.md, .claude/hooks/*.cjs,
// and .claude/skills/**/SKILL.md to ~/.hermes/skills/ in WSL whenever edited.
//
// Drop into your .claude/hooks/ directory and register in settings.json:
//
//   "postToolUse": [
//     {
//       "matcher": "Write|Edit",
//       "hooks": [{ "type": "command", "command": "node /path/to/.claude/hooks/sync-hermes.cjs" }]
//     }
//   ]
//
// Config via environment variables (all optional — auto-detected if not set):
//   HERMES_WSL_DISTRO        WSL distro name (default: Ubuntu)
//   HERMES_WSL_USER          WSL username (default: auto-detected via whoami)
//   HERMES_CATEGORY_AGENTS   Hermes category name for agents (default: cc-agents)
//   HERMES_CATEGORY_HOOKS    Hermes category name for hooks  (default: cc-hooks)
//   HERMES_CATEGORY_SKILLS   Hermes category name for skills (default: cc-skills)
//
// Requirements:
//   - Windows with WSL installed
//   - Hermes Agent installed in WSL at ~/.hermes/
//   - Node.js available in PATH
//
// Linux/Mac users: replace syncToHermes() with a direct fs.writeFileSync call.

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
    throw new Error(`unsafe ${label}: ${JSON.stringify(value)} — only [A-Za-z0-9._-] allowed`);
  }
}

const DEBOUNCE_MS = 5_000;
const WSL_DISTRO  = process.env.HERMES_WSL_DISTRO        || 'Ubuntu';
const CAT_AGENTS  = process.env.HERMES_CATEGORY_AGENTS    || 'cc-agents';
const CAT_HOOKS   = process.env.HERMES_CATEGORY_HOOKS     || 'cc-hooks';
const CAT_SKILLS  = process.env.HERMES_CATEGORY_SKILLS    || 'cc-skills';

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
    // succeed. Throw so main() can surface the error and the user can set HERMES_WSL_USER.
    throw new Error(`could not detect WSL user (set HERMES_WSL_USER env var): ${err.message}`);
  }
  return _wslUser;
}

// [Perf Fix 4] Stream-parse just the file_path from stdin — bail early for non-agent/hook/skill
// files without waiting for the full JSON payload. Saves ~15ms per Write/Edit event.
function readFilePathFast() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      buf += chunk;
      const m = buf.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        process.stdin.destroy();
        resolve(m[1].replace(/\\\\/g, '\\').replace(/\\/g, '/'));
      }
    });
    process.stdin.on('end', () => resolve(null));
    process.stdin.on('error', () => resolve(null));
  });
}

function wslUnixPath(winPath) {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
}

function syncToHermes(name, content, category) {
  // [P1-B] Validate all values that appear in the shell command before use.
  assertSafeId(name, 'skill name');
  assertSafeId(category, 'category');
  const wslUser = getWslUser();
  assertSafeId(wslUser, 'WSL username');

  const skillDir  = `/home/${wslUser}/.hermes/skills/${category}/${name}`;
  const skillFile = `${skillDir}/SKILL.md`;

  // Write to Windows temp, then have WSL copy it (avoids all bash escaping issues).
  // [P2] Use createHash for a collision-free temp name.
  const tmpId   = createHash('sha256').update(`${Date.now()}-${name}`).digest('hex').slice(0, 16);
  const tmpWin  = path.join(os.tmpdir(), `hermes-sync-${tmpId}.md`);
  const tmpUnix = wslUnixPath(tmpWin);
  fs.writeFileSync(tmpWin, content, 'utf8');

  try {
    execSync(
      `wsl -d ${WSL_DISTRO} -- bash -c "mkdir -p '${skillDir}' && cp '${tmpUnix}' '${skillFile}'"`,
      { windowsHide: true, stdio: 'pipe', timeout: 10_000 }
    );
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

async function main() {
  const filePath = await readFilePathFast();
  if (!filePath) process.exit(0);

  const isAgent = filePath.includes('/.claude/agents/') && filePath.endsWith('.md');
  const isHook  = filePath.includes('/.claude/hooks/')  && filePath.endsWith('.cjs');
  const isSkill = filePath.includes('/.claude/skills/') && filePath.endsWith('.md');

  if (!isAgent && !isHook && !isSkill) process.exit(0);

  // [P1-F] Per-file debounce stamp — use SHA-256 of full path (not truncated base64)
  // to avoid key collisions between files sharing a path prefix.
  const fileStamp = path.join(
    os.tmpdir(),
    `.hermes-sync-${createHash('sha256').update(filePath).digest('hex').slice(0, 32)}`
  );
  try {
    const last = parseInt(fs.readFileSync(fileStamp, 'utf8'), 10);
    if (Date.now() - last < DEBOUNCE_MS) process.exit(0);
  } catch { /* first sync for this file */ }
  // NOTE: stamp is written AFTER sync completes (see bottom of function) so a failed
  // sync does not suppress the next retry. [P1-D]

  // Resolve to Windows path if needed
  const winPath = filePath
    .replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:/`)
    .replace(/^\/([a-z])\//, (_, d) => `${d.toUpperCase()}:/`);

  // [P1-E] Surface read failures to stderr rather than silently exiting 0.
  let raw;
  try { raw = fs.readFileSync(winPath, 'utf8'); } catch {
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch {
      process.stderr.write(`[sync-hermes] ERROR: could not read file: ${filePath}\n`);
      process.exit(1);
    }
  }

  if (isAgent) {
    const name    = path.basename(filePath, '.md');
    const content = [
      `# ${name}`,
      '',
      `> Claude Code agent — auto-synced from .claude/agents/${name}.md`,
      `> Last sync: ${new Date().toISOString()}`,
      '',
      raw,
    ].join('\n');
    syncToHermes(name, content, CAT_AGENTS);
    process.stderr.write(`[sync-hermes] agent synced → ${CAT_AGENTS}/${name}\n`);
  }

  if (isHook) {
    const name = path.basename(filePath, '.cjs');
    if (name.startsWith('_')) process.exit(0); // skip archived hooks (_ prefix)
    const description = extractFirstComment(raw);
    const snippet     = raw.slice(0, 3000);
    const content = [
      `# Hook: ${name}`,
      '',
      `> Claude Code hook — auto-synced from .claude/hooks/${name}.cjs`,
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
    syncToHermes(name, content, CAT_HOOKS);
    process.stderr.write(`[sync-hermes] hook synced → ${CAT_HOOKS}/${name}\n`);
  }

  if (isSkill) {
    const name    = path.basename(path.dirname(filePath));
    const content = [
      `# Skill: ${name}`,
      '',
      `> Claude Code skill — auto-synced from .claude/skills/${name}/SKILL.md`,
      `> Last sync: ${new Date().toISOString()}`,
      '',
      raw,
    ].join('\n');
    syncToHermes(name, content, CAT_SKILLS);
    process.stderr.write(`[sync-hermes] skill synced → ${CAT_SKILLS}/${name}\n`);
  }

  // [P1-D] Write debounce stamp only after a successful sync, not before.
  fs.writeFileSync(fileStamp, String(Date.now()));

  process.exit(0);
}

// [P1-A] Surface errors to stderr and exit non-zero so Claude Code hook output
// shows the failure rather than silently treating every error as success.
main().catch(err => {
  process.stderr.write(`[sync-hermes] ERROR: ${err.message}\n`);
  process.exit(1);
});
