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
      "--get-url",
      "--no-warnings",
      "--no-check-certificates",
      "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
      url,
    ]);
    const direct = stdout.trim().split("\n")[0];
    if (!direct.startsWith("http")) throw new Error("No direct URL: " + direct.slice(0, 200));
    res.json({ url: direct });
  } catch (e) {
    console.error("[/api/url] error", e);
    res.status(500).json({ error: (e.stderr || e.message || "Failed to get URL").toString().slice(0, 800) });
  }
};
