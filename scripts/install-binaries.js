#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");

console.log("[postinstall] checking yt-dlp binary...");

try {
  execSync("yt-dlp --version", { stdio: "inherit", timeout: 10000 });
  console.log("[postinstall] yt-dlp binary OK (yt-dlp)");
} catch {
  try {
    execSync("./yt-dlp --version", { stdio: "inherit", timeout: 10000 });
    console.log("[postinstall] yt-dlp binary OK (./yt-dlp)");
  } catch (e) {
    console.warn("[postinstall] yt-dlp NOT found, trying to download via yt-dlp-wrap-plus...");
    try {
      const YTDlpWrap = require("yt-dlp-wrap-plus").default;
      // download latest to ./yt-dlp
      (async () => {
        try {
          await YTDlpWrap.downloadFromGithub("./yt-dlp");
          console.log("[postinstall] yt-dlp downloaded to ./yt-dlp");
          execSync("./yt-dlp --version", { stdio: "inherit" });
        } catch (dlErr) {
          console.warn("[postinstall] download failed:", dlErr.message);
          console.warn("[postinstall] Manual: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp");
        }
      })();
    } catch (wrapErr) {
      console.warn("[postinstall] yt-dlp-wrap-plus not available:", wrapErr.message);
      console.warn("[postinstall] Manual: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp");
    }
  }
}

try {
  execSync("ffmpeg -version", { stdio: "ignore", timeout: 5000 });
  console.log("[postinstall] ffmpeg OK");
} catch {
  console.warn("[postinstall] ffmpeg NOT found - 720p mp4 merging needs ffmpeg. Install: sudo apt update && sudo apt install -y ffmpeg");
}

console.log("[postinstall] done");
