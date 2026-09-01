"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp";
const TMP_BIN = "/tmp/yt-dlp";

function resolveBin() {
  if (fs.existsSync(TMP_BIN)) return TMP_BIN;
  if (fs.existsSync(path.join(process.cwd(), "yt-dlp"))) return path.join(process.cwd(), "yt-dlp");
  if (fs.existsSync(path.join(__dirname, "..", "yt-dlp"))) return path.join(__dirname, "..", "yt-dlp");
  return YTDLP_BIN;
}

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

function runYtDlp(args) {
  const bin = resolveBin();
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
  });
}

async function ensureYtDlp() {
  if (fs.existsSync(TMP_BIN)) return TMP_BIN;
  if (fs.existsSync(BUNDLED_BIN)) return BUNDLED_BIN;
  if (fs.existsSync(ALT_BUNDLED)) return ALT_BUNDLED;
  try {
    await runYtDlp(["--version"]);
    return resolveBin();
  } catch {
    // Try to download to /tmp (Vercel writable)
    try {
      const YTDlpWrap = require("yt-dlp-wrap-plus").default;
      await YTDlpWrap.downloadFromGithub(TMP_BIN);
      if (fs.existsSync(TMP_BIN)) {
        fs.chmodSync(TMP_BIN, 0o755);
        return TMP_BIN;
      }
    } catch (e) {
      console.warn("[yt-dlp] download failed", e.message);
    }
    return null;
  }
}

async function ytDlpAvailable() {
  try {
    const bin = await ensureYtDlp();
    if (!bin) return false;
    await runYtDlp(["--version"]);
    return true;
  } catch {
    return false;
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = {
  isYouTubeUrl,
  sanitizeFilename,
  runYtDlp,
  ensureYtDlp,
  ytDlpAvailable,
  setCors,
};
