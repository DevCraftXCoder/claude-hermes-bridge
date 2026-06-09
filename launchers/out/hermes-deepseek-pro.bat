@echo off
title Hermes DeepSeek Pro 1M
wsl -d Ubuntu -- bash -lc "hermes chat --provider openrouter --model deepseek/deepseek-v4-pro"
