'use strict';

/**
 * Measure: sync-coverage
 *
 * Counts how many agents, hooks, and skills are synced to ~/.hermes/skills/
 * and reports a 0-100 coverage score based on source counts vs synced counts.
 *
 * Returns JSON to stdout:
 *   { score, synced, source, categories }
 */

const { execSync } = require('node:child_process');

const CATEGORIES = ['frxncois-agents', 'frxncois-hooks', 'frxncois-skills'];

const SOURCE_DIRS = {
  'frxncois-agents': 'C:/Za/.claude/agents',
  'frxncois-hooks': 'C:/Za/.claude/hooks',
  'frxncois-skills': 'C:/Za/.claude/skills',
};

function wslCount(dir) {
  try {
    const raw = execSync(`wsl -d Ubuntu -- bash -c "ls ${dir}/ 2>/dev/null | wc -l"`, { timeout: 6000 }).toString().trim();
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

function sourceCount(winPath) {
  try {
    const fs = require('node:fs');
    if (!fs.existsSync(winPath)) return 0;
    return fs.readdirSync(winPath).filter(f => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

const categories = {};
let totalSynced = 0;
let totalSource = 0;

for (const cat of CATEGORIES) {
  const hermesDir = `~/.hermes/skills/${cat}`;
  const synced = wslCount(hermesDir);
  const source = sourceCount(SOURCE_DIRS[cat]);
  categories[cat] = { synced, source };
  totalSynced += synced;
  totalSource += source;
}

const score = totalSource > 0 ? Math.round((totalSynced / totalSource) * 100) : 0;

process.stdout.write(JSON.stringify({
  score,
  synced: totalSynced,
  source: totalSource,
  categories,
}));
