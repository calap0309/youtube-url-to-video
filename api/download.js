"use strict";
const { spawn } = require("child_process");
const { setCors, isYouTubeUrl, runYtDlp, ensureYtDlp, sanitizeFilename } = require("./_lib");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = (req.query.url || "").toString().trim();
  const quality = (req.query.quality || "720").toString().trim();
  const rawTitle = (req.query.title || "").toString().trim();
  if (!url) return res.status(400).json({ ok: false, error: "Missing ?url=" });
  if (!isYouTubeUrl(url)) return res.status(400).json({ ok: false, error: "Not a YouTube URL" });

  const allowed = new Set(["360", "480", "720", "1080"]);
  const q = allowed.has(quality) ? quality : "720";

  let filename = rawTitle ? sanitizeFilename(rawTitle) + ".mp4" : "video-720p.mp4";

  if (!rawTitle) {
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
  }

  // 1. On Vercel / serverless or by default, 302 redirect directly to GoogleVideo stream
  // This avoids serverless execution limits / timeouts and provides instant high-speed download
  const isVercel = !!process.env.VERCEL;
  const wantStream = req.query.stream === "1" || req.query.stream === "true";

  if (isVercel || !wantStream) {
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
        if (req.query.json === "1" || req.headers.accept?.includes("application/json")) {
          return res.json({ ok: true, url: direct, filename });
        }
        res.writeHead(302, {
          Location: direct,
          "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
          "Access-Control-Allow-Origin": "*",
        });
        return res.end();
      }
    } catch (e) {
      console.warn("[download] direct url extraction failed, trying stream:", e.message);
    }
  }

  // 2. Stream muxed MP4 on persistent server
  const bin = await ensureYtDlp();
  if (!bin) {
    return res.status(503).json({ ok: false, error: "yt-dlp binary is not available" });
  }

  const muxedFormat = `best[height<=${q}][ext=mp4]/best[height<=${q}]/best`;
  const fallbackFormat = `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${q}][ext=mp4]/best`;

  const trySpawn = (format) =>
    spawn(bin, ["--no-warnings", "--no-check-certificates", "-f", format, "--merge-output-format", "mp4", "-o", "-", "--quiet", url], { stdio: ["ignore", "pipe", "pipe"] });

  return new Promise((resolve) => {
    let proc = trySpawn(muxedFormat);
    let usedFallback = false;
    let errBuf = "";
    let headersSent = false;

    const startPipe = (p) => {
      if (!p.stdout) {
        if (!headersSent) res.status(500).json({ ok: false, error: "yt-dlp no stdout" });
        return resolve();
      }

      p.stdout.on("data", (chunk) => {
        if (!headersSent) {
          headersSent = true;
          res.writeHead(200, {
            "Content-Type": "video/mp4",
            "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Disposition",
          });
        }
        try { res.write(chunk); } catch {}
      });

      p.stdout.on("end", () => {
        try { res.end(); } catch {}
        resolve();
      });

      p.stderr.on("data", (d) => { errBuf += d.toString(); });

      p.on("error", (err) => {
        console.error("[download] spawn error", err);
        if (!headersSent) res.status(500).json({ ok: false, error: err.message });
        else try { res.end(); } catch {}
        resolve();
      });

      p.on("close", (code) => {
        if (code !== 0 && !usedFallback && !headersSent) {
          usedFallback = true;
          errBuf = "";
          const p2 = trySpawn(fallbackFormat);
          startPipe(p2);
          p2.on("close", (c2) => {
            if (c2 !== 0 && !headersSent) {
              console.error("[download] fallback exit", c2, errBuf.slice(0, 500));
              res.status(500).json({ ok: false, error: errBuf.slice(0, 800) || "Download failed" });
              resolve();
            }
          });
          return;
        }

        if (!headersSent) {
          console.error("[download] exit before data", code, errBuf.slice(0, 500));
          res.status(500).json({ ok: false, error: errBuf.slice(0, 800) || "Empty stream or download failed" });
          resolve();
        }
      });
    };

    startPipe(proc);
    req.on("close", () => {
      try { proc.kill(); } catch {}
      resolve();
    });
  });
};
