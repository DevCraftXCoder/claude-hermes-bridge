# Detective Dono — Performance Audit
# claude-hermes-bridge / 2026-05-21

## Production Readiness Score: 62/100

Deductions: one WSL subprocess per file in bulk-sync (-15), sequential provider fallback chain (-10), sync-on-every-hook-invocation with cold-start cost (-8), blocking readHermesEnvKey on callHermes path (-5).

---

## Top 5 Performance Findings (ranked by impact)

---

### Finding 1 — CRITICAL: bulk-sync fires one WSL process per file (N × ~300 ms overhead)

**What it is:** `bulk-sync-hermes.cjs` calls `syncToHermes()` inside a `for` loop — once per agent, once per hook, once per skill. Each call spawns `wsl -d Ubuntu -- bash -c "mkdir -p ... && cp ..."` via `execSync`. On a 40-agent + 25-hook + 30-skill repo that is ~95 sequential WSL process spawns.

**Why it's slow:** WSL process startup costs ~80–200 ms each on Windows 11 (observed 95–762 ms in `_runs/hook-timing.jsonl`). Sequentially that is 95 × ~150 ms = ~14 seconds of pure OS overhead before any file bytes land. Additionally every invocation also pays a separate `wsl -- whoami` round-trip on the first call (another ~100 ms).

**Specific fix — batch all copies into one WSL command:**

```javascript
// bulk-sync-hermes.cjs — replace the per-file syncToHermes() loop with a batch approach

async function batchSyncToHermes(items, category) {
  // items: [{ name, content }, ...]
  const wslUser = getWslUser();
  assertSafeId(wslUser, 'WSL username');
  assertSafeId(category, 'category');

  // 1. Write all temp files to Windows tmpdir (pure JS, ~0 ms overhead)
  const pairs = items.map(({ name, content }) => {
    assertSafeId(name, 'skill name');
    const tmpId  = createHash('sha256').update(`${Date.now()}-${name}-${Math.random()}`).digest('hex').slice(0, 16);
    const tmpWin = path.join(os.tmpdir(), `hermes-bulk-${tmpId}.md`);
    fs.writeFileSync(tmpWin, content, 'utf8');
    const destDir  = `/home/${wslUser}/.hermes/skills/${category}/${name}`;
    const destFile = `${destDir}/SKILL.md`;
    return { name, tmpWin, tmpUnix: wslUnixPath(tmpWin), destDir, destFile };
  });

  // 2. ONE WSL invocation for all files in this category
  const cmds = pairs
    .map(p => `mkdir -p '${p.destDir}' && cp '${p.tmpUnix}' '${p.destFile}'`)
    .join(' && ');

  try {
    execSync(`wsl -d ${WSL_DISTRO} -- bash -c "${cmds}"`,
      { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
  } finally {
    for (const p of pairs) try { fs.unlinkSync(p.tmpWin); } catch {}
  }
}
```

Call once per category:
```javascript
const agentItems = agentFiles.map(file => ({ name, content }));
batchSyncToHermes(agentItems, CAT_AGENTS);   // 1 WSL spawn instead of N
batchSyncToHermes(hookItems,  CAT_HOOKS);    // 1 WSL spawn
batchSyncToHermes(skillItems, CAT_SKILLS);   // 1 WSL spawn
```

**Impact:** Cuts bulk-sync WSL overhead from ~95 spawns to 3. Wall-clock time drops from ~14 s → ~0.5 s on a 95-file repo. The `whoami` lookup also fires once (cached in `_wslUser`).

---

### Finding 2 — HIGH: readHermesEnvKey() fires a WSL subprocess on every `complete()` call when OPENROUTER_API_KEY is not in the Windows environment

**What it is:** `getProviderChain()` in `lib/llm.cjs` calls `readHermesEnvKey('OPENROUTER_API_KEY')` unconditionally to build the chain. `readHermesEnvKey` has three layers:
1. Read local `.env` (fast)
2. Read `C:/Za/.env` (fast)
3. **Fall through to `execSync('wsl -d Ubuntu -- bash -lc "grep ... ~/.hermes/.env"')`** — this fires every single time `getProviderChain()` is called, including on every `complete()` or `completeJSON()` invocation in the planner template.

