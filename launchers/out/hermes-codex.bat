@echo off
title Hermes Codex
wsl -d Ubuntu -- bash -lc "hermes chat --provider openrouter --model openai/gpt-4o"
