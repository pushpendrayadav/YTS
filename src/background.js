// background.js — service worker
// Intelligent transcript chunking with Groq free-tier TPM-aware delays
// Routes AI calls to Groq, Ollama, Claude, OpenAI and fetches transcripts

// ── SYSTEM PROMPT (all calls, all providers) ────────────

const SYSTEM_PROMPT =
  "You are YT Summarizer, expert at converting YouTube transcripts " +
  "into structured Markdown notes. Be concise and precise. " +
  "Output only what is asked — no preamble, no explanation.";

// ── MESSAGE ROUTER ──────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "callAI") {
    handleAIRequest(request.payload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === "fetchTranscriptXml") {
    fetchTranscriptXml(request.transcriptUrl)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === "checkOllamaHealth") {
    checkOllamaHealth()
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ── MAIN ORCHESTRATOR ───────────────────────────────────

async function handleAIRequest(payload) {
  const { provider, apiKey, model, prompt, videoMeta, rawTranscript } = payload;

  // Legacy path: if caller sends a plain prompt (no rawTranscript), just call the provider directly
  if (!rawTranscript) {
    return callProvider(
      provider,
      apiKey,
      model,
      SYSTEM_PROMPT,
      prompt,
      getMaxTokens(provider, model, "single"),
      0.2,
    );
  }

  // ── New chunking path ──
  // Step 1: Clean
  const { cleanedText, stats } = cleanTranscript(rawTranscript);
  sendProgress(
    "cleaning",
    0,
    1,
    `Cleaned transcript: ${stats.originalWords}\u2192${stats.cleanedWords} words (${stats.reductionPercent}% reduction)`,
  );

  console.log(
    `Transcript: ${stats.originalWords} \u2192 ${stats.cleanedWords} words ` +
      `(${stats.reductionPercent}% reduction, ~${stats.estimatedTokens} tokens)`,
  );

  // Step 2: Chunk
  const chunks = chunkTranscript(cleanedText, 800, 100);
  const meta = videoMeta || {};

  if (chunks.length <= 1) {
    return processSinglePass(provider, apiKey, model, meta, cleanedText);
  }

  // Show estimate before starting
  const estimate = estimateTotalTime(chunks.length, provider, model);
  sendProgress(
    "estimate",
    0,
    chunks.length,
    `This video needs ${chunks.length} chunks. Estimated time: ${estimate} (includes rate limit pauses)`,
  );

  return processMultiChunk(provider, apiKey, model, meta, chunks);
}

// ── SINGLE PASS ─────────────────────────────────────────

async function processSinglePass(
  provider,
  apiKey,
  model,
  videoMeta,
  cleanedText,
) {
  sendProgress("summarizing", 1, 1, "Summarizing...");
  const userPrompt = buildSinglePrompt(videoMeta, cleanedText);
  const maxTokens = getMaxTokens(provider, model, "single");
  return callProvider(
    provider,
    apiKey,
    model,
    SYSTEM_PROMPT,
    userPrompt,
    maxTokens,
    0.2,
  );
}

// ── MULTI CHUNK ORCHESTRATOR ────────────────────────────

async function processMultiChunk(provider, apiKey, model, videoMeta, chunks) {
  const chunkSummaries = [];
  let extraDelay = 0; // added if token budget gets low

  for (let i = 0; i < chunks.length; i++) {
    sendProgress(
      "extracting",
      i + 1,
      chunks.length,
      `Extracting key points: part ${i + 1} of ${chunks.length}...`,
    );

    const userPrompt = buildExtractionPrompt(chunks[i], i + 1, chunks.length);
    const maxTokens = getMaxTokens(provider, model, "extraction");

    let result;
    try {
      result = await callProviderWithRetry(
        provider,
        apiKey,
        model,
        SYSTEM_PROMPT,
        userPrompt,
        maxTokens,
        0.1,
        i + 1,
        chunks.length,
      );
    } catch (err) {
      throw err;
    }

    chunkSummaries.push(result.text);

    // Check remaining tokens header (Groq sends x-ratelimit-remaining-tokens)
    if (result.remainingTokens !== null && result.remainingTokens < 2000) {
      extraDelay = 30000;
      sendProgress(
        "waiting",
        i + 1,
        chunks.length,
        "Token budget low \u2014 adding extra wait time...",
      );
    }

    // Delay between chunks (not after last one)
    if (i < chunks.length - 1) {
      const delay = getChunkDelay(provider, model) + extraDelay;
      if (delay > 0) {
        await countdownDelay(delay, i + 2, chunks.length);
      }
      extraDelay = 0; // reset after applying once
    }
  }

  // Merge pass
  return mergeChunkSummaries(
    provider,
    apiKey,
    model,
    videoMeta,
    chunkSummaries,
  );
}

// ── MERGE ───────────────────────────────────────────────

async function mergeChunkSummaries(
  provider,
  apiKey,
  model,
  videoMeta,
  summaries,
) {
  sendProgress(
    "merging",
    summaries.length,
    summaries.length,
    `Merging ${summaries.length} sections into final notes...`,
  );

  // Delay before merge too (it's another API call)
  if (provider === "groq") {
    const delay = getChunkDelay(provider, model);
    if (delay > 0) {
      await countdownDelay(delay, "merge", summaries.length);
    }
  }

  const userPrompt = buildMergePrompt(videoMeta, summaries);
  const maxTokens = getMaxTokens(provider, model, "merge");
  return callProvider(
    provider,
    apiKey,
    model,
    SYSTEM_PROMPT,
    userPrompt,
    maxTokens,
    0.2,
  );
}

// ── PROVIDER ROUTER ─────────────────────────────────────

async function callProvider(
  provider,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens,
  temperature,
) {
  switch (provider) {
    case "groq":
      return callGroq(
        apiKey,
        model,
        systemPrompt,
        userPrompt,
        maxTokens,
        temperature,
      );
    case "ollama":
      return callOllama(model, systemPrompt, userPrompt, maxTokens);
    case "claude":
      return callClaude(apiKey, model, systemPrompt, userPrompt, maxTokens);
    case "openai":
      return callOpenAI(apiKey, model, systemPrompt, userPrompt, maxTokens);
    default:
      throw new Error("Unknown AI provider: " + provider);
  }
}

/** Calls provider and retries once on Groq 429 */
async function callProviderWithRetry(
  provider,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens,
  temperature,
  chunkIndex,
  totalChunks,
) {
  try {
    return await callProviderRaw(
      provider,
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      maxTokens,
      temperature,
    );
  } catch (err) {
    if (provider === "groq" && err.retryAfter !== undefined) {
      // First 429 — wait and retry once
      const shouldRetry = await handleGroq429(
        err.retryAfter,
        chunkIndex,
        totalChunks,
      );
      if (shouldRetry) {
        try {
          return await callProviderRaw(
            provider,
            apiKey,
            model,
            systemPrompt,
            userPrompt,
            maxTokens,
            temperature,
          );
        } catch (err2) {
          if (err2.retryAfter !== undefined) {
            throw new Error(
              "Groq rate limit exceeded twice. Switch to llama-4-scout for higher limits, or try again in a few minutes.",
            );
          }
          throw err2;
        }
      }
    }
    throw err;
  }
}

/** Raw call that returns { text, remainingTokens } and throws with retryAfter on 429 */
async function callProviderRaw(
  provider,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens,
  temperature,
) {
  switch (provider) {
    case "groq":
      return callGroqRaw(
        apiKey,
        model,
        systemPrompt,
        userPrompt,
        maxTokens,
        temperature,
      );
    case "ollama":
      return {
        text: await callOllama(model, systemPrompt, userPrompt, maxTokens),
        remainingTokens: null,
      };
    case "claude":
      return {
        text: await callClaude(
          apiKey,
          model,
          systemPrompt,
          userPrompt,
          maxTokens,
        ),
        remainingTokens: null,
      };
    case "openai":
      return {
        text: await callOpenAI(
          apiKey,
          model,
          systemPrompt,
          userPrompt,
          maxTokens,
        ),
        remainingTokens: null,
      };
    default:
      throw new Error("Unknown AI provider: " + provider);
  }
}

// ── GROQ (with rate-limit header reading) ───────────────

async function callGroqRaw(
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens,
  temperature,
) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: temperature,
      }),
    },
  );

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      const retryAfter = parseInt(response.headers.get("retry-after")) || 60;
      const err = new Error("Groq rate limit hit");
      err.retryAfter = retryAfter;
      throw err;
    }
    if (status === 401) {
      throw new Error("Invalid Groq API key. Check your key in Settings.");
    }
    const errBody = await response.json().catch(() => ({}));
    throw new Error(
      `Groq API error: ${errBody?.error?.message || response.statusText}`,
    );
  }

  const remainingTokens = parseInt(
    response.headers.get("x-ratelimit-remaining-tokens"),
  );
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  return {
    text,
    remainingTokens: isNaN(remainingTokens) ? null : remainingTokens,
  };
}