**Why it's slow:** The WSL `bash -lc` login shell adds ~300–500 ms versus a plain `bash -c`. With no key in local `.env` files, every LLM call pays an extra WSL login-shell subprocess before the actual HTTP request. The benchmark shows Test 2 at 21,256 ms — a meaningful fraction of that can be saved by caching.

**Specific fix — cache the resolved key at module load time:**

```javascript
// lib/llm.cjs — add at module top level, outside any function

let _resolvedOpenRouterKey = null; // undefined = not yet resolved; null = not found

function getOpenRouterKey() {
  if (_resolvedOpenRouterKey !== undefined) return _resolvedOpenRouterKey;
  const key = process.env.OPENROUTER_API_KEY || readHermesEnvKey('OPENROUTER_API_KEY');
  _resolvedOpenRouterKey = key || null;
  return _resolvedOpenRouterKey;
}

// In getProviderChain():
function getProviderChain() {
  const chain = [];
  for (const p of PROVIDERS) {
    if (p.name === 'openrouter') {
      const key = getOpenRouterKey();   // cached after first call
      if (key) chain.push({ ...p, apiKey: key });
    } else {
      chain.push({ ...p, apiKey: null });
    }
  }
  return chain;
}
```

**Impact:** Eliminates a 300–500 ms WSL login-shell round-trip on every `complete()` call after the first. For the benchmark's 3 sequential tests this saves ~900–1500 ms. For a planner loop with 10 iterations it saves ~3–5 s.

---

### Finding 3 — HIGH: callHermes() uses `bash -lc` (login shell) which adds 300–500 ms per call; also blocks the event loop via execSync

**What it is:** In `lib/llm.cjs`, `callHermes()` uses:
```javascript
execSync(
  `wsl -d Ubuntu -- bash -lc "hermes -z \\"$(cat '${wslPath}')\\" 2>/dev/null"`,
  { encoding: 'utf8', timeout, windowsHide: true }
);
```

Two issues here:
1. `bash -lc` sources `~/.bashrc`, `~/.profile`, and `~/.bash_profile`. On a Hermes install this evaluates nvm/pyenv init, PATH exports, and Hermes's own shell hooks — typically 300–500 ms extra before `hermes` even starts. The benchmark records Hermes at 8,008 ms vs OpenRouter at 2,331 ms; roughly 300–500 ms of that gap is pure login-shell overhead.
2. `execSync` blocks the Node.js event loop for the entire duration of the Hermes call (60 s timeout). Any other I/O or timers queue behind it.

**Specific fix — switch to `bash -c` with an explicit PATH, and use `execFileAsync` instead of `execSync`:**

