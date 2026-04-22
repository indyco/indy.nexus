#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# indy.nexus — LXC auto-update script
#
# Pulls the latest commits from origin/main, reinstalls dependencies if
# package-lock.json changed, and restarts the indy-nexus systemd service.
#
# By default, refuses to update unless every new commit is signed by a
# key listed in /etc/indy-nexus/allowed_signers (Tier 1 verification).
# Configure via /etc/default/indy-nexus-update.
#
# Designed to be invoked periodically by indy-nexus-update.timer, but can
# also be run manually as root:
#
#   sudo /opt/indy-nexus/update-lxc.sh                       # normal run
#   sudo /opt/indy-nexus/update-lxc.sh --force               # rebuild + restart
#   sudo /opt/indy-nexus/update-lxc.sh --insecure-skip-verify  # EMERGENCY ONLY
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="/opt/indy-nexus"
APP_USER="indynexus"
SERVICE="indy-nexus.service"
BRANCH="main"
LOCK_FILE="/run/indy-nexus-update.lock"
ENV_FILE="/etc/default/indy-nexus-update"

# ---------------------------------------------------------------------------
# We run as root (via systemd), but the repo is chowned to ${APP_USER}.
# Git ≥2.35 refuses cross-user access unless the path is marked safe.
# Apply safe.directory via env so every git call in this script honours it,
# independent of HOME or global config.
# ---------------------------------------------------------------------------
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$APP_DIR"

# ---------------------------------------------------------------------------
# Load config (may override the defaults below)
# ---------------------------------------------------------------------------
REQUIRE_SIGNED="${REQUIRE_SIGNED:-0}"
ANCHOR_SHA="${ANCHOR_SHA:-}"
ALLOWED_SIGNERS="${ALLOWED_SIGNERS:-/etc/indy-nexus/allowed_signers}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

FORCE=0
SKIP_VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    --insecure-skip-verify) SKIP_VERIFY=1 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Colours (only when stdout is a TTY — keeps journalctl output clean)
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; NC="\033[0m"
else
  GREEN=""; YELLOW=""; RED=""; NC=""
fi

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || error "This script must be run as root."
[[ -d "$APP_DIR/.git" ]] || error "No git repository found at ${APP_DIR}."
command -v git >/dev/null || error "git is not installed."

