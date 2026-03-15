// onboarding.js — First-run onboarding flow (renders inside popup)

let _onboardingStep = 1;
let _chosenProvider = null;

async function checkOnboardingComplete() {
  const data = await chrome.storage.local.get("onboardingComplete");
  return data.onboardingComplete === true;
}

async function markOnboardingComplete() {
  await chrome.storage.local.set({ onboardingComplete: true });
}

function detectOS() {
  const p = navigator.platform.toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "windows";
  return "linux";
}

/** Render the onboarding inside the given container, hiding mainUI */
function renderOnboarding(container) {
  container.innerHTML = buildStep1();
  container.style.display = "block";
  const mainUI = document.getElementById("mainUI");
  if (mainUI) mainUI.style.display = "none";
  const notYt = document.getElementById("notYoutube");
  if (notYt) notYt.style.display = "none";

  wireOnboardingListeners(container);
}

function buildStepIndicator(current) {
  return `<div style="text-align:center;margin-bottom:14px;font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:0.1em;">STEP ${current} OF 3</div>`;
}

/* ── STEP 1 ── */
function buildStep1() {
  return `
${buildStepIndicator(1)}
<div style="text-align:center;margin-bottom:16px;">
  <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px;">How would you like to summarize?</div>
</div>
<div style="display:flex;gap:8px;margin-bottom:12px;">
  <div class="ob-card" id="obChooseGroq" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;cursor:pointer;transition:border-color .15s;">
    <div style="font-size:18px;text-align:center;margin-bottom:6px;">Cloud</div>
    <div style="font-family:var(--mono);font-size:11px;font-weight:700;text-align:center;color:var(--text);">Groq</div>
    <div style="font-size:10px;color:var(--muted);text-align:center;margin-top:2px;">Free cloud API. Instant results.</div>
    <div style="margin-top:6px;text-align:center;">
      <span style="font-size:9px;background:rgba(46,196,182,.12);color:var(--success);padding:2px 6px;border-radius:4px;font-family:var(--mono);">No install needed</span>
    </div>
    <div style="font-size:9px;color:var(--muted);text-align:center;margin-top:6px;line-height:1.4;">Get a free API key at console.groq.com<br>~100 summaries/day free forever</div>
  </div>
  <div class="ob-card" id="obChooseOllama" style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;cursor:pointer;transition:border-color .15s;">
    <div style="font-size:18px;text-align:center;margin-bottom:6px;">Local</div>
    <div style="font-family:var(--mono);font-size:11px;font-weight:700;text-align:center;color:var(--text);">Ollama</div>
    <div style="font-size:10px;color:var(--muted);text-align:center;margin-top:2px;">Runs on your computer. 100% private.</div>
    <div style="margin-top:6px;text-align:center;">
      <span style="font-size:9px;background:rgba(46,196,182,.12);color:var(--success);padding:2px 6px;border-radius:4px;font-family:var(--mono);">No API key needed</span>
    </div>
    <div style="font-size:9px;color:var(--muted);text-align:center;margin-top:6px;line-height:1.4;">Requires one-time Ollama install.<br>Unlimited, fully offline.</div>
  </div>
</div>
<div style="text-align:center;">
  <a href="#" id="obSkip" style="font-size:10px;color:var(--muted);font-family:var(--mono);text-decoration:none;">I'll decide later</a>
</div>`;
}

/* ── STEP 2A — Groq ── */
function buildStep2Groq() {
  return `
${buildStepIndicator(2)}
<div style="margin-bottom:12px;">
  <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">Get your free Groq API key</div>
  <ol style="font-size:11px;color:var(--muted);line-height:1.8;padding-left:18px;margin-bottom:12px;">
    <li>Go to console.groq.com &nbsp;<a href="https://console.groq.com" target="_blank" style="color:var(--accent);font-size:10px;font-family:var(--mono);text-decoration:none;">Open →</a></li>
    <li>Sign up free (no credit card)</li>
    <li>Click "API Keys" → "Create API Key"</li>
    <li>Paste your key below:</li>
  </ol>
  <input type="text" id="obGroqKeyInput" placeholder="gsk_..." style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:6px;font-family:var(--mono);font-size:11px;outline:none;" autocomplete="off" />
  <div id="obGroqKeyError" style="font-size:10px;color:var(--accent);margin-top:4px;display:none;"></div>
</div>
<button id="obGroqSave" style="width:100%;padding:10px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;cursor:pointer;">Save & Continue →</button>`;
}

