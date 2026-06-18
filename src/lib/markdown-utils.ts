export function formatMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  const formatted = paragraphs.map((p) => {
    const lines = p.split('\n');
    return lines
      .map((line, i, arr) => {
        if (line.trim() === '$$') return line;
        if (i < arr.length - 1) return line + '  ';
        return line;
      })
      .join('\n');
  });
  return formatted.join('\n\n');
}
