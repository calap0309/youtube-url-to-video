"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const { setCors, isYouTubeUrl, runYtDlp, sanitizeFilename } = require("./_lib");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = (req.query.url || "").toString().trim();
  const quality = (req.query.quality || "720").toString().trim();
  if (!url) return res.status(400).json({ error: "Missing ?url=" });
  if (!isYouTubeUrl(url)) return res.status(400).json({ error: "Not a YouTube URL" });

  const allowed = new Set(["360", "480", "720", "1080"]);
  const q = allowed.has(quality) ? quality : "720";

  // Try to get filename (best effort, don't fail download if this fails)
  let filename = "video-720p.mp4";
  try {
    const { stdout } = await runYtDlp([
      "--dump-single-json",
      "--no-warnings",
      "--no-check-certificates",
      "--no-playlist",
      "--flat-playlist",
      url,
    ]);
    const data = JSON.parse(stdout);
    filename = sanitizeFilename(data.title || data.id || "video") + ".mp4";
  } catch (_) {}

  // For Vercel: prefer redirect to direct URL to avoid timeout/stream limits.
  // If ?redirect=0 is passed, we stream via yt-dlp; otherwise we redirect to /api/url result.
  const redirect = req.query.redirect !== "0";

  if (redirect) {
    try {
      const { stdout } = await runYtDlp([
        "--get-url",
        "--no-warnings",
        "--no-check-certificates",
        "-f", `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${q}][ext=mp4]/best`,
        url,
      ]);
      const direct = stdout.trim().split("\n")[0];
      if (direct && direct.startsWith("http")) {
        // Redirect to direct URL with download header hint
        res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
        return res.redirect(302, direct);
      }
    } catch (e) {
      console.warn("[/api/download] get-url failed, falling back to stream", e.message);
    }
  }

  // Fallback: stream via yt-dlp (may hit Vercel 60s timeout for long videos)
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  res.setHeader("Content-Type", "video/mp4");

  const format = `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${q}][ext=mp4]/best`;
  const bin = fs.existsSync("/tmp/yt-dlp") ? "/tmp/yt-dlp" : (process.env.YTDLP_BIN || "yt-dlp");
  console.log(`[download] ${url} -> ${q}p via ${bin}`);

  const proc = spawn(bin, [
    "--no-warnings",
    "--no-check-certificates",
    "-f", format,
    "--merge-output-format", "mp4",
    "-o", "-",
    "--quiet",
    url,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  if (!proc.stdout) return res.status(500).json({ error: "yt-dlp did not return stdout" });

  proc.stdout.pipe(res);

  let errBuf = "";
  proc.stderr.on("data", (d) => { errBuf += d.toString(); });
  proc.on("error", (err) => {
    console.error("[download] spawn error", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });
  proc.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      console.error("[download] exit", code, errBuf.slice(0, 500));
      if (!res.headersSent) res.status(500).json({ error: errBuf.slice(0, 800) || "Download failed" });
      else res.end();
    }
  });
  req.on("close", () => { try { proc.kill(); } catch (_) {} });
};
