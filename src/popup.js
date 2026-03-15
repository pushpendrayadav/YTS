// popup.js — handles all popup UI logic with 4 providers, caching, chunking, onboarding

let currentProvider = "groq";
let videoData = null;
let ollamaHealthy = false;
let cachedSummary = null;
let currentVideoId = null;

const CACHE_EXPIRY_DAYS = 30;

const MODELS = {
  groq: [
    {
      value: "llama-3.1-8b-instant",
      label: "llama-3.1-8b-instant (Recommended)",
    },
    {
      value: "llama-3.3-70b-versatile",
      label: "llama-3.3-70b-versatile (Best quality)",
    },
    {
      value: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "llama-4-scout (Latest)",
    },
    { value: "qwen/qwen3-32b", label: "qwen3-32b (Strong reasoning)" },
  ],
  ollama: [
    { value: "phi3:mini", label: "phi3:mini (Recommended)" },
    { value: "llama3.2:3b", label: "llama3.2:3b (Lightweight)" },
    { value: "llama3.2:1b", label: "llama3.2:1b (Fastest)" },
    { value: "llama3.1:8b", label: "llama3.1:8b (Best quality)" },
    { value: "mistral:7b", label: "mistral:7b (Great for summaries)" },
    { value: "gemma2:9b", label: "gemma2:9b (Highest quality)" },
  ],
  claude: [
    {
      value: "claude-sonnet-4-20250514",
      label: "claude-sonnet-4 (Recommended)",
    },
    { value: "claude-opus-4-20250514", label: "claude-opus-4 (Most Capable)" },
    { value: "claude-haiku-4-5-20251001", label: "claude-haiku-4.5 (Fastest)" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o (Recommended)" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini (Fastest)" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo (Most capable)" },
  ],
};

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const onboardingDone = await checkOnboardingComplete();
    if (!onboardingDone) {
      const container = document.getElementById("onboarding-screen");
      renderOnboarding(container);
      setupSettingsBtn();
      return;
    }
    await initMainUI();
  } catch (err) {
    console.error("Popup init error:", err);
  }
});

/** Called after onboarding completes or on normal load */
async function initMainUI() {
  // Restore last provider
  const stored = await chrome.storage.local.get(["lastProvider"]);
  if (stored.lastProvider && MODELS[stored.lastProvider]) {
    currentProvider = stored.lastProvider;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isYouTube = tab?.url?.includes("youtube.com/watch");

  if (!isYouTube) {
    document.getElementById("onboarding-screen").style.display = "none";
    document.getElementById("notYoutube").style.display = "block";
    document.getElementById("mainUI").style.display = "none";
    setupSettingsBtn();
    return;
  }

  document.getElementById("onboarding-screen").style.display = "none";
  document.getElementById("notYoutube").style.display = "none";
  document.getElementById("mainUI").style.display = "block";
  document.getElementById("videoInfo").style.display = "block";

  const title = tab.title?.replace(" - YouTube", "") || "YouTube Video";
  document.getElementById("videoTitle").textContent = title;

  // Set active tab
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  const activeTab = document.querySelector(
    `.tab[data-provider="${currentProvider}"]`,
  );
  if (activeTab) activeTab.classList.add("active");

  updateModelOptions();
  setupListeners();

  // Check Ollama health (non-blocking)
  checkOllamaHealth();

  await updateKeyStatus();

  // Check cache for current video
  const videoIdMatch = tab.url.match(/v=([a-zA-Z0-9_-]{11})/);
  currentVideoId = videoIdMatch ? videoIdMatch[1] : null;
  if (currentVideoId) {
    await checkCache(currentVideoId);
  }
}

function setupSettingsBtn() {
  const btn = document.getElementById("settingsBtn");
  if (btn)
    btn.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

function setupListeners() {
  // Provider tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentProvider = tab.dataset.provider;
      await chrome.storage.local.set({ lastProvider: currentProvider });
      updateModelOptions();
      await updateKeyStatus();
      if (currentProvider === "ollama") await checkOllamaHealth();
    });
  });

  setupSettingsBtn();

  // Key link
  const keyLink = document.getElementById("keyLink");
  if (keyLink) {
    keyLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (currentProvider === "groq") {
        window.open("https://console.groq.com", "_blank");
      } else {
        chrome.runtime.openOptionsPage();
      }
    });
  }

  // Generate button
  document.getElementById("generateBtn").addEventListener("click", generate);

  // Copy error link
  document.getElementById("errorBox").addEventListener("click", (e) => {
    if (e.target.classList.contains("copy-err")) {
      const errText =
        document.getElementById("errorBox").dataset.errorMsg || "";
      navigator.clipboard.writeText(errText);
      e.target.textContent = "Copied!";
      setTimeout(() => {
        e.target.textContent = "Copy error";
      }, 1500);
    }
  });

  // Listen for chunk progress from background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "chunkProgress") {
      const generateBtn = document.getElementById("generateBtn");
      setProgress((msg.current / (msg.total + 1)) * 100, msg.message);
      if (msg.stage === "waiting" || msg.stage === "ratelimit") {
        generateBtn.textContent = msg.message;
      } else if (msg.stage === "estimate") {
        // Show estimate but don't change button
      } else {
        generateBtn.textContent = `Summarizing... (${msg.current} of ${msg.total})`;
      }
    }
  });
}

