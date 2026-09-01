#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("[postinstall] checking yt-dlp binary...");

  try {
    execSync("yt-dlp --version", { stdio: "inherit", timeout: 10000 });
    console.log("[postinstall] yt-dlp binary OK (system yt-dlp)");
    return;
  } catch {}

  const localBin = path.join(process.cwd(), "yt-dlp");
  if (fs.existsSync(localBin)) {
    try {
      execSync(`"${localBin}" --version`, { stdio: "inherit", timeout: 10000 });
      console.log("[postinstall] yt-dlp binary OK (" + localBin + ")");
      return;
    } catch {}
  }

  console.warn("[postinstall] yt-dlp NOT found, trying to download via yt-dlp-wrap-plus...");
  try {
    const YTDlpWrap = require("yt-dlp-wrap-plus").default;
    await YTDlpWrap.downloadFromGithub(localBin);
    try { fs.chmodSync(localBin, 0o755); } catch {}
    console.log("[postinstall] yt-dlp downloaded to " + localBin);
    execSync(`"${localBin}" --version`, { stdio: "inherit" });
  } catch (dlErr) {
    console.warn("[postinstall] download failed:", dlErr.message);
    console.warn("[postinstall] Manual: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp");
  }

  try {
    execSync("ffmpeg -version", { stdio: "ignore", timeout: 5000 });
    console.log("[postinstall] ffmpeg OK");
  } catch {
    console.warn("[postinstall] ffmpeg NOT found - 720p mp4 merging needs ffmpeg. Install: sudo apt update && sudo apt install -y ffmpeg");
  }

  console.log("[postinstall] done");
}

main().catch((err) => {
  console.warn("[postinstall] error:", err.message);
});

