# YouTube URL → Video

Paste a YouTube URL → preview → download **MP4 at 720p** (fixed). Static site for **GitHub Pages** — no backend.

![Stack](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Cobalt%20API-5865f2) ![Quality](https://img.shields.io/badge/quality-720p%20MP4-green)

## How it works

GitHub Pages can't run `yt-dlp`. The app calls the open-source [Cobalt API](https://github.com/imput/cobalt) (`api.cobalt.tools` / `co.wuk.sh`) directly from your browser. Your URL never touches a custom server. If one instance is down, it retries the next.

```
You → Paste youtube.com/watch?v=ID → oEmbed preview →
POST https://api.cobalt.tools/ { url, videoQuality: "720", youtubeVideoCodec: "h264" } →
{ status: "tunnel", url: "https://..." } → <a download> triggers browser download
```

## URL formats

- `https://www.youtube.com/watch?v=ID`
- `https://youtu.be/ID`
- `https://www.youtube.com/shorts/ID`
- `https://www.youtube.com/embed/ID`
- `https://music.youtube.com/watch?v=ID`
- `https://m.youtube.com/watch?v=ID`

You can also share with `?url=`:

```
https://<user>.github.io/youtube-url-to-video/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

## Run locally

```bash
# any static server
python3 -m http.server 8000
# or
npx serve .
# open http://localhost:8000
```

No build step, no `npm install`.

## Deploy to GitHub Pages

1. Create a new GitHub repo named `youtube-url-to-video` (or any name).
2. Push this folder:

```bash
git init
git branch -m main
git add .
git commit -m "feat: youtube url to 720p mp4 (cobalt) for github pages"
git remote add origin https://github.com/<YOUR_USER>/youtube-url-to-video.git
git push -u origin main
```

3. In GitHub → Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / `root` → Save.
4. URL: `https://<YOUR_USER>.github.io/youtube-url-to-video/`

To use a custom domain, add a `CNAME` file.

## Why 720p fixed?

Requested: `mp4` at `720p` always. Cobalt payload is locked:

```js
{ url, videoQuality: "720", youtubeVideoCodec: "h264", filenamePattern: "basic" }
```

If 720p isn't available for a video, Cobalt falls back to the next best. No quality picker keeps the UI simple and GitHub Pages friendly.

## Troubleshooting

- **Extractor timed out / rate-limited** — wait 30s, retry, or try another video.
- **Private / age-restricted / Premium video** — can't be downloaded here (requires login).
- **Failed to fetch / blocked** — disable ad-block / iCloud Private Relay, or try another network.
- **Download didn't start on iPhone** — tap the fallback direct link → long-press → Download Linked File.

## Disclaimer

For personal/educational use only. Respect YouTube's Terms of Service and creators' copyright. Only download videos you have rights to.

## License

MIT