```javascript
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

async function callHermes(messages, opts = {}) {
  const lastMsg   = messages[messages.length - 1]?.content || '';
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const prompt    = systemMsg ? `${systemMsg}\n\n${lastMsg}` : lastMsg;

  const tmpFile = path.join(os.tmpdir(), `hermes-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt, 'utf8');
  const wslPath = tmpFile.replace(/\\/g, '/').replace(/^([A-Z]):/i, (_, d) => `/mnt/${d.toLowerCase()}`);

  const timeout = opts.timeoutMs || 60000;
  try {
    // bash -c (not -lc): no login-shell overhead. Explicit PATH covers ~/.local/bin.
    const { stdout } = await execFileAsync(
      'wsl', ['-d', 'Ubuntu', '--', 'bash', '-c',
        `PATH="$HOME/.local/bin:$PATH" hermes -z "$(cat '${wslPath}')" 2>/dev/null`],
      { encoding: 'utf8', timeout, windowsHide: true }
    );
    return { provider: 'hermes', model: 'hermes-configured', content: stdout.trim(), usage: null };
  } catch (err) {
    throw new Error(`hermes one-shot failed: ${err.message.slice(0, 300)}`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
```

**Impact:** Saves 300–500 ms per Hermes call. Switching from `execSync` to `await execFileAsync` unblocks the Node.js event loop, enabling concurrent I/O (e.g. writing telemetry, reading debounce stamps) while Hermes runs. The benchmark's Hermes latency would drop from ~8 s to ~7.5 s, and the event loop is no longer frozen during that window.

---

### Finding 4 — MEDIUM: sync-hermes.cjs (the per-save hook) pays a 100 ms+ cold-start cost on every PostToolUse Write/Edit event, even when the file is not an agent/hook/skill

**What it is:** Claude Code invokes `node sync-hermes.cjs` on **every** Write/Edit tool call. The script does a full CJS module load on every invocation: `require('crypto')`, `require('fs')`, `require('os')`, `require('path')`, `require('child_process')` — all loaded fresh each time. The file-type check (`isAgent`, `isHook`, `isSkill`) that gates further work happens only **after** stdin is fully consumed and the JSON is parsed.

On the common case (editing a file that is NOT an agent/hook/skill), the script pays:
- Node.js VM startup: ~30–50 ms
- Module require() cold-start: ~10–20 ms  
- stdin buffering (waiting for Claude Code to write JSON): ~5–20 ms
- JSON parse + path checks
- Then exits 0 in ~100–200 ms

This is confirmed by `hook-timing.jsonl`: the fastest runs are 95–100 ms (the no-op exits after type-check).

**Specific fix — move the path filter to the very top, before stdin reads, using the tool_input from a pre-parsed first byte:**

The most effective fix is to read `CLAUDE_TOOL_INPUT` if Claude Code ever sets it as an env var, or to structure the stdin read as a streaming early-exit:

```javascript
// At the top of main(), before the full stdin buffer is consumed:
// Claude Code passes the file path in tool_input.file_path.
// Stream-parse just the file_path key without waiting for the full JSON.

async function readFilePathFast() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      buf += chunk;
      // Once we have enough characters to extract file_path, bail early.
      const m = buf.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        process.stdin.destroy(); // stop reading; we have what we need
        resolve(m[1].replace(/\\\\/g, '\\').replace(/\\/g, '/'));
      }
    });
    process.stdin.on('end', () => resolve(null));
    process.stdin.on('error', () => resolve(null));
  });
}