/** Backward-compatible wrapper for simple calls */
async function callGroq(
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens,
  temperature,
) {
  const result = await callGroqRaw(
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    maxTokens,
    temperature,
  );
  return result.text;
}

// ── OLLAMA ──────────────────────────────────────────────

async function callOllama(model, systemPrompt, userPrompt, maxTokens) {
  const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
  let response;
  try {
    response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "phi3:mini",
        prompt: combinedPrompt,
        stream: true,
        options: maxTokens ? { num_predict: maxTokens } : undefined,
      }),
    });
  } catch (err) {
    if (
      err.message &&
      (err.message.includes("Failed to fetch") ||
        err.message.includes("NetworkError"))
    ) {
      throw new Error(
        "CORS error. Restart Ollama with:\nOLLAMA_ORIGINS=chrome-extension://* ollama serve",
      );
    }
    throw new Error("Ollama offline. Run: ollama serve");
  }

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.response) fullResponse += json.response;
      } catch (_) {
        /* partial line, ignore */
      }
    }
  }

  return fullResponse;
}

// ── CLAUDE ──────────────────────────────────────────────

async function callClaude(apiKey, model, systemPrompt, userPrompt, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: maxTokens || 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const status = response.status;
    const errBody = await response.json().catch(() => ({}));
    if (status === 401)
      throw new Error("Invalid Claude API key. Check Settings.");
    throw new Error(
      `Claude API error: ${errBody?.error?.message || response.statusText}`,
    );
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// ── OPENAI ──────────────────────────────────────────────

async function callOpenAI(apiKey, model, systemPrompt, userPrompt, maxTokens) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      max_tokens: maxTokens || 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const status = response.status;
    const errBody = await response.json().catch(() => ({}));
    if (status === 401)
      throw new Error("Invalid OpenAI API key. Check Settings.");
    throw new Error(
      `OpenAI API error: ${errBody?.error?.message || response.statusText}`,
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── TRANSCRIPT UTILITIES ────────────────────────────────

function cleanTranscript(rawText) {
  let text = typeof rawText === "string" ? rawText : "";
  const originalWords = text.split(/\s+/).filter(Boolean).length;

  // 1. Remove filler words/phrases (case-insensitive)
  const fillers = [
    /\bu+m+h*\b/gi,
    /\bu+h+\b/gi,
    /\byou know\b/gi,
    /\blike I said\b/gi,
    /\bsort of\b/gi,
    /\bkind of\b/gi,
    /\bbasically\b/gi,
    /\bliterally\b/gi,
    /\bright\?/gi,
    /\bokay so\b/gi,
    /\bso yeah\b/gi,
    /\byou see\b/gi,
    /\bI mean\b/gi,
    /\bactually\b/gi,
    /\bhonestly\b/gi,
    /\bto be honest\b/gi,
    /\bat the end of the day\b/gi,
    /\bmoving forward\b/gi,
    /\bgoing forward\b/gi,
    /\bin terms of\b/gi,
    /\bas I mentioned\b/gi,
  ];
  for (const re of fillers) {
    text = text.replace(re, "");
  }

  // 2. Remove auto-caption artifacts
  text = text.replace(/\[.*?\]/g, "");
  text = text.replace(/\(music\)/gi, "");
  text = text.replace(/\(applause\)/gi, "");

  // 3. Remove consecutive duplicate sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  const deduped = [sentences[0]];
  for (let i = 1; i < sentences.length; i++) {
    if (
      sentences[i].trim().toLowerCase() !==
      sentences[i - 1].trim().toLowerCase()
    ) {
      deduped.push(sentences[i]);
    }
  }
  text = deduped.join(" ");

  // 4. Collapse whitespace
  text = text.replace(/ {3,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  const cleanedWords = text.split(/\s+/).filter(Boolean).length;
  const reductionPercent =
    originalWords > 0
      ? Math.round(((originalWords - cleanedWords) / originalWords) * 100)
      : 0;

  return {
    cleanedText: text,
    stats: {
      originalWords,
      cleanedWords,
      reductionPercent,
      estimatedTokens: Math.ceil(cleanedWords * 1.3),
    },
  };
}

function chunkTranscript(text, chunkSize, overlap) {
  chunkSize = chunkSize || 800;
  overlap = overlap || 100;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= chunkSize) return [words.join(" ")];

  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start = end - overlap;
  }
  return chunks;
}

function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

// ── PROMPTS ─────────────────────────────────────────────

function buildExtractionPrompt(chunk, current, total) {
  return (
    "Extract ONLY the key points from this transcript section.\n" +
    "Output as bullet points ONLY. Maximum 8 bullet points.\n" +
    "No introduction, no conclusion, no commentary.\n" +
    `Section ${current} of ${total}:\n\n` +
    chunk
  );
}

function buildMergePrompt(videoMeta, summaries) {
  const formatted = Array.isArray(summaries)
    ? summaries.map((s, i) => `--- Section ${i + 1} ---\n${s}`).join("\n\n")
    : summaries;

  return (
    `Combine these key points from ${Array.isArray(summaries) ? summaries.length : "multiple"} sections ` +
    "of a YouTube video into ONE cohesive structured Markdown document.\n\n" +
    `Video: ${videoMeta.title || "Unknown"}\n` +
    `Channel: ${videoMeta.channel || "Unknown"}\n\n` +
    formatted +
    "\n\n" +
    "OUTPUT FORMAT:\n" +
    `# ${videoMeta.title || "Video Summary"}\n` +
    "## Key Takeaways\n" +
    "- (5-8 most important insights, crisp and specific)\n" +
    "## Structured Notes\n" +
    "### {Topic Heading}\n" +
    "(notes grouped by topic, not by section number)\n" +
    "## Notable Quotes & Examples\n" +
    "- (standout quotes or statistics)\n\n" +
    "Output ONLY the Markdown. Nothing else."
  );
}

function buildSinglePrompt(videoMeta, cleanedText) {
  return (
    "Summarize this YouTube video transcript into structured Markdown notes.\n\n" +
    `Video: ${videoMeta.title || "Unknown"}\n` +
    `Channel: ${videoMeta.channel || "Unknown"}\n\n` +
    "OUTPUT FORMAT:\n" +
    `# ${videoMeta.title || "Video Summary"}\n` +
    "## Key Takeaways\n" +
    "- (5-8 most important insights)\n" +
    "## Structured Notes\n" +
    "### {Topic Heading}\n" +
    "(detailed notes by topic)\n" +
    "## Notable Quotes & Examples\n" +
    "- (standout quotes or stats)\n\n" +
    "TRANSCRIPT:\n" +
    cleanedText
  );
}

// ── RATE LIMIT & DELAY UTILITIES ────────────────────────

function getChunkDelay(provider, model) {
  if (provider !== "groq") {
    if (provider === "ollama") return 0;
    return 1000; // claude, openai: conservative 1s
  }
  // Groq per-model delays based on TPM limits
  if (model && model.includes("llama-4-scout")) return 3000;
  if (model === "llama-3.3-70b-versatile") return 9000;
  // llama-3.1-8b-instant, qwen/qwen3-32b, and any unknown groq model
  return 20000;
}

function getMaxTokens(provider, model, callType) {
  if (callType === "extraction") return 500;

  // merge and single share the same budgets
  if (provider === "groq") {
    if (model === "llama-3.3-70b-versatile") return 2000;
    if (model && model.includes("llama-4-scout")) return 2000;
    // llama-3.1-8b-instant, qwen/qwen3-32b, fallback
    return 1500;
  }
  if (provider === "ollama") return 1200;
  // claude, openai
  return 2048;
}

async function countdownDelay(ms, nextChunk, totalChunks) {
  const seconds = Math.ceil(ms / 1000);
  const label =
    nextChunk === "merge"
      ? "merge pass"
      : `part ${nextChunk} of ${totalChunks}`;

  for (let remaining = seconds; remaining > 0; remaining--) {
    sendProgress(
      "waiting",
      typeof nextChunk === "number" ? nextChunk - 1 : totalChunks,
      totalChunks,
      `Rate limit pause: ${remaining}s before ${label}...`,
    );
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function handleGroq429(retryAfterSecs, chunkIndex, totalChunks) {
  const waitSecs = retryAfterSecs || 60;

  sendProgress(
    "ratelimit",
    chunkIndex,
    totalChunks,
    `Groq rate limit hit. Waiting ${waitSecs}s automatically...`,
  );

  await countdownDelay(waitSecs * 1000, chunkIndex, totalChunks);
  return true; // signal to retry
}

function estimateTotalTime(chunkCount, provider, model) {
  const processingPerChunk = 5;
  const delayPerChunk = getChunkDelay(provider, model) / 1000;
  const mergeTime = 10;
  const mergeDelay = provider === "groq" ? delayPerChunk : 0;

  const totalSeconds =
    chunkCount * processingPerChunk +
    (chunkCount - 1) * delayPerChunk +
    mergeDelay +
    mergeTime;

  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  return mins > 0 ? `~${mins}m ${secs}s` : `~${secs}s`;
}

// ── PROGRESS ────────────────────────────────────────────

function sendProgress(stage, current, total, message) {
  chrome.runtime
    .sendMessage({
      action: "chunkProgress",
      stage,
      current,
      total,
      message,
    })
    .catch(() => {
      // Popup may have closed — ignore
    });
}

// ── OLLAMA HEALTH ───────────────────────────────────────

async function checkOllamaHealth() {
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      method: "GET",
    });
    if (response.ok) {
      const data = await response.json();
      return { running: true, models: data.models?.map((m) => m.name) || [] };
    }
    return { running: false, models: [] };
  } catch (_) {
    return { running: false, models: [] };
  }
}

// ── TRANSCRIPT FETCHER ──────────────────────────────────

async function fetchTranscriptXml(transcriptUrl) {
  const urlObj = new URL(transcriptUrl);
  const videoId = urlObj.searchParams.get("v");
  if (!videoId)
    throw new Error("Could not extract video ID from transcript URL");

  // Try JSON API first
  try {
    const response = await fetch(
      `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en&fmt=json`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.youtube.com/",
        },
      },
    );
    if (response.ok) {
      const data = await response.json();
      return convertJsonToChunks(data);
    }
  } catch (_) {
    /* fall through */
  }

  // Fallback to XML
  try {
    const response = await fetch(transcriptUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.youtube.com/",
        Accept: "application/xml, text/xml, */*",
      },
    });
    if (response.ok) {
      const xmlText = await response.text();
      if (xmlText.length > 0) return parseTranscriptXml(xmlText);
    }
  } catch (_) {
    /* fall through */
  }

  throw new Error(
    "No captions on this video. Try a video with CC/subtitles enabled.",
  );
}

