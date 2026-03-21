(function () {
  function createPdfBlob(markdown) {
    const pdfBytes = buildPdfDocument(markdown);
    return new Blob([pdfBytes], { type: "application/pdf" });
  }

  function buildPdfDocument(markdown) {
    const pageWidth = 612;
    const pageHeight = 792;
    const left = 54;
    const top = 740;
    const bottom = 54;
    const usableWidth = pageWidth - left * 2;
    const lines = buildPdfLines(markdown, usableWidth);
    const pages = paginatePdfLines(lines, top, bottom);

    const objects = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

    const pageObjectIds = [];
    let nextObjectId = 5;

    pages.forEach((page) => {
      const contentObjectId = nextObjectId++;
      const pageObjectId = nextObjectId++;
      pageObjectIds.push(pageObjectId);

      const contentStream = buildPdfPageContent(page, left);
      objects[contentObjectId] =
        `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`;
      objects[pageObjectId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    });

    objects[2] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

    let pdf = "%PDF-1.4\n";
    const offsets = [0];

    for (let objectId = 1; objectId < objects.length; objectId++) {
      const objectBody = objects[objectId];
      if (!objectBody) continue;
      offsets[objectId] = pdf.length;
      pdf += `${objectId} 0 obj\n${objectBody}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length}\n`;
    pdf += "0000000000 65535 f \n";
    for (let objectId = 1; objectId < objects.length; objectId++) {
      const offset = offsets[objectId] || 0;
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }

    pdf +=
      `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`;

    return new TextEncoder().encode(pdf);
  }

  function buildPdfLines(markdown, usableWidth) {
    const maxChars = Math.max(40, Math.floor(usableWidth / 6.2));
    const sourceLines = normalizePdfText(markdown).split("\n");
    const pdfLines = [];

    for (const rawLine of sourceLines) {
      const line = rawLine.trimEnd();

      if (!line.trim()) {
        pdfLines.push({ text: "", font: "F1", size: 11, gapAfter: 4 });
        continue;
      }

      let text = line.trim();
      let font = "F1";
      let size = 11;
      let gapAfter = 3;

      if (text.startsWith("# ")) {
        text = text.slice(2).trim();
        font = "F2";
        size = 17;
        gapAfter = 8;
      } else if (text.startsWith("## ")) {
        text = text.slice(3).trim();
        font = "F2";
        size = 13;
        gapAfter = 5;
      } else if (text.startsWith("### ")) {
        text = text.slice(4).trim();
        font = "F2";
        size = 11.5;
        gapAfter = 4;
      } else if (text === "---") {
        pdfLines.push({ text: "", font: "F1", size: 11, gapAfter: 6 });
        continue;
      } else if (text.startsWith("> ")) {
        text = text.slice(2).trim();
        font = "F1";
        size = 10.5;
      }

      const wrapped = wrapPdfText(text, maxChars);
      wrapped.forEach((wrappedLine, index) => {
        pdfLines.push({
          text: wrappedLine,
          font,
          size,
          gapAfter: index === wrapped.length - 1 ? gapAfter : 0,
        });
      });
    }

    return pdfLines;
  }

  function paginatePdfLines(lines, top, bottom) {
    const pages = [];
    let currentPage = [];
    let cursorY = top;

    for (const line of lines) {
      const lineHeight = Math.max(14, line.size + 4);
      if (cursorY - lineHeight < bottom && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        cursorY = top;
      }

      currentPage.push({ ...line, y: cursorY });
      cursorY -= lineHeight + line.gapAfter;
    }

    if (currentPage.length === 0) {
      currentPage.push({
        text: "Summary",
        font: "F2",
        size: 14,
        gapAfter: 0,
        y: top,
      });
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  }

  function buildPdfPageContent(lines, left) {
    const commands = ["BT"];
    for (const line of lines) {
      if (!line.text) continue;
      commands.push(`/${line.font} ${line.size} Tf`);
      commands.push(`1 0 0 1 ${left} ${line.y.toFixed(2)} Tm`);
      commands.push(`(${escapePdfText(line.text)}) Tj`);
    }
    commands.push("ET");
    return commands.join("\n");
  }

  function wrapPdfText(text, maxChars) {
    if (text.length <= maxChars) return [text];

    const words = text.split(/\s+/);
    const lines = [];
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        if (word.length <= maxChars) {
          current = word;
        } else {
          const chunks = splitLongWord(word, maxChars);
          lines.push(...chunks.slice(0, -1));
          current = chunks[chunks.length - 1] || "";
        }
      } else {
        const chunks = splitLongWord(word, maxChars);
        lines.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] || "";
      }
    }

    if (current) lines.push(current);
    return lines;
  }

  function splitLongWord(word, maxChars) {
    const chunks = [];
    for (let index = 0; index < word.length; index += maxChars) {
      chunks.push(word.slice(index, index + maxChars));
    }
    return chunks;
  }

  function normalizePdfText(text) {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ");
  }

  function escapePdfText(text) {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }
  window.YTPdfUtils = {
    buildPdfDocument,
    createPdfBlob,
  };
})();
