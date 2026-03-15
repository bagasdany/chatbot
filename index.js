import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import cors from 'cors';
import db from './db/database.js';

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

    // Call Gemini
    const aiResponse = await ai.models.generateContent({
      model,
      contents,
      config: {
        temperature,
        systemInstruction: systemPrompt
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
// Start server
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Talismanic AI Chat running at http://localhost:${PORT}`);
});
