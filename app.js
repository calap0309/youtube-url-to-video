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

  // Backend (same domain, VPS) + Cobalt fallback (github.io / when backend down)
  const BACKEND_BASE = ""; // same origin: /api/* (VPS: https://yourdomain.com/api/*)
  const COBALT_INSTANCES = [
    "https://api.cobalt.tools",
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
    errorBox.classList.remove("hidden");
  }

  function hideError() {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
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
      const path = parsed.pathname;
      // allow youtube.com, youtu.be, youtube-nocookie.com, music.youtube.com, m.youtube.com
      const validHosts = [
        "youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "m.youtube.com",
        "music.youtube.com",
      ];
      const isHostValid = validHosts.some((h) => host === h || host.endsWith("." + h));
      if (!isHostValid) return false;
      // Basic path check: watch, shorts, embed, live, youtu.be/<id>
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
    return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "video";
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
      const t = setTimeout(() => ctrl.abort(), 2500);
      const resp = await fetch(BACKEND_BASE + "/api/health", { signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) {
        backendAvailable = false;
        return false;
      }
      const data = await resp.json().catch(() => ({}));
      // Vercel has no python3/yt-dlp — treat as not available so we fallback to Cobalt quickly
      if (data.hasYtDlp === false) {
        backendAvailable = false;
        return false;
      }
      backendAvailable = true;
      return true;
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

    // 1. Try backend /api/info (VPS) - has real title/thumbnail/duration
    if (await checkBackend()) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
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
        // fall through to oEmbed
        console.warn("[preview] backend failed, falling back to oEmbed", e);
      }
    }

    // 2. Try oEmbed (no key, CORS allowed) - works on github.io
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
      // ignore, fallback to thumbnail
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
    currentTitle = info.title;
    thumbImg.src = info.thumb;
    thumbImg.alt = info.title;
    videoTitle.textContent = info.title;
    videoMeta.textContent = info.author ? "by " + info.author + " · 720p MP4" : "720p MP4 · Ready to download";
    previewCard.classList.remove("hidden");
    setStatus("Ready — tap Download for 720p MP4", "success");
    openBtn.onclick = () => window.open(url, "_blank", "noopener");
    // scroll into view on mobile
    previewCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // --- Backend download helpers ---

  async function requestBackendDownload(url) {
    // Option 1: try /api/url to get direct URL (no server bandwidth)
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(BACKEND_BASE + "/api/url?url=" + encodeURIComponent(url), { signal: ctrl.signal });
      clearTimeout(t);
      if (resp.ok) {
        const data = await resp.json();
        if (data.url && String(data.url).startsWith("http")) {
          return { url: data.url, filename: sanitizeFilename(currentTitle) + ".mp4", via: "backend-url" };
        }
      }
    } catch (e) {
      console.warn("[backend] /api/url failed", e);
    }
    // Option 2: use streaming endpoint directly - return its URL for <a href>
    // Browser will download via server pipe (uses server bandwidth but reliable)
    const streamUrl = BACKEND_BASE + "/api/download?url=" + encodeURIComponent(url) + "&quality=720";
    return { url: streamUrl, filename: sanitizeFilename(currentTitle) + ".mp4", via: "backend-stream" };
  }

  // --- Cobalt download ---

  async function requestCobalt(url, instanceBase) {
    const endpoint = instanceBase.replace(/\/$/, "") + "/";
    // Cobalt API 10+ uses JSON with url + videoQuality
    const payload = {
      url: url,
      videoQuality: "720",
      youtubeVideoCodec: "h264",
      filenamePattern: "basic",
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);

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
      throw new Error("Extractor " + resp.status + (text ? ": " + text.slice(0, 120) : ""));
    }

    const data = await resp.json();
    // Cobalt statuses: redirect, tunnel, picker, error
    if (data.status === "error") {
      const msg = (data.error && data.error.code) ? data.error.code : JSON.stringify(data.error || data);
      throw new Error(mapCobaltError(msg));
    }
    if (data.status === "redirect" || data.status === "tunnel") {
      if (!data.url) throw new Error("Extractor returned no URL");
      return { url: data.url, filename: data.filename || sanitizeFilename(currentTitle) + ".mp4" };
    }
    if (data.status === "picker") {
      // picker = multiple items, pick 720p mp4 if available
      const items = Array.isArray(data.picker) ? data.picker : [];
      const best = items.find((it) => it.type === "video" && String(it.url).includes("720"))
        || items.find((it) => it.type === "video")
        || items[0];
      if (best && best.url) return { url: best.url, filename: sanitizeFilename(currentTitle) + ".mp4" };
      throw new Error("No downloadable format found (picker empty)");
    }
    throw new Error("Unexpected extractor response: " + (data.status || "unknown"));
  }

  function mapCobaltError(code) {
    const map = {
      "error.api.youtube.noVideoInfo": "YouTube blocked extractor — try again in a minute",
      "error.api.youtube.loginRequired": "This video requires login / age verification and can't be downloaded here",
      "error.api.youtube.privateVideo": "Private video — can't download",
      "error.api.youtube.premiumVideo": "YouTube Premium-only video",
      "error.api.link.unsupported": "Link not supported — use a standard youtube.com/watch or youtu.be URL",
      "error.api.youtube.regionBlocked": "Video blocked in extractor region",
    };
    const key = String(code).toLowerCase();
    for (const k in map) {
      if (key.includes(k.toLowerCase()) || key.includes(k.split(".").pop())) return map[k];
    }
    // generic
    if (key.includes("rate")) return "Extractor rate-limited — wait 30s and retry";
    return "Extractor error: " + code;
  }

  async function triggerDownload(directUrl, filename) {
    // Try blob fetch for true download attribute (works on desktop + Android)
    // Fallback to window.open for iOS where blob may OOM on large files
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) {
      try {
        showProgress("Downloading…", 60);
        setStatus("Starting download…");
        // Use anchor with href directly - let browser handle streaming
        // We do NOT fetch blob for large videos (can be 100MB+)
        const a = document.createElement("a");
        a.href = directUrl;
        a.download = filename;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
        return true;
      } catch (e) {
        // fallback to open
      }
    }
    // iOS / fallback: open in new tab (user can long-press -> Save Video)
    window.open(directUrl, "_blank", "noopener");
    return true;
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
    showProgress("Contacting extractor (720p)…", 20);
    setStatus("Requesting 720p MP4…");

    // 1. Try backend first (VPS, single domain) - preferred when available
    if (await checkBackend()) {
      try {
        showProgress("Using your server (720p)…", 40);
        const result = await requestBackendDownload(currentUrl);
        showProgress("Got link — starting download…", 90);
        setStatus("Got link — downloading…", "success");
        await triggerDownload(result.url, result.filename);
        showProgress("Done", 100);
        setStatus("Download started via backend: " + result.filename, "success");
        showToast("Download started — check your downloads folder", "success");
        showError(
          'Via your domain (' + result.via + '). If download didn’t start, <a href="' + result.url + '" target="_blank" rel="noopener">tap here to open direct link</a>.'
        );
        errorBox.classList.remove("hidden");
        errorBox.style.background = "#1a2e1a";
        errorBox.style.borderColor = "#2e7d5b";
        errorBox.style.color = "#bff5dd";
        hideProgress();
        isBusy = false;
        downloadBtn.disabled = false;
        convertBtn.disabled = false;
        return;
      } catch (e) {
        console.warn("[download] backend failed, falling back to Cobalt", e);
        setStatus("Backend failed, trying Cobalt…", "error");
        await new Promise((r) => setTimeout(r, 300));
        // fall through to Cobalt
      }
    }

    // 2. Fallback: Cobalt (github.io / backend down)
    let lastErr = null;
    for (let i = 0; i < COBALT_INSTANCES.length; i++) {
      const inst = COBALT_INSTANCES[i];
      try {
        showProgress("Trying " + inst.replace("https://", "") + "…", 30 + i * 20);
        const result = await requestCobalt(currentUrl, inst);
        showProgress("Got link — starting download…", 90);
        setStatus("Got link — downloading…", "success");
        await triggerDownload(result.url, result.filename);
        showProgress("Done", 100);
        setStatus("Download started: " + result.filename, "success");
        showToast("Download started — check your downloads folder", "success");
        // Also show direct link fallback
        showError(
          'If download didn’t start, <a href="' + result.url + '" target="_blank" rel="noopener">tap here to open direct link</a>. ' +
          'On iPhone: long-press → Download Linked File.'
        );
        errorBox.classList.remove("hidden");
        errorBox.style.background = "#1a2e1a";
        errorBox.style.borderColor = "#2e7d5b";
        errorBox.style.color = "#bff5dd";
        break;
      } catch (e) {
        lastErr = e;
        const isAbort = e.name === "AbortError";
        const msg = isAbort ? "Extractor timed out — check connection" : (e.message || "Extractor failed");
        setStatus(msg, "error");
        // Don't retry on login/private errors
        if (/login|private|premium/i.test(msg)) break;
        if (i === COBALT_INSTANCES.length - 1) {
          showError(
            msg + '<br><br>Try:<br>• Check URL is public (not private/live)<br>• Disable ad-block / Private Relay<br>• Wait 30s and retry<br>• Try another video like <code>https://www.youtube.com/watch?v=dQw4w9WgXcQ</code>'
          );
          showToast(msg, "error");
        } else {
          // try next instance
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
      }
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
      showError('Not a YouTube URL. Use <code>youtube.com/watch?v=ID</code> or <code>youtu.be/ID</code> or <code>youtube.com/shorts/ID</code>');
      showToast("Invalid YouTube URL", "error");
      return;
    }

    hideError();
    errorBox.style.background = "";
    errorBox.style.borderColor = "";
    errorBox.style.color = "";
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
      showError(msg + '<br>Thumb fallback: <code>https://img.youtube.com/vi/' + (extractVideoId(url) || "ID") + '/hqdefault.jpg</code>');
      showToast(msg, "error");
      // Still allow download even if preview fails
      currentUrl = url;
      currentTitle = "video-" + (extractVideoId(url) || Date.now());
      thumbImg.src = extractVideoId(url) ? "https://img.youtube.com/vi/" + extractVideoId(url) + "/hqdefault.jpg" : "";
      videoTitle.textContent = currentTitle;
      videoMeta.textContent = "720p MP4 · Preview failed but download may still work";
      previewCard.classList.remove("hidden");
      setStatus("Preview failed — you can still try download", "error");
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
    errorBox.style.background = "";
    errorBox.style.borderColor = "";
    errorBox.style.color = "";
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
      // Fallback: focus input for manual paste (iOS may block readText)
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

  // Backend badge + expose
  (function updateBackendBadge() {
    const badge = document.getElementById("backendBadge");
    if (!badge) return;
    checkBackend().then((ok) => {
      if (ok) {
        badge.textContent = "✓ Your server";
        badge.className = "badge badge-accent";
        badge.title = "Backend /api reachable on this domain";
      } else {
        badge.textContent = "Cobalt fallback";
        badge.className = "badge";
        badge.title = "Backend not found — using Cobalt API (github.io mode)";
      }
    });
  })();

  // expose for tests / console
  window.__ytv = { isYouTubeUrl, extractVideoId, normalizeUrl, sanitizeFilename, checkBackend };
})();
