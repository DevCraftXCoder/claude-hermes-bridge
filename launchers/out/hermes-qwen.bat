@echo off
title Hermes Qwen
wsl -d Ubuntu -- bash -lc "hermes chat --provider openrouter --model qwen/qwen3-30b-a3b"
