'use strict';

/**
 * Autoresearch ↔ Hermes LLM benchmark
 *
 * Tests each provider in the fallback chain:
 *   1. Connectivity + basic completion
 *   2. JSON generation (planner-style output)
 *   3. Latency measurement
 *
 * Usage: node autoresearch/benchmark.cjs [--verbose] [--json]
 */

const { benchmark, complete, completeJSON, getProviderChain } = require('./lib/llm.cjs');

const VERBOSE = process.argv.includes('--verbose');
const JSON_OUT = process.argv.includes('--json');

async function runBenchmark() {
  const startTotal = Date.now();
  const report = { timestamp: new Date().toISOString(), tests: [], summary: {} };

  // Test 1: Basic connectivity for each provider
  console.log('=== Autoresearch ↔ Hermes LLM Benchmark ===\n');
  console.log('Test 1: Provider connectivity...');
  const connResults = await benchmark({ timeoutMs: 20000 });

  const anyConnOk = connResults.some(r => r.status === 'ok');
  for (const r of connResults) {
    if (r.status === 'error' && anyConnOk) r.status = 'warn';
    const icon = r.status === 'ok' ? 'PASS' : r.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  [${icon}] ${r.provider} (${r.model}) — ${r.latencyMs}ms${r.error ? ` — ${r.error}` : ''}`);
    if (VERBOSE && r.preview) console.log(`        preview: ${r.preview}`);
    report.tests.push({ test: 'connectivity', ...r });
  }

  // Test 2: Full completion (system + user, longer response)
  console.log('\nTest 2: Full completion (hypothesis generation)...');
  const planPrompt = [
    {
      role: 'system',
      content: 'You are an autoresearch planner. Generate improvement hypotheses for code quality.',
    },
    {
      role: 'user',
      content: `Given a codebase with 41 route files and 30+ database tables, suggest 3 concrete hypotheses to improve test coverage. Each hypothesis should name a specific file or module. Respond with JSON: { "hypotheses": [{"id": 1, "description": "...", "target": "..."}], "context": "..." }`,
    },
  ];

  const t2Start = Date.now();
  try {
    const result = await completeJSON(planPrompt, { maxTokens: 1024, timeoutMs: 45000 });
    const t2Ms = Date.now() - t2Start;
    const hypCount = result.parsed?.hypotheses?.length || 0;
    console.log(`  [PASS] ${result.provider} — ${t2Ms}ms — ${hypCount} hypotheses generated`);
    if (VERBOSE) {
      for (const h of (result.parsed?.hypotheses || []).slice(0, 3)) {
        console.log(`        #${h.id}: ${(h.description || '').slice(0, 80)}`);
      }
    }
    report.tests.push({
      test: 'completion',
      provider: result.provider,
      model: result.model,
      status: 'ok',
      latencyMs: t2Ms,
      hypothesesCount: hypCount,
    });
  } catch (err) {
    const t2Ms = Date.now() - t2Start;
    console.log(`  [FAIL] All providers — ${t2Ms}ms — ${err.message.slice(0, 200)}`);
    report.tests.push({ test: 'completion', status: 'error', latencyMs: t2Ms, error: err.message.slice(0, 200) });
  }

  // Test 3: JSON extraction reliability
  console.log('\nTest 3: JSON extraction from LLM response...');
  const jsonPrompt = [
    { role: 'user', content: 'Respond with exactly this JSON and nothing else: {"status":"ok","count":3,"items":["a","b","c"]}' },
  ];

  const t3Start = Date.now();
  try {
    const result = await completeJSON(jsonPrompt, { maxTokens: 256, temperature: 0, timeoutMs: 20000 });
    const t3Ms = Date.now() - t3Start;
    const valid = result.parsed?.status === 'ok' && Array.isArray(result.parsed?.items);
    console.log(`  [${valid ? 'PASS' : 'WARN'}] ${result.provider} — ${t3Ms}ms — JSON valid: ${valid}`);
    report.tests.push({
      test: 'json_extraction',
      provider: result.provider,
      status: valid ? 'ok' : 'warn',
      latencyMs: t3Ms,
      jsonValid: valid,
    });
  } catch (err) {
    const t3Ms = Date.now() - t3Start;
    console.log(`  [FAIL] — ${t3Ms}ms — ${err.message.slice(0, 200)}`);
    report.tests.push({ test: 'json_extraction', status: 'error', latencyMs: t3Ms, error: err.message.slice(0, 200) });
  }

  // Summary
  const totalMs = Date.now() - startTotal;
  const passCount = report.tests.filter(t => t.status === 'ok').length;
  const failCount = report.tests.filter(t => t.status === 'error').length;
  const warnCount = report.tests.filter(t => t.status === 'warn').length;
  const chain = getProviderChain();

  report.summary = {
    totalMs,
    passCount,
    failCount,
    warnCount,
    providerChain: chain.map(p => p.name),
    firstAvailable: connResults.find(r => r.status === 'ok')?.provider || 'none',
  };

  console.log(`\n=== Summary ===`);
  console.log(`  Total time: ${totalMs}ms`);
  console.log(`  Results: ${passCount} PASS / ${warnCount} WARN / ${failCount} FAIL`);
  console.log(`  Provider chain: ${chain.map(p => p.name).join(' → ')}`);
  console.log(`  First available: ${report.summary.firstAvailable}`);

  if (JSON_OUT) {
    const fs = require('node:fs');
    const outPath = require('node:path').resolve(__dirname, '..', '_runs', 'benchmark-latest.json');
    fs.mkdirSync(require('node:path').dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n  JSON report: ${outPath}`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

runBenchmark().catch(err => {
  console.error(`Benchmark failed: ${err.message}`);
  process.exit(1);
});
