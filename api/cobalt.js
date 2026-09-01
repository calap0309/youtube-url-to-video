"use strict";
const { setCors, isYouTubeUrl, runYtDlp, sanitizeFilename } = require("./_lib");

// Self-hosted Cobalt-compatible endpoint to avoid api.cobalt.tools JWT auth
// POST /api/cobalt  body: { url, videoQuality: "720", youtubeVideoCodec: "h264", filenamePattern: "basic" }
// Returns: { status: "tunnel" | "redirect", url: "https://...", filename: "..." } or { status: "error", error: { code } }
// Uses yt-dlp with --js-runtimes node and Invidious fallback, so no external Cobalt instance needed.

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ status: "error", error: { code: "error.api.method.not_allowed" } });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const url = (body && body.url || "").toString().trim();
  const quality = (body && body.videoQuality || "720").toString().trim();
  if (!url) return res.status(400).json({ status: "error", error: { code: "error.api.missing.url" } });
  if (!isYouTubeUrl(url)) return res.status(400).json({ status: "error", error: { code: "error.api.link.unsupported" } });

  const allowed = new Set(["360","480","720","1080","max"]);
  const q = allowed.has(quality) ? quality : "720";

  // Try yt-dlp first (most reliable, stays on Vercel with --js-runtimes node)
  const tryYtDlp = async () => {
    const formats = [
      `best[height<=${q}][ext=mp4]/best[height<=${q}]/best`,
      `best[height<=${q}][ext=mp4]/best[height<=${q}]/best/best`,
      `best`,
    ];
    for (const fmt of formats) {
      try {
        const { stdout } = await runYtDlp(["--get-url","--no-warnings","--no-check-certificates","-f",fmt,url]);
        const direct = stdout.trim().split("\n")[0];
        if (direct && direct.startsWith("http")) {
          let filename = "video.mp4";
          try {
            const { stdout: j } = await runYtDlp(["--dump-single-json","--no-warnings","--no-check-certificates","--no-playlist","--flat-playlist",url]);
            const data = JSON.parse(j);
            filename = sanitizeFilename(data.title || data.id || "video") + ".mp4";
          } catch {}
          return { url: direct, filename };
        }
      } catch (e) {
        console.warn(`[cobalt] yt-dlp ${fmt} failed`, e.message?.slice(0,120));
      }
    }
    return null;
  };

  // Try Invidious fallback
  const tryInvidious = async () => {
    const videoId = (url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([^?&\/]+)/) || [])[1];
    if (!videoId) return null;
    const instances = ["https://inv.tux.pizza","https://invidious.nerdvpn.de","https://invidious.drgns.space","https://yewtu.be"];
    for (const inv of instances) {
      try {
        const r = await fetch(`${inv}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = await r.json();
        const streams = j.formatStreams || [];
        const s = streams.find(x => (x.qualityLabel||"").includes(q) && x.container==="mp4") || streams.find(x=>x.container==="mp4") || streams[0];
        if (s && s.url) return { url: s.url, filename: sanitizeFilename(j.title || "video") + ".mp4" };
      } catch {}
    }
    return null;
  };

  let result = await tryYtDlp();
  if (!result) result = await tryInvidious();
  if (result && result.url) {
    // Return tunnel so frontend's triggerDownload works same as before
    return res.json({ status: "tunnel", url: result.url, filename: result.filename });
  }
  return res.status(500).json({ status: "error", error: { code: "error.api.youtube.noVideoInfo", message: "Could not extract 720p stream" } });
};
