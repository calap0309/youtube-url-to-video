# YouTube URL → Video — ezconverter

Paste a YouTube URL → preview → download **MP4 at 720p** (fixed). **Free single domain** `https://ezconverter.onrender.com` with Node + `yt-dlp` backend, plus **GitHub Pages + Cobalt fallback**. Easy, no VPS to manage.

![Stack](https://img.shields.io/badge/stack-Node%20%2B%20yt--dlp%20%2B%20Vanilla%20JS-5865f2) ![Quality](https://img.shields.io/badge/quality-720p%20MP4-green) ![Deploy](https://img.shields.io/badge/domain-ezconverter.onrender.com-blue)

Live (after Render deploy): `https://ezconverter.onrender.com` — share: `https://ezconverter.onrender.com/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ`

## Architecture

```
Single domain: https://ezconverter.onrender.com

Browser -> https://ezconverter.onrender.com/               -> static (index.html, app.js, styles.css)
Browser -> https://ezconverter.onrender.com/api/info?url=  -> Node (yt-dlp --dump-single-json) 720p meta
Browser -> https://ezconverter.onrender.com/api/download?url=&quality=720 -> Node streams mp4 (yt-dlp -o -)
Browser -> https://ezconverter.onrender.com/api/url?url=   -> Node returns direct URL (saves bandwidth)
Fallback: if /api/health fails -> POST https://api.cobalt.tools/ (github.io / cold-start mode)
```

Frontend (`app.js:127`) probes `/api/health` first. If backend reachable (Render), uses it. Otherwise falls back to Cobalt — same code works on `github.io` and on Render.

## URL formats

- `https://www.youtube.com/watch?v=ID`
- `https://youtu.be/ID`
- `https://www.youtube.com/shorts/ID`
- `https://www.youtube.com/embed/ID`
- `https://music.youtube.com/watch?v=ID`
- `https://m.youtube.com/watch?v=ID`

Share with `?url=`:
```
https://ezconverter.onrender.com/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
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

Requires `yt-dlp` and `ffmpeg` (auto-checked on `npm install` via `scripts/install-binaries.js:1`):
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

## Deploy to Render — ezconverter (free, no VPS) — RECOMMENDED

Easiest free domain **without paying**, no VPS/DNS `A` record, no card. Gives `https://ezconverter.onrender.com`.

**Prerequisites:** GitHub account (free), repo pushed to GitHub.

### Steps (2 minutes)

1. Push this repo to GitHub (see [Push to GitHub](#push-to-github) below).
2. Go to `https://dashboard.render.com` → **New +** → **Blueprint** → connect `youtube-url-to-video` repo → **Apply** (reads `render.yaml:1`).
   - If Blueprint not used: **New +** → **Web Service** → connect repo → **Environment: Docker**, **Plan: Free**, **Region: Singapore**, **Dockerfile Path: ./Dockerfile**, **Health Check: /api/health** → Create.
3. Wait build (~3 min) → Render gives `https://ezconverter.onrender.com` (if name taken, Render suffixes `ezconverter-xxxx`; rename to `ezconverter-yt` in `render.yaml:4` and re-apply).
4. Verify:
   ```bash
   curl https://ezconverter.onrender.com/api/health
   # {"ok":true,"hasYtDlp":true,"bin":"yt-dlp"}
   curl "https://ezconverter.onrender.com/api/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
   ```
   Open `https://ezconverter.onrender.com/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ` → Preview → Download MP4 (720p). Badge shows `✓ Your server`.

**Free tier note:** Spins down after 15m idle → first Preview/Download wakes ~30s. Subsequent requests instant. Free 750h/mo. Keep warm via cron if desired: `*/14 * * * * curl https://ezconverter.onrender.com/api/health`.

### Alternative: Deploy to VPS with custom domain (single domain)

If you later get a VPS + domain (e.g. `yourdomain.com` or `ezconverter.duckdns.org`):

```bash
git clone https://github.com/<YOUR_USER>/youtube-url-to-video.git /opt/youtube-url-to-video
cd /opt/youtube-url-to-video
sudo bash deploy/setup-vps.sh yourdomain.com
# check
curl https://yourdomain.com/api/health
```

What it does (`deploy/setup-vps.sh:1`): install Node 20, ffmpeg, nginx, yt-dlp, `npm install`, configure `deploy/nginx.conf:1`, enable `deploy/youtube-ytv.service:1`, request Let's Encrypt cert.

## Push to GitHub

```bash
# First time (repo already init, commits 1f24d44, 84bb92f)
git remote add origin https://github.com/<YOUR_USER>/youtube-url-to-video.git
git push -u origin main
# Next pushes
git add . && git commit -m "feat: ..." && git push
# GitHub -> Settings -> Pages (optional static fallback) -> Source: main / root -> https://<YOUR_USER>.github.io/youtube-url-to-video/
```

## Deploy to GitHub Pages (static fallback, no backend)

Works without Render — uses Cobalt fallback automatically.

```bash
# already pushed above
# GitHub -> Settings -> Pages -> Source: main / root
# -> https://<YOUR_USER>.github.io/youtube-url-to-video/
```

## API

- `GET /api/health` -> `{ ok, hasYtDlp }`
- `GET /api/info?url=` -> `{ id, title, author, thumbnail, duration }`
- `GET /api/url?url=` -> `{ url: "https://...direct..." }`
- `GET /api/download?url=&quality=720` -> streams `video/mp4` with `Content-Disposition: attachment; filename="..."`

All serve from same domain — no CORS. Frontend badge shows `✓ Your server` vs `Cobalt fallback`.

## Troubleshooting

- **Render badge shows Cobalt fallback** -> `curl https://ezconverter.onrender.com/api/health` should be 200. Check Render → Logs. If 404, check `render.yaml:10` `healthCheckPath: /api/health` and `Dockerfile:1` `EXPOSE`.
- **Cold start slow** -> normal on free (wake 30s). Add keep-warm cron: `https://cron-job.org` hit `/api/health` every 14m.
- **Extractor timed out / rate-limited** -> wait 30s, retry.
- **Private / age-restricted** -> requires login, can't download.
- **Build fails: yt-dlp not found** -> `Dockerfile:9` curls latest yt-dlp; check Render logs → `yt-dlp --version` line.

## Disclaimer

For personal/educational use only. Respect YouTube's Terms of Service and creators' copyright. Only download videos you have rights to.

## License

MIT
