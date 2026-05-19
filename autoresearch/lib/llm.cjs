'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROVIDERS = [
  {
    name: 'openrouter',
    model: 'nousresearch/hermes-3-llama-3.1-405b',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
  },
  {
    name: 'ollama',
    model: 'qwen2.5-coder:14b',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    envKey: null,
  },
  {
    name: 'hermes',
    model: null,
    baseUrl: null,
    envKey: null,
  },
];

function getProviderChain() {
  const chain = [];
  for (const p of PROVIDERS) {
    if (p.name === 'openrouter') {
      const key = process.env.OPENROUTER_API_KEY || readHermesEnvKey('OPENROUTER_API_KEY');
      if (key) chain.push({ ...p, apiKey: key });
    } else if (p.name === 'ollama') {
      chain.push({ ...p, apiKey: null });
    } else if (p.name === 'hermes') {
      chain.push({ ...p, apiKey: null });
    }
  }
  return chain;
}

function readEnvFile(filePath, varName) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const line = lines.find(l => l.startsWith(`${varName}=`));
    if (!line) return null;
    return line.split('=').slice(1).join('=').replace(/^["']|["']$/g, '').trim();
  } catch {
    return null;
  }
}

function readHermesEnvKey(varName) {
  const localEnv = readEnvFile(path.resolve(__dirname, '..', '..', '.env'), varName);
  if (localEnv) return localEnv;

  const rootEnv = readEnvFile('C:/Za/.env', varName);
  if (rootEnv) return rootEnv;

  try {
    const out = execSync(
      `wsl -d Ubuntu -- bash -lc "grep '^${varName}=' ~/.hermes/.env 2>/dev/null | head -1"`,
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    ).trim();
    const match = out.match(/^[^=]+=(.+)$/);
    return match ? match[1].replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

async function callOpenAI(provider, messages, opts = {}) {
  const maxRetries = provider.name === 'ollama' ? 2 : 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
    if (provider.name === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/DevCraftXCoder/claude-hermes-bridge';
      headers['X-Title'] = 'autoresearch-planner';
    }

    const body = {
      model: provider.model,
      messages,
      max_tokens: opts.maxTokens || 2048,
      temperature: opts.temperature ?? 0.7,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);

    try {
      const res = await fetch(provider.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 500 && attempt < maxRetries) {
          clearTimeout(timeout);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error(`${provider.name} HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${provider.name}: empty response`);

      return {
        provider: provider.name,
        model: provider.model,
        content,
        usage: data.usage || null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function callHermes(messages, opts = {}) {
  const lastMsg = messages[messages.length - 1]?.content || '';
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const prompt = systemMsg ? `${systemMsg}\n\n${lastMsg}` : lastMsg;

  const tmpFile = path.join(os.tmpdir(), `hermes-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt, 'utf8');

  const timeout = opts.timeoutMs || 60000;
  try {
    const wslPath = tmpFile.replace(/\\/g, '/').replace(/^([A-Z]):/i, (_, d) => `/mnt/${d.toLowerCase()}`);
    const stdout = execSync(
      `wsl -d Ubuntu -- bash -lc "hermes -z \\"$(cat '${wslPath}')\\" 2>/dev/null"`,
      { encoding: 'utf8', timeout, windowsHide: true }
    );
    return {
      provider: 'hermes',
      model: 'hermes-configured',
      content: stdout.trim(),
      usage: null,
    };
  } catch (err) {
    throw new Error(`hermes one-shot failed: ${err.message.slice(0, 300)}`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function complete(messages, opts = {}) {
  const chain = getProviderChain();
  const errors = [];

  for (const provider of chain) {
    try {
      if (provider.name === 'hermes') {
        return callHermes(messages, opts);
      }
      return await callOpenAI(provider, messages, opts);
    } catch (err) {
      errors.push({ provider: provider.name, error: err.message });
    }
  }

  throw new Error(
    `All providers failed:\n${errors.map(e => `  ${e.provider}: ${e.error}`).join('\n')}`
  );
}

async function completeJSON(messages, opts = {}) {
  const result = await complete(messages, opts);
  const jsonMatch = result.content.match(/```json\s*([\s\S]*?)```/) ||
    result.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON found in ${result.provider} response`);

  const raw = jsonMatch[1] || jsonMatch[0];
  const parsed = JSON.parse(raw);
  return { ...result, parsed };
}

async function benchmark(opts = {}) {
  const chain = getProviderChain();
  const testMessages = [
    { role: 'system', content: 'You are a code quality analyzer.' },
    { role: 'user', content: 'Respond with exactly: {"status":"ok","provider":"your_name"}' },
  ];
  const results = [];

  for (const provider of chain) {
    const start = Date.now();
    try {
      let result;
      if (provider.name === 'hermes') {
        result = callHermes(testMessages, { timeoutMs: opts.timeoutMs || 30000 });
      } else {
        result = await callOpenAI(provider, testMessages, {
          maxTokens: 100,
          timeoutMs: opts.timeoutMs || 15000,
        });
      }
      results.push({
        provider: provider.name,
        model: provider.model || 'hermes-configured',
        status: 'ok',
        latencyMs: Date.now() - start,
        responseLength: result.content.length,
        preview: result.content.slice(0, 120),
      });
    } catch (err) {
      results.push({
        provider: provider.name,
        model: provider.model || 'hermes-configured',
        status: 'error',
        latencyMs: Date.now() - start,
        error: err.message.slice(0, 200),
      });
    }
  }
  return results;
}

module.exports = { complete, completeJSON, benchmark, getProviderChain, PROVIDERS };
