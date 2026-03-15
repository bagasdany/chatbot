import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import cors from 'cors';
import db from './db/database.js';
import { chunkText, extractText } from './rag/chunker.js';
import { embedBatch } from './rag/embedder.js';
import { retrieveContext } from './rag/retriever.js';
import mysqlPool, { initMySQL } from './db/mysql.js';

// Init MySQL schema
initMySQL();

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ==========================================
// Helper
// ==========================================
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

// ==========================================
// API: Conversations
// ==========================================
app.get('/api/conversations', (req, res) => {
  const conversations = db.prepare(`
    SELECT c.*,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
    FROM conversations c
    ORDER BY c.updated_at DESC
  `).all();
  res.json(conversations);
});

app.post('/api/conversations', (req, res) => {
  const result = db.prepare('INSERT INTO conversations (title) VALUES (?)').run('New Chat');
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
  res.json(conversation);
});

app.get('/api/conversations/:id', (req, res) => {
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ ...conversation, messages });
});

app.delete('/api/conversations/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==========================================
// API: Chat
// ==========================================
app.post('/api/chat', upload.single('file'), async (req, res) => {
  try {
    let { conversationId, message } = req.body;
    const file = req.file;

    if (!message && !file) {
      return res.status(400).json({ error: 'Message or file is required' });
    }

    // Create conversation if needed
    if (!conversationId) {
      const result = db.prepare('INSERT INTO conversations (title) VALUES (?)').run('New Chat');
      conversationId = result.lastInsertRowid;
    }

    // Save user message to DB
    db.prepare('INSERT INTO messages (conversation_id, role, content, file_name, file_type) VALUES (?, ?, ?, ?, ?)')
      .run(conversationId, 'user', message || '(file uploaded)', file?.originalname || null, file?.mimetype || null);

    // Update conversation timestamp
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);

    // Load full conversation history for context
    const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId);

    // Build Gemini request
    const systemPrompt = getSetting('system_prompt');
    const model = getSetting('model') || 'gemini-2.5-flash';
    const temperature = parseFloat(getSetting('temperature') || '0.7');

    // Build contents: all previous messages (excluding the latest user msg we just inserted)
    const contents = history.slice(0, -1).map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    // Current message parts (text + optional file)
    const currentParts = [];
    if (message) currentParts.push({ text: message });
    if (file) {
      const base64 = file.buffer.toString('base64');
      currentParts.push({ inlineData: { data: base64, mimeType: file.mimetype } });
    }
    if (currentParts.length === 0) currentParts.push({ text: '(file uploaded)' });
    contents.push({ role: 'user', parts: currentParts });

    // RAG: Search knowledge base for relevant context
    let augmentedSystemPrompt = systemPrompt || '';
    try {
      const ragResults = await retrieveContext(message || '');
      if (ragResults.length > 0) {
        const contextText = ragResults.map(r =>
          `[Sumber: ${r.filename} | Relevansi: ${(r.score * 100).toFixed(0)}%]\n${r.content}`
        ).join('\n\n---\n\n');
        augmentedSystemPrompt += `\n\nBerikut adalah informasi dari knowledge base yang relevan. Gunakan informasi ini untuk menjawab pertanyaan user jika relevan:\n\n${contextText}`;
      }
    } catch (ragError) {
      console.error('RAG error (non-fatal):', ragError.message);
    }

    // Call Gemini
    const aiResponse = await ai.models.generateContent({
      model,
      contents,
      config: {
        temperature,
        systemInstruction: augmentedSystemPrompt
      }
    });

    const aiText = aiResponse.text;

    // Save AI response to DB
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(conversationId, 'model', aiText);

    // Auto-generate title from first user message
    const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?').get(conversationId);
    if (msgCount.count <= 2) {
      const title = (message || 'File Analysis').substring(0, 60);
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId);
    }

    res.json({
      conversationId: Number(conversationId),
      message: aiText,
      metadata: aiResponse.usageMetadata
    });
  } catch (error) {
    console.error('Chat error:', error);
    if (error.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Tunggu sebentar ya.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Settings
// ==========================================
app.get('/api/settings', (req, res) => {
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(row => {
    settings[row.key] = row.value;
  });
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const updates = req.body;
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const transaction = db.transaction((entries) => {
    for (const [key, value] of entries) {
      stmt.run(key, String(value));
    }
  });
  transaction(Object.entries(updates));
  res.json({ success: true });
});

// ==========================================
// API: Database Viewer
// ==========================================
app.get('/api/db/stats', (req, res) => {
  const convos = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
  const msgs = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const userMsgs = db.prepare("SELECT COUNT(*) as count FROM messages WHERE role = 'user'").get();
  const aiMsgs = db.prepare("SELECT COUNT(*) as count FROM messages WHERE role = 'model'").get();
  res.json({
    conversations: convos.count,
    totalMessages: msgs.count,
    userMessages: userMsgs.count,
    aiMessages: aiMsgs.count
  });
});

app.get('/api/db/messages', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const messages = db.prepare(`
    SELECT m.*, c.title as conversation_title
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  res.json({ messages, total: total.count, page, limit });
});

// ==========================================
// API: Knowledge Base
// ==========================================
app.get('/api/knowledge', (req, res) => {
  const documents = db.prepare('SELECT * FROM knowledge_documents ORDER BY created_at DESC').all();
  res.json(documents);
});

app.post('/api/knowledge/upload', upload.single('document'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  // Insert document record with 'processing' status
  const result = db.prepare(
    'INSERT INTO knowledge_documents (filename, file_type, file_size, status) VALUES (?, ?, ?, ?)'
  ).run(file.originalname, file.mimetype, file.size, 'processing');

  const docId = result.lastInsertRowid;

  // Return immediately, process in background
  res.json({ id: Number(docId), status: 'processing', filename: file.originalname });

  // Background processing: extract → chunk → embed → store
  processDocument(docId, file).catch(err => {
    console.error('Document processing error:', err);
    db.prepare("UPDATE knowledge_documents SET status = 'error' WHERE id = ?").run(docId);
  });
});

app.delete('/api/knowledge/:id', (req, res) => {
  db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(req.params.id);
  db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/knowledge/:id/status', (req, res) => {
  const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
});

/**
 * Background document processing pipeline
 * 1. Extract text (Gemini for PDFs, direct read for text files)
 * 2. Chunk text into overlapping segments
 * 3. Generate embeddings via Gemini text-embedding-004
 * 4. Store chunks + embeddings in SQLite
 */
async function processDocument(docId, file) {
  try {
    console.log(`📄 Processing: ${file.originalname}`);

    // Step 1: Extract text
    const text = await extractText(file.buffer, file.mimetype, ai);
    if (!text || text.trim().length === 0) {
      db.prepare("UPDATE knowledge_documents SET status = 'empty', chunk_count = 0 WHERE id = ?").run(docId);
      console.log(`⚠️  Empty document: ${file.originalname}`);
      return;
    }

    // Step 2: Chunk text
    const chunks = chunkText(text);
    console.log(`📦 ${chunks.length} chunks created`);

    if (chunks.length === 0) {
      db.prepare("UPDATE knowledge_documents SET status = 'empty', chunk_count = 0 WHERE id = ?").run(docId);
      return;
    }

    // Step 3: Generate embeddings
    console.log(`🔢 Generating embeddings...`);
    const embeddings = await embedBatch(chunks);

    // Step 4: Store chunks with embeddings
    const insertChunk = db.prepare(
      'INSERT INTO knowledge_chunks (document_id, content, embedding, chunk_index) VALUES (?, ?, ?, ?)'
    );
    const insertAll = db.transaction((items) => {
      for (const item of items) {
        insertChunk.run(item.docId, item.content, JSON.stringify(item.embedding), item.index);
      }
    });

    insertAll(chunks.map((content, index) => ({
      docId, content, embedding: embeddings[index], index
    })));

    // Step 5: Mark as ready
    db.prepare("UPDATE knowledge_documents SET status = 'ready', chunk_count = ? WHERE id = ?").run(chunks.length, docId);
    console.log(`✅ Ready: ${file.originalname} (${chunks.length} chunks)`);

  } catch (error) {
    console.error(`❌ Processing failed: ${file.originalname}`, error.message);
    db.prepare("UPDATE knowledge_documents SET status = 'error' WHERE id = ?").run(docId);
  }
}

// ==========================================
// API: MySQL Dashboard
// ==========================================
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const [bookingCount] = await mysqlPool.query("SELECT COUNT(*) as count FROM bookings WHERE status != 'cancelled'");
    const [orderTotal] = await mysqlPool.query("SELECT SUM(amount) as total FROM orders WHERE status = 'paid'");
    const [recentBookings] = await mysqlPool.query("SELECT COUNT(*) as count FROM bookings WHERE created_at >= NOW() - INTERVAL 7 DAY");
    
    res.json({
      activeBookings: bookingCount[0].count,
      totalRevenue: orderTotal[0].total || 0,
      newBookingsWeek: recentBookings[0].count
    });
  } catch (error) {
    if (error.code === 'ECONNREFUSED') return res.json({ activeBookings: '-', totalRevenue: '-', newBookingsWeek: '-' });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/bookings', async (req, res) => {
  try {
    const [bookings] = await mysqlPool.query('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 50');
    res.json(bookings);
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/dashboard/orders', async (req, res) => {
  try {
    const [orders] = await mysqlPool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50');
    res.json(orders);
  } catch (error) {
    res.json([]);
  }
});

// ==========================================
// Start server
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Talismanic AI Chat running at http://localhost:${PORT}`);
});
