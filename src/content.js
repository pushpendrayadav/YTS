// content.js – injected into YouTube pages
// Extracts transcript from visible transcript panel

console.log(" content.js loaded on page:", window.location.href);

(function () {
  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(" Received message:", request);
    if (request.action === "getTranscript") {
      console.log(" Starting transcript extraction...");
      extractTranscript()
        .then((data) => {
          console.log(" Transcript extracted, sending response:", data);
          sendResponse({ success: true, data });
        })
        .catch((err) => {
          console.error(" Extraction error:", err.message);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
  });

  async function extractTranscript() {
    const videoId = getVideoId();
    if (!videoId) throw new Error("No YouTube video ID found on this page.");

    const title = document.title.replace(" - YouTube", "").trim();
    const channelEl = document.querySelector("#channel-name a, #owner-name a");
    const channel = channelEl
      ? channelEl.textContent.trim()
      : "Unknown Channel";
    const url = window.location.href;

    // Try to open transcript panel if not already open
    console.log(" Attempting to open transcript panel...");
    await openTranscriptPanel();

    // Try to extract from visible transcript panel
    const transcript = extractTranscriptFromDOM();

    return { videoId, title, channel, url, transcript };
  }

  async function openTranscriptPanel() {
    // Look for "Show transcript" button
    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], a'),
    );
    for (const btn of buttons) {
      const text = btn.textContent.toLowerCase();
      if (text.includes("transcript") && !text.includes("closed")) {
        console.log(" Found transcript button, clicking it...");
        btn.click();
        // Wait for panel to open
        await new Promise((resolve) => setTimeout(resolve, 500));
        return;
      }
    }
    console.log(" Could not find 'Show transcript' button");
  }

  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
  }

  function extractTranscriptFromDOM() {
    console.log(" Looking for transcript in DOM...");

    // Look for transcript content in various possible containers
    let transcriptPanel = null;

    // Try multiple selectors in order of preference
    const selectors = [
      // YouTube's actual transcript panel (most specific)
      'ytd-engagement-panels [aria-label="Transcript"]',
      'div[jsname="NCxGof"]', // YouTube transcript container
      'div[role="tabpanel"][aria-label*="Transcript"]',
      'div[role="tabpanel"]',
      'div[jsaction*="transcript"]',
      '[aria-label*="Transcript"]',
      '[aria-label*="transcript"]',
      '[class*="transcript"]',
    ];

    for (const selector of selectors) {
      try {
        const panels = document.querySelectorAll(selector);
        console.log(` Selector "${selector}" found ${panels.length} elements`);

        for (const panel of panels) {
          const text = panel.textContent;
          // Skip if it contains "AI-generated video summary" (that's the summary, not transcript)
          if (text.includes("AI-generated video summary")) {
            console.log(
              " Skipping summary panel, looking for actual transcript",
            );
            continue;
          }
          // Check if this looks like a transcript (has substantial text content with timestamps)
          if (
            text.length > 200 &&
            (text.includes(":") || text.match(/\d+:\d{2}/))
          ) {
            console.log(
              ` Found potential transcript with ${text.length} chars`,
            );
            transcriptPanel = panel;
            break;
          }
        }

        if (transcriptPanel) break;
      } catch (e) {
        console.warn(" Selector error: " + e.message);
      }
    }

    if (!transcriptPanel) {
      console.error(" No panel found with any CSS selectors!");
      console.log(" Falling back to searching all divs...");
      // Log all visible large text containers for debugging
      const allDivs = document.querySelectorAll("div");
      let foundCount = 0;

      console.log(`Scanning ${allDivs.length} total divs on page...`);

      for (const div of allDivs) {
        const text = div.textContent;
        const isVisible = div.offsetParent !== null && div.clientHeight > 0;

        if (
          isVisible &&
          text.length > 500 &&
          text.length < 50000 &&
          !text.includes("Chat") &&
          !text.includes("Comments")
        ) {
          foundCount++;
          if (foundCount <= 5) {
            console.log(
              "Checking visible div #" +
                foundCount +
                " with " +
                text.length +
                " chars, classes: " +
                div.className.substring(0, 50),
            );
            const segments = extractSegmentsFromElement(div);
            console.log("  → Got " + segments.length + " segments");
            if (segments.length > 5) {
              console.log("Found enough segments in div!");
              return groupIntoChunks(segments);
            }
          }
        }
      }

      throw new Error(
        'Could not find transcript. Please click "Show transcript" button below the video description to open it.',
      );
    }

    console.log(" Extracting segments from found panel...");
    const segments = extractSegmentsFromElement(transcriptPanel);
    console.log(` Total segments extracted: ${segments.length}`);

    if (segments.length === 0) {
      console.error(
        " Panel found but NO segments extracted. Trying alternate extraction...",
      );
      const allText = transcriptPanel.innerText || transcriptPanel.textContent;
      console.log(` Panel contains ${allText.length} total text characters`);
      throw new Error(
        "Transcript panel found but no text segments could be extracted. Try a different video.",
      );
    }

    console.log(" Successfully extracted " + segments.length + " segments");
    const chunks = groupIntoChunks(segments);
    console.log(` Grouped into ${chunks.length} chunks`);
    return chunks;
  }

  function extractSegmentsFromElement(element) {
    const segments = [];

    // Look for transcript segments - they can be in various structures
    let segmentElements = element.querySelectorAll(
      'div[class*="segment"], p, span[data-start-time], div[role="button"], yt-formatted-string',
    );

    console.log(
      ` First selector search found ${segmentElements.length} elements`,
    );

    // If we don't find specific segments, try broader search
    if (segmentElements.length < 5) {
      console.log(
        " Not enough specific segments (<5), trying broader search",
      );
      segmentElements = element.querySelectorAll("div > span, p");
      console.log(` Broader search found ${segmentElements.length} elements`);
    }

    console.log(
      " Processing " + segmentElements.length + " segment elements",
    );

    segmentElements.forEach((seg, index) => {
      const text = seg.textContent.trim();

      // Skip very short, empty, or button segments
      if (text.length < 3 || text.length > 1000) return;

      // Skip if it looks like UI text
      if (text.match(/^(Copy|Share|Report|More|Less|Show|Hide)$/i)) return;

      // Skip if it looks like the AI summary
      if (
        text.includes("AI-generated video summary") ||
        text.includes("Summary")
      )
        return;

      // Try to get timestamp
      let start = 0;
      const timeAttr = seg.getAttribute("data-start-time");
      if (timeAttr) {
        start = parseFloat(timeAttr);
      }

      // Try to parse timestamps from text like "1:23" at the start
      const timeMatch = text.match(/^(\d+):(\d{2})\s+/);
      if (timeMatch) {
        start = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
      }

      // Remove timestamp from text if it exists
      const cleanText = text.replace(/^\d+:\d{2}\s+/, "").trim();

      if (cleanText && cleanText.length > 2) {
        segments.push({ start, text: cleanText });
        if (segments.length <= 3) {
          console.log(
            `   Segment ${segments.length}: "${cleanText.substring(0, 50)}..."`,
          );
        }
      }
    });

    return segments;
  }

  function groupIntoChunks(segments) {
    if (segments.length === 0) {
      throw new Error("No segments to group.");
    }

    const chunks = [];
    let currentChunk = { start: 0, texts: [] };

    segments.forEach((seg) => {
      // Create chunks every 60 seconds or when we have enough text
      if (
        (seg.start - currentChunk.start > 60 &&
          currentChunk.texts.length > 0) ||
        currentChunk.texts.join(" ").length > 500
      ) {
        chunks.push({
          timestamp: formatTime(currentChunk.start),
          text: currentChunk.texts.join(" "),
        });
        currentChunk = { start: seg.start, texts: [seg.text] };
      } else {
        currentChunk.texts.push(seg.text);
      }
    });

    if (currentChunk.texts.length > 0) {
      chunks.push({
        timestamp: formatTime(currentChunk.start),
        text: currentChunk.texts.join(" "),
      });
    }

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
})();