function updateModelOptions() {
  const select = document.getElementById("modelSelect");
  const models = MODELS[currentProvider] || [];

  // If Ollama, check for custom yt-summarizer model
  let opts = models;
  if (currentProvider === "ollama" && ollamaHealthy) {
    // We'll prepend custom model option if needed (checked during health check)
  }

  select.innerHTML = opts
    .map((m) => `<option value="${m.value}">${m.label}</option>`)
    .join("");
}

async function updateKeyStatus() {
  const keyStatusDiv = document.getElementById("keyStatus");
  const providerFooter = document.getElementById("providerFooter");
  const ollamaOffline = document.getElementById("ollamaOffline");
  const btn = document.getElementById("generateBtn");

  ollamaOffline.style.display = "none";

  if (currentProvider === "ollama") {
    keyStatusDiv.style.display = "none";
    providerFooter.style.display = "block";
    btn.disabled = !ollamaHealthy;
    if (!ollamaHealthy) {
      ollamaOffline.style.display = "block";
    }
    updateBtnLabel();
    return;
  }

  // Groq / Claude / OpenAI — show key status
  keyStatusDiv.style.display = "flex";
  providerFooter.style.display = "none";

  const keyMap = { groq: "groqKey", claude: "claudeKey", openai: "openaiKey" };
  const keyName = keyMap[currentProvider];
  const settings = await chrome.storage.sync.get([keyName]);
  const key = settings[keyName];
  const dot = document.getElementById("keyDot");
  const statusText = document.getElementById("keyStatusText");
  const link = document.getElementById("keyLink");

  if (currentProvider === "groq") {
    if (key && key.length > 5) {
      dot.className = "key-dot set";
      statusText.textContent = "Groq key set — ~100 free summaries/day";
      link.textContent = "Settings →";
      link.href = "#";
      btn.disabled = false;
    } else {
      dot.className = "key-dot missing";
      statusText.textContent = "No Groq key — get free key at console.groq.com";
      link.textContent = "Get free key →";
      link.href = "#";
      btn.disabled = true;
    }
  } else {
    if (key && key.length > 10) {
      dot.className = "key-dot set";
      statusText.textContent = `API key set (${key.slice(0, 8)}...)`;
      link.textContent = "Settings →";
      btn.disabled = false;
    } else {
      dot.className = "key-dot missing";
      statusText.textContent = "No API key set";
      link.textContent = "Set key →";
      btn.disabled = true;
    }
  }

  updateBtnLabel();
}

function updateBtnLabel() {
  const btn = document.getElementById("generateBtn");
  if (cachedSummary) {
    btn.textContent = "Download cached summary";
  } else {
    btn.textContent = "Generate summary.md";
  }
}

