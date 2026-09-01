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

  // Option A: stream on same domain, but Vercel serverless can't reliably pipe yt-dlp (needs python, ffmpeg, 60s limit)
  // So: try yt-dlp streaming first, if it fails or would be empty, fallback to Cobalt tunnel proxied through this endpoint
  // This keeps download on vercel.app domain (no off-domain redirect) and avoids network error empty body.
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  // Helper: proxy Cobalt tunnel/stream through Vercel (stays on vercel.app)
  async function tryCobaltProxy() {
    const instances = ["https://api.cobalt.tools", "https://co.wuk.sh"];
    for (const base of instances) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 20000);
        const r = await fetch(base.replace(/\/$/, "") + "/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url, videoQuality: q, youtubeVideoCodec: "h264", filenamePattern: "basic" }),
          signal: controller.signal,
        });
        clearTimeout(t);
        if (!r.ok) continue;
        const data = await r.json();
        if (data.status === "error") continue;
        const cobaltUrl = data.url;
        if (!cobaltUrl || !String(cobaltUrl).startsWith("http")) continue;
        console.log(`[download] cobalt ${base} -> ${data.status} ${cobaltUrl.slice(0, 80)}`);
        // Proxy the cobalt URL stream through Vercel so it stays on vercel.app
        const upstream = await fetch(cobaltUrl);
        if (!upstream.ok || !upstream.body) continue;
        // Pipe upstream to res
        const reader = upstream.body.getReader();
        // Keep function alive until stream ends
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
        return true;
      } catch (e) {
        console.warn(`[download] cobalt ${base} failed`, e.message);
      }
    }
    return false;
  }

  // Try Cobalt proxy first on Vercel (most reliable for 720p muxed, no ffmpeg/python needed)
  // On Vercel, yt-dlp needs python3 which is missing (health false case), so Cobalt is preferred.
  // We detect Vercel by checking if yt-dlp would fail quickly.
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    const ok = await tryCobaltProxy();
    if (ok) return;
    // If Cobalt failed, fall through to yt-dlp streaming attempt below
  }

  // Fallback: yt-dlp streaming (for local/VPS where ffmpeg/python available, or if Cobalt down)
  const muxedFormat = `best[height<=${q}][ext=mp4]/best[height<=${q}][ext=mp4]/best[height<=${q}]/best`;
  const fallbackFormat = `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${q}][ext=mp4]/best`;
  let bin = "yt-dlp";
  const candidates = ["/tmp/yt-dlp", path.join(process.cwd(), "yt-dlp"), path.join(__dirname, "..", "yt-dlp"), "yt-dlp"];
  for (const c of candidates) if (fs.existsSync(c)) { bin = c; break; }
  console.log(`[download] ${url} -> ${q}p muxed via ${bin} as ${filename} (vercel: ${isVercel})`);

  const trySpawn = (format) =>
    spawn(bin, ["--no-warnings","--no-check-certificates","-f",format,"--merge-output-format","mp4","-o","-","--quiet",url], { stdio: ["ignore","pipe","pipe"] });

  // Return a promise that keeps Vercel function alive until streaming ends
  return new Promise((resolve, reject) => {
    let proc = trySpawn(muxedFormat);
    let usedFallback = false;
    let errBuf = "";
    let headersSent = false;

    const startPipe = (p) => {
      if (!p.stdout) {
        if (!res.headersSent) res.status(500).json({ error: "yt-dlp no stdout" });
        return resolve();
      }
      p.stdout.on("data", (chunk) => {
        if (!headersSent) headersSent = true;
        try { res.write(chunk); } catch {}
      });
      p.stdout.on("end", () => {
        try { res.end(); } catch {}
        resolve();
      });
      p.stderr.on("data", (d) => { errBuf += d.toString(); });
      p.on("error", (err) => {
        console.error("[download] spawn error", err);
        if (!res.headersSent) { res.status(500).json({ error: err.message }); resolve(); }
        else { try { res.end(); } catch {} resolve(); }
      });
      p.on("close", (code) => {
        if (code !== 0 && !usedFallback && !res.headersSent && !headersSent) {
          console.warn(`[download] muxed failed ${code}, trying fallback`, errBuf.slice(0,300));
          usedFallback = true;
          errBuf = "";
          const p2 = trySpawn(fallbackFormat);
          startPipe(p2);
          p2.on("close", (c2) => {
            if (c2 !== 0 && !res.writableEnded) {
              console.error("[download] fallback exit", c2, errBuf.slice(0,500));
              if (!res.headersSent) res.status(500).json({ error: errBuf.slice(0,800) || "Download failed" });
              resolve();
            }
          });
          return;
        }
        if (code !== 0 && !headersSent) {
          console.error("[download] exit", code, errBuf.slice(0,500));
          if (!res.headersSent) res.status(500).json({ error: errBuf.slice(0,800) || "Download failed" });
          resolve();
        } else if (!headersSent) {
          // No data was written but exit 0 — treat as error and try Cobalt
          tryCobaltProxy().then((ok) => {
            if (!ok && !res.headersSent) res.status(500).json({ error: "Empty stream, no muxed 720p" });
            resolve();
          });
        }
      });
    };
    startPipe(proc);
    req.on("close", () => { try { proc.kill(); } catch {} resolve(); });
  });
};
