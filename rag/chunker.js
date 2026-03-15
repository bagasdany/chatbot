/**
 * RAG Chunker — Split documents into overlapping chunks for embedding
 */

/**
 * Split text into overlapping chunks
 * @param {string} text - The full text to chunk
 * @param {object} options - chunkSize and overlap in characters
 * @returns {string[]} Array of text chunks
 */
export function chunkText(text, { chunkSize = 800, overlap = 150 } = {}) {
  if (!text || text.trim().length === 0) return [];

  // Normalize whitespace
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if ((currentChunk + '\n\n' + trimmed).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep overlap from end of previous chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 6));
      currentChunk = overlapWords.join(' ') + '\n\n' + trimmed;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
  }

  if (currentChunk.trim().length > 20) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Extract text from a file buffer.
 * Text-based files are read directly; PDFs and other formats use Gemini AI for extraction.
 * @param {Buffer} buffer - File contents
 * @param {string} mimeType - MIME type
 * @param {object} ai - GoogleGenAI instance
 * @returns {Promise<string>} Extracted text
 */
export async function extractText(buffer, mimeType, ai) {
  // Text-based files: read directly (no API call needed)
  const textTypes = ['text/plain', 'text/csv', 'text/markdown', 'text/html', 'application/json'];
  if (textTypes.some(t => mimeType === t || mimeType.startsWith('text/'))) {
    return buffer.toString('utf-8');
  }

  // PDFs, images, and other binary formats: use Gemini to extract text
  const base64 = buffer.toString('base64');
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        text: 'Extract ALL text content from this document. Return ONLY the raw extracted text with no commentary, no prefixes, no markdown code fences. Preserve the original structure (headings, lists, paragraphs, tables).',
        type: 'text'
      },
      { inlineData: { data: base64, mimeType } }
    ]
  });

  return response.text;
}
