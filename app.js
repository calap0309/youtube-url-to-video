(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const urlInput = $("#urlInput");
  const pasteBtn = $("#pasteBtn");
  const clearBtn = $("#clearBtn");
  const convertBtn = $("#convertBtn");
  const previewCard = $("#previewCard");
  const thumbImg = $("#thumbImg");
  const videoTitle = $("#videoTitle");
  const videoMeta = $("#videoMeta");
  const downloadBtn = $("#downloadBtn");
  const openBtn = $("#openBtn");
  const statusLine = $("#statusLine");
  const progressWrap = $("#progressWrap");
  const progressFill = $("#progressFill");
  const progressText = $("#progressText");
  const errorBox = $("#errorBox");
  const toastEl = $("#toast");

  // Backend (same domain: /api/* on Vercel, Render, VPS, or localhost)
  const BACKEND_BASE = "";
  const INVIDIOUS_INSTANCES = [
    "https://inv.tux.pizza",
    "https://invidious.nerdvpn.de",
    "https://invidious.drgns.space",
    "https://yewtu.be",
  ];
  // Self-hosted Cobalt on Vercel (no JWT, no Turnstile) + public fallbacks
  const COBALT_INSTANCES = [
    "/api/cobalt",
    "https://co.wuk.sh",
  ];

  let backendAvailable = null; // null=unknown, true/false cached
  let currentUrl = "";
  let currentTitle = "video";
  let isBusy = false;

  // --- helpers ---

  function showToast(msg, type) {
    toastEl.textContent = msg;
    toastEl.className = "toast" + (type ? " " + type : "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toastEl.className = "toast hidden";
    }, 3000);
  }

  function setStatus(msg, type) {
    statusLine.textContent = msg || "";
    statusLine.className = "status-line" + (type ? " " + type : "");
  }

  function showError(html) {
    errorBox.innerHTML = html;
    errorBox.className = "error-box";
    errorBox.classList.remove("hidden");
  }

  function showSuccess(html) {
    errorBox.innerHTML = html;
    errorBox.className = "success-box";
    errorBox.classList.remove("hidden");
  }

  function hideError() {
    errorBox.className = "error-box hidden";
    errorBox.innerHTML = "";
  }

  function showProgress(text, pct) {
    progressWrap.classList.remove("hidden");
    progressText.textContent = text || "";
    if (typeof pct === "number") progressFill.style.width = pct + "%";
  }

  function hideProgress() {
    progressWrap.classList.add("hidden");
    progressFill.style.width = "0%";
  }

  function toggleClearBtn() {
    const has = urlInput.value.trim().length > 0;
    clearBtn.classList.toggle("hidden", !has);
  }

  function normalizeUrl(raw) {
    let u = raw.trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  function isYouTubeUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      const validHosts = [
        "youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "m.youtube.com",
        "music.youtube.com",
      ];
      const isHostValid = validHosts.some((h) => host === h || host.endsWith("." + h));
      if (!isHostValid) return false;
      if (host.includes("youtu.be")) return parsed.pathname.length > 1;
      return true;
    } catch {
      return false;
    }
  }

  function extractVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) {
        const id = u.pathname.split("/")[1];
        return (id || "").split("?")[0].split("&")[0];
      }
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?&]+)/);
      if (m) return m[2];
      return null;
    } catch {
      return null;
    }
  }

  function sanitizeFilename(name) {
    return (name || "video")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "video";
  }

  // --- backend detection ---
  async function checkBackend() {
    if (backendAvailable !== null) return backendAvailable;
    if (location.protocol === "file:") {
      backendAvailable = false;
      return false;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const resp = await fetch(BACKEND_BASE + "/api/health", { signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) {
        backendAvailable = false;
        return false;
      }
      const data = await resp.json().catch(() => ({}));
      if (data && data.ok) {
        backendAvailable = true;
        return true;
      }
      backendAvailable = false;
      return false;
    } catch {
      backendAvailable = false;
      return false;
    }
  }

  // --- preview via backend /api/info -> oEmbed fallback ---

  async function fetchPreview(url) {
    const videoId = extractVideoId(url);
    const thumbFallback = videoId
      ? "https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg"
      : "";

    // 1. Try backend /api/info
    if (await checkBackend()) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const resp = await fetch(BACKEND_BASE + "/api/info?url=" + encodeURIComponent(url), { signal: ctrl.signal });
        clearTimeout(t);
        if (resp.ok) {
          const data = await resp.json();
          return {
            title: data.title || "YouTube Video",
            author: data.author || "",
            thumb: data.thumbnail || thumbFallback,
          };
        }
      } catch (e) {
        console.warn("[preview] backend /api/info failed, trying oEmbed fallback", e);
      }
    }

    // 2. Try YouTube oEmbed (CORS allowed on client side)
    try {
      const oembedUrl = "https://www.youtube.com/oembed?url=" + encodeURIComponent(url) + "&format=json";
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(oembedUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (resp.ok) {
        const data = await resp.json();
        return {
          title: data.title || "YouTube Video",
          author: data.author_name || "",
          thumb: data.thumbnail_url || thumbFallback,
        };
      }
    } catch (e) {
      // ignore
    }

    if (videoId) {
      return {
        title: "YouTube Video (" + videoId + ")",
        author: "",
        thumb: thumbFallback,
      };
    }
    throw new Error("Could not fetch video info. Check the URL.");
  }

  function renderPreview(url, info) {
    currentUrl = url;
    currentTitle = info.title || "video";
    thumbImg.src = info.thumb;
    thumbImg.alt = info.title || "thumbnail";
    videoTitle.textContent = info.title || "YouTube Video";
    videoMeta.textContent = info.author ? "by " + info.author + " · 720p MP4" : "720p MP4 · Ready to download";
    previewCard.classList.remove("hidden");
    setStatus("Ready — tap Download for 720p MP4", "success");
    openBtn.onclick = () => window.open(url, "_blank", "noopener");
    previewCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // --- Invidious fallback extractor ---
  async function requestInvidious(videoId, instanceBase) {
    const endpoint = instanceBase.replace(/\/$/, "") + "/api/v1/videos/" + encodeURIComponent(videoId);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);

    let resp;
    try {
      resp = await fetch(endpoint, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(t);
    }

    if (!resp.ok) throw new Error("Invidious error: " + resp.status);
    const data = await resp.json();
    const streams = Array.isArray(data.formatStreams) ? data.formatStreams : [];

    // Prefer 720p mp4, then any 720p, then highest resolution mp4
    const stream720 = streams.find((s) => (s.qualityLabel || s.quality || "").includes("720") && (s.container === "mp4" || (s.type || "").includes("mp4")))
      || streams.find((s) => (s.qualityLabel || s.quality || "").includes("720"))
      || streams.find((s) => s.container === "mp4" || (s.type || "").includes("mp4"))
      || streams[0];

    if (stream720 && stream720.url) {
      return {
        url: stream720.url,
        filename: sanitizeFilename(data.title || currentTitle) + ".mp4",
      };
    }

    const adaptive = Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : [];
    const adaptiveVideo = adaptive.find((s) => (s.qualityLabel || s.quality || "").includes("720") && (s.container === "mp4" || (s.type || "").includes("mp4")))
      || adaptive.find((s) => s.container === "mp4" || (s.type || "").includes("mp4"));

    if (adaptiveVideo && adaptiveVideo.url) {
      return {
        url: adaptiveVideo.url,
        filename: sanitizeFilename(data.title || currentTitle) + ".mp4",
      };
    }

    throw new Error("No compatible MP4 stream found");
  }

  // --- Cobalt fallback extractor (supports self-hosted /api/cobalt and public instances) ---
  async function requestCobalt(url, instanceBase) {
    const isSelfHosted = instanceBase.startsWith("/");
    const endpoint = isSelfHosted ? instanceBase : instanceBase.replace(/\/$/, "") + "/";
    const payload = {
      url: url,
      videoQuality: "720",
      youtubeVideoCodec: "h264",
      filenamePattern: "basic",
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);

    let resp;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error("Extractor " + resp.status + (text ? ": " + text.slice(0, 100) : ""));
    }

    const data = await resp.json();
    if (data.status === "error") {
      const msg = (data.error && data.error.code) ? data.error.code : JSON.stringify(data.error || data);
      throw new Error(msg);
    }
    if (data.status === "redirect" || data.status === "tunnel") {
      if (!data.url) throw new Error("Extractor returned no URL");
      return { url: data.url, filename: data.filename || sanitizeFilename(currentTitle) + ".mp4" };
    }
    if (data.status === "picker") {
      const items = Array.isArray(data.picker) ? data.picker : [];
      const best = items.find((it) => it.type === "video" && String(it.url).includes("720"))
        || items.find((it) => it.type === "video")
        || items[0];
      if (best && best.url) return { url: best.url, filename: sanitizeFilename(currentTitle) + ".mp4" };
      throw new Error("No format found in picker");
    }
    throw new Error("Unexpected response from extractor");
  }

  async function triggerDownload(directUrl, filename) {
    try {
      const a = document.createElement("a");
      a.href = directUrl;
      a.download = filename;
      a.rel = "noopener";
      a.target = "_blank";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
      return true;
    } catch (e) {
      window.open(directUrl, "_blank", "noopener");
      return true;
    }
  }

  async function handleDownload() {
    if (isBusy || !currentUrl) return;
    if (!isYouTubeUrl(currentUrl)) {
      showError("Invalid YouTube URL. Paste a <code>youtube.com/watch?v=</code> or <code>youtu.be</code> link.");
      return;
    }

    isBusy = true;
    downloadBtn.disabled = true;
    convertBtn.disabled = true;
    hideError();
    showProgress("Resolving 720p stream…", 20);
    setStatus("Requesting 720p MP4…");

    const filename = sanitizeFilename(currentTitle) + ".mp4";
    let downloadSuccess = false;

    // 1. Try backend (Vercel/Render/VPS) — use JSON mode to avoid 0-byte cross-origin 302
    const isBackend = await checkBackend();
    if (isBackend) {
      try {
        showProgress("Resolving stream from server…", 40);
        // Get direct muxed URL via backend JSON (stays same-origin, no 302, then fetch as blob)
        const apiUrl = BACKEND_BASE + "/api/download?url=" + encodeURIComponent(currentUrl) + "&quality=720&json=1";
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const resp = await fetch(apiUrl, { signal: ctrl.signal }).catch(() => null);
        clearTimeout(t);
        if (resp && resp.ok) {
          const data = await resp.json().catch(() => null);
          const directUrl = data && (data.url || data.directUrl);
          if (directUrl && String(directUrl).startsWith("http")) {
            showProgress("Downloading…", 60);
            setStatus("Downloading 720p MP4…");
            // Fetch direct URL as blob (same-origin blob, not 0-byte cross-origin)
            try {
              const blobResp = await fetch(directUrl);
              if (!blobResp.ok) throw new Error(`direct ${blobResp.status}`);
              const blob = await blobResp.blob();
              if (blob.size === 0) throw new Error("empty blob");
              const blobUrl = URL.createObjectURL(blob);
              await triggerDownload(blobUrl, data.filename || filename);
              setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
              showProgress("Done", 100);
              setStatus("Download started: " + (data.filename || filename), "success");
              showToast("Download complete — check downloads", "success");
              showSuccess('Download via server complete! File: <code>' + (data.filename || filename) + '</code> (' + (blob.size/1024/1024).toFixed(1) + ' MB)');
              downloadSuccess = true;
              hideProgress();
              isBusy = false;
              downloadBtn.disabled = false;
              convertBtn.disabled = false;
              return;
            } catch (blobErr) {
              console.warn("[download] blob fetch failed, falling back to direct link", blobErr);
              // Fallback to direct link via <a> (off-domain but better than 0-byte)
              await triggerDownload(directUrl, data.filename || filename);
              showProgress("Done", 100);
              setStatus("Download started: " + (data.filename || filename), "success");
              showToast("Download started — check downloads", "success");
              showSuccess('Download started! If not, <a href="' + directUrl + '" target="_blank" rel="noopener">click here</a>.');
              downloadSuccess = true;
              hideProgress();
              isBusy = false;
              downloadBtn.disabled = false;
              convertBtn.disabled = false;
              return;
            }
          }
        }
      } catch (e) {
        console.warn("[download] backend json failed:", e);
      }
    }

    // 2. Fallback: Public Invidious & Cobalt extractors
    const videoId = extractVideoId(currentUrl);

    // A. Invidious format streams
    if (videoId && !downloadSuccess) {
      for (let i = 0; i < INVIDIOUS_INSTANCES.length; i++) {
        const inst = INVIDIOUS_INSTANCES[i];
        try {
          showProgress("Checking " + new URL(inst).hostname + "…", 45 + i * 10);
          const result = await requestInvidious(videoId, inst);
          if (result && result.url) {
            showProgress("Starting download…", 90);
            setStatus("Got format — downloading…", "success");
            await triggerDownload(result.url, result.filename);
            showProgress("Done", 100);
            setStatus("Download started: " + result.filename, "success");
            showToast("Download started — check your downloads", "success");
            showSuccess(
              'Download started via stream. If needed, <a href="' + result.url + '" target="_blank" rel="noopener" download="' + result.filename + '">click here to download directly</a>.'
            );
            downloadSuccess = true;
            break;
          }
        } catch (e) {
          console.warn("[invidious]", inst, e.message);
        }
      }
    }

    // B. Cobalt instances
    if (!downloadSuccess) {
      for (let i = 0; i < COBALT_INSTANCES.length; i++) {
        const inst = COBALT_INSTANCES[i];
        try {
          showProgress("Trying " + inst.replace("https://", "") + "…", 70 + i * 10);
          const result = await requestCobalt(currentUrl, inst);
          if (result && result.url) {
            showProgress("Starting download…", 90);
            setStatus("Got link — downloading…", "success");
            await triggerDownload(result.url, result.filename);
            showProgress("Done", 100);
            setStatus("Download started: " + result.filename, "success");
            showToast("Download started — check downloads folder", "success");
            showSuccess(
              'Download ready! <a href="' + result.url + '" target="_blank" rel="noopener">Tap here to open direct link</a>.'
            );
            downloadSuccess = true;
            break;
          }
        } catch (e) {
          console.warn("[cobalt]", inst, e.message);
        }
      }
    }

    if (!downloadSuccess) {
      const cleanMsg = "Could not extract direct 720p stream for this video.";
      setStatus(cleanMsg, "error");
      showError(
        cleanMsg + '<br><br>' +
        '<strong>Troubleshooting:</strong><br>' +
        '• Check if the video is public (not private, age-restricted, or members-only)<br>' +
        '• Try opening on YouTube: <a href="' + currentUrl + '" target="_blank" rel="noopener">Watch Video</a>'
      );
      showToast("Download extractor failed", "error");
    }

    hideProgress();
    isBusy = false;
    downloadBtn.disabled = false;
    convertBtn.disabled = false;
  }


  async function handlePreview() {
    const raw = urlInput.value.trim();
    if (!raw) {
      showToast("Paste a YouTube URL first", "error");
      urlInput.focus();
      return;
    }
    const url = normalizeUrl(raw);
    if (!isYouTubeUrl(url)) {
      showError("Not a YouTube URL. Use <code>youtube.com/watch?v=ID</code> or <code>youtu.be/ID</code> or <code>youtube.com/shorts/ID</code>");
      showToast("Invalid YouTube URL", "error");
      return;
    }

    hideError();
    previewCard.classList.add("hidden");
    setStatus("Loading preview…");
    showProgress("Fetching video info…", 40);
    convertBtn.disabled = true;
    convertBtn.textContent = "Loading…";

    try {
      const info = await fetchPreview(url);
      renderPreview(url, info);
      hideProgress();
      showToast("Preview ready — tap Download", "success");
    } catch (e) {
      const msg = e.message || "Could not load preview";
      const vid = extractVideoId(url);
      showError(msg + (vid ? '<br>Thumb fallback: <code>https://img.youtube.com/vi/' + vid + '/hqdefault.jpg</code>' : ""));
      showToast(msg, "error");
      // Still allow download attempt even if preview failed
      currentUrl = url;
      currentTitle = "video-" + (vid || Date.now());
      thumbImg.src = vid ? "https://img.youtube.com/vi/" + vid + "/hqdefault.jpg" : "";
      videoTitle.textContent = currentTitle;
      videoMeta.textContent = "720p MP4 · Ready to download";
      previewCard.classList.remove("hidden");
      setStatus("Preview fallback loaded — tap Download", "success");
      hideProgress();
    } finally {
      convertBtn.disabled = false;
      convertBtn.textContent = "Preview Video";
    }
  }

  // --- wiring ---

  urlInput.addEventListener("input", () => {
    toggleClearBtn();
    hideError();
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handlePreview();
  });

  // Auto-preview on paste
  urlInput.addEventListener("paste", () => {
    setTimeout(() => {
      toggleClearBtn();
      if (urlInput.value.trim()) handlePreview();
    }, 50);
  });

  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        toggleClearBtn();
        handlePreview();
      }
    } catch {
      urlInput.focus();
      showToast("Paste with Ctrl+V / long-press → Paste", "error");
    }
  });

  clearBtn.addEventListener("click", () => {
    urlInput.value = "";
    toggleClearBtn();
    previewCard.classList.add("hidden");
    hideError();
    hideProgress();
    setStatus("");
    currentUrl = "";
    urlInput.focus();
  });

  convertBtn.addEventListener("click", handlePreview);
  downloadBtn.addEventListener("click", handleDownload);

  // Support ?url= prefill for sharing
  (function prefillFromQuery() {
    const q = new URLSearchParams(location.search);
    const pre = q.get("url") || q.get("v");
    if (pre) {
      urlInput.value = pre.includes("http") ? pre : "https://www.youtube.com/watch?v=" + pre;
      toggleClearBtn();
      handlePreview();
    }
  })();

  // Backend badge
  (function updateBackendBadge() {
    const badge = document.getElementById("backendBadge");
    if (!badge) return;
    checkBackend().then((ok) => {
      if (ok) {
        badge.textContent = "✓ Server ready";
        badge.className = "badge badge-accent";
        badge.title = "Backend API connected";
      } else {
        badge.textContent = "Direct fallback";
        badge.className = "badge";
        badge.title = "Client fallback mode";
      }
    });
  })();

  window.__ytv = { isYouTubeUrl, extractVideoId, normalizeUrl, sanitizeFilename, checkBackend };
})();

