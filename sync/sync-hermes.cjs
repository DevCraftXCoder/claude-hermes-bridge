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

const DEBOUNCE_MS = 5_000;
const WSL_DISTRO  = process.env.HERMES_WSL_DISTRO        || 'Ubuntu';
const CAT_AGENTS  = process.env.HERMES_CATEGORY_AGENTS    || 'cc-agents';
const CAT_HOOKS   = process.env.HERMES_CATEGORY_HOOKS     || 'cc-hooks';
const CAT_SKILLS  = process.env.HERMES_CATEGORY_SKILLS    || 'cc-skills';

let _wslUser = process.env.HERMES_WSL_USER || null;

function getWslUser() {
  if (_wslUser) return _wslUser;
  try {
    _wslUser = execSync(
      `wsl -d ${WSL_DISTRO} -- whoami`,
      { encoding: 'utf8', timeout: 5_000, stdio: 'pipe', windowsHide: true }
    ).trim();
  } catch {
    _wslUser = 'user'; // fallback — set HERMES_WSL_USER to override
    process.stderr.write(`[sync-hermes] WARN: could not detect WSL user, set HERMES_WSL_USER env var\n`);
  }
  return _wslUser;
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    process.stdin.on('error', reject);
  });
}

function wslUnixPath(winPath) {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
}

function syncToHermes(name, content, category) {
  const wslUser   = getWslUser();
  const skillDir  = `/home/${wslUser}/.hermes/skills/${category}/${name}`;
  const skillFile = `${skillDir}/SKILL.md`;

  // Write to Windows temp, then have WSL copy it (avoids all bash escaping issues)
  const tmpWin  = path.join(os.tmpdir(), `hermes-sync-${Date.now()}.md`);
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
  let input;
  try { input = await readStdinJson(); } catch { process.exit(0); }

  const filePath = (input?.tool_input?.file_path || '').replace(/\\/g, '/');
  if (!filePath) process.exit(0);

  const isAgent = filePath.includes('/.claude/agents/') && filePath.endsWith('.md');
  const isHook  = filePath.includes('/.claude/hooks/')  && filePath.endsWith('.cjs');
  const isSkill = filePath.includes('/.claude/skills/') && filePath.endsWith('.md');

  if (!isAgent && !isHook && !isSkill) process.exit(0);

  // Per-file debounce stamp — each file has its own 5s window
  const fileStamp = path.join(
    os.tmpdir(),
    `.hermes-sync-${Buffer.from(filePath).toString('base64').slice(0, 16)}`
  );
  try {
    const last = parseInt(fs.readFileSync(fileStamp, 'utf8'), 10);
    if (Date.now() - last < DEBOUNCE_MS) process.exit(0);
  } catch { /* first sync for this file */ }
  fs.writeFileSync(fileStamp, String(Date.now()));

  // Resolve to Windows path if needed
  const winPath = filePath
    .replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:/`)
    .replace(/^\/([a-z])\//, (_, d) => `${d.toUpperCase()}:/`);

  let raw;
  try { raw = fs.readFileSync(winPath, 'utf8'); } catch {
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch { process.exit(0); }
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

  process.exit(0);
}

main().catch(() => process.exit(0));
