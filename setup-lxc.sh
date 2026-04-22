#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# indy.nexus — LXC setup script
#
# Run this inside a fresh Debian 12 (Bookworm) LXC container as root.
# It will install Node.js, clone the repo, configure the systemd service,
# and start the portal.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/indyco/indy.nexus/main/setup-lxc.sh | bash
#
#   — or copy this script into the container and run it directly:
#   bash setup-lxc.sh
# ---------------------------------------------------------------------------
set -euo pipefail

APP_DIR="/opt/indy-nexus"
APP_USER="indynexus"
REPO_URL="https://github.com/indyco/indy.nexus.git"
NODE_MAJOR=24

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || error "This script must be run as root."

info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ---------------------------------------------------------------------------
# Install Node.js 24.x from official binary tarball
# ---------------------------------------------------------------------------
if ! command -v node &>/dev/null; then
  info "Installing Node.js ${NODE_MAJOR}.x from official binary..."
  apt-get install -y -qq ca-certificates curl xz-utils
  NODE_VERSION=$(curl -fsSL https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/ \
    | grep -oP 'node-v\K[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  ARCH=$(dpkg --print-architecture)
  [[ "$ARCH" == "amd64" ]] && ARCH="x64"
  TARBALL="node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}" -o "/tmp/${TARBALL}"
  tar -xJf "/tmp/${TARBALL}" -C /usr/local --strip-components=1
  rm -f "/tmp/${TARBALL}"
else
  info "Node.js already installed: $(node --version)"
fi
# Upgrade npm to latest stable
info "Upgrading npm to latest..."
npm install -g npm@latest
info "node $(node --version), npm $(npm --version) ready."

# ---------------------------------------------------------------------------
# Install git (needed to clone)
# ---------------------------------------------------------------------------
if ! command -v git &>/dev/null; then
  info "Installing git..."
  apt-get install -y -qq git
fi

# ---------------------------------------------------------------------------
# Clone or update the repository
# ---------------------------------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  info "Repository already exists at ${APP_DIR}, pulling latest..."
  git -C "$APP_DIR" pull --ff-only
else
  info "Cloning repository into ${APP_DIR}..."
  git clone "$REPO_URL" "$APP_DIR"
fi

# ---------------------------------------------------------------------------
# Install npm dependencies
# ---------------------------------------------------------------------------
info "Installing npm dependencies..."
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Create system user
# ---------------------------------------------------------------------------
if ! id "$APP_USER" &>/dev/null; then
  info "Creating system user '${APP_USER}'..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# ---------------------------------------------------------------------------
# Set ownership
# ---------------------------------------------------------------------------
info "Setting file ownership..."
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"

# ---------------------------------------------------------------------------
# Prompt for configuration
# ---------------------------------------------------------------------------
echo ""
warn "Configuration required — you will need your Proxmox API details."
echo ""

read -rp "Proxmox host URL (e.g. https://192.168.1.100:8006): " PVE_HOST
read -rp "Proxmox node name (e.g. pve): " PVE_NODE
read -rp "API token ID (e.g. root@pam!indynexus): " PVE_TOKEN_ID
read -rsp "API token secret (hidden): " PVE_TOKEN_SECRET
echo ""

# Generate a random session secret
SESSION_SECRET=$(openssl rand -hex 32)

# ---------------------------------------------------------------------------
# Create systemd service
# ---------------------------------------------------------------------------
NODE_BIN=$(which node)
info "Creating systemd service (node: ${NODE_BIN})..."
cat > /etc/systemd/system/indy-nexus.service <<EOF
[Unit]
Description=indy.nexus game server portal
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=SESSION_SECRET=${SESSION_SECRET}
Environment=PROXMOX_HOST=${PVE_HOST}
Environment=PROXMOX_NODE=${PVE_NODE}
Environment=PROXMOX_TOKEN_ID=${PVE_TOKEN_ID}
Environment=PROXMOX_TOKEN_SECRET=${PVE_TOKEN_SECRET}
ExecStart=${NODE_BIN} server.js
Restart=on-failure
RestartSec=5

# Hardening (namespace-based options omitted: not supported in LXC containers)
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

# ---------------------------------------------------------------------------
# Ensure data directory is writable
# ---------------------------------------------------------------------------
mkdir -p "${APP_DIR}/data"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/data"

# ---------------------------------------------------------------------------
# Install auto-update timer (pulls origin/main every 5 minutes)
# ---------------------------------------------------------------------------
info "Installing auto-update timer..."
chmod +x "${APP_DIR}/update-lxc.sh"
install -m 0644 "${APP_DIR}/systemd/indy-nexus-update.service" /etc/systemd/system/indy-nexus-update.service
install -m 0644 "${APP_DIR}/systemd/indy-nexus-update.timer"   /etc/systemd/system/indy-nexus-update.timer

# ---------------------------------------------------------------------------
# Install signature-verification config examples
#
# We install *.example files only; the operator must copy them into place
# and fill in real values to enable enforcement. This keeps the updater
# backwards-compatible on existing deployments (it falls back to the
# legacy unverified path until the real files exist).
# ---------------------------------------------------------------------------
info "Installing signing config examples..."
install -d -m 0755 /etc/indy-nexus
install -m 0644 "${APP_DIR}/systemd/allowed_signers.example"           /etc/indy-nexus/allowed_signers.example
install -m 0644 "${APP_DIR}/systemd/indy-nexus-update.env.example"     /etc/default/indy-nexus-update.example

# ---------------------------------------------------------------------------
# Start the service
# ---------------------------------------------------------------------------
info "Starting indy-nexus service..."
systemctl daemon-reload
systemctl enable --now indy-nexus
systemctl enable --now indy-nexus-update.timer

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
info "Setup complete!"
echo ""
echo "  Portal:   http://$(hostname -I | awk '{print $1}'):3000"
echo "  Service:  systemctl status indy-nexus"
echo "  Logs:     journalctl -u indy-nexus -f"
echo "  Updates:  systemctl status indy-nexus-update.timer   (pulls every 5 min)"
echo ""
echo "  Default login:  admin / admin"
echo "  ⚠  Change the admin password immediately after first login."
echo ""
echo "  To configure game servers, create ${APP_DIR}/data/services.json"
echo "  (see ${APP_DIR}/data/services.json.example for the format)."
echo ""
warn "Auto-updates are currently UNVERIFIED."
echo "  To enforce signed-commit verification (recommended):"
echo "    1. sudo cp /etc/indy-nexus/allowed_signers.example /etc/indy-nexus/allowed_signers"
echo "       and replace the placeholder with your SSH signing public key."
echo "    2. sudo cp /etc/default/indy-nexus-update.example /etc/default/indy-nexus-update"
echo "       and set ANCHOR_SHA to the first signed commit on main."
echo "  See README.md > 'Securing auto-updates' for the full walkthrough."
echo ""