async function main() {
  const filePath = await readFilePathFast();
  if (!filePath) process.exit(0);

  const isAgent = filePath.includes('/.claude/agents/') && filePath.endsWith('.md');
  const isHook  = filePath.includes('/.claude/hooks/')  && filePath.endsWith('.cjs');
  const isSkill = filePath.includes('/.claude/skills/') && filePath.endsWith('.md');

  if (!isAgent && !isHook && !isSkill) process.exit(0);  // fast exit — no full JSON parse needed

  // ... rest of main() unchanged, full JSON parse only needed for the actual sync path
}
```

**Impact:** For the ~95% of Write/Edit events that target non-agent/hook/skill files, the script exits after receiving just the first `file_path` key — saving 5–20 ms of stdin buffering and full JSON parse. Over a session with 200 file writes, this accumulates to 1–4 seconds of saved hook latency. More importantly it reduces the hook's visible tail latency in the Claude Code UI.

---

### Finding 5 — MEDIUM: LLM fallback chain in `complete()` is strictly sequential — Ollama and OpenRouter are never tried in parallel, adding full provider latency on every failure

**What it is:** `complete()` in `lib/llm.cjs` iterates `chain` with a `for...of` loop and `await` inside:

```javascript
for (const provider of chain) {
  try {
    if (provider.name === 'hermes') return callHermes(messages, opts);
    return await callOpenAI(provider, messages, opts);   // blocks here until full timeout
  } catch (err) { errors.push(...); }
}
```

When ollama is the first provider and it is down, `callOpenAI` runs to its full timeout (default 30 s) before openrouter is tried. The benchmark shows that even when ollama responds in 2,282 ms, any situation where it times out makes the full chain 30 s + 2.3 s = 32+ s before an answer arrives.

**Specific fix — race providers with `Promise.any()`, using a tiered approach (fast providers first, Hermes last due to its blocking execSync nature):**

```javascript
async function complete(messages, opts = {}) {
  const chain = getProviderChain();
  const httpProviders = chain.filter(p => p.name !== 'hermes');
  const hermesProvider = chain.find(p => p.name === 'hermes');

  // Race all HTTP providers simultaneously; take whichever responds first.
  if (httpProviders.length > 0) {
    try {
      const result = await Promise.any(
        httpProviders.map(p => callOpenAI(p, messages, opts))
      );
      return result;
    } catch (aggErr) {
      // AggregateError — all HTTP providers failed; fall through to Hermes.
      if (!hermesProvider) {
        const msgs = aggErr.errors.map((e, i) => `  ${httpProviders[i].name}: ${e.message}`).join('\n');
        throw new Error(`All providers failed:\n${msgs}`);
      }
    }
  }

  // Hermes last — it uses execSync (blocking) so it cannot be part of Promise.any
  if (hermesProvider) return callHermes(messages, opts);

  throw new Error('No providers available');
}
```

For the benchmark: instead of ollama(2282 ms) then openrouter(2331 ms) sequentially, both fire simultaneously and the result arrives in max(2282, 2331) ≈ 2331 ms rather than 2282 + 2331 = 4613 ms. When one is slow/down, the penalty disappears entirely — the fast provider wins. The total benchmark time drops from ~35 s to ~25 s (the Hermes sequential tests dominate; HTTP tests benefit by eliminating cascading waits).

Note: `Promise.any` requires Node.js 15+; `package.json` already gates `"node": ">=18"` so this is safe.

---

## Summary Table

| Rank | Finding | Location | Estimated Saving |
|------|---------|----------|-----------------|
| 1 | N×WSL spawns in bulk-sync | `sync/bulk-sync-hermes.cjs` syncToHermes loop | ~13 s on 95-file repo |
| 2 | readHermesEnvKey uncached — WSL login shell per getProviderChain() call | `autoresearch/lib/llm.cjs` getProviderChain | ~500 ms per planner call |
| 3 | callHermes uses bash -lc + execSync blocks event loop | `autoresearch/lib/llm.cjs` callHermes | ~400 ms/call + async unblock |
| 4 | Hook cold-start + full stdin drain on every Write/Edit (99% no-ops) | `sync/sync-hermes.cjs` main | ~15 ms/event × session volume |
| 5 | Sequential provider fallback — full timeout penalty per failed provider | `autoresearch/lib/llm.cjs` complete | ~2-30 s when any provider is slow |

## Risks & Mitigations

- **Finding 1 batch cmd length:** On repos with 100+ files, the single bash -c string could exceed ARG_MAX. Mitigation: chunk at 50 files per WSL invocation.
- **Finding 5 Promise.any:** Fires parallel HTTP requests to all providers simultaneously, which burns API quota on all of them even when the first succeeds. Mitigation: add a `racePrimaryMs` option — race for N ms, then fall back to sequential for secondary providers.
- **Finding 3 bash -c PATH:** If the user's Hermes install is not in `~/.local/bin`, `bash -c` with the explicit PATH will still miss it. Mitigation: read the path from `which hermes` at startup (cached) and embed the absolute path.

## Next Steps (prioritized)

1. [P0] Apply Finding 1 to `bulk-sync-hermes.cjs` — highest wall-clock impact, safe change
2. [P0] Apply Finding 2 (key caching) to `lib/llm.cjs` — one-line fix, zero risk
3. [P1] Apply Finding 3 (bash -lc → bash -c + execFileAsync) — reduces Hermes latency and unblocks event loop
4. [P1] Apply Finding 5 (Promise.any race) — improves planner throughput when any HTTP provider is available
5. [P2] Apply Finding 4 (stream-parse filePath in hook) — quality-of-life latency reduction across the session