/* ── STEP 2B — Ollama ── */
function buildStep2Ollama() {
  const os = detectOS();
  let installCmd = "curl -fsSL https://ollama.com/install.sh | sh";
  let installNote = "Linux one-liner install";
  if (os === "mac") {
    installCmd = "brew install ollama";
    installNote = "or download from ollama.com";
  }
  if (os === "windows") {
    installCmd = "";
    installNote = "Download installer from ollama.com/download";
  }

  return `
${buildStepIndicator(2)}
<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">Set up Ollama (one-time)</div>

<div style="margin-bottom:10px;">
  <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px;">A — Install Ollama</div>
  ${installCmd ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-family:var(--mono);font-size:10px;color:var(--text);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;"><code>${installCmd}</code><span class="ob-copy" data-cmd="${installCmd}" style="color:var(--accent);cursor:pointer;font-size:9px;">Copy</span></div>` : ""}
  <div style="font-size:9px;color:var(--muted);margin-bottom:4px;">${installNote}</div>
  <a href="https://ollama.com/download" target="_blank" style="font-size:10px;color:var(--accent);font-family:var(--mono);text-decoration:none;">Open ollama.com/download →</a>
  <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:10px;color:var(--muted);cursor:pointer;">
    <input type="checkbox" id="obOllamaInstalled" /> I've installed Ollama
  </label>
</div>

<div id="obOllamaStep2" style="opacity:.4;pointer-events:none;margin-bottom:10px;">
  <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px;">B — Pull model</div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-family:var(--mono);font-size:10px;color:var(--text);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;"><code>ollama pull phi3:mini</code><span class="ob-copy" data-cmd="ollama pull phi3:mini" style="color:var(--accent);cursor:pointer;font-size:9px;">Copy</span></div>
  <div style="font-size:9px;color:var(--muted);margin-bottom:4px;">One-time ~2.3 GB download</div>
  <label style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);cursor:pointer;">
    <input type="checkbox" id="obOllamaModel" /> Model is downloaded
  </label>
</div>

<div id="obOllamaStep3" style="opacity:.4;pointer-events:none;margin-bottom:10px;">
  <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px;">C — Start with CORS</div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-family:var(--mono);font-size:10px;color:var(--text);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;"><code>OLLAMA_ORIGINS=chrome-extension://* ollama serve</code><span class="ob-copy" data-cmd="OLLAMA_ORIGINS=chrome-extension://* ollama serve" style="color:var(--accent);cursor:pointer;font-size:9px;">Copy</span></div>
  <div style="font-size:9px;color:var(--muted);margin-bottom:6px;">Run this in your terminal each time</div>
  <button id="obOllamaCheck" style="width:100%;padding:9px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-family:var(--mono);font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.06em;">Check if Ollama is running →</button>
  <div id="obOllamaCheckResult" style="text-align:center;font-size:10px;margin-top:6px;display:none;"></div>
</div>`;
}

/* ── STEP 3 — Done ── */
function buildStep3() {
  const providerLabel =
    _chosenProvider === "groq" ? "Groq (cloud)" : "Ollama (local)";
  return `
${buildStepIndicator(3)}
<div style="text-align:center;padding:10px 0;">
  <div style="font-size:36px;margin-bottom:8px;">Done</div>
  <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">You're all set!</div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">Provider: ${providerLabel}</div>
  <button id="obStartBtn" style="width:100%;padding:11px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.08em;cursor:pointer;">Start Summarizing →</button>
