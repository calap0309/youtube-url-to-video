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

  // Try yt-dlp first (most reliable, stays on Vercel)
  // Add android player_client to bypass YouTube bot detection on Vercel AWS IP
  const baseArgs = ["--no-warnings","--no-check-certificates","--extractor-args","youtube:player_client=android,web"];
  const tryYtDlp = async () => {
    const formats = [
      `best[height<=${q}][ext=mp4]/best[height<=${q}]/best`,
      `best[height<=${q}][ext=mp4]/best[height<=${q}]/best/best`,
      `best[height<=720][ext=mp4]/best`,
      `best`,
      `18/22/best`, // fallback for old muxed
    ];
    for (const fmt of formats) {
      try {
        const { stdout } = await runYtDlp([...baseArgs,"--get-url","-f",fmt,url]);
        const direct = stdout.trim().split("\n")[0];
        if (direct && direct.startsWith("http")) {
          let filename = `video-${q}p.mp4`;
          try {
            const { stdout: j } = await runYtDlp([...baseArgs,"--dump-single-json","--no-playlist","--flat-playlist",url]);
            const data = JSON.parse(j);
            filename = sanitizeFilename(data.title || data.id || "video") + ".mp4";
          } catch {}
          return { url: direct, filename };
        }
      } catch (e) {
        console.warn(`[cobalt] yt-dlp ${fmt} failed`, (e.stderr||e.message||"").slice(0,180));
      }
    }
    return null;
  };

  // Try Invidious fallback (more instances, longer timeout for Vercel)
  const tryInvidious = async () => {
    const videoId = (url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([^?&\/]+)/) || [])[1];
    if (!videoId) return null;
    const instances = [
      "https://inv.tux.pizza",
      "https://invidious.nerdvpn.de",
      "https://invidious.drgns.space",
      "https://yewtu.be",
      "https://invidious.protokolla.fi",
      "https://inv.nadeko.net",
    ];
    for (const inv of instances) {
      try {
        const r = await fetch(`${inv}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) continue;
        const j = await r.json();
        const streams = j.formatStreams || [];
        // Try 720p mp4, then any mp4, then any stream
        let s = streams.find(x => (x.qualityLabel||x.quality||"").includes(q) && (x.container==="mp4"||x.type?.includes("mp4"))) 
          || streams.find(x => (x.qualityLabel||x.quality||"").includes(q))
          || streams.find(x=>x.container==="mp4"||x.type?.includes("mp4")) || streams[0];
        if (s && s.url) return { url: s.url, filename: sanitizeFilename(j.title || "video") + ".mp4" };
        const adaptive = j.adaptiveFormats || [];
        s = adaptive.find(x => (x.qualityLabel||"").includes(q) && x.container==="mp4") || adaptive.find(x=>x.container==="mp4");
        if (s && s.url) return { url: s.url, filename: sanitizeFilename(j.title || "video") + ".mp4" };
      } catch (e) {
        console.warn(`[cobalt] inv ${inv} failed`, e.message?.slice(0,80));
      }
    }
    return null;
  };

  let result = await tryYtDlp();
  if (!result) {
    console.log(`[cobalt] yt-dlp failed for ${q}p, trying Invidious`);
    result = await tryInvidious();
  }
  if (result && result.url) {
    return res.json({ status: "tunnel", url: result.url, filename: result.filename });
  }
  // Provide helpful error with hint
  return res.status(500).json({ status: "error", error: { code: "error.api.youtube.noVideoInfo", message: `Could not extract ${q}p stream. Try 360p or check if video is public/age-restricted.` } });
};
