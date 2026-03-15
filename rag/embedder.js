/**
 * RAG Embedder — Generate vector embeddings using Gemini text-embedding-004
 */
import { GoogleGenAI } from '@google/genai';

let ai;
function getAI() {
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * Generate embedding vector for a single text
 * @param {string} text
 * @returns {Promise<number[]>} Embedding vector
 */
export async function embedText(text) {
  const genai = getAI();
  const response = await genai.models.embedContent({
    model: EMBEDDING_MODEL,
    content: text,
  });
  return response.embedding.values;
}

/**
 * Generate embeddings for multiple texts in rate-limited batches
 * @param {string[]} texts
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function embedBatch(texts) {
  const embeddings = [];
  const batchSize = 5;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(t => embedText(t)));
    embeddings.push(...results);

    // Delay between batches to respect rate limits
    if (i + batchSize < texts.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return embeddings;
}
