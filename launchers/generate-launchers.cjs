#!/usr/bin/env node
/**
 * generate-launchers.cjs — Generate Windows .bat launchers + desktop shortcuts
 * for Hermes Agent with multiple LLM providers (OpenRouter + local Ollama).
 *
 * Usage:
 *   node launchers/generate-launchers.cjs [--output <dir>] [--shortcuts]
 *
 * Options:
 *   --output <dir>   Directory for .bat files (default: current directory)
 *   --shortcuts      Also create .lnk desktop shortcuts
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const LAUNCHERS = [
  // OpenRouter models (require OPENROUTER_API_KEY in ~/.hermes/.env)
  {
    file: "hermes-gemini.bat",
    name: "Hermes Gemini",
    model: "google/gemini-2.5-flash",
    provider: "openrouter",
    description: "Hermes CLI with Gemini 2.5 Flash via OpenRouter",
    dashboardNote: "Dashboard: http://localhost:4333",
  },
  {
    file: "hermes-codex.bat",
    name: "Hermes Codex",
    model: "openai/gpt-4o",
    provider: "openrouter",
    description: "Hermes CLI with OpenAI GPT-4o via OpenRouter",
    dashboardNote: "Dashboard: http://localhost:4333",
  },
  {
    file: "hermes-qwen.bat",
    name: "Hermes Qwen",
    model: "qwen/qwen3-30b-a3b",
    provider: "openrouter",
    description: "Hermes CLI with Qwen3 30B via OpenRouter",
    dashboardNote: "Dashboard: http://localhost:4333",
  },
  {
    file: "hermes-deepseek.bat",
    name: "Hermes DeepSeek 1M",
    model: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    description: "Hermes CLI with DeepSeek V4 Flash (1M context) via OpenRouter",
    dashboardNote: "Dashboard: http://localhost:4333",
    contextNote: "Context: 1M tokens",
  },
  {
    file: "hermes-deepseek-pro.bat",
    name: "Hermes DeepSeek Pro 1M",
    model: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    description: "Hermes CLI with DeepSeek V4 Pro (1M context, 1.6T MoE) via OpenRouter",
    dashboardNote: "Dashboard: http://localhost:4333",
    contextNote: "Context: 1M tokens",
  },

  // Local Ollama models (require Ollama running on localhost:11434)
  // These use the ollama-local provider defined in ~/.hermes/config.yaml
  {
    file: "hermes-ollama-coder14b.bat",
    name: "Hermes Ollama Coder14B",
    model: "qwen2.5-coder:14b",
    provider: "ollama-local",
    description: "Hermes CLI with Qwen2.5-Coder 14B (local Ollama)",
    requiresNote: "Requires: Ollama running on localhost:11434",
  },
  {
    file: "hermes-ollama-coder7b.bat",
    name: "Hermes Ollama Coder7B",
    model: "qwen2.5-coder:7b",
    provider: "ollama-local",
    description: "Hermes CLI with Qwen2.5-Coder 7B (local Ollama)",
    requiresNote: "Requires: Ollama running on localhost:11434",
  },
  {
    file: "hermes-ollama-llama3.bat",
    name: "Hermes Ollama Llama3",
    model: "llama3.2:latest",
    provider: "ollama-local",
    description: "Hermes CLI with Llama 3.2 3B (local Ollama)",
    requiresNote: "Requires: Ollama running on localhost:11434",
  },
];

function generateBat(launcher) {
  const tag = launcher.file.replace(".bat", "").replace("hermes-", "hermes-");
  const lines = [
    "@echo off",
    `REM ${launcher.file} — ${launcher.description}`,
    `REM Provider: ${launcher.provider} | Model: ${launcher.model}`,
    "",
    "setlocal",
    "",
    `echo [${tag}] Launching Hermes (${launcher.model})...`,
    "",
    "where wt >nul 2>&1",
    "if %ERRORLEVEL% == 0 (",
    `    start "" wt.exe wsl -d Ubuntu -- bash -lc "export PATH=$HOME/.local/bin:$PATH && hermes chat --provider ${launcher.provider} --model ${launcher.model}"`,
    ") else (",
    `    start "" cmd /k "wsl -d Ubuntu -- bash -lc \\"export PATH=$HOME/.local/bin:$PATH && hermes chat --provider ${launcher.provider} --model ${launcher.model}\\""`,
    ")",
    "",
    `echo [${tag}] Launched. Check your terminal window.`,
  ];
  if (launcher.contextNote) lines.push(`echo [${tag}] ${launcher.contextNote}`);
  if (launcher.dashboardNote) lines.push(`echo [${tag}] ${launcher.dashboardNote}`);
  if (launcher.requiresNote) lines.push(`echo [${tag}] ${launcher.requiresNote}`);
  lines.push("");
  return lines.join("\r\n");
}

function createShortcut(batPath, name, description) {
  const psScript = `
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$s = $ws.CreateShortcut("$desktop\\${name}.lnk")
$s.TargetPath = "${batPath.replace(/\//g, "\\")}"
$s.WorkingDirectory = "${path.dirname(batPath).replace(/\//g, "\\")}"
$s.Description = "${description}"
$s.Save()
`.trim();
  try {
    execSync(`powershell -Command "${psScript.replace(/\n/g, "; ")}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Parse args
const args = process.argv.slice(2);
const outputIdx = args.indexOf("--output");
const outputDir = outputIdx >= 0 && args[outputIdx + 1] ? args[outputIdx + 1] : process.cwd();
const makeShortcuts = args.includes("--shortcuts");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`Generating ${LAUNCHERS.length} Hermes launchers in: ${outputDir}`);
if (makeShortcuts) console.log("Also creating desktop shortcuts.");
console.log("");

for (const launcher of LAUNCHERS) {
  const batPath = path.join(outputDir, launcher.file);
  fs.writeFileSync(batPath, generateBat(launcher));
  console.log(`  [OK] ${launcher.file} — ${launcher.provider} / ${launcher.model}`);

  if (makeShortcuts) {
    const ok = createShortcut(batPath, launcher.name, launcher.description);
    console.log(`  ${ok ? "[OK]" : "[FAIL]"} Desktop shortcut: ${launcher.name}.lnk`);
  }
}

console.log("");
console.log("Done. Double-click any .bat file or desktop shortcut to launch Hermes.");
console.log("");
console.log("OpenRouter launchers require OPENROUTER_API_KEY in ~/.hermes/.env");
console.log("Ollama launchers require Ollama running on localhost:11434");
console.log("");
console.log("To add the ollama-local provider to Hermes config:");
console.log("  hermes config set providers.ollama-local.base_url http://localhost:11434/v1");
console.log("  hermes config set providers.ollama-local.api_key ollama");
