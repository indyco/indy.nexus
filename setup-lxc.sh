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
NODE_MAJOR=22

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
# Install Node.js 22.x from official binary tarball
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
# Node 22.x ships with npm 10.x — pin to known-good npm 11.12.1
info "Installing npm 11.12.1..."
npm install -g npm@11.12.1
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
npm install --production --no-audit --no-fund

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
info "Creating systemd service..."
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
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# ---------------------------------------------------------------------------
# Ensure data directory is writable
# ---------------------------------------------------------------------------
mkdir -p "${APP_DIR}/data"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/data"

# ---------------------------------------------------------------------------
# Start the service
# ---------------------------------------------------------------------------
info "Starting indy-nexus service..."
systemctl daemon-reload
systemctl enable --now indy-nexus

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
info "Setup complete!"
echo ""
echo "  Portal:   http://$(hostname -I | awk '{print $1}'):3000"
echo "  Service:  systemctl status indy-nexus"
echo "  Logs:     journalctl -u indy-nexus -f"
echo ""
echo "  Default login:  admin / admin"
echo "  ⚠  Change the admin password immediately after first login."
echo ""
echo "  To configure game servers, create ${APP_DIR}/data/services.json"
echo "  (see ${APP_DIR}/data/services.json.example for the format)."
echo ""