async function checkOllamaHealth() {
  const statusEl = document.getElementById("ollamaStatus");
  if (statusEl) {
    statusEl.textContent = "●";
    statusEl.className = "ollama-badge checking";
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: "checkOllamaHealth",
    });
    if (response?.data?.running) {
      ollamaHealthy = true;
      if (statusEl) {
        statusEl.textContent = "●";
        statusEl.className = "ollama-badge healthy";
        statusEl.title = `Ollama running (${response.data.models.length} models)`;
      }

      // Check if yt-summarizer custom model exists
      if (response.data.models.some((m) => m.includes("yt-summarizer"))) {
        const models = MODELS.ollama;
        if (!models.find((m) => m.value === "yt-summarizer")) {
          models.unshift({
            value: "yt-summarizer",
            label: "yt-summarizer (custom)",
          });
        }
      }
    } else {
      ollamaHealthy = false;
      if (statusEl) {
        statusEl.textContent = "●";
        statusEl.className = "ollama-badge unhealthy";
        statusEl.title = "Ollama not running";
      }
    }
  } catch (_) {
    ollamaHealthy = false;
    if (statusEl) {
      statusEl.textContent = "●";
      statusEl.className = "ollama-badge unhealthy";
      statusEl.title = "Ollama not reachable";
    }
  }

  if (currentProvider === "ollama") {
    document.getElementById("generateBtn").disabled = !ollamaHealthy;
    const offlineEl = document.getElementById("ollamaOffline");
    if (offlineEl) offlineEl.style.display = ollamaHealthy ? "none" : "block";
  }
}

// ─── Cache ──────────────────────────────────────────────

async function checkCache(videoId) {
  const key = `cache_${videoId}`;
  const data = await chrome.storage.local.get([key]);
  const entry = data[key];
  if (!entry) {
    cachedSummary = null;
    updateBtnLabel();
    return;
  }

  // Check expiry
  if (entry.date) {
    const cached = new Date(entry.date);
    const now = new Date();
    const diffDays = (now - cached) / (1000 * 60 * 60 * 24);
    if (diffDays > CACHE_EXPIRY_DAYS) {
      await chrome.storage.local.remove([key]);
      cachedSummary = null;
      updateBtnLabel();
      return;
    }
  }

  cachedSummary = entry;
  document.getElementById("cacheIndicator").style.display = "block";
  updateBtnLabel();
}

// ─── Generate ───────────────────────────────────────────