# When invoked by systemd, PATH is reduced and may not include the
# directory containing node/npm (common layouts: /usr/local/bin from a
# tarball install, or /root/.nvm/versions/node/<ver>/bin from nvm).
# Probe the usual places and prepend the first hit to PATH so the later
# `npm install` call works regardless of install style.
if ! command -v npm >/dev/null 2>&1; then
  shopt -s nullglob
  _npm_candidates=(
    /usr/local/bin/npm
    /root/.nvm/versions/node/*/bin/npm
    /home/*/.nvm/versions/node/*/bin/npm
    /usr/bin/npm
  )
  shopt -u nullglob
  for _c in "${_npm_candidates[@]}"; do
    if [[ -x "$_c" ]]; then
      export PATH="$(dirname "$_c"):${PATH}"
      break
    fi
  done
  unset _npm_candidates _c
fi
command -v npm >/dev/null || error "npm is not installed (PATH=$PATH)."

# ---------------------------------------------------------------------------
# Single-instance lock (prevents overlap if a pull takes longer than the
# timer interval — e.g. large dependency reinstall on slow storage).
# ---------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  warn "Another update is already in progress; exiting."
  exit 0
fi

cd "$APP_DIR"

# ---------------------------------------------------------------------------
# Fetch and compare
# ---------------------------------------------------------------------------
info "Fetching origin/${BRANCH}..."
git fetch --quiet origin "$BRANCH"

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse "origin/${BRANCH}")

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" && $FORCE -eq 0 ]]; then
  info "Already up to date (${LOCAL_SHA:0:7}). Nothing to do."
  exit 0
fi

if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  info "Updating ${LOCAL_SHA:0:7} -> ${REMOTE_SHA:0:7}"
else
  warn "--force specified; rebuilding at ${LOCAL_SHA:0:7}"
fi

# ---------------------------------------------------------------------------
# Verify signatures on every new commit (Tier 1 trust)
#
# Only commits strictly AFTER ANCHOR_SHA are checked. Anything at or
# before the anchor is considered legacy/unsigned history and accepted
# as-is. This lets us turn on enforcement without rewriting history.
# ---------------------------------------------------------------------------
verify_commit_range() {
  local to="$1"

  [[ -s "$ALLOWED_SIGNERS" ]] \
    || error "allowed_signers file missing or empty: $ALLOWED_SIGNERS"
  [[ -n "$ANCHOR_SHA" ]] \
    || error "ANCHOR_SHA is not set in $ENV_FILE; refusing to update."

  # Anchor must be a real commit reachable from the new tip.
  if ! git cat-file -e "${ANCHOR_SHA}^{commit}" 2>/dev/null; then
    error "ANCHOR_SHA ($ANCHOR_SHA) is not a valid commit in this repo."
  fi
  if ! git merge-base --is-ancestor "$ANCHOR_SHA" "$to" 2>/dev/null; then
    error "ANCHOR_SHA ($ANCHOR_SHA) is not an ancestor of ${to:0:7}; refusing."
  fi

  # List commits strictly after the anchor, up to the incoming tip.
  local commits
  commits=$(git rev-list "${ANCHOR_SHA}..${to}")
  if [[ -z "$commits" ]]; then
    info "No post-anchor commits to verify."
    return 0
  fi

  info "Verifying signatures on $(echo "$commits" | wc -l) commit(s)..."

  local bad=0 sha author
  while read -r sha; do
    if ! git -c gpg.ssh.allowedSignersFile="$ALLOWED_SIGNERS" \
           verify-commit "$sha" >/dev/null 2>&1; then
      author=$(git log -1 --pretty=format:'%an <%ae>' "$sha")
      warn "Untrusted commit ${sha:0:7} by ${author}"
      bad=1
    fi
  done <<< "$commits"

  if [[ $bad -ne 0 ]]; then
    error "Refusing update: one or more commits are unsigned or signed by an unknown key. Staying at ${LOCAL_SHA:0:7}."
  fi

  info "All post-anchor commits verified."
}

if [[ $SKIP_VERIFY -eq 1 ]]; then
  warn "SIGNATURE VERIFICATION SKIPPED (--insecure-skip-verify). Do not leave this enabled."
elif [[ "$REQUIRE_SIGNED" == "1" ]]; then
  verify_commit_range "$REMOTE_SHA"
else
  warn "REQUIRE_SIGNED is not enabled; accepting commits without verification."
fi

# ---------------------------------------------------------------------------
# Detect whether dependencies need reinstalling
# ---------------------------------------------------------------------------
LOCKFILE_CHANGED=0
if [[ $FORCE -eq 1 ]]; then
  LOCKFILE_CHANGED=1
elif ! git diff --quiet "$LOCAL_SHA" "$REMOTE_SHA" -- package.json package-lock.json; then
  LOCKFILE_CHANGED=1
fi

# ---------------------------------------------------------------------------
# Apply update
# ---------------------------------------------------------------------------
info "Pulling latest changes..."
git pull --ff-only --quiet origin "$BRANCH"

if [[ $LOCKFILE_CHANGED -eq 1 ]]; then
  info "Dependencies changed — running npm install..."
  npm install --omit=dev --no-audit --no-fund
else
  info "No dependency changes detected; skipping npm install."
fi

# ---------------------------------------------------------------------------
# Re-assert ownership in case new files were added
# ---------------------------------------------------------------------------
info "Re-asserting file ownership..."
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"

# ---------------------------------------------------------------------------
# Restart the service
# ---------------------------------------------------------------------------
info "Restarting ${SERVICE}..."
systemctl restart "$SERVICE"

# Brief sanity check — fail loudly if the service didn't come back.
sleep 2
if ! systemctl is-active --quiet "$SERVICE"; then
  error "${SERVICE} failed to start after update. Check: journalctl -u ${SERVICE} -n 50"
fi

NEW_SHA=$(git rev-parse HEAD)
info "Update complete. Now at ${NEW_SHA:0:7}."
