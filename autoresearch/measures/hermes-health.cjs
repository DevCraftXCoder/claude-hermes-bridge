'use strict';

/**
 * Measure: hermes-health
 *
 * Checks whether the Hermes dashboard and LLM providers are reachable.
 * Returns a 0-100 health score.
 *
 * Returns JSON to stdout:
 *   { score, checks }
 */

const { execSync } = require('node:child_process');

function httpCheck(url, timeoutMs = 4000) {
  try {
    execSync(`curl -sf --max-time ${Math.floor(timeoutMs / 1000)} "${url}"`, { timeout: timeoutMs + 500, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const checks = {
  hermes_dashboard: httpCheck('http://localhost:4333/health'),
  ollama: httpCheck('http://localhost:11434/api/tags'),
  openrouter_reachable: httpCheck('https://openrouter.ai/api/v1/models'),
};

const passed = Object.values(checks).filter(Boolean).length;
const total = Object.keys(checks).length;
const score = Math.round((passed / total) * 100);

process.stdout.write(JSON.stringify({ score, checks }));
