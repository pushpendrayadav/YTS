# YT Summarizer - AI Notes

**YT Summarizer** is an AI-powered Chrome extension that turns any YouTube video into clean, structured Markdown notes. Whether you're learning a new topic, doing research, or just want to capture key takeaways from a long video — YT Summarizer watches so you don't have to re-watch.

It extracts the video transcript, sends it through an AI provider of your choice, and downloads a ready-to-use `summary.md` file with key takeaways, structured notes, and notable quotes.

---

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
- [Output Format](#output-format)
- [Supported AI Providers](#supported-ai-providers)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Privacy and Security](#privacy-and-security)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

- **Multi-provider AI support** — use Groq (free), Claude, OpenAI, or Ollama (local/private)
- **One-click summaries** — generate structured Markdown notes from any YouTube video
- **Smart transcript processing** — automatic filler word removal, deduplication, and cleaning
- **Intelligent chunking** — handles long videos by splitting transcripts into chunks with overlap, then merging results
- **Rate limit handling** — built-in Groq free-tier TPM-aware delays with automatic retry on 429
- **Local caching** — summaries are cached for 30 days so repeat visits are instant
- **Guided onboarding** — first-run setup wizard walks users through provider and key configuration
- **Offline-capable** — Ollama support means fully private, no-internet summarization
- **Clean download** — outputs `.md` files with YAML front matter, ready for Obsidian, Notion, or any Markdown editor

---

## Technology Stack

| Layer            | Technology                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **Platform**     | Chrome Extension (Manifest V3)                                                                     |
| **Language**     | Vanilla JavaScript (ES2020+)                                                                       |
| **UI**           | HTML5, CSS3 (custom dark theme, CSS variables)                                                     |
| **Fonts**        | Google Fonts — Space Mono (monospace), DM Sans (sans-serif)                                        |
| **AI Providers** | Groq API, Anthropic Claude API, OpenAI API, Ollama (local REST API)                                |
| **Storage**      | Chrome Storage API — `chrome.storage.sync` (API keys), `chrome.storage.local` (cache, preferences) |
| **APIs**         | Chrome Tabs, Scripting, ActiveTab, Downloads APIs                                                  |
| **Transcript**   | DOM extraction from YouTube transcript panel + YouTube Timed Text API fallback                     |
| **Architecture** | Service Worker (background), Content Script (YouTube page), Popup UI                               |

---

## Installation

### Developer Mode (from source)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `yt-summarizer` folder
6. The extension icon will appear in your toolbar

---

## Setup

1. Click the extension icon on any YouTube video page
2. The onboarding wizard will guide you through provider selection:
   - **Groq** (recommended) — free cloud API, ~100 summaries/day, no credit card needed
   - **Claude / OpenAI** — paid API, set keys in Settings
   - **Ollama** — local, private, no API key, requires one-time install
3. For Groq: get a free key at [console.groq.com](https://console.groq.com) and paste it in
4. For Ollama: install from [ollama.com](https://ollama.com), pull a model, and start with CORS enabled:

```bash
ollama pull phi3:mini
OLLAMA_ORIGINS=chrome-extension://* ollama serve
```

---

## Usage

1. Navigate to any YouTube video with captions/transcripts
2. Click the **YT Summarizer** extension icon
3. Select your AI provider (Groq, Claude, OpenAI, or Ollama)
4. Choose a model from the dropdown
5. Click **Generate summary.md**
6. The file downloads automatically to your Downloads folder

For long videos, the extension will show real-time progress as it processes chunks and merges them into a final summary.

---

## Output Format

The generated `summary.md` includes YAML front matter and structured sections:

```markdown
---
title: "Video Title"
channel: "Channel Name"
url: https://youtube.com/watch?v=...
date: 2026-03-14
provider: groq / llama-3.1-8b-instant
duration: ~12 min video
---

# Video Title

> _Channel Name — summarized by YT Summarizer_

## Key Takeaways

- Key insight 1
- Key insight 2

## Structured Notes

### Topic Heading

Detailed notes grouped by topic...

## Notable Quotes & Examples

- Standout quotes or statistics

---

_Generated by YT Summarizer Chrome Extension_
_groq / llama-3.1-8b-instant · 2026-03-14_
```

---

## Supported AI Providers

| Provider   | Type      | Cost             | Models                                                                  |
| ---------- | --------- | ---------------- | ----------------------------------------------------------------------- |
| **Groq**   | Cloud API | Free (~100/day)  | llama-3.1-8b-instant, llama-3.3-70b-versatile, llama-4-scout, qwen3-32b |
| **Claude** | Cloud API | Paid (per token) | claude-sonnet-4, claude-opus-4, claude-haiku-4.5                        |
| **OpenAI** | Cloud API | Paid (per token) | GPT-4o, GPT-4o Mini, GPT-4 Turbo                                        |
| **Ollama** | Local     | Free (unlimited) | phi3:mini, llama3.2, mistral:7b, gemma2:9b, and any pulled model        |

---

## Architecture

```
YouTube Page                 Popup UI                  Background (Service Worker)
+------------------+     +----------------+         +---------------------------+
| content.js       |     | popup.html     |         | background.js             |
| - Extracts       |<--->| popup.js       |<------->| - AI provider router      |
|   transcript     |     | onboarding.js  |         | - Transcript cleaning     |
|   from DOM       |     | transcriptUtils|         | - Chunking + merging      |
|                  |     |                |         | - Rate limit handling     |
+------------------+     +----------------+         | - Groq / Claude / OpenAI  |
                                                    |   / Ollama API calls      |
                                                    +---------------------------+
                                                                |
                                                    +-----------+------------+
                                                    |   Chrome Storage API   |
                                                    | - API keys (sync)      |
                                                    | - Cache (local)        |
                                                    | - Preferences (local)  |
                                                    +------------------------+
```

---

## Project Structure

```
yt-summarizer/
├── manifest.json            # Chrome Extension config (Manifest V3)
├── popup.html               # Main popup UI with dark theme
├── options.html             # Settings page (API keys, cache, privacy)
├── README.md
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background.js        # Service worker — AI calls, chunking, rate limits
    ├── content.js           # Content script — transcript extraction from YouTube DOM
    ├── popup.js             # Popup logic — provider tabs, generation, caching
    ├── onboarding.js        # First-run onboarding wizard
    ├── options.js           # Settings page logic
    └── transcriptUtils.js   # Transcript cleaning, chunking, prompt building utilities
```

---

## Privacy and Security

- **No backend server** — the extension runs entirely in your browser
- **API keys** are stored in Chrome's encrypted sync storage and sent only to the respective AI provider
- **Ollama mode** is 100% local — no data leaves your machine
- **No analytics, no tracking, no telemetry**
- Transcript data is processed in-memory and never persisted beyond the local summary cache

---

## Limitations

- Only works on videos with **captions enabled** (auto-generated or manual)
- Very long videos (3h+) may hit AI token limits — use a model with larger context window
- Groq free tier has rate limits (~100 summaries/day, TPM-based delays between chunks)
- Ollama requires local install and sufficient RAM (2-16 GB depending on model)
- YouTube DOM structure may change; transcript extraction depends on current page layout

---

## Troubleshooting

| Error                              | Fix                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------- |
| "No transcript/captions available" | The video doesn't have captions enabled                                 |
| "Content script not loaded"        | Reload the YouTube page and try again                                   |
| "Invalid API key"                  | Check your key in Settings (click gear icon)                            |
| "Groq rate limit exceeded twice"   | Switch to llama-4-scout for higher limits, or wait a few minutes        |
| "CORS error" (Ollama)              | Restart Ollama with: `OLLAMA_ORIGINS=chrome-extension://* ollama serve` |
| "No YouTube video ID found"        | Make sure you're on a `youtube.com/watch?v=...` page                    |

---

## Roadmap

### Phase 1 — Free Tier (Current)

The current release is a **fully client-side Chrome extension** with no backend. Users bring their own API keys or use a local Ollama instance.

**What's included:**

- Groq free tier support (~100 summaries/day, zero cost)
- Claude, OpenAI support (user's own API key)
- Ollama local support (unlimited, private)
- Smart chunking with rate-limit-aware delays
- Local 30-day summary cache

**Known limitations in Phase 1:**

- Speed depends on the chosen provider's rate limits (Groq free tier adds pauses between chunks for long videos)
- Users must manage their own API keys
- Ollama requires local setup (install, pull model, run with CORS)
- No cloud sync of summaries across devices
- No batch processing (one video at a time)

---

### Phase 2 — Subscription-Based Cloud Service (Planned)

Phase 2 introduces a **hosted backend** that removes all friction from the user experience. No API keys, no local setup, no rate limit pauses.

**Planned features:**

- **Cloud-hosted AI models** — fast Ollama or optimized models running on cloud infrastructure (GPU instances) so users get instant summaries without managing anything
- **No API key required** — the backend handles all AI calls; users just click and summarize
- **No rate limits** — dedicated infrastructure means no TPM throttling or chunk delays
- **Subscription tiers:**
  - **Free** — limited summaries per month (e.g., 10-20/month)
  - **Pro** — unlimited summaries, priority processing, faster models
  - **Team** — shared workspace, summary library, collaboration features
- **Cloud summary library** — summaries synced and accessible from any device via a web dashboard
- **Batch processing** — summarize playlists or multiple videos in one go
- **Custom output formats** — choose between Markdown, PDF, Notion export, Obsidian vault sync
- **User accounts and auth** — secure login, usage tracking, billing management
- **API access** — developer API for integrating YT Summarizer into other tools and workflows

**Planned tech stack for Phase 2:**

| Layer              | Technology                                                      |
| ------------------ | --------------------------------------------------------------- |
| Backend            | Node.js / Python (FastAPI)                                      |
| AI Hosting         | Ollama on GPU cloud (RunPod / AWS / GCP) or fine-tuned models   |
| Database           | PostgreSQL (users, subscriptions), Redis (caching, rate limits) |
| Auth               | OAuth 2.0 (Google / GitHub login)                               |
| Payments           | Stripe                                                          |
| Hosting            | AWS / GCP / Vercel                                              |
| Frontend Dashboard | Next.js (web app for managing summaries)                        |

---

## License

MIT
