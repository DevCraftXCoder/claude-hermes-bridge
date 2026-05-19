'use strict';

/**
 * Autoresearch planner template — generates hypotheses via Hermes LLM chain.
 *
 * USAGE:
 *   Copy this file as <domain>-planner.cjs alongside the domain's measure script.
 *   The autoresearch harness calls: node <domain>-planner.cjs
 *   It must print JSON to stdout: { hypotheses: [...], context: string }
 *
 * CUSTOMIZE:
 *   1. Set DOMAIN_NAME to match your domain config name
 *   2. Edit buildPrompt() to describe the domain-specific improvement strategy
 *   3. Optionally adjust MAX_HYPOTHESES and TEMPERATURE
 */

const fs = require('node:fs');
const path = require('node:path');
const { completeJSON } = require('../lib/llm.cjs');

const DOMAIN_NAME = 'CHANGE_ME';
const MAX_HYPOTHESES = 5;
const TEMPERATURE = 0.7;

function loadDomainContext() {
  const configPath = path.resolve(__dirname, '..', '..', 'scripts', 'autoresearch', 'domains', `${DOMAIN_NAME}.json`);
  if (!fs.existsSync(configPath)) {
    return { config: null, lastExperiments: [] };
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const expPath = path.resolve(process.cwd(), '_runs', 'autoresearch', DOMAIN_NAME, 'experiments.jsonl');
  let lastExperiments = [];
  if (fs.existsSync(expPath)) {
    const lines = fs.readFileSync(expPath, 'utf8').split('\n').filter(Boolean);
    lastExperiments = lines.slice(-5).map(l => JSON.parse(l));
  }

  return { config, lastExperiments };
}

function buildPrompt(config, lastExperiments) {
  const targetFiles = (config?.targets || []).map(t => path.basename(t)).join(', ');
  const program = config?.program || 'Improve the codebase quality score.';
  const recentResults = lastExperiments
    .map(e => `  exp#${e.experiment}: ${e.status} (${e.metric_before ?? e.metric}→${e.metric_after ?? '?'}) "${e.hypothesis}"`)
    .join('\n') || '  (no prior experiments)';

  return `You are an autoresearch planner for the "${DOMAIN_NAME}" domain.

GOAL: Generate ${MAX_HYPOTHESES} concrete, actionable hypotheses to improve the domain metric.

DOMAIN PROGRAM:
${program}

TARGET FILES: ${targetFiles || '(see config)'}
METRIC: ${config?.metric?.name || 'score'} (direction: ${config?.metric?.direction || 'higher'}, threshold: ${config?.metric?.threshold || '?'})

RECENT EXPERIMENT HISTORY:
${recentResults}

RULES:
- Each hypothesis must be a specific code change, not a vague suggestion
- Reference exact file names and functions where possible
- Prioritize hypotheses that address gaps shown in recent failures
- Do NOT repeat hypotheses that were already tried and discarded
- Output valid JSON only

Respond with JSON:
{
  "hypotheses": [
    { "id": 1, "description": "...", "priority": "P0|P1|P2", "target_file": "...", "estimated_impact": "..." },
    ...
  ],
  "context": "Brief summary of current state and reasoning"
}`;
}

async function main() {
  const { config, lastExperiments } = loadDomainContext();
  const prompt = buildPrompt(config, lastExperiments);

  const result = await completeJSON(
    [
      { role: 'system', content: 'You are a precise code quality improvement planner. Always respond with valid JSON.' },
      { role: 'user', content: prompt },
    ],
    { temperature: TEMPERATURE, maxTokens: 2048 }
  );

  const output = {
    hypotheses: result.parsed.hypotheses || [],
    context: result.parsed.context || '',
    llm_provider: result.provider,
    llm_model: result.model,
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch(err => {
  process.stderr.write(`Planner error: ${err.message}\n`);
  process.exit(1);
});
