"use strict";
const { setCors, ensureYtDlp, runYtDlp } = require("./_lib");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  let hasYtDlp = false;
  let bin = "yt-dlp";
  let version = "";

  try {
    const resolved = await ensureYtDlp();
    if (resolved) {
      bin = resolved;
      const { stdout } = await runYtDlp(["--version"]);
      version = (stdout || "").trim();
      hasYtDlp = !!version;
    }
  } catch (e) {
    hasYtDlp = false;
  }

  res.json({
    ok: true,
    hasYtDlp,
    bin,
    version,
    runtime: process.env.VERCEL ? "vercel" : "node",
    time: new Date().toISOString(),
  });
};