async function generate() {
  const btn = document.getElementById("generateBtn");
  const progress = document.getElementById("progress");
  const errorBox = document.getElementById("errorBox");
  const successBox = document.getElementById("successBox");
  const cacheIndicator = document.getElementById("cacheIndicator");

  // Reset UI
  errorBox.style.display = "none";
  successBox.style.display = "none";

  // If cached, just download
  if (cachedSummary && cachedSummary.summary) {
    const now = new Date().toISOString().split("T")[0];
    const filename = `summary_${sanitizeFilename(cachedSummary.title || "video")}_${now}.md`;
    downloadMarkdown(cachedSummary.summary, filename);
    successBox.style.display = "block";
    // Reset for next click
    btn.textContent = "Done! Generate again?";
    cachedSummary = null;
    cacheIndicator.style.display = "none";
    setTimeout(() => {
      btn.textContent = "Generate summary.md";
    }, 3000);
    return;
  }

  btn.disabled = true;
  progress.style.display = "block";
  cacheIndicator.style.display = "none";

  try {
    // Check network
    if (!navigator.onLine) throw new Error("No internet connection.");

    // Step 1: Extract transcript
    setProgress(10, "Extracting transcript...");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    let transcriptResult;
    try {
      transcriptResult = await chrome.tabs.sendMessage(tab.id, {
        action: "getTranscript",
      });
    } catch (err) {
      if (err.message.includes("Could not establish connection")) {
        throw new Error(
          "Content script not loaded. Please reload the YouTube page and try again.",
        );
      }
      throw err;
    }
    if (!transcriptResult?.success)
      throw new Error(
        transcriptResult?.error || "Transcript extraction failed",
      );

    const { title, channel, url, transcript } = transcriptResult.data;
    if (!transcript || transcript.length === 0)
      throw new Error("Transcript appears empty. Try again.");

    const videoIdMatch = url.match(/v=([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    document.getElementById("videoTitle").textContent = title;
    if (document.getElementById("videoChannel")) {
      document.getElementById("videoChannel").textContent = channel;
    }

    // Step 2: Send to background for cleaning, chunking, and AI calls
    setProgress(20, "Cleaning transcript...");

    // Build raw transcript text from segments
    const rawTranscript = transcript.map((seg) => seg.text).join(" ");
    if (!rawTranscript.trim())
      throw new Error("Transcript appears empty. Try again.");

    const wordCount = rawTranscript.split(/\s+/).filter(Boolean).length;

    const settings = await chrome.storage.sync.get([
      "groqKey",
      "claudeKey",
      "openaiKey",
    ]);
    const keyMap = {
      groq: "groqKey",
      claude: "claudeKey",
      openai: "openaiKey",
    };
    const apiKey = settings[keyMap[currentProvider]] || "";
    const model = document.getElementById("modelSelect").value;

    setProgress(30, `Calling ${providerLabel()}...`);
    btn.textContent = "Summarizing...";

    // Background handles cleaning, chunking, delays, and all AI calls
    const aiResult = await chrome.runtime.sendMessage({
      action: "callAI",
      payload: {
        provider: currentProvider,
        apiKey,
        model,
        rawTranscript,
        videoMeta: { title, channel, url },
      },
    });
    if (!aiResult.success) throw new Error(aiResult.error);
    const finalSummaryText = aiResult.result;

    // Step 3: Build final markdown with YAML front matter
    setProgress(90, "Preparing download...");
    const now = new Date().toISOString().split("T")[0];
    const durationMin = Math.round(wordCount / 150); // rough speaking rate
    const finalMarkdown = `---
title: "${title}"
channel: "${channel}"
url: ${url}
date: ${now}
provider: ${currentProvider} / ${model}
duration: ~${durationMin} min video
---

# ${title}

> *${channel} — summarized by YT Summarizer*

${finalSummaryText}

---
*Generated by YT Summarizer Chrome Extension*
*${currentProvider} / ${model} · ${now}*`;

    // Cache
    if (videoId) {
      await chrome.storage.local.set({
        [`cache_${videoId}`]: {
          summary: finalMarkdown,
          title,
          channel,
          date: now,
          provider: currentProvider,
          model,
        },
      });
    }

    const filename = `summary_${sanitizeFilename(title)}_${now}.md`;
    downloadMarkdown(finalMarkdown, filename);

    setProgress(100, "Done!");
    btn.textContent = "Done! Generate again?";
    setTimeout(() => {
      progress.style.display = "none";
      successBox.style.display = "block";
      btn.disabled = false;
      setTimeout(() => {
        btn.textContent = "Generate summary.md";
      }, 3000);
    }, 600);
  } catch (err) {
    progress.style.display = "none";
    const msg = err.message || "Unknown error";
    errorBox.innerHTML = `Error: ${escapeHtml(msg)}<br><span class="copy-err">Copy error</span>`;
    errorBox.dataset.errorMsg = msg;
    errorBox.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Generate summary.md";
  }
}

// ─── Helpers ────────────────────────────────────────────

function providerLabel() {
  const labels = {
    groq: "Groq",
    ollama: "Ollama",
    claude: "Claude",
    openai: "OpenAI",
  };
  return labels[currentProvider] || currentProvider;
}

function setProgress(pct, text) {
  const bar = document.getElementById("progressBar");
  const txt = document.getElementById("progressText");
  if (bar) bar.style.width = pct + "%";
  if (txt) txt.textContent = text;
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 60);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
