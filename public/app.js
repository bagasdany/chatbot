// ==========================================
// Talismanic AI Chat — Frontend Application
// ==========================================

// ---------- State ----------
const state = {
  conversations: [],
  currentConversationId: null,
  messages: [],
  settings: {},
  isLoading: false,
  currentView: 'chat',
  dbPage: 1,
  selectedFile: null
};

// ---------- DOM Helpers ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- Configure Marked ----------
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true
});

// ==========================================
// API Layer
// ==========================================
const api = {
  async getConversations() {
    const res = await fetch('/api/conversations');
    return res.json();
  },
  async createConversation() {
    const res = await fetch('/api/conversations', { method: 'POST' });
    return res.json();
  },
  async getConversation(id) {
    const res = await fetch(`/api/conversations/${id}`);
    return res.json();
  },
  async deleteConversation(id) {
    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    return res.json();
  },
  async sendMessage(conversationId, message, file) {
    const formData = new FormData();
    if (conversationId) formData.append('conversationId', conversationId);
    if (message) formData.append('message', message);
    if (file) formData.append('file', file);
    const res = await fetch('/api/chat', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to send message');
    }
    return res.json();
  },
  async getSettings() {
    const res = await fetch('/api/settings');
    return res.json();
  },
  async saveSettings(settings) {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    return res.json();
  },
  async getDbStats() {
    const res = await fetch('/api/db/stats');
    return res.json();
  },
  async getDbMessages(page = 1) {
    const res = await fetch(`/api/db/messages?page=${page}&limit=30`);
    return res.json();
  },
  // Knowledge Base
  async getKnowledgeDocs() {
    const res = await fetch('/api/knowledge');
    return res.json();
  },
  async uploadKnowledgeDoc(file) {
    const formData = new FormData();
    formData.append('document', file);
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
  async deleteKnowledgeDoc(id) {
    const res = await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    return res.json();
  },
  async getKnowledgeDocStatus(id) {
    const res = await fetch(`/api/knowledge/${id}/status`);
    return res.json();
  }
};

// ==========================================
// Render: Conversations Sidebar
// ==========================================
function renderConversations(filter = '') {
  const list = $('conversation-list');
  const filtered = state.conversations.filter(c =>
    c.title.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <p>${filter ? 'Tidak ada hasil' : 'Belum ada percakapan'}</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(c => `
    <div class="conversation-item ${c.id === state.currentConversationId ? 'active' : ''}"
         onclick="loadConversation(${c.id})">
      <div class="conv-icon">💬</div>
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(c.title)}</div>
        <div class="conv-preview">${c.last_message ? escapeHtml(c.last_message).substring(0, 40) : 'Empty chat'}</div>
      </div>
      ${c.message_count ? `<span class="conv-count">${c.message_count}</span>` : ''}
    </div>
  `).join('');
}

// ==========================================
// Render: Chat Messages
// ==========================================
function renderMessages() {
  const container = $('chat-messages');
  const welcome = $('welcome-screen');

  if (state.messages.length === 0) {
    welcome.style.display = 'flex';
    // Remove any message rows
    container.querySelectorAll('.message-row').forEach(el => el.remove());
    return;
  }

  welcome.style.display = 'none';

  // Build messages HTML
  const messagesHtml = state.messages.map(msg => {
    const isUser = msg.role === 'user';
    const avatar = isUser ? '👤' : '✦';
    let content = '';

    // File badge
    if (msg.file_name) {
      content += `<div class="file-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        ${escapeHtml(msg.file_name)}
      </div>`;
    }

    // Message content
    if (isUser) {
      content += escapeHtml(msg.content);
    } else {
      content += renderMarkdown(msg.content);
    }

    return `
      <div class="message-row ${msg.role}">
        <div class="message-avatar">${avatar}</div>
        <div class="message-bubble">${content}</div>
      </div>`;
  }).join('');

  // Keep welcome screen in DOM but hidden, update message rows
  const existingMessages = container.querySelectorAll('.message-row, .typing-row');
  existingMessages.forEach(el => el.remove());

  container.insertAdjacentHTML('beforeend', messagesHtml);
  scrollToBottom();
}

function addTypingIndicator() {
  const container = $('chat-messages');
  const typing = document.createElement('div');
  typing.className = 'message-row model typing-row';
  typing.innerHTML = `
    <div class="message-avatar">✦</div>
    <div class="message-bubble">
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>`;
  container.appendChild(typing);
  scrollToBottom();
}

function removeTypingIndicator() {
  const typing = document.querySelector('.typing-row');
  if (typing) typing.remove();
}

function scrollToBottom() {
  const container = $('chat-messages');
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ==========================================
// Render: Markdown with Code Copy
// ==========================================
function renderMarkdown(text) {
  let html = marked.parse(text || '');

  // Wrap code blocks with copy button
  html = html.replace(/<pre><code class="language-(\w+)">/g,
    `<pre><div class="code-header"><span>$1</span><button class="btn-copy-code" onclick="copyCode(this)">Copy</button></div><code class="language-$1">`);
  html = html.replace(/<pre><code>/g,
    `<pre><div class="code-header"><span>code</span><button class="btn-copy-code" onclick="copyCode(this)">Copy</button></div><code>`);

  return html;
}

// ==========================================
// Render: Database Viewer
// ==========================================
async function renderDbViewer() {
  // Stats
  const stats = await api.getDbStats();
  $('db-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.conversations}</div><div class="stat-label">Conversations</div></div>
    <div class="stat-card"><div class="stat-value">${stats.totalMessages}</div><div class="stat-label">Total Messages</div></div>
    <div class="stat-card"><div class="stat-value">${stats.userMessages}</div><div class="stat-label">User Messages</div></div>
    <div class="stat-card"><div class="stat-value">${stats.aiMessages}</div><div class="stat-label">AI Messages</div></div>
  `;

  // Messages table
  const data = await api.getDbMessages(state.dbPage);
  const tbody = $('db-table-body');

  if (data.messages.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">Belum ada data</td></tr>`;
  } else {
    tbody.innerHTML = data.messages.map(m => `
      <tr>
        <td>${m.id}</td>
        <td>${escapeHtml(m.conversation_title)}</td>
        <td><span class="role-badge ${m.role}">${m.role}</span></td>
        <td title="${escapeHtml(m.content)}">${escapeHtml(m.content).substring(0, 80)}${m.content.length > 80 ? '...' : ''}</td>
        <td>${m.file_name ? escapeHtml(m.file_name) : '—'}</td>
        <td>${formatDate(m.created_at)}</td>
      </tr>
    `).join('');
  }

  // Pagination
  const totalPages = Math.ceil(data.total / data.limit);
  const pagination = $('db-pagination');

  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  let paginationHtml = `<button onclick="goDbPage(${state.dbPage - 1})" ${state.dbPage <= 1 ? 'disabled' : ''}>← Prev</button>`;
  paginationHtml += `<span class="page-info">Page ${state.dbPage} of ${totalPages}</span>`;
  paginationHtml += `<button onclick="goDbPage(${state.dbPage + 1})" ${state.dbPage >= totalPages ? 'disabled' : ''}>Next →</button>`;
  pagination.innerHTML = paginationHtml;
}

// ==========================================
// Actions
// ==========================================
async function loadConversations() {
  state.conversations = await api.getConversations();
  renderConversations();
}

async function loadConversation(id) {
  state.currentConversationId = id;
  const data = await api.getConversation(id);
  state.messages = data.messages || [];

  $('chat-title').textContent = data.title || 'New Chat';
  $('btn-delete-chat').style.display = 'flex';
  $('chat-model').textContent = state.settings.model || 'gemini-2.5-flash';

  renderMessages();
  renderConversations();
  showView('chat');

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    $('sidebar').classList.remove('open');
  }
}

async function createNewChat() {
  state.currentConversationId = null;
  state.messages = [];
  $('chat-title').textContent = 'Talismanic AI';
  $('btn-delete-chat').style.display = 'none';
  renderMessages();
  renderConversations();
  showView('chat');
  $('message-input').focus();
}

async function deleteCurrentConversation() {
  if (!state.currentConversationId) return;
  if (!confirm('Hapus percakapan ini?')) return;

  await api.deleteConversation(state.currentConversationId);
  toast('Percakapan dihapus', 'success');
  createNewChat();
  loadConversations();
}

async function sendMessage() {
  const input = $('message-input');
  const message = input.value.trim();
  const file = state.selectedFile;

  if (!message && !file) return;
  if (state.isLoading) return;

  state.isLoading = true;
  input.value = '';
  input.style.height = 'auto';
  removeFile();
  updateSendButton();

  // Immediately show user message in UI
  const userMsg = {
    role: 'user',
    content: message || '(file uploaded)',
    file_name: file?.name || null,
    file_type: file?.type || null
  };
  state.messages.push(userMsg);

  // Hide welcome screen
  $('welcome-screen').style.display = 'none';
  renderMessages();
  addTypingIndicator();

  try {
    const response = await api.sendMessage(state.currentConversationId, message, file);

    // Update conversation ID (in case it was newly created)
    state.currentConversationId = response.conversationId;
    $('btn-delete-chat').style.display = 'flex';

    // Add AI response
    state.messages.push({
      role: 'model',
      content: response.message
    });

    removeTypingIndicator();
    renderMessages();

    // Refresh sidebar
    await loadConversations();

    // Update title
    const conv = state.conversations.find(c => c.id === state.currentConversationId);
    if (conv) $('chat-title').textContent = conv.title;

  } catch (error) {
    removeTypingIndicator();
    toast(error.message || 'Gagal mengirim pesan', 'error');
    // Remove the user message we optimistically added
    state.messages.pop();
    renderMessages();
  } finally {
    state.isLoading = false;
  }
}

async function loadSettings() {
  state.settings = await api.getSettings();
  $('setting-system-prompt').value = state.settings.system_prompt || '';
  $('setting-model').value = state.settings.model || 'gemini-2.5-flash';
  $('setting-temperature').value = state.settings.temperature || '0.7';
  $('temp-value').textContent = state.settings.temperature || '0.7';
  $('chat-model').textContent = state.settings.model || 'gemini-2.5-flash';
}

async function saveSettings() {
  const settings = {
    system_prompt: $('setting-system-prompt').value,
    model: $('setting-model').value,
    temperature: $('setting-temperature').value
  };
  await api.saveSettings(settings);
  state.settings = settings;
  $('chat-model').textContent = settings.model;
  toast('Settings saved!', 'success');
}

// ==========================================
// View Management
// ==========================================
function showView(view) {
  state.currentView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`view-${view}`).classList.add('active');

  if (view === 'db') renderDbViewer();
  if (view === 'settings') loadSettings();
  if (view === 'knowledge') renderKnowledgeBase();
}

// ==========================================
// File Handling
// ==========================================
function handleFileSelect(file) {
  if (!file) return;

  // Limit to 10MB
  if (file.size > 10 * 1024 * 1024) {
    toast('File terlalu besar (max 10MB)', 'error');
    return;
  }

  state.selectedFile = file;
  const preview = $('file-preview');
  const content = $('file-preview-content');
  preview.classList.remove('hidden');

  const isImage = file.type.startsWith('image/');
  const size = formatFileSize(file.size);

  if (isImage) {
    const url = URL.createObjectURL(file);
    content.innerHTML = `
      <img src="${url}" class="file-preview-thumb" alt="preview" />
      <div class="file-preview-info">
        <div class="file-preview-name">${escapeHtml(file.name)}</div>
        <div class="file-preview-size">${size}</div>
      </div>`;
  } else {
    content.innerHTML = `
      <div class="file-preview-icon">📄</div>
      <div class="file-preview-info">
        <div class="file-preview-name">${escapeHtml(file.name)}</div>
        <div class="file-preview-size">${size}</div>
      </div>`;
  }

  updateSendButton();
}

function removeFile() {
  state.selectedFile = null;
  $('file-preview').classList.add('hidden');
  $('file-input').value = '';
  updateSendButton();
}

// ==========================================
// UI Helpers
// ==========================================
function updateSendButton() {
  const message = $('message-input').value.trim();
  $('btn-send').disabled = !message && !state.selectedFile;
}

function toggleSidebar() {
  $('sidebar').classList.toggle('open');
}

function useSuggestion(btn) {
  const text = btn.textContent.replace(/^[^\s]+\s/, ''); // remove emoji
  $('message-input').value = text;
  updateSendButton();
  $('message-input').focus();
}

function copyCode(btn) {
  const code = btn.closest('pre').querySelector('code');
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

function goDbPage(page) {
  if (page < 1) return;
  state.dbPage = page;
  renderDbViewer();
}

function toast(message, type = 'info') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ==========================================
// Utility
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'Z');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Auto resize textarea
function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

// ==========================================
// Event Listeners
// ==========================================
function initEventListeners() {
  // Chat form submit
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  // Textarea: auto resize + Enter to send
  const input = $('message-input');
  input.addEventListener('input', () => {
    autoResize(input);
    updateSendButton();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // File input
  $('file-input').addEventListener('change', (e) => {
    handleFileSelect(e.target.files[0]);
  });

  // New chat
  $('btn-new-chat').addEventListener('click', createNewChat);

  // Search conversations
  $('search-conversations').addEventListener('input', (e) => {
    renderConversations(e.target.value);
  });

  // Temperature slider
  $('setting-temperature').addEventListener('input', (e) => {
    $('temp-value').textContent = e.target.value;
  });

  // Drag and drop
  const chatArea = $('chat-messages');
  chatArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatArea.style.outline = '2px dashed var(--accent)';
    chatArea.style.outlineOffset = '-12px';
  });
  chatArea.addEventListener('dragleave', () => {
    chatArea.style.outline = '';
    chatArea.style.outlineOffset = '';
  });
  chatArea.addEventListener('drop', (e) => {
    e.preventDefault();
    chatArea.style.outline = '';
    chatArea.style.outlineOffset = '';
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    const sidebar = $('sidebar');
    const toggle = $('sidebar-toggle');
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    }
  });

  // Knowledge Base: file input
  $('kb-file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await uploadKnowledgeDoc(file);
    }
    e.target.value = '';
  });

  // Knowledge Base: drag & drop
  const kbArea = $('kb-upload-area');
  kbArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    kbArea.classList.add('drag-over');
  });
  kbArea.addEventListener('dragleave', () => kbArea.classList.remove('drag-over'));
  kbArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    kbArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await uploadKnowledgeDoc(file);
    }
  });
}

