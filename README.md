# YouTube URL → Video

Paste a YouTube URL → preview → download **MP4 at 720p** (fixed). **Single domain VPS** with Node + `yt-dlp` backend, plus **GitHub Pages + Cobalt fallback**.

![Stack](https://img.shields.io/badge/stack-Node%20%2B%20yt--dlp%20%2B%20Vanilla%20JS-5865f2) ![Quality](https://img.shields.io/badge/quality-720p%20MP4-green) ![Deploy](https://img.shields.io/badge/domain-single%20VPS-blue)

## Architecture

```
Single domain: https://yourdomain.com

Browser -> https://yourdomain.com/               -> static (index.html, app.js, styles.css)
Browser -> https://yourdomain.com/api/info?url=  -> Node (yt-dlp --dump-single-json) 720p meta
Browser -> https://yourdomain.com/api/download?url=&quality=720 -> Node streams mp4 (yt-dlp -o -)
Browser -> https://yourdomain.com/api/url?url=   -> Node returns direct URL (saves server bandwidth)
Fallback: if /api/health fails -> POST https://api.cobalt.tools/ (github.io mode)
```

Frontend (`app.js:127`) probes `/api/health` first. If VPS backend reachable, uses it. Otherwise falls back to Cobalt — so the same code works on `github.io` and on your domain.

## URL formats

- `https://www.youtube.com/watch?v=ID`
- `https://youtu.be/ID`
- `https://www.youtube.com/shorts/ID`
- `https://www.youtube.com/embed/ID`
- `https://music.youtube.com/watch?v=ID`
- `https://m.youtube.com/watch?v=ID`

Share with `?url=`:
```
https://yourdomain.com/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

## Run locally (with backend)

```bash
npm install
npm start
# open http://localhost:3000
# test:
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Requires `yt-dlp` and `ffmpeg`:
```bash
# yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
# ffmpeg
sudo apt update && sudo apt install -y ffmpeg
```

Or via Docker:
```bash
docker build -t ytv .
docker run -p 3000:3000 ytv
# or
docker compose up --build
```

Run static only (no backend, github.io mode):
```bash
python3 -m http.server 8000
# open http://localhost:8000 - will use Cobalt fallback
```

## Deploy to VPS with domain (single domain, recommended)

You chose **VPS + one domain for all** — frontend + API on same `https://yourdomain.com`.

### Option A: One-shot script

On a fresh Ubuntu 22.04/24.04 VPS with DNS `A` record pointing to its IP:

```bash
git clone https://github.com/<YOUR_USER>/youtube-url-to-video.git /opt/youtube-url-to-video
cd /opt/youtube-url-to-video
sudo bash deploy/setup-vps.sh yourdomain.com
# check
curl https://yourdomain.com/api/health
```

What it does (`deploy/setup-vps.sh:1`): install Node 20, ffmpeg, nginx, yt-dlp, `npm install`, configure `deploy/nginx.conf:1` for `yourdomain.com`, enable `deploy/youtube-ytv.service:1` (systemd), reload nginx, request Let's Encrypt cert via `certbot --nginx`.

### Option B: Manual steps

```bash
# 1. deps
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx ffmpeg curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp

# 2. app
sudo git clone https://github.com/<YOUR_USER>/youtube-url-to-video.git /opt/youtube-url-to-video
cd /opt/youtube-url-to-video
npm install --production

# 3. nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/yourdomain.com
sudo sed -i "s/yourdomain.com/YOUR_REAL_DOMAIN/g" /etc/nginx/sites-available/yourdomain.com
sudo ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 4. systemd
sudo cp deploy/youtube-ytv.service /etc/systemd/system/youtube-ytv.service
sudo systemctl daemon-reload && sudo systemctl enable --now youtube-ytv

# 5. TLS
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### DNS

At your registrar, add:
```
Type  A  Name  @     Value  <VPS_IP>  TTL  3600
Type  A  Name  www   Value  <VPS_IP>  TTL  3600
```
Wait for propagation, then `certbot` will succeed.

## Deploy to GitHub Pages (static fallback, no backend)

```bash
git init
git branch -m main
git add .
git commit -m "feat: youtube url to 720p mp4"
git remote add origin https://github.com/<YOUR_USER>/youtube-url-to-video.git
git push -u origin main
# GitHub -> Settings -> Pages -> Source: main / root
# -> https://<YOUR_USER>.github.io/youtube-url-to-video/
```
Works without VPS — uses Cobalt fallback automatically.

## API

- `GET /api/health` -> `{ ok, hasYtDlp }`
- `GET /api/info?url=` -> `{ id, title, author, thumbnail, duration }`
- `GET /api/url?url=` -> `{ url: "https://...direct..." }`
- `GET /api/download?url=&quality=720` -> streams `video/mp4` with `Content-Disposition: attachment; filename="..."`

All serve from same domain — no CORS needed. Frontend badge shows `✓ Your server` vs `Cobalt fallback`.

## Troubleshooting

- **Backend badge shows Cobalt fallback** -> `curl https://yourdomain.com/api/health` should be 200. Check `systemctl status youtube-ytv` and `journalctl -u youtube-ytv -f`.
- **Extractor timed out / rate-limited** -> wait 30s, retry.
- **Private / age-restricted** -> requires login, can't download.
- **ffmpeg missing** -> `sudo apt install -y ffmpeg` then `sudo systemctl restart youtube-ytv`.

## Disclaimer

For personal/educational use only. Respect YouTube's Terms of Service and creators' copyright. Only download videos you have rights to.

## License

MIT
