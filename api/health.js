"use strict";
const { setCors, ytDlpAvailable } = require("./_lib");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const hasYtDlp = await ytDlpAvailable();
  res.json({ ok: true, hasYtDlp, runtime: "vercel", time: new Date().toISOString() });
};
