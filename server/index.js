/**
 * VPS / Local backend - serves frontend static + /api/info & /api/download (720p mp4)
 * Single domain: https://yourdomain.com/ -> static, https://yourdomain.com/api/* -> API
 */
"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { ytDlpAvailable, ensureYtDlp } = require("../api/_lib");

const healthHandler = require("../api/health");
const infoHandler = require("../api/info");
const urlHandler = require("../api/url");
const downloadHandler = require("../api/download");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// API Routes
app.all("/api/health", (req, res) => healthHandler(req, res));
app.all("/api/info", (req, res) => infoHandler(req, res));
app.all("/api/url", (req, res) => urlHandler(req, res));
app.all("/api/download", (req, res) => downloadHandler(req, res));

// Static frontend
const staticRoot = path.join(__dirname, "..");
app.use(express.static(staticRoot, { extensions: ["html"] }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  const indexPath = path.join(staticRoot, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send("Not found");
});

app.listen(PORT, HOST, async () => {
  const bin = await ensureYtDlp();
  const has = await ytDlpAvailable();
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] static root: ${staticRoot}`);
  console.log(`[server] yt-dlp: ${has ? "available (" + bin + ")" : "MISSING - install binary"}`);
  console.log(`[server] health check: http://localhost:${PORT}/api/health`);
});

