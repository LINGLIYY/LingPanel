#!/bin/bash
# LingServer Dashboard — Deployment Script
# Target: Ubuntu 26.04 @ 8.148.10.136
# Run as: sudo bash setup.sh

set -euo pipefail

APP_DIR="/opt/ling-server-dashboard"
DOMAIN="linglician.duckdns.org"
PYTHON="python3.13"
VENV="$APP_DIR/venv"

echo "╔══════════════════════════════════════════════╗"
echo "║   LingServer Dashboard — Deployment          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. System dependencies ──
echo ">>> [1/6] Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    $PYTHON $PYTHON-venv $PYTHON-dev \
    nginx certbot python3-certbot-nginx \
    ufw curl git

# ── 2. Create user ──
echo ">>> [2/6] Creating service user..."
if ! id -u ling &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin ling
fi
mkdir -p "$APP_DIR"
chown -R ling:ling "$APP_DIR"

# ── 3. Python venv + deps ──
echo ">>> [3/6] Setting up Python environment..."
if [ ! -d "$VENV" ]; then
    $PYTHON -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$APP_DIR/server/requirements.txt"

# ── 4. Nginx ──
echo ">>> [4/6] Configuring Nginx..."
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/ling-server-dashboard
ln -sf /etc/nginx/sites-available/ling-server-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 5. SSL (Let's Encrypt) ──
echo ">>> [5/6] Setting up SSL..."
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        -m "admin@$DOMAIN" --redirect
fi
# Auto-renewal
echo "0 3 * * * root certbot renew --quiet --post-hook 'systemctl reload nginx'" \
    > /etc/cron.d/certbot-renew

# ── 6. Systemd ──
echo ">>> [6/6] Installing systemd service..."
cp "$APP_DIR/deploy/ling-server-dashboard.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable ling-server-dashboard
systemctl restart ling-server-dashboard

# ── 7. Firewall ──
echo ">>> Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── 8. Verify ──
echo ""
echo ">>> Verifying deployment..."
sleep 3
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/health" || echo "000")
if [ "$HEALTH" = "200" ]; then
    echo "  ✅ Health check: 200 OK"
else
    echo "  ⚠️  Health check: $HEALTH (check journalctl -u ling-server-dashboard)"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Deployment complete!                       ║"
echo "║   https://$DOMAIN                             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Check status:  systemctl status ling-server-dashboard"
echo "  View logs:     journalctl -u ling-server-dashboard -f"
echo "  Restart:       systemctl restart ling-server-dashboard"
