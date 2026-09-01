"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const TMP_BIN = "/tmp/yt-dlp";
let cachedBin = null;

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

function testBin(binPath) {
  try {
    const out = execFileSync(binPath, ["--version"], { timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function downloadYtDlpDirect(targetPath) {
  return new Promise((resolve, reject) => {
    const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
    function get(u, redirects = 0) {
      if (redirects > 5) return reject(new Error("Too many redirects"));
      https.get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        const file = fs.createWriteStream(targetPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            try { fs.chmodSync(targetPath, 0o755); } catch {}
            resolve();
          });
        });
        file.on("error", (err) => {
          try { fs.unlinkSync(targetPath); } catch {}
          reject(err);
        });
      }).on("error", reject);
    }
    get(url);
  });
}

async function ensureYtDlp() {
  if (cachedBin && (cachedBin === "yt-dlp" || fs.existsSync(cachedBin)) && testBin(cachedBin)) {
    return cachedBin;
  }

  const candidates = [
    process.env.YTDLP_BIN,
    TMP_BIN,
    path.join(process.cwd(), "yt-dlp"),
    path.join(__dirname, "..", "yt-dlp"),
    "yt-dlp",
  ].filter(Boolean);

  for (const c of candidates) {
    if (c === "yt-dlp" || fs.existsSync(c)) {
      if (testBin(c)) {
        cachedBin = c;
        return cachedBin;
      }
    }
  }

  // Attempt to download to /tmp/yt-dlp (writable on Vercel / AWS Lambda / Linux)
  try {
    console.log("[yt-dlp] binary not found, downloading to", TMP_BIN);
    try {
      const YTDlpWrap = require("yt-dlp-wrap-plus").default;
      await YTDlpWrap.downloadFromGithub(TMP_BIN);
    } catch (wrapErr) {
      console.warn("[yt-dlp] wrap-plus download failed, trying direct https:", wrapErr.message);
      await downloadYtDlpDirect(TMP_BIN);
    }

    if (fs.existsSync(TMP_BIN)) {
      fs.chmodSync(TMP_BIN, 0o755);
      if (testBin(TMP_BIN)) {
        cachedBin = TMP_BIN;
        console.log("[yt-dlp] downloaded and verified at", TMP_BIN);
        return cachedBin;
      }
    }
  } catch (e) {
    console.warn("[yt-dlp] download failed:", e.message);
  }

  return null;
}

function resolveBin() {
  if (cachedBin) return cachedBin;
  if (fs.existsSync(TMP_BIN)) return TMP_BIN;
  if (fs.existsSync(path.join(process.cwd(), "yt-dlp"))) return path.join(process.cwd(), "yt-dlp");
  if (fs.existsSync(path.join(__dirname, "..", "yt-dlp"))) return path.join(__dirname, "..", "yt-dlp");
  return process.env.YTDLP_BIN || "yt-dlp";
}

async function runYtDlp(args, opts = {}) {
  const bin = await ensureYtDlp();
  if (!bin) {
    throw new Error("yt-dlp binary is not available");
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
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
        try { proc.kill(); } catch {}
      });
    }
  });
}


async function ytDlpAvailable() {
  try {
    const bin = await ensureYtDlp();
    return !!bin;
  } catch {
    return false;
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}

module.exports = {
  isYouTubeUrl,
  sanitizeFilename,
  runYtDlp,
  ensureYtDlp,
  resolveBin,
  ytDlpAvailable,
  setCors,
};

