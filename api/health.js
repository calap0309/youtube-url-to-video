"use strict";
const { setCors, runYtDlp } = require("./_lib");
const fs = require("fs");
const path = require("path");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  let hasYtDlp = false;
  let bin = "yt-dlp";
  try {
    // Check bundled binary first (postinstall ./yt-dlp)
    const candidates = ["/tmp/yt-dlp", path.join(process.cwd(), "yt-dlp"), path.join(__dirname, "..", "yt-dlp"), "yt-dlp"];
    for (const c of candidates) if (fs.existsSync(c)) { bin = c; break; }
    const { stdout } = await runYtDlp(["--version"]);
    hasYtDlp = !!stdout.trim();
  } catch (e) {
    hasYtDlp = false;
  }
  res.json({ ok: true, hasYtDlp, bin, runtime: "vercel", time: new Date().toISOString() });
};