// ==========================================
// Initialize
// ==========================================
async function init() {
  initEventListeners();
  await loadSettings();
  await loadConversations();

  // If there are existing conversations, you could auto-load the latest:
  // if (state.conversations.length > 0) loadConversation(state.conversations[0].id);
}

init();

// ==========================================
// Knowledge Base Functions
// ==========================================
let kbPollingTimers = {};

async function renderKnowledgeBase() {
  const docs = await api.getKnowledgeDocs();
  const container = $('kb-documents');

  if (docs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>Belum ada dokumen di knowledge base</p>
      </div>`;
    return;
  }

  container.innerHTML = docs.map(doc => {
    const iconClass = doc.status;
    const icon = doc.status === 'ready' ? '✅' : doc.status === 'processing' ? '⏳' : doc.status === 'error' ? '❌' : '⚠️';
    const statusHtml = doc.status === 'processing'
      ? `<span class="kb-status processing"><span class="kb-spinner"></span> Processing</span>`
      : `<span class="kb-status ${doc.status}">${doc.status}</span>`;

    return `
      <div class="kb-doc-card" data-doc-id="${doc.id}">
        <div class="kb-doc-icon ${iconClass}">${icon}</div>
        <div class="kb-doc-info">
          <div class="kb-doc-name">${escapeHtml(doc.filename)}</div>
          <div class="kb-doc-meta">
            ${statusHtml}
            ${doc.chunk_count ? `<span>${doc.chunk_count} chunks</span>` : ''}
            <span>${formatFileSize(doc.file_size || 0)}</span>
            <span>${formatDate(doc.created_at)}</span>
          </div>
        </div>
        <button class="kb-btn-delete" onclick="deleteKnowledgeDoc(${doc.id})" title="Delete document">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>`;
  }).join('');

  // Start polling for any processing documents
  docs.filter(d => d.status === 'processing').forEach(doc => {
    pollDocStatus(doc.id);
  });
}

async function uploadKnowledgeDoc(file) {
  try {
    toast(`Uploading: ${file.name}...`, 'info');
    const result = await api.uploadKnowledgeDoc(file);
    toast(`${file.name} sedang diproses...`, 'info');
    await renderKnowledgeBase();
    // Start polling for this document
    pollDocStatus(result.id);
  } catch (error) {
    toast(`Gagal upload: ${error.message}`, 'error');
  }
}

async function deleteKnowledgeDoc(id) {
  if (!confirm('Hapus dokumen ini dari knowledge base?')) return;
  // Stop polling if active
  if (kbPollingTimers[id]) {
    clearInterval(kbPollingTimers[id]);
    delete kbPollingTimers[id];
  }
  await api.deleteKnowledgeDoc(id);
  toast('Dokumen dihapus', 'success');
  await renderKnowledgeBase();
}

function pollDocStatus(docId) {
  // Avoid duplicate polling
  if (kbPollingTimers[docId]) return;

  kbPollingTimers[docId] = setInterval(async () => {
    try {
      const doc = await api.getKnowledgeDocStatus(docId);
      if (doc.status !== 'processing') {
        clearInterval(kbPollingTimers[docId]);
        delete kbPollingTimers[docId];
        if (doc.status === 'ready') {
          toast(`✅ ${doc.filename} siap digunakan! (${doc.chunk_count} chunks)`, 'success');
        } else if (doc.status === 'error') {
          toast(`❌ Gagal memproses ${doc.filename}`, 'error');
        }
        // Re-render to update status
        if (state.currentView === 'knowledge') {
          renderKnowledgeBase();
        }
      }
    } catch (err) {
      clearInterval(kbPollingTimers[docId]);
      delete kbPollingTimers[docId];
    }
  }, 3000); // Check every 3 seconds
}
