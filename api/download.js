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

  // Vercel serverless can't reliably pipe yt-dlp streaming (needs python, 60s limit, empty body 200 with 0 bytes -> network error)
  // Fix: on Vercel, just 302 redirect to direct muxed URL (googlevideo) with proper Content-Disposition
  // This is off-domain but reliable and avoids empty stream. Frontend will handle it via <a download>.
  // Local/VPS still streams via pipe for same-domain download.
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
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
      if (direct && direct.startsWith("http")) {
        res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
        // Use 302 so browser follows to googlevideo directly — no network error, proper video
        return res.redirect(302, direct);
      }
    } catch (e) {
      console.warn("[download] Vercel direct url failed, falling back to stream", e.message);
    }
  }

  // Local/VPS: stream muxed MP4 on same domain (no redirect)
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  const muxedFormat = `best[height<=${q}][ext=mp4]/best[height<=${q}][ext=mp4]/best[height<=${q}]/best`;
  const fallbackFormat = `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${q}][ext=mp4]/best`;
  let bin = "yt-dlp";
  const candidates = ["/tmp/yt-dlp", path.join(process.cwd(), "yt-dlp"), path.join(__dirname, "..", "yt-dlp"), "yt-dlp"];
  for (const c of candidates) if (fs.existsSync(c)) { bin = c; break; }
  console.log(`[download] ${url} -> ${q}p muxed via ${bin} as ${filename}`);

  const trySpawn = (format) =>
    spawn(bin, ["--no-warnings","--no-check-certificates","-f",format,"--merge-output-format","mp4","-o","-","--quiet",url], { stdio: ["ignore","pipe","pipe"] });

  return new Promise((resolve) => {
    let proc = trySpawn(muxedFormat);
    let usedFallback = false;
    let errBuf = "";
    let headersSent = false;
    const startPipe = (p) => {
      if (!p.stdout) { if (!res.headersSent) res.status(500).json({ error: "yt-dlp no stdout" }); return resolve(); }
      p.stdout.on("data", (chunk) => { if (!headersSent) headersSent = true; try { res.write(chunk); } catch {} });
      p.stdout.on("end", () => { try { res.end(); } catch {} resolve(); });
      p.stderr.on("data", (d) => { errBuf += d.toString(); });
      p.on("error", (err) => { console.error("[download] spawn error", err); if (!res.headersSent) res.status(500).json({ error: err.message }); else try { res.end(); } catch {} resolve(); });
      p.on("close", (code) => {
        if (code !== 0 && !usedFallback && !res.headersSent && !headersSent) {
          usedFallback = true; errBuf = "";
          const p2 = trySpawn(fallbackFormat);
          startPipe(p2);
          p2.on("close", (c2) => { if (c2 !== 0 && !res.writableEnded) { console.error("[download] fallback exit", c2, errBuf.slice(0,500)); if (!res.headersSent) res.status(500).json({ error: errBuf.slice(0,800) || "Download failed" }); resolve(); }});
          return;
        }
        if (code !== 0 && !headersSent) { console.error("[download] exit", code, errBuf.slice(0,500)); if (!res.headersSent) res.status(500).json({ error: errBuf.slice(0,800) || "Download failed" }); resolve(); }
        else if (!headersSent) { if (!res.headersSent) res.status(500).json({ error: "Empty stream" }); resolve(); }
      });
    };
    startPipe(proc);
    req.on("close", () => { try { proc.kill(); } catch {} resolve(); });
  });
};
