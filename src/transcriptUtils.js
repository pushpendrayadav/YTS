// transcriptUtils.js — Transcript preprocessing utilities

const FILLER_PATTERNS = [
  /\b(um|uh|ugh)\b/gi,
  /\byou know\b/gi,
  /\blike I said\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
  /\bbasically\b/gi,
  /\bliterally\b/gi,
  /\bright\?/gi,
  /\bokay so\b/gi,
];

/**
 * Clean transcript by removing filler words, deduplicating, and collapsing whitespace.
 * @param {Array} segments - Array of { timestamp, text } objects
 * @returns {{ text: string, wordCount: number }}
 */
function cleanTranscript(segments) {
  if (!segments || segments.length === 0) return { text: "", wordCount: 0 };

  let fullText = segments.map((seg) => seg.text).join(" ");

  // Remove filler words / phrases
  FILLER_PATTERNS.forEach((rx) => {
    fullText = fullText.replace(rx, "");
  });

  // Collapse multiple spaces / newlines
  fullText = fullText.replace(/\s+/g, " ").trim();

  // Remove consecutive duplicate sentences
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  const deduped = [];
  let prev = "";
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed && trimmed !== prev) {
      deduped.push(trimmed);
      prev = trimmed;
    }
  }

  const cleaned = deduped.join(" ");
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return { text: cleaned, wordCount };
}

/**
 * Split long transcript into overlapping chunks.
 * @param {string} text - Cleaned transcript text
 * @param {number} maxWords - Max words per chunk (default 2500)
 * @returns {string[]} Array of chunk strings
 */
function chunkTranscript(text, maxWords = 2500) {
  if (!text) return [];
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];

  const overlap = 200;
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start = end - overlap;
  }
  return chunks;
}

/**
 * Build a prompt for a single-pass or multi-chunk summarisation.
 * @param {{ title: string, channel: string, url: string }} videoMeta
 * @param {string} transcriptText
 * @param {{ current: number, total: number }|null} chunkInfo - null for single-chunk
 * @returns {string}
 */
function buildPrompt(videoMeta, transcriptText, chunkInfo) {
  const { title, channel } = videoMeta;

  if (!chunkInfo || chunkInfo.total <= 1) {
    return `Summarize this YouTube video transcript into structured Markdown notes.

Video: ${title}
Channel: ${channel}

TRANSCRIPT:
${transcriptText}`;
  }

  return `Extract the KEY POINTS ONLY from this section of a YouTube transcript. Be concise. Output bullet points only.
This is section ${chunkInfo.current} of ${chunkInfo.total}.

TRANSCRIPT SECTION:
${transcriptText}`;
}

/**
 * Build the merge prompt that combines partial summaries.
 */
function buildMergePrompt(videoMeta, allChunkSummaries) {
  const { title, channel } = videoMeta;
  return `Combine these partial summaries from different sections of the same YouTube video into ONE cohesive structured Markdown document.

Video: ${title}
Channel: ${channel}

PARTIAL SUMMARIES:
${allChunkSummaries}`;
}

/**
 * Rough token estimate: words × 1.3
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

/**
 * Get word count of text.
 */
function getWordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}
