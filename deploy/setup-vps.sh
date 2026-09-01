#!/usr/bin/env bash
set -euo pipefail

# One-shot VPS setup for Ubuntu/Debian
# Usage on fresh VPS:
#   git clone https://github.com/<user>/youtube-url-to-video.git /opt/youtube-url-to-video
#   cd /opt/youtube-url-to-video
#   sudo bash deploy/setup-vps.sh yourdomain.com

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: sudo bash deploy/setup-vps.sh yourdomain.com"
  exit 1
fi

echo "==> Installing deps (node, ffmpeg, nginx, certbot, yt-dlp)..."
apt-get update
apt-get install -y curl nginx certbot python3-certbot-nginx ffmpeg

# Node 20
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# yt-dlp binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod +x /usr/local/bin/yt-dlp
yt-dlp --version

echo "==> Installing app deps..."
cd /opt/youtube-url-to-video
npm install --production

echo "==> Configuring nginx for $DOMAIN..."
sed "s/yourdomain.com/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
# remove default if it conflicts
rm -f /etc/nginx/sites-enabled/default || true
nginx -t
systemctl restart nginx

echo "==> Setting up systemd service..."
cp deploy/youtube-ytv.service /etc/systemd/system/youtube-ytv.service
# fix WorkingDirectory if repo is elsewhere
systemctl daemon-reload
systemctl enable youtube-ytv
systemctl restart youtube-ytv
sleep 2
systemctl status youtube-ytv --no-pager || true

echo "==> Requesting Let's Encrypt cert for $DOMAIN..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || echo "Certbot failed - set DNS A record to this VPS IP first!"

echo "==> Done! Check:"
echo "  http://$DOMAIN/api/health"
echo "  https://$DOMAIN/api/health"
echo "  https://$DOMAIN/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
