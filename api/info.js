"use strict";
const { setCors, isYouTubeUrl, runYtDlp } = require("./_lib");

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const url = (req.query.url || "").toString().trim();
  if (!url) return res.status(400).json({ error: "Missing ?url=" });
  if (!isYouTubeUrl(url)) return res.status(400).json({ error: "Not a YouTube URL" });

  let vid = "";
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      vid = u.pathname.split("/")[1]?.split("?")[0]?.split("&")[0] || "";
    } else {
      vid = u.searchParams.get("v") || u.pathname.match(/\/(shorts|embed|live)\/([^/?&]+)/)?.[2] || "";
    }
  } catch {}

  const thumbFallback = vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : "";

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
    if (!thumb && (data.id || vid)) thumb = `https://img.youtube.com/vi/${data.id || vid}/hqdefault.jpg`;
    return res.json({
      id: data.id || vid,
      title: data.title || "YouTube Video",
      author: data.uploader || data.channel || "",
      duration: data.duration || null,
      thumbnail: thumb || thumbFallback,
      url,
      formats: (data.formats || []).slice(0, 5).map((f) => ({
        height: f.height, ext: f.ext, vcodec: f.vcodec, acodec: f.acodec, format_id: f.format_id,
      })),
    });
  } catch (e) {
    console.warn("[/api/info] yt-dlp info failed, attempting oEmbed fallback:", e.message || e);
    // Fallback: try YouTube oEmbed to get title and author
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const resp = await fetch(oembedUrl);
      if (resp.ok) {
        const odata = await resp.json();
        return res.json({
          id: vid,
          title: odata.title || "YouTube Video",
          author: odata.author_name || "",
          thumbnail: odata.thumbnail_url || thumbFallback,
          url,
          fallback: true,
        });
      }
    } catch {}

    if (vid) {
      return res.json({
        id: vid,
        title: `YouTube Video (${vid})`,
        author: "",
        thumbnail: thumbFallback,
        url,
        fallback: true,
      });
    }

    return res.status(500).json({ error: (e.stderr || e.message || "Failed to get video info").toString().slice(0, 500) });
  }
};

