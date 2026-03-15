import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'chatbot.db'));

// Performance optimizations
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ==========================================
// Schema
// ==========================================
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT 'New Chat',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'model')),
    content TEXT NOT NULL,
    file_name TEXT,
    file_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS knowledge_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    chunk_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'processing',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    chunk_index INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
  );
`);

// ==========================================
// Default Settings
// ==========================================
const initSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
initSetting.run('system_prompt', 'Kamu adalah asisten AI yang membantu. Jawab pertanyaan dengan jelas dan ringkas. Gunakan format markdown jika diperlukan.');
initSetting.run('model', 'gemini-2.5-flash');
initSetting.run('temperature', '0.7');

export default db;
