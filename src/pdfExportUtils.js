(function () {
  function downloadPdfFromMarkdown(markdown, filename) {
    const blob = window.YTPdfUtils.createPdfBlob(markdown);
    downloadBlob(blob, filename);
  }

  async function convertMarkdownFileToPdf(file, preferredFilename) {
    const markdown = await file.text();
    if (!markdown.trim()) {
      throw new Error("Selected Markdown file is empty.");
    }

    const filename =
      preferredFilename ||
      `${sanitizeFilename(stripMdExtension(file.name) || "summary")}.pdf`;

    downloadPdfFromMarkdown(markdown, filename);
    return { filename, markdown };
  }

  function stripMdExtension(filename) {
    return filename.replace(/\.md$/i, "");
  }

  function sanitizeFilename(name) {
    return name
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .slice(0, 60);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  window.YTPdfExportUtils = {
    downloadPdfFromMarkdown,
    convertMarkdownFileToPdf,
  };
})();