</div>`;
}

/* ── Event wiring ── */
function wireOnboardingListeners(container) {
  // Step 1 listeners
  const chooseGroq = container.querySelector("#obChooseGroq");
  const chooseOllama = container.querySelector("#obChooseOllama");
  const skip = container.querySelector("#obSkip");

  if (chooseGroq) {
    chooseGroq.addEventListener("click", () => {
      _chosenProvider = "groq";
      _onboardingStep = 2;
      container.innerHTML = buildStep2Groq();
      wireStep2Groq(container);
    });
    chooseGroq.addEventListener("mouseenter", () => {
      chooseGroq.style.borderColor = "var(--accent)";
    });
    chooseGroq.addEventListener("mouseleave", () => {
      chooseGroq.style.borderColor = "var(--border)";
    });
  }
  if (chooseOllama) {
    chooseOllama.addEventListener("click", () => {
      _chosenProvider = "ollama";
      _onboardingStep = 2;
      container.innerHTML = buildStep2Ollama();
      wireStep2Ollama(container);
    });
    chooseOllama.addEventListener("mouseenter", () => {
      chooseOllama.style.borderColor = "var(--accent)";
    });
    chooseOllama.addEventListener("mouseleave", () => {
      chooseOllama.style.borderColor = "var(--border)";
    });
  }
  if (skip) {
    skip.addEventListener("click", async (e) => {
      e.preventDefault();
      await finishOnboarding();
    });
  }

  wireCopyButtons(container);
}

function wireStep2Groq(container) {
  const saveBtn = container.querySelector("#obGroqSave");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const input = container.querySelector("#obGroqKeyInput");
      const errEl = container.querySelector("#obGroqKeyError");
      const key = (input.value || "").trim();
      if (!key || !key.startsWith("gsk_")) {
        errEl.textContent = "Key should start with gsk_";
        errEl.style.display = "block";
        return;
      }
      await chrome.storage.sync.set({ groqKey: key });
      _onboardingStep = 3;
      container.innerHTML = buildStep3();
      wireStep3(container);
    });
  }
}

function wireStep2Ollama(container) {
  const cb1 = container.querySelector("#obOllamaInstalled");
  const cb2 = container.querySelector("#obOllamaModel");
  const step2Div = container.querySelector("#obOllamaStep2");
  const step3Div = container.querySelector("#obOllamaStep3");

  if (cb1) {
    cb1.addEventListener("change", () => {
      if (cb1.checked) {
        step2Div.style.opacity = "1";
        step2Div.style.pointerEvents = "auto";
      } else {
        step2Div.style.opacity = ".4";
        step2Div.style.pointerEvents = "none";
      }
    });
  }
  if (cb2) {
    cb2.addEventListener("change", () => {
      if (cb2.checked && cb1 && cb1.checked) {
        step3Div.style.opacity = "1";
        step3Div.style.pointerEvents = "auto";
      } else {
        step3Div.style.opacity = ".4";
        step3Div.style.pointerEvents = "none";
      }
    });
  }

  const checkBtn = container.querySelector("#obOllamaCheck");
  if (checkBtn) {
    checkBtn.addEventListener("click", async () => {
      const resultEl = container.querySelector("#obOllamaCheckResult");
      resultEl.style.display = "block";
      resultEl.innerHTML =
        '<span style="color:var(--muted);">Checking...</span>';
      try {
        const resp = await chrome.runtime.sendMessage({
          action: "checkOllamaHealth",
        });
        if (resp && resp.data && resp.data.running) {
          resultEl.innerHTML =
            '<span style="color:var(--success);">Ollama detected!</span>';
          setTimeout(() => {
            _onboardingStep = 3;
            container.innerHTML = buildStep3();
            wireStep3(container);
          }, 800);
        } else {
          resultEl.innerHTML =
            '<span style="color:var(--accent);">Not detected yet. Is Ollama running?</span>';
        }
      } catch {
        resultEl.innerHTML =
          '<span style="color:var(--accent);">Not detected yet. Is Ollama running?</span>';
      }
    });
  }

  wireCopyButtons(container);
}

function wireStep3(container) {
  const startBtn = container.querySelector("#obStartBtn");
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      await finishOnboarding();
    });
  }
}

async function finishOnboarding() {
  await markOnboardingComplete();
  // If a provider was chosen, set it as the default
  if (_chosenProvider) {
    await chrome.storage.local.set({ lastProvider: _chosenProvider });
  }
  const container = document.getElementById("onboarding-screen");
  if (container) container.style.display = "none";
  // Let popup.js re-init
  if (typeof initMainUI === "function") {
    await initMainUI();
  }
}

function wireCopyButtons(container) {
  container.querySelectorAll(".ob-copy").forEach((el) => {
    el.addEventListener("click", () => {
      const cmd = el.getAttribute("data-cmd");
      if (cmd) {
        navigator.clipboard.writeText(cmd).then(() => {
          const orig = el.textContent;
          el.textContent = "Copied!";
          setTimeout(() => {
            el.textContent = orig;
          }, 1500);
        });
      }
    });
  });
}
