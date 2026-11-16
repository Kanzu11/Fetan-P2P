#!/usr/bin/env bash
set -euo pipefail

# Hardens a fresh Ubuntu 22.04 / 24.04 ARM64 (Ampere A1) VM on Oracle Cloud Always Free
# for running the isolated Fetan P2P BEP-20 payout worker.
# Run as root: sudo ADMIN_SSH_IP="your.ip.here" bash setup-oracle.sh

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

ADMIN_SSH_IP="${ADMIN_SSH_IP:-}"
if [[ -z "$ADMIN_SSH_IP" ]]; then
  echo "Set ADMIN_SSH_IP=your.public.ip before running so SSH stays reachable." >&2
  exit 1
fi

echo "[1/7] Installing security updates, chrony, nftables, fail2ban..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg chrony nftables fail2ban unattended-upgrades

echo "[2/7] Installing Node.js 20 LTS (arm64)..."
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "[3/7] Creating unprivileged fetan-payout service account and directories..."
if ! id -u fetan-payout >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin fetan-payout
fi
mkdir -p /opt/fetan-payout /etc/fetan
chown root:fetan-payout /opt/fetan-payout /etc/fetan
chmod 0755 /opt/fetan-payout
chmod 0750 /etc/fetan

echo "[4/7] Disabling core dumps & swap so hot wallet keys never write to disk..."
swapoff -a || true
sed -i '/\sswap\s/ s/^/#/' /etc/fstab
cat >/etc/sysctl.d/99-fetan-security.conf <<'EOF'
fs.suid_dumpable = 0
kernel.core_pattern = |/bin/false
EOF
sysctl --system

cat >/etc/security/limits.d/99-no-core.conf <<'EOF'
* hard core 0
* soft core 0
EOF

echo "[5/7] Hardening SSH (key-only, no root login) & fail2ban..."
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd
systemctl enable --now fail2ban chrony unattended-upgrades

echo "[6/7] Installing nftables firewall restricted to ADMIN_SSH_IP=$ADMIN_SSH_IP..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sed "s|203\.0\.113\.10|${ADMIN_SSH_IP}|g" "${SCRIPT_DIR}/nftables.conf" >/etc/nftables.conf
nft -c -f /etc/nftables.conf
systemctl enable --now nftables
systemctl restart nftables

echo "[7/7] Installing systemd unit..."
cp "${SCRIPT_DIR}/fetan-payout.service" /etc/systemd/system/fetan-payout.service
systemctl daemon-reload

echo ""
echo "Oracle VM hardening complete. Next steps:"
echo "  1. Create /etc/fetan/hot_wallet_key (chmod 600, owned by root:root) OR use OCI Vault."
echo "  2. Copy payout.env.example -> /etc/fetan/payout.env (chmod 640, root:fetan-payout)."
echo "  3. Deploy built bundle to /opt/fetan-payout, run 'npm ci --omit=dev && npx prisma generate --schema=schema.prisma'."
echo "  4. Enable service: sudo systemctl enable --now fetan-payout"
