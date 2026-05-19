#!/usr/bin/env bash
# install.sh — Claude Hermes Bridge quick installer
# Copies sync hooks into your .claude/hooks/ directory and shows registration steps.
#
# Usage (from repo root):
#   bash sync/install.sh
#   bash sync/install.sh --dir /custom/path/to/.claude

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Resolve target .claude/hooks dir ─────────────────────────────────────────

TARGET_DIR=""

# Check for --dir flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) TARGET_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  # Auto-detect
  candidates=(
    "$(pwd)/.claude"
    "$HOME/.claude"
  )
  for c in "${candidates[@]}"; do
    if [[ -d "$c" ]]; then
      TARGET_DIR="$c"
      break
    fi
  done
fi

if [[ -z "$TARGET_DIR" ]]; then
  echo "ERROR: Could not find .claude directory."
  echo "Usage: bash sync/install.sh --dir /path/to/.claude"
  exit 1
fi

HOOKS_DIR="$TARGET_DIR/hooks"
mkdir -p "$HOOKS_DIR"

echo "Installing to: $HOOKS_DIR"
echo ""

# ── Copy files ────────────────────────────────────────────────────────────────

cp "$SCRIPT_DIR/sync-hermes.cjs"      "$HOOKS_DIR/sync-hermes.cjs"
cp "$SCRIPT_DIR/bulk-sync-hermes.cjs" "$HOOKS_DIR/bulk-sync-hermes.cjs"

echo "  ✓ sync-hermes.cjs       → $HOOKS_DIR/"
echo "  ✓ bulk-sync-hermes.cjs  → $HOOKS_DIR/"
echo ""

# ── Settings.json instructions ────────────────────────────────────────────────

HOOK_PATH="$HOOKS_DIR/sync-hermes.cjs"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXT STEP: Register the hook in your Claude Code settings.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Add this block to your .claude/settings.json under postToolUse:"
echo ""
cat <<JSON
{
  "hooks": {
    "postToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node $HOOK_PATH"
          }
        ]
      }
    ]
  }
}
JSON
echo ""
echo "Or if settings.json already has a postToolUse Write|Edit block, add:"
echo "  { \"type\": \"command\", \"command\": \"node $HOOK_PATH\" }"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "RUN INITIAL BULK SYNC"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To sync all existing agents/hooks/skills to Hermes right now:"
echo "  node $HOOKS_DIR/bulk-sync-hermes.cjs"
echo ""
echo "Or with a custom .claude dir:"
echo "  node $HOOKS_DIR/bulk-sync-hermes.cjs --dir /path/to/.claude"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OPTIONAL ENV VARS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  HERMES_WSL_DISTRO=Ubuntu          (default: Ubuntu)"
echo "  HERMES_WSL_USER=yourname          (default: auto-detected)"
echo "  HERMES_CATEGORY_AGENTS=cc-agents  (default: cc-agents)"
echo "  HERMES_CATEGORY_HOOKS=cc-hooks    (default: cc-hooks)"
echo "  HERMES_CATEGORY_SKILLS=cc-skills  (default: cc-skills)"
echo ""
echo "Done."
