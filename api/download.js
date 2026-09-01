"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
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

  // Best effort filename
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

  // Option A: always stream on same domain (no 302 to googlevideo), stay on vercel.app
  // Use muxed MP4 format that doesn't require ffmpeg on Vercel (ffmpeg missing there)
  // Falls back to Cobalt on frontend if this 504s (Vercel 60s limit for long videos)
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-cache");

  // Muxed MP4 for Vercel (no ffmpeg needed). Local server still uses +bestaudio with ffmpeg, but this works without it.
  const muxedFormat = `best[height<=${q}][ext=mp4]/best[height<=${q}][ext=mp4]/best[height<=${q}]/best`;
  const fallbackFormat = `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${q}][ext=mp4]/best`;

  // Resolve yt-dlp bin (Vercel: /var/task/yt-dlp from postinstall, or /tmp/yt-dlp, or system)
  let bin = "yt-dlp";
  const candidates = ["/tmp/yt-dlp", path.join(process.cwd(), "yt-dlp"), path.join(__dirname, "..", "yt-dlp"), "yt-dlp"];
  for (const c of candidates) if (fs.existsSync(c)) { bin = c; break; }

  console.log(`[download] ${url} -> ${q}p muxed via ${bin} as ${filename}`);

  // Try muxed first (no ffmpeg), if fails try with merge (needs ffmpeg, may fail on Vercel but ok locally)
  const trySpawn = (format) =>
    spawn(bin, [
      "--no-warnings",
      "--no-check-certificates",
      "-f", format,
      "--merge-output-format", "mp4",
      "-o", "-",
      "--quiet",
      url,
    ], { stdio: ["ignore", "pipe", "pipe"] });

  let proc = trySpawn(muxedFormat);
  let usedFallback = false;

  if (!proc.stdout) return res.status(500).json({ error: "yt-dlp did not return stdout" });

  let errBuf = "";
  proc.stderr.on("data", (d) => { errBuf += d.toString(); });

  proc.on("error", (err) => {
    console.error("[download] spawn error", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });

  proc.on("close", (code) => {
    // If muxed format failed (e.g. no muxed 720p), try fallback format once (needs ffmpeg)
    if (code !== 0 && !usedFallback && !res.writableEnded && !res.headersSent) {
      console.warn(`[download] muxed ${muxedFormat} failed code ${code}, trying fallback ${fallbackFormat}`, errBuf.slice(0, 300));
      usedFallback = true;
      errBuf = "";
      proc = trySpawn(fallbackFormat);
      if (!proc.stdout) {
        if (!res.headersSent) res.status(500).json({ error: "yt-dlp fallback no stdout" });
        return;
      }
      proc.stdout.pipe(res);
      proc.stderr.on("data", (d) => { errBuf += d.toString(); });
      proc.on("error", (e) => {
        console.error("[download] fallback spawn error", e);
        if (!res.headersSent) res.status(500).json({ error: e.message });
        else res.end();
      });
      proc.on("close", (c2) => {
        if (c2 !== 0 && !res.writableEnded) {
          console.error("[download] fallback exit", c2, errBuf.slice(0, 500));
          if (!res.headersSent) res.status(500).json({ error: errBuf.slice(0, 800) || "Download failed (no muxed 720p, fallback needs ffmpeg)" });
          else res.end();
        }
      });
      req.on("close", () => { try { proc.kill(); } catch (_) {} });
      return;
    }
    if (code !== 0 && !res.writableEnded) {
      console.error("[download] exit", code, errBuf.slice(0, 500));
      if (!res.headersSent) res.status(500).json({ error: errBuf.slice(0, 800) || "Download failed" });
      else res.end();
    }
  });

  proc.stdout.pipe(res);
  req.on("close", () => { try { proc.kill(); } catch (_) {} });
};
