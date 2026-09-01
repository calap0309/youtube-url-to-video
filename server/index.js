/**
 * VPS backend - serves frontend static + /api/info & /api/download (720p mp4)
 * Single domain: https://yourdomain.com/ -> static, https://yourdomain.com/api/* -> API
 * Uses yt-dlp binary directly (or via yt-dlp-wrap-plus). Falls back to direct URL.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// yt-dlp binary - try system, then local ./yt-dlp, then wrapper download
let YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp";
try {
  // if wrapper available, try to use its binary path if system not found
  const YTDlpWrap = require("yt-dlp-wrap-plus").default;
  // we keep default bin, but wrapper can download
  // Check if binary exists at ./yt-dlp
  if (fs.existsSync(path.join(__dirname, "..", "yt-dlp"))) {
    YTDLP_BIN = path.join(__dirname, "..", "yt-dlp");
  } else if (fs.existsSync(path.join(process.cwd(), "yt-dlp"))) {
    YTDLP_BIN = path.join(process.cwd(), "yt-dlp");
  }
  console.log("[server] yt-dlp-wrap-plus available, bin:", YTDLP_BIN);
} catch (e) {
  console.log("[server] yt-dlp-wrap-plus not available, using bin:", YTDLP_BIN, e.message);
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const valid = ["youtube.com", "youtu.be", "youtube-nocookie.com", "m.youtube.com", "music.youtube.com"];
    return valid.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

function sanitizeFilename(name) {
  return (name || "video")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "video";
}

function runYtDlp(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      err.stderr = stderr;
      reject(err);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const err = new Error(stderr || `yt-dlp exited ${code}`);
        err.stderr = stderr;
        err.stdout = stdout;
        err.code = code;
        reject(err);
      }
    });
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
        try { proc.kill(); } catch (_) {}
      });
    }
  });
}

function spawnYtDlpStream(args) {
  const proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
  return proc;
}

async function ytDlpAvailable() {
  try {
    await runYtDlp(["--version"]);
    return true;
  } catch {
    return false;
  }
}

// --- API: health ---
app.get("/api/health", async (_req, res) => {
  const hasYtDlp = await ytDlpAvailable();
  res.json({ ok: true, hasYtDlp, bin: YTDLP_BIN, time: new Date().toISOString() });
});

// --- API: info ---
app.get("/api/info", async (req, res) => {
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
      url: url,
      formats: (data.formats || []).slice(0, 5).map((f) => ({
        height: f.height,
        ext: f.ext,
        vcodec: f.vcodec,
        acodec: f.acodec,
        format_id: f.format_id,
      })),
    });
  } catch (e) {
    console.error("[/api/info] error:", e);
    const msg = (e.stderr || e.message || "yt-dlp failed").toString().slice(0, 800);
    if (/Private video/i.test(msg)) return res.status(403).json({ error: "Private video" });
    if (/Sign in/i.test(msg) || /login/i.test(msg)) return res.status(403).json({ error: "Video requires login / age verification" });
    if (/Video unavailable/i.test(msg)) return res.status(404).json({ error: "Video unavailable" });
    if (/not found|ENOENT/i.test(msg)) return res.status(500).json({ error: "yt-dlp binary not found on server. Install: curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp" });
    return res.status(500).json({ error: msg });
  }
});

// --- API: direct URL ---
app.get("/api/url", async (req, res) => {
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
    console.error("[/api/url] error:", e);
    res.status(500).json({ error: (e.stderr || e.message || "Failed to get URL").toString().slice(0, 800) });
  }
});

// --- API: download (stream) ---
app.get("/api/download", async (req, res) => {
  const url = (req.query.url || "").toString().trim();
  const quality = (req.query.quality || "720").toString().trim();
  if (!url) return res.status(400).json({ error: "Missing ?url=" });
  if (!isYouTubeUrl(url)) return res.status(400).json({ error: "Not a YouTube URL" });

  const allowed = new Set(["360", "480", "720", "1080"]);
  const q = allowed.has(quality) ? quality : "720";

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

  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  res.setHeader("Content-Type", "video/mp4");

  const format = `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${q}][ext=mp4]/best`;
  console.log(`[download] ${url} -> ${q}p mp4 as ${filename} via ${YTDLP_BIN}`);

  const proc = spawnYtDlpStream([
    "--no-warnings",
    "--no-check-certificates",
    "-f", format,
    "--merge-output-format", "mp4",
    "-o", "-",
    "--quiet",
    url,
  ]);

  if (!proc.stdout) {
    return res.status(500).json({ error: "yt-dlp did not return stdout" });
  }

  proc.stdout.pipe(res);

  let errBuf = "";
  proc.stderr.on("data", (d) => { errBuf += d.toString(); });

  proc.on("error", (err) => {
    console.error("[download] spawn error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });

  proc.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      console.error("[download] yt-dlp exited", code, errBuf.slice(0, 500));
      if (!res.headersSent) {
        res.status(500).json({ error: errBuf.slice(0, 800) || "Download failed" });
      } else {
        res.end();
      }
    }
  });

  req.on("close", () => {
    try { proc.kill(); } catch (_) {}
  });
});

// --- Static frontend ---
const staticRoot = path.join(__dirname, "..");
app.use(express.static(staticRoot, { extensions: ["html"] }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  const indexPath = path.join(staticRoot, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send("Not found");
});

app.listen(PORT, HOST, async () => {
  const has = await ytDlpAvailable();
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] static root: ${staticRoot}`);
  console.log(`[server] yt-dlp: ${has ? "available (" + YTDLP_BIN + ")" : "MISSING - install binary"}`);
  console.log(`[server] try: http://localhost:${PORT}/api/health`);
});
