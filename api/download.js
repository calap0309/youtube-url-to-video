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

  const wantJson = req.query.json === "1" || req.headers.accept?.includes("application/json");
  const muxedFormat = `best[height<=${q}][ext=mp4]/best[height<=${q}]/best`;
  const permissiveFormat = `best[height<=${q}][ext=mp4]/best[height<=${q}]/best/best`;
  const ultimateFormat = `best`;
  const tryGetUrl = async (fmt) => {
    const { stdout } = await runYtDlp(["--get-url","--no-warnings","--no-check-certificates","-f",fmt,url]);
    return stdout.trim().split("\n")[0];
  };
  // HEAD: just check if direct URL exists, return 200/500 so frontend knows to fallback to Invidious/Cobalt
  if (req.method === "HEAD") {
    try {
      let direct = "";
      for (const fmt of [muxedFormat, permissiveFormat, ultimateFormat]) {
        try { direct = await tryGetUrl(fmt); if (direct && direct.startsWith("http")) break; } catch {}
      }
      if (direct && direct.startsWith("http")) return res.status(200).end();
      return res.status(500).end();
    } catch { return res.status(500).end(); }
  }
  if (wantJson) {
    try {
      let direct = "";
      for (const fmt of [muxedFormat, permissiveFormat, ultimateFormat]) {
        try {
          direct = await tryGetUrl(fmt);
          if (direct && direct.startsWith("http")) break;
        } catch (e) {
          console.warn(`[download] json get-url ${fmt} failed`, e.message?.slice(0,200));
        }
      }
      if (direct && direct.startsWith("http")) return res.json({ ok: true, url: direct, filename });
      // Fallback to Invidious on Vercel when yt-dlp get-url fails (YouTube bot detection)
      if (process.env.VERCEL) {
        const videoId = (url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([^?&\/]+)/) || [])[1];
        if (videoId) {
          const invInstances = ["https://inv.tux.pizza","https://invidious.nerdvpn.de","https://invidious.drgns.space"];
          for (const inv of invInstances) {
            try {
              const r = await fetch(`${inv}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(8000) });
              if (!r.ok) continue;
              const j = await r.json();
              const streams = j.formatStreams || [];
              const s = streams.find(x => (x.qualityLabel||"").includes("720") && (x.container==="mp4"||x.type?.includes("mp4"))) || streams.find(x=>x.container==="mp4") || streams[0];
              if (s && s.url) return res.json({ ok: true, url: s.url, filename });
            } catch {}
          }
        }
      }
      return res.status(500).json({ ok: false, error: "No direct URL found (tried muxed/permissive/best + Invidious)" });
    } catch (e) {
      const msg = (e.stderr || e.message || "failed").toString().slice(0, 600);
      return res.status(500).json({ ok: false, error: msg });
    }
  }
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    try {
      let direct = "";
      for (const fmt of [muxedFormat, permissiveFormat, ultimateFormat]) {
        try {
          direct = await tryGetUrl(fmt);
          if (direct && direct.startsWith("http")) break;
        } catch {}
      }
      if (!direct || !direct.startsWith("http")) {
        // Try Invidious as Vercel fallback
        const videoId = (url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([^?&\/]+)/) || [])[1];
        if (videoId) {
          for (const inv of ["https://inv.tux.pizza","https://invidious.nerdvpn.de"]) {
            try {
              const r = await fetch(`${inv}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(8000) });
              if (!r.ok) continue;
              const j = await r.json();
              const streams = j.formatStreams || [];
              const s = streams.find(x => (x.qualityLabel||"").includes("720") && x.container==="mp4") || streams.find(x=>x.container==="mp4") || streams[0];
              if (s && s.url) direct = s.url;
              if (direct) break;
            } catch {}
          }
        }
      }
      if (direct && direct.startsWith("http")) {
        const upstream = await fetch(direct);
        if (!upstream.ok || !upstream.body) throw new Error(`upstream ${upstream.status}`);
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Disposition",
        });
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        return res.end();
      }
    } catch (e) {
      console.warn("[download] Vercel proxy failed, falling back to stream:", e.message);
    }
  }

  // 2. Stream muxed MP4 on persistent server (reuse muxedFormat/permissiveFormat)
  const bin = await ensureYtDlp();
  if (!bin) {
    return res.status(503).json({ ok: false, error: "yt-dlp binary is not available" });
  }

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
