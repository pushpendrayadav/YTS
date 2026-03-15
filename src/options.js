// options.js — Settings page: Groq + Claude + OpenAI keys, Modelfile copy, cache management

const CACHE_EXPIRY_DAYS = 30;

document.addEventListener("DOMContentLoaded", async () => {
  // Load saved keys
  const settings = await chrome.storage.sync.get([
    "groqKey",
    "claudeKey",
    "openaiKey",
  ]);
  if (settings.groqKey)
    document.getElementById("groqKey").value = settings.groqKey;
  if (settings.claudeKey)
    document.getElementById("claudeKey").value = settings.claudeKey;
  if (settings.openaiKey)
    document.getElementById("openaiKey").value = settings.openaiKey;

  // Toggle visibility buttons
  document.querySelectorAll(".toggle-vis").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === "password" ? "text" : "password";
    });
  });

  // Copy Modelfile button
  const copyBtn = document.getElementById("copyModelfileBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const content = document.getElementById("modelfileContent");
      navigator.clipboard.writeText(content.textContent).then(() => {
        const msg = document.getElementById("modelfileCopyMsg");
        msg.style.display = "inline";
        setTimeout(() => {
          msg.style.display = "none";
        }, 2000);
      });
    });
  }

  // Save button
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const groqKey = document.getElementById("groqKey").value.trim();
    const claudeKey = document.getElementById("claudeKey").value.trim();
    const openaiKey = document.getElementById("openaiKey").value.trim();

    await chrome.storage.sync.set({ groqKey, claudeKey, openaiKey });

    const msg = document.getElementById("saveMsg");
    msg.classList.add("show");
    setTimeout(() => msg.classList.remove("show"), 2500);
  });

  // Load and display cache stats (also cleans expired entries)
  await updateCacheStats();

  // Clear cache button
  document
    .getElementById("clearCacheBtn")
    .addEventListener("click", async () => {
      const confirmed = confirm(
        "Delete all cached summaries? This cannot be undone.",
      );
      if (!confirmed) return;

      const allStorage = await chrome.storage.local.get(null);
      const cacheKeys = Object.keys(allStorage).filter((k) =>
        k.startsWith("cache_"),
      );
      if (cacheKeys.length > 0) await chrome.storage.local.remove(cacheKeys);

      document.getElementById("cacheSize").textContent = "0 summaries (0 KB)";
      document.getElementById("clearCacheBtn").disabled = true;
    });
});

async function updateCacheStats() {
  const allStorage = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(allStorage).filter((k) =>
    k.startsWith("cache_"),
  );

  // Clean expired entries
  const now = new Date();
  const expired = [];
  cacheKeys.forEach((k) => {
    const entry = allStorage[k];
    if (entry && entry.date) {
      const diffDays = (now - new Date(entry.date)) / (1000 * 60 * 60 * 24);
      if (diffDays > CACHE_EXPIRY_DAYS) expired.push(k);
    }
  });
  if (expired.length > 0) await chrome.storage.local.remove(expired);

  const validKeys = cacheKeys.filter((k) => !expired.includes(k));
  let totalBytes = 0;
  validKeys.forEach((k) => {
    const value = allStorage[k];
    totalBytes += new Blob([JSON.stringify(value)]).size;
  });

  const kbSize = (totalBytes / 1024).toFixed(1);
  const displaySize = totalBytes > 1024 ? `${kbSize} KB` : `${totalBytes} B`;
  const count = validKeys.length;
  document.getElementById("cacheSize").textContent =
    `${count} ${count === 1 ? "summary" : "summaries"} (${displaySize})`;
  document.getElementById("clearCacheBtn").disabled = count === 0;
}
