import { extractText, getDocumentProxy } from 'unpdf';

const LOG_PREFIX = '[PdfService]';

export class PdfService {
  async extractText(buffer: Buffer): Promise<string> {
    console.log(`${LOG_PREFIX} Extracting text from PDF (bufferSize=${buffer.length})`);
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      console.log(`${LOG_PREFIX} Extracted ${text.length} characters, pages=${totalPages}`);
      return text.trim();
    } catch (error) {
      console.error(`${LOG_PREFIX} PDF extraction failed:`, error);
      throw error;
    }
  }

  chunkText(text: string, minWords = 500, maxWords = 800, overlap = 50): string[] {
    const words = text.split(/\s+/);
    console.log(`${LOG_PREFIX} Chunking ${words.length} words (minWords=${minWords}, maxWords=${maxWords}, overlap=${overlap})`);

    if (words.length <= maxWords) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + maxWords, words.length);
      const chunk = words.slice(start, end).join(' ');
      chunks.push(chunk);

      if (end >= words.length) break;

      const wordsUsed = end - start;
      const nextStart = wordsUsed > minWords
        ? start + maxWords - overlap
        : start + Math.floor(wordsUsed / 2);

      start = Math.min(nextStart, words.length - 1);
    }

    console.log(`${LOG_PREFIX} Created ${chunks.length} chunks`);
    return chunks;
  }

  suggestDeckName(filename: string, topicCounts: Map<string, number>): string {
    const nameFromFile = filename
      .replace(/\.pdf$/i, '')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (nameFromFile && !/^document$/i.test(nameFromFile)) {
      return nameFromFile;
    }

    let bestTopic = '';
    let bestCount = 0;
    topicCounts.forEach((count, topic) => {
      if (count > bestCount) {
        bestCount = count;
        bestTopic = topic;
      }
    });

    if (bestTopic) {
      return `${bestTopic} - Flashcards`;
    }

    return 'Generated Flashcards';
  }
}

export const pdfService = new PdfService();
