"use strict";
const { setCors, isYouTubeUrl, runYtDlp } = require("./_lib");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = (req.query.url || "").toString().trim();
  const quality = (req.query.quality || "720").toString().trim();
  if (!url) return res.status(400).json({ error: "Missing ?url=" });
  if (!isYouTubeUrl(url)) return res.status(400).json({ error: "Not a YouTube URL" });

  const allowed = new Set(["360", "480", "720", "1080"]);
  const q = allowed.has(quality) ? quality : "720";

  try {
    const muxedFormat = `best[height<=${q}][ext=mp4]/best[height<=${q}]/best`;
    const { stdout } = await runYtDlp([
      "--get-url",
      "--no-warnings",
      "--no-check-certificates",
      "-f", muxedFormat,
      url,
    ]);
    const direct = stdout.trim().split("\n")[0];
    if (!direct || !direct.startsWith("http")) {
      throw new Error("No direct URL: " + (direct || "").slice(0, 200));
    }
    res.json({ ok: true, url: direct });
  } catch (e) {
    console.error("[/api/url] error", e.message);
    res.status(500).json({ ok: false, error: (e.stderr || e.message || "Failed to get direct URL").toString().slice(0, 500) });
  }
};