function convertJsonToChunks(data) {
  const events = data?.events || [];
  const segments = [];
  events.forEach((event) => {
    if (event.tStartMs && event.segs) {
      const start = parseFloat(event.tStartMs) / 1000;
      event.segs.forEach((seg) => {
        if (seg.utf8) segments.push({ start, text: seg.utf8 });
      });
    }
  });
  if (segments.length === 0)
    throw new Error("Transcript appears empty. Try again.");
  return groupSegments(segments);
}

function parseTranscriptXml(xmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  if (xmlDoc.documentElement.tagName === "parsererror")
    throw new Error("Failed to parse transcript XML");
  const textNodes = xmlDoc.querySelectorAll("text");
  const segments = [];
  textNodes.forEach((node) => {
    const start = parseFloat(node.getAttribute("start") || "0");
    const text = node.textContent
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, " ")
      .trim();
    if (text) segments.push({ start, text });
  });
  if (segments.length === 0)
    throw new Error("Transcript appears empty. Try again.");
  return groupSegments(segments);
}

function groupSegments(segments) {
  const chunks = [];
  let cur = { start: 0, texts: [] };
  segments.forEach((seg) => {
    if (seg.start - cur.start > 60 && cur.texts.length > 0) {
      chunks.push({
        timestamp: formatTime(cur.start),
        text: cur.texts.join(" "),
      });
      cur = { start: seg.start, texts: [seg.text] };
    } else {
      cur.texts.push(seg.text);
    }
  });
  if (cur.texts.length > 0)
    chunks.push({
      timestamp: formatTime(cur.start),
      text: cur.texts.join(" "),
    });
  return chunks;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
