#!/usr/bin/env bash
# install.sh — Claude Hermes Bridge full installer
#
# Handles first-time users with no Hermes install:
#   1. Verifies WSL2 + Ubuntu are available
#   2. Installs Hermes Agent inside WSL if not found
#   3. Copies sync hooks into .claude/hooks/
#   4. Drops hermes-chat.bat on your Windows Desktop
#   5. Prints settings.json registration snippet
#   6. Prints bulk-sync command
#
# Usage (from repo root):
#   bash sync/install.sh
#   bash sync/install.sh --dir /custom/path/to/.claude

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WSL_DISTRO="${HERMES_WSL_DISTRO:-Ubuntu}"

# ── Resolve target .claude/hooks dir ─────────────────────────────────────────

TARGET_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) TARGET_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
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

# ── Step 1: WSL2 check ────────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1/6 — WSL2 Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

WSL_CMD="wsl"
command -v wsl.exe &>/dev/null && WSL_CMD="wsl.exe"

if ! command -v wsl.exe &>/dev/null && ! command -v wsl &>/dev/null; then
  echo ""
  echo "ERROR: WSL2 not found."
  echo ""
  echo "Install it by running this in PowerShell (Administrator):"
  echo "  wsl --install"
  echo ""
  echo "Then reboot, open Ubuntu, and re-run this script."
  exit 1
fi

if ! $WSL_CMD -d "$WSL_DISTRO" -- bash -c "echo ok" &>/dev/null; then
  echo ""
  echo "ERROR: WSL distro '$WSL_DISTRO' not found."
  echo ""
  echo "Install Ubuntu with:"
  echo "  wsl --install -d Ubuntu"
  echo ""
  echo "Or set HERMES_WSL_DISTRO to match your distro name."
  $WSL_CMD --list 2>/dev/null || true
  exit 1
fi

echo "  ✓ WSL2 + $WSL_DISTRO ready"
echo ""

# ── Step 2: Install Hermes if missing ────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2/6 — Hermes Agent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HERMES_PATH=$($WSL_CMD -d "$WSL_DISTRO" -- bash -lc "command -v hermes 2>/dev/null || echo ''" 2>/dev/null | tr -d '\r')

if [[ -z "$HERMES_PATH" ]]; then
  echo "  Hermes not found — installing now..."
  echo "  (This downloads from hermes-agent.nousresearch.com)"
  echo ""
  $WSL_CMD -d "$WSL_DISTRO" -- bash -lc "
    set -e
    curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

    # Add ~/.local/bin to PATH if not already present
    if ! grep -q '.local/bin' ~/.bashrc 2>/dev/null; then
      echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc
    fi
    if ! grep -q '.local/bin' ~/.profile 2>/dev/null; then
      echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.profile
    fi

    # Pin to stable channel
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    hermes update --channel stable
    echo '--- Hermes install complete ---'
  "
  echo ""
  echo "  ✓ Hermes installed (stable channel)"
else
  echo "  ✓ Hermes already installed: $HERMES_PATH"
  # Keep it on stable
  $WSL_CMD -d "$WSL_DISTRO" -- bash -lc "hermes update --channel stable 2>/dev/null" || true
fi

echo ""

# ── Step 3: Copy sync hooks ───────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3/6 — Sync Hooks  →  $HOOKS_DIR/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cp "$SCRIPT_DIR/sync-hermes.cjs"      "$HOOKS_DIR/sync-hermes.cjs"
cp "$SCRIPT_DIR/bulk-sync-hermes.cjs" "$HOOKS_DIR/bulk-sync-hermes.cjs"

echo "  ✓ sync-hermes.cjs"
echo "  ✓ bulk-sync-hermes.cjs"
echo ""

# ── Step 4: Desktop shortcuts + Hermes Launchers folder ──────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 4/6 — Desktop Shortcuts"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DESKTOP_DIR=""

# Resolve Windows Desktop path to a Git Bash-accessible Unix path.
# Preference order:
#   1. cygpath (Git for Windows built-in — cleanest, lowercase drive letter)
#   2. $USERPROFILE env var (always set by Windows, inherited by Git Bash)
# The cmd.exe /c echo approach is intentionally skipped — it emits the Windows
# banner + CWD prompt instead of just the value, making reliable parsing impossible.
# \L in sed replacement is a GNU extension that does NOT work in the sed bundled
# with Git for Windows — it causes "unknown option to s" and produces an empty string.
if command -v cygpath &>/dev/null && [[ -n "$USERPROFILE" ]]; then
  DESKTOP_DIR="$(cygpath -u "$USERPROFILE")/Desktop"
elif [[ -n "$USERPROFILE" ]]; then
  # cygpath not available — convert C:\Users\X → /C/Users/X via sed.
  # Use character class [\\] so the backslash is treated as a literal match, not
  # an escape sequence. The /\1 replacement keeps the drive letter as-is (uppercase
  # C is fine; Windows NTFS is case-insensitive, Git Bash accepts /C/ paths).
  DESKTOP_DIR="$(echo "$USERPROFILE" | sed 's|[\\]|/|g; s|^\([A-Za-z]\):|/\1|')/Desktop"
fi

if [[ -n "$DESKTOP_DIR" ]] && [[ -d "$DESKTOP_DIR" ]]; then
  # hermes-chat.bat — quick default launcher
  cp "$REPO_ROOT/hermes-chat.bat" "$DESKTOP_DIR/hermes-chat.bat"
  echo "  ✓ hermes-chat.bat  →  Desktop"

  # "Hermes Launchers\" folder — all 8 model launchers
  LAUNCHERS_DIR="$DESKTOP_DIR/Hermes Launchers"
  mkdir -p "$LAUNCHERS_DIR"
  if command -v node &>/dev/null; then
    node "$REPO_ROOT/launchers/generate-launchers.cjs" --output "$LAUNCHERS_DIR" 2>/dev/null \
      && echo "  ✓ Hermes Launchers/  →  Desktop (8 launchers)" \
      || { echo "  ! Launcher generation failed — run manually:"; echo "    node launchers/generate-launchers.cjs --output \"$LAUNCHERS_DIR\""; }
  else
    echo "  ! Node.js not found — skipping launcher folder."
    echo "    Install Node.js >= 18 and run:"
    echo "    node launchers/generate-launchers.cjs --output \"Desktop/Hermes Launchers\""
  fi
else
  echo "  ! Could not detect Desktop path."
  echo "    Copy manually:  $REPO_ROOT/hermes-chat.bat  →  Desktop"
  echo "    For all launchers, run:"
  echo "    node launchers/generate-launchers.cjs --output \"C:/Users/YourName/Desktop/Hermes Launchers\""
fi

echo ""

# ── Step 5: Settings.json snippet ────────────────────────────────────────────

HOOK_PATH="$HOOKS_DIR/sync-hermes.cjs"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 5/6 — Register hook in .claude/settings.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
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
echo "Already have a postToolUse Write|Edit block? Just add:"
echo "  { \"type\": \"command\", \"command\": \"node $HOOK_PATH\" }"
echo ""

# ── Step 6: Initial bulk sync ─────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 6/6 — Initial Bulk Sync"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Sync all existing agents/hooks/skills to Hermes now:"
echo "  node $HOOKS_DIR/bulk-sync-hermes.cjs"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Install complete."
echo "  Quick start:      double-click  hermes-chat.bat  on your Desktop"
echo "  All 8 launchers:  Desktop → Hermes Launchers\\"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
