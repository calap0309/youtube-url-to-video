"use strict";
const { setCors, isYouTubeUrl, runYtDlp } = require("./_lib");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const url = (req.query.url || "").toString().trim();
  if (!url) return res.status(400).json({ error: "Missing ?url=" });
  if (!isYouTubeUrl(url)) return res.status(400).json({ error: "Not a YouTube URL" });

  try {
    const { stdout } = await runYtDlp([
      "--dump-single-json",
      "--no-warnings",
      "--no-check-certificates",
      "--no-playlist",
      "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
      url,
    ]);
    const data = JSON.parse(stdout);
    let thumb = "";
    if (Array.isArray(data.thumbnails) && data.thumbnails.length) {
      thumb = data.thumbnails[data.thumbnails.length - 1].url || data.thumbnail || "";
    } else {
      thumb = data.thumbnail || "";
    }
    if (!thumb && data.id) thumb = `https://img.youtube.com/vi/${data.id}/hqdefault.jpg`;
    res.json({
      id: data.id,
      title: data.title || "YouTube Video",
      author: data.uploader || data.channel || "",
      duration: data.duration || null,
      thumbnail: thumb,
      url,
      formats: (data.formats || []).slice(0, 5).map((f) => ({
        height: f.height, ext: f.ext, vcodec: f.vcodec, acodec: f.acodec, format_id: f.format_id,
      })),
    });
  } catch (e) {
    console.error("[/api/info] error", e);
    const msg = (e.stderr || e.message || "yt-dlp failed").toString().slice(0, 800);
    if (/Private video/i.test(msg)) return res.status(403).json({ error: "Private video" });
    if (/Sign in/i.test(msg) || /login/i.test(msg)) return res.status(403).json({ error: "Video requires login / age verification" });
    if (/Video unavailable/i.test(msg)) return res.status(404).json({ error: "Video unavailable" });
    if (/not found|ENOENT/i.test(msg)) return res.status(500).json({ error: "yt-dlp binary not found. Vercel cold start may need retry or use Cobalt fallback." });
    return res.status(500).json({ error: msg });
  }
};
