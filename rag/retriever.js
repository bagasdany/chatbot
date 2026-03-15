/**
 * RAG Retriever — Search knowledge base for relevant context using cosine similarity
 */
import db from '../db/database.js';
import { embedText } from './embedder.js';

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Retrieve relevant context from knowledge base
 * @param {string} query - User's question
 * @param {number} topK - Number of top results
 * @param {number} threshold - Minimum similarity score (0-1)
 * @returns {Promise<Array<{content, filename, score}>>}
 */
export async function retrieveContext(query, topK = 3, threshold = 0.35) {
  // Check if knowledge base has any documents
  const docCount = db.prepare("SELECT COUNT(*) as count FROM knowledge_documents WHERE status = 'ready'").get();
  if (!docCount || docCount.count === 0) return [];

  // Don't search for very short queries
  if (!query || query.trim().length < 3) return [];

  // Generate query embedding
  const queryEmbedding = await embedText(query);

  // Load all chunks with embeddings
  const chunks = db.prepare(`
    SELECT kc.id, kc.content, kc.embedding, kd.filename
    FROM knowledge_chunks kc
    JOIN knowledge_documents kd ON kc.document_id = kd.id
    WHERE kd.status = 'ready' AND kc.embedding IS NOT NULL
  `).all();

  if (chunks.length === 0) return [];

  // Calculate similarities and rank
  const scored = chunks.map(chunk => ({
    content: chunk.content,
    filename: chunk.filename,
    score: cosineSimilarity(queryEmbedding, JSON.parse(chunk.embedding))
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .filter(r => r.score >= threshold)
    .slice(0, topK);
}
