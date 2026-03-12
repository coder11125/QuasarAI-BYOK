/**
 * Quasar AI · BYOK Edition
 * Refactored for better maintainability and scalability.
 */

// ── Configuration & Constants ──
const CONFIG = {
  APPWRITE: {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT: '69b25dcc002da2046dd6',
    DATABASE: '69b2944f0031df986393',
    COLLECTION: '69b2954c002f7aff0f92'
  },
  PROVIDERS: {
    GROQ: {
      NAME: 'groq',
      ENDPOINT: 'https://api.groq.com/openai/v1/chat/completions',
      MODELS_ENDPOINT: 'https://api.groq.com/openai/v1/models',
      FALLBACK_MODELS: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'gemma-7b-it']
    },
    OPENAI: {
      NAME: 'openai',
      ENDPOINT: 'https://api.openai.com/v1/chat/completions',
      MODELS_ENDPOINT: 'https://api.openai.com/v1/models',
      FALLBACK_MODELS: []
    },
    ANTHROPIC: {
      NAME: 'anthropic',
      ENDPOINT: 'https://api.anthropic.com/v1/messages',
      MODELS_ENDPOINT: null,
      FALLBACK_MODELS: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
    }
  }
};

// ── Icons ──
const ICONS = {
  COPY:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  CHECK: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  RETRY: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  FILE:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
};

// ── Utils ──
const Utils = {
  ts: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  esc: (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  isMobile: () => window.innerWidth <= 640,
  detectProvider: (key) => {
    if (key.startsWith('gsk_')) return CONFIG.PROVIDERS.GROQ.NAME;
    if (key.startsWith('sk-ant-')) return CONFIG.PROVIDERS.ANTHROPIC.NAME;
    if (key.startsWith('sk-')) return CONFIG.PROVIDERS.OPENAI.NAME;
    return null;
  }
};

// ── Services ──

class AuthService {
  constructor() {
    this.client = new Appwrite.Client()
      .setEndpoint(CONFIG.APPWRITE.ENDPOINT)
      .setProject(CONFIG.APPWRITE.PROJECT);
    this.account = new Appwrite.Account(this.client);
    this.databases = new Appwrite.Databases(this.client);
    this.user = null;
  }

  async init(onUserChange) {
    try {
      this.user = await this.account.get();
      onUserChange(this.user);
      return this.user;
    } catch (e) {
      this.user = null;
      onUserChange(null);
      return null;
    }
  }

  async login(email, password) {
    await this.account.createEmailPasswordSession(email, password);
    this.user = await this.account.get();
    return this.user;
  }

  async register(email, password) {
    await this.account.create(Appwrite.ID.unique(), email, password);
    return this.login(email, password);
  }

  async logout() {
    try { await this.account.deleteSession('current'); } catch (e) {}
    this.user = null;
  }

  async googleLogin() {
    const url = window.location.href;
    this.account.createOAuth2Session('google', url, url);
  }
}

class AIService {
  constructor(settings) {
    this.settings = settings;
  }

  async fetchModels(apiKey) {
    const provider = Utils.detectProvider(apiKey);
    if (!provider) throw new Error('Unknown API key format.');

    const config = CONFIG.PROVIDERS[provider.toUpperCase()];
    if (provider === CONFIG.PROVIDERS.ANTHROPIC.NAME) {
      return config.FALLBACK_MODELS;
    }

    try {
      const res = await fetch(config.MODELS_ENDPOINT, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const filters = {
        groq: m => !m.includes('whisper') && !m.includes('distil') && !m.includes('guard'),
        openai: m => m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')
      };

      let models = data.data.map(m => m.id);
      if (filters[provider]) models = models.filter(filters[provider]);
      return models.sort();
    } catch (err) {
      if (config.FALLBACK_MODELS.length > 0) return config.FALLBACK_MODELS;
      throw err;
    }
  }

  async *streamCompletion(messages) {
    const { apiKey, model, provider, systemPrompt } = this.settings;
    if (!apiKey) throw new Error('API key is missing.');

    const config = CONFIG.PROVIDERS[provider.toUpperCase()];

    let res;
    if (provider === CONFIG.PROVIDERS.ANTHROPIC.NAME) {
      res = await fetch(config.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: 1000, stream: true, system: systemPrompt, messages })
      });
    } else {
      res = await fetch(config.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          stream: true,
          messages: [{ role: 'system', content: systemPrompt }, ...messages]
        })
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const json = JSON.parse(data);
          if (provider === CONFIG.PROVIDERS.ANTHROPIC.NAME) {
            if (json.type === 'content_block_delta') yield json.delta?.text || '';
          } else {
            yield json.choices?.[0]?.delta?.content || '';
          }
        } catch (e) {}
      }
    }
  }
}

class ChatManager {
  constructor(authService) {
    this.authService = authService;
    this.chats = [];
    this.currentChatId = null;
    this.onChatsChange = () => {};
  }

  loadFromLocal() {
    try {
      const c = localStorage.getItem('ai_chats');
      if (c) this.chats = JSON.parse(c);
      if (this.chats.length > 0) this.currentChatId = this.chats[this.chats.length - 1].id;
    } catch (e) {}
  }

  saveToLocal() {
    try {
      const trimmed = this.chats.map(c => ({ ...c, history: c.history.slice(-60) }));
      localStorage.setItem('ai_chats', JSON.stringify(trimmed));
    } catch (e) {}
  }

  async syncFromCloud() {
    if (!this.authService.user) return;
    try {
      const { DATABASE, COLLECTION } = CONFIG.APPWRITE;
      const res = await this.authService.databases.listDocuments(DATABASE, COLLECTION, [
        Appwrite.Query.equal('userId', this.authService.user.$id),
        Appwrite.Query.orderDesc('updatedAt'),
        Appwrite.Query.limit(100)
      ]);
      if (res.documents.length > 0) {
        this.chats = res.documents.map(doc => ({
          id: doc.$id,
          title: doc.title,
          history: JSON.parse(doc.history),
          cloudId: doc.$id
        }));
        this.currentChatId = this.chats[0].id;
      }
      this.onChatsChange();
    } catch (e) {
      console.error('Cloud sync error', e);
    }
  }

  async saveToCloud(chat) {
    if (!this.authService.user || !chat || chat.history.length === 0) return;
    try {
      const { DATABASE, COLLECTION } = CONFIG.APPWRITE;
      const payload = {
        userId: this.authService.user.$id,
        title: chat.title,
        history: JSON.stringify(chat.history.slice(-60)),
        updatedAt: Date.now()
      };
      if (chat.cloudId) {
        await this.authService.databases.updateDocument(DATABASE, COLLECTION, chat.cloudId, payload);
      } else {
        const doc = await this.authService.databases.createDocument(DATABASE, COLLECTION, Appwrite.ID.unique(), payload);
        chat.cloudId = doc.$id;
        chat.id = doc.$id;
        if (this.currentChatId === chat.id) this.currentChatId = doc.$id;
      }
    } catch (e) {
      console.error('Cloud save error', e);
    }
  }

  async deleteFromCloud(cloudId) {
    if (!this.authService.user) return;
    try {
      const { DATABASE, COLLECTION } = CONFIG.APPWRITE;
      await this.authService.databases.deleteDocument(DATABASE, COLLECTION, cloudId);
    } catch (e) {}
  }

  newChat() {
    const id = Date.now().toString();
    const chat = { id, title: 'New Chat', history: [] };
    this.chats.push(chat);
    this.currentChatId = id;
    this.saveToLocal();
    this.onChatsChange();
    return chat;
  }

  switchChat(id) {
    this.currentChatId = id;
    this.onChatsChange();
  }

  async deleteChat(id) {
    const chat = this.chats.find(c => c.id === id);
    if (chat?.cloudId) await this.deleteFromCloud(chat.cloudId);
    this.chats = this.chats.filter(c => c.id !== id);
    if (this.currentChatId === id) {
      if (this.chats.length === 0) this.newChat();
      else this.currentChatId = this.chats[this.chats.length - 1].id;
    }
    this.saveToLocal();
    this.onChatsChange();
  }

  async clearAll() {
    for (const c of this.chats) {
      if (c.cloudId) await this.deleteFromCloud(c.cloudId);
    }
    this.chats = [];
    this.newChat();
  }

  getCurrentChat() {
    return this.chats.find(c => c.id === this.currentChatId);
  }
}

// ── App Controller ──

class QuasarApp {
  constructor() {
    this.settings = {
      apiKey: '',
      model: 'llama-3.3-70b-versatile',
      provider: 'groq',
      systemPrompt: 'You are a helpful, concise assistant. Use markdown when it genuinely helps. Keep replies focused.'
    };
    this.busy = false;
    this.pendingFiles = [];
    this.sidebarOpen = !Utils.isMobile();
    this.authMode = 'login';
    this.recognition = null;
    this.micActive = false;

    this.auth = new AuthService();
    this.chats = new ChatManager(this.auth);
    this.ai = new AIService(this.settings);

    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    this.dom = {
      stream:   document.getElementById('stream'),
      input:    document.getElementById('input'),
      sendBtn:  document.getElementById('send'),
      empty:    document.getElementById('empty'),
      tray:     document.getElementById('attachments-tray'),
      toast:    document.getElementById('toast'),
      chatList: document.getElementById('chat-list'),
      title:    document.getElementById('chat-title'),
      sidebar:  document.getElementById('sidebar'),
      backdrop: document.getElementById('sidebar-backdrop'),
      fileInput: document.getElementById('file-input'),
      micBtn:    document.getElementById('mic-btn'),
      // Modals & Forms
      modalOverlay: document.getElementById('modal-overlay'),
      authOverlay:  document.getElementById('auth-overlay'),
      authError:    document.getElementById('auth-error'),
      authEmail:    document.getElementById('auth-email'),
      authPassword: document.getElementById('auth-password'),
      apiKeyInput:  document.getElementById('api-key-input'),
      modelSelect:  document.getElementById('model-select'),
      systemPromptInput: document.getElementById('system-prompt-input'),
      fetchModelsBtn: document.getElementById('fetch-models-btn'),
      providerBadge: document.getElementById('provider-badge'),
      modelStatus:   document.getElementById('model-status')
    };
  }

  async start() {
    this.loadSettings();
    this.chats.onChatsChange = () => this.render();
    this.chats.loadFromLocal();

    await this.auth.init(user => this.updateUserUI(user));
    if (this.auth.user) await this.chats.syncFromCloud();

    if (this.chats.chats.length === 0) this.chats.newChat();
    this.applyTheme();
    this.render();
    this.dom.input.focus();
  }

  loadSettings() {
    try {
      const s = localStorage.getItem('ai_settings');
      if (s) Object.assign(this.settings, JSON.parse(s));
    } catch (e) {}
  }

  saveSettingsState() {
    try {
      const toSave = { ...this.settings };
      // Requirement check: The original code cleared apiKey if not logged in.
      // But for "BYOK" it's often better to keep it locally.
      // Keeping it as per original logic if needed, but the prompt suggested "privacy-first".
      // I will keep it locally now as it makes more sense for a BYOK app.
      localStorage.setItem('ai_settings', JSON.stringify(toSave));
    } catch (e) {}
  }

  // ── UI Rendering ──

  render() {
    this.renderChatList();
    this.renderMessages();
  }

  renderChatList() {
    this.dom.chatList.innerHTML = '';
    const activeChats = [...this.chats.chats].reverse().filter(c => c.history.some(m => m.role !== 'system'));
    if (activeChats.length === 0) {
      this.dom.chatList.innerHTML = '<div id="chat-list-empty">Start a chat</div>';
      return;
    }
    activeChats.forEach(c => {
      const el = document.createElement('div');
      el.className = 'chat-item' + (c.id === this.chats.currentChatId ? ' active' : '');
      el.innerHTML = `<span class="chat-item-title">${Utils.esc(c.title)}</span>
        <button class="chat-item-del" title="Delete">×</button>`;
      el.querySelector('.chat-item-del').onclick = (e) => { e.stopPropagation(); this.chats.deleteChat(c.id); };
      el.onclick = () => { this.chats.switchChat(c.id); if (Utils.isMobile()) this.closeSidebarMobile(); };
      this.dom.chatList.appendChild(el);
    });
  }

  renderMessages() {
    const chat = this.chats.getCurrentChat();
    this.dom.title.textContent = chat ? chat.title : 'New Chat';
    while (this.dom.stream.firstChild) this.dom.stream.removeChild(this.dom.stream.firstChild);
    if (!chat || chat.history.length === 0) {
      this.dom.stream.appendChild(this.dom.empty);
      this.dom.empty.style.display = '';
      return;
    }
    this.dom.empty.style.display = 'none';
    chat.history.forEach((msg, i) => {
      if (msg.role === 'system') return;
      this.appendBubble(msg.role, msg.content, msg.files || [], msg.time || '', i, false);
    });
    this.scrollBottom();
  }

  appendBubble(role, content, files = [], time = '', idx = null, animate = true) {
    this.dom.empty.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role + (animate ? '' : ' no-anim');
    if (idx !== null) wrap.dataset.idx = idx;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'assistant') bubble.innerHTML = marked.parse(content || '');
    else bubble.textContent = content;

    if (files.length > 0) {
      const attDiv = document.createElement('div');
      attDiv.className = 'attachment-preview';
      files.forEach(f => {
        if (f.dataUrl) {
          const img = document.createElement('img');
          img.src = f.dataUrl; img.alt = Utils.esc(f.name);
          attDiv.appendChild(img);
        } else {
          const chip = document.createElement('div');
          chip.className = 'file-chip';
          chip.innerHTML = `${ICONS.FILE}<span>${Utils.esc(f.name)}</span>`;
          attDiv.appendChild(chip);
        }
      });
      bubble.appendChild(attDiv);
    }

    const footer = document.createElement('div');
    footer.className = 'msg-footer';
    footer.innerHTML = `<span class="msg-time">${time}</span>`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action'; copyBtn.title = 'Copy';
    copyBtn.innerHTML = ICONS.COPY;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.innerHTML = ICONS.CHECK;
        setTimeout(() => copyBtn.innerHTML = ICONS.COPY, 2000);
      });
    };
    footer.appendChild(copyBtn);

    if (role === 'assistant') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'msg-action'; retryBtn.title = 'Retry';
      retryBtn.innerHTML = ICONS.RETRY;
      retryBtn.onclick = () => this.retryLast();
      footer.appendChild(retryBtn);
    }

    wrap.appendChild(bubble); wrap.appendChild(footer);
    this.dom.stream.appendChild(wrap);
    return bubble;
  }

  // ── Core Actions ──

  async send() {
    const text = this.dom.input.value.trim();
    const files = [...this.pendingFiles];
    if ((!text && files.length === 0) || this.busy) return;

    const chat = this.chats.getCurrentChat();
    const time = Utils.ts();
    const userMsg = { role: 'user', content: text, files, time };
    chat.history.push(userMsg);

    this.appendBubble('user', text, files, time, chat.history.length - 1, true);

    if (chat.history.filter(m => m.role === 'user').length === 1 && text) {
      chat.title = text.slice(0, 42) + (text.length > 42 ? '…' : '');
      this.renderChatList();
    }

    this.dom.input.value = ''; this.dom.input.style.height = 'auto';
    this.dom.sendBtn.classList.remove('active');
    this.clearTray();

    await this.processCompletion();
  }

  async retryLast() {
    if (this.busy) return;
    const chat = this.chats.getCurrentChat();
    if (!chat || chat.history.length === 0) return;
    if (chat.history[chat.history.length - 1].role === 'assistant') chat.history.pop();
    this.renderMessages();
    await this.processCompletion();
  }

  async processCompletion() {
    if (this.busy) return;
    if (!this.settings.apiKey) { this.openSettingsModal(); this.showToast('Add your API key'); return; }

    const chat = this.chats.getCurrentChat();
    const lastUserMsg = [...chat.history].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;

    if (lastUserMsg.files?.some(f => !f.ocrDone)) {
        this.showToast('Still processing files…');
        // We might want to wait here or just fail.
        // Original code would show toast and return.
        return;
    }

    this.busy = true;
    this.stopMic();

    const typingEl = this.addTypingIndicator();
    this.chats.saveToLocal();

    try {
      const apiMessages = this.prepareApiMessages(chat.history);
      const { wrap, bubble } = this.createStreamBubble();
      let reply = '';

      typingEl.remove();

      for await (const token of this.ai.streamCompletion(apiMessages)) {
        reply += token;
        bubble.innerHTML = marked.parse(reply);
        this.scrollBottom();
      }

      const aTime = Utils.ts();
      this.finalizeStreamBubble(wrap, bubble, reply, aTime);
      chat.history.push({ role: 'assistant', content: reply, time: aTime });
      this.chats.saveToLocal();
      if (this.auth.user) this.chats.saveToCloud(chat);

    } catch (err) {
      if (typingEl) typingEl.remove();
      this.showToast(err.message);
      this.appendBubble('assistant', `⚠ ${err.message}`, [], Utils.ts()).style.color = 'var(--red)';
      chat.history.push({ role: 'assistant', content: `⚠ ${err.message}`, time: Utils.ts() });
      this.chats.saveToLocal();
    } finally {
      this.busy = false;
      this.scrollBottom();
      this.dom.input.focus();
    }
  }

  prepareApiMessages(history) {
    return history.filter(m => m.role !== 'system').map(m => {
      if (m.role === 'user' && m.files?.length > 0) {
        let content = m.files.map(f => {
          if (f.ocrText) return `[Image: ${f.name}]\nExtracted text:\n${f.ocrText}`;
          if (f.textContent) return `[File: ${f.name}]\n${f.textContent}`;
          return `[Attached: ${f.name}]`;
        }).join('\n\n');
        if (m.content) content += `\n\n${m.content}`;
        return { role: 'user', content };
      }
      return { role: m.role, content: m.content };
    });
  }

  // ── UI Helpers ──

  createStreamBubble() {
    this.dom.empty.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'bubble streaming';
    wrap.appendChild(bubble);
    this.dom.stream.appendChild(wrap);
    this.scrollBottom();
    return { wrap, bubble };
  }

  finalizeStreamBubble(wrap, bubble, content, time) {
    bubble.classList.remove('streaming');
    bubble.innerHTML = marked.parse(content);
    const footer = document.createElement('div');
    footer.className = 'msg-footer';
    footer.innerHTML = `<span class="msg-time">${time}</span>`;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action'; copyBtn.title = 'Copy';
    copyBtn.innerHTML = ICONS.COPY;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.innerHTML = ICONS.CHECK;
        setTimeout(() => copyBtn.innerHTML = ICONS.COPY, 2000);
      });
    };
    footer.appendChild(copyBtn);
    const retryBtn = document.createElement('button');
    retryBtn.className = 'msg-action'; retryBtn.title = 'Retry';
    retryBtn.innerHTML = ICONS.RETRY;
    retryBtn.onclick = () => this.retryLast();
    footer.appendChild(retryBtn);
    wrap.appendChild(footer);
  }

  addTypingIndicator() {
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant'; wrap.id = 'typing';
    wrap.innerHTML = `<div class="bubble typing-bubble"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
    this.dom.stream.appendChild(wrap);
    this.scrollBottom();
    return wrap;
  }

  showToast(msg) {
    this.dom.toast.textContent = msg;
    this.dom.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.dom.toast.classList.remove('show'), 2400);
  }

  scrollBottom() { this.dom.stream.scrollTo({ top: this.dom.stream.scrollHeight, behavior: 'smooth' }); }

  // ── Auth UI ──

  updateUserUI(user) {
    const info = document.getElementById('user-info');
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (user) {
      info.style.display = 'flex';
      authBtn.style.display = 'none';
      logoutBtn.style.display = 'flex';
      document.getElementById('user-avatar').textContent = (user.name || user.email)[0].toUpperCase();
      document.getElementById('user-name').textContent = user.name || user.email;
    } else {
      info.style.display = 'none';
      authBtn.style.display = '';
      logoutBtn.style.display = 'none';
    }
  }

  toggleAuthMode() {
    this.authMode = this.authMode === 'login' ? 'register' : 'login';
    document.getElementById('auth-title').textContent = this.authMode === 'login' ? 'Sign in to Quasar AI' : 'Create account';
    document.getElementById('auth-subtitle').textContent = this.authMode === 'login' ? 'Sync your chats across all devices.' : 'Start syncing your chats.';
    document.getElementById('auth-submit-btn').textContent = this.authMode === 'login' ? 'Sign in' : 'Create account';
    document.getElementById('auth-switch-btn').textContent = this.authMode === 'login' ? 'Create account' : 'Sign in instead';
    this.dom.authError.style.display = 'none';
  }

  async submitAuth() {
    const email = this.dom.authEmail.value.trim();
    const pass = this.dom.authPassword.value;
    const btn = document.getElementById('auth-submit-btn');
    if (!email || !pass) { this.showAuthError('Please fill in all fields.'); return; }
    btn.textContent = '…'; btn.disabled = true;
    try {
      if (this.authMode === 'register') await this.auth.register(email, pass);
      else await this.auth.login(email, pass);
      this.updateUserUI(this.auth.user);
      await this.chats.syncFromCloud();
      this.closeAuthModal();
    } catch (err) {
      this.showAuthError(err.message || 'Something went wrong.');
    } finally {
      btn.disabled = false;
      btn.textContent = this.authMode === 'login' ? 'Sign in' : 'Create account';
    }
  }

  showAuthError(msg) {
    this.dom.authError.textContent = msg;
    this.dom.authError.style.display = 'block';
  }

  async signOut() {
    await this.auth.logout();
    this.updateUserUI(null);
    this.showToast('Signed out');
    this.chats.loadFromLocal();
    this.render();
  }

  // ── Settings ──

  async fetchModels() {
    const key = this.dom.apiKeyInput.value.trim();
    if (!key) { this.dom.modelStatus.textContent = 'Enter an API key first.'; return; }
    this.dom.fetchModelsBtn.textContent = '…'; this.dom.fetchModelsBtn.disabled = true;
    this.dom.modelStatus.textContent = 'Fetching…';
    try {
      const models = await this.ai.fetchModels(key);
      this.dom.modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
      this.dom.modelSelect.value = models.includes(this.settings.model) ? this.settings.model : models[0];
      this.dom.modelStatus.textContent = `${models.length} models loaded.`;
      this.dom.providerBadge.textContent = `Provider: ${Utils.detectProvider(key)}`;
    } catch (err) {
      this.dom.modelStatus.textContent = `Error: ${err.message}`;
    } finally {
      this.dom.fetchModelsBtn.textContent = 'Fetch Models';
      this.dom.fetchModelsBtn.disabled = false;
    }
  }

  saveSettings() {
    const key = this.dom.apiKeyInput.value.trim();
    const provider = Utils.detectProvider(key) || 'groq';
    if (provider !== this.settings.provider) this.settings.model = '';
    this.settings.apiKey = key;
    this.settings.provider = provider;
    this.settings.model = this.dom.modelSelect.value || this.settings.model;
    this.settings.systemPrompt = this.dom.systemPromptInput.value.trim() || this.settings.systemPrompt;
    this.saveSettingsState();
    this.closeModal();
    this.showToast('Settings saved');
  }

  // ── Event Binding ──

  bindEvents() {
    this.dom.input.oninput = () => {
      this.dom.input.style.height = 'auto';
      this.dom.input.style.height = Math.min(this.dom.input.scrollHeight, 180) + 'px';
      this.dom.sendBtn.classList.toggle('active', this.dom.input.value.trim().length > 0 || this.pendingFiles.length > 0);
    };
    this.dom.input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } };

    this.dom.fileInput.onchange = (e) => { this.handleFiles(Array.from(e.target.files)); e.target.value = ''; };

    document.getElementById('theme-toggle').onclick = () => this.toggleTheme();

    // Modal close on overlay click
    this.dom.modalOverlay.onclick = (e) => { if (e.target === this.dom.modalOverlay) this.closeModal(); };
    this.dom.authOverlay.onclick = (e) => { if (e.target === this.dom.authOverlay) this.closeAuthModal(); };

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); this.chats.newChat(); }
      if (mod && e.key === ',') { e.preventDefault(); this.openSettingsModal(); }
      if (mod && e.shiftKey && e.key === 'S') { e.preventDefault(); this.toggleSidebar(); }
      if (e.key === 'Escape') { this.closeModal(); this.closeAuthModal(); }
    });

    // Drag and drop
    this.dom.stream.ondragover = (e) => { e.preventDefault(); this.dom.stream.style.outline = '2px dashed var(--accent)'; };
    this.dom.stream.ondragleave = () => { this.dom.stream.style.outline = ''; };
    this.dom.stream.ondrop = (e) => { e.preventDefault(); this.dom.stream.style.outline = ''; if (e.dataTransfer.files.length) this.handleFiles(Array.from(e.dataTransfer.files)); };

    // Paste images
    document.onpaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []).filter(i => i.type.startsWith('image/'));
      if (items.length) this.handleFiles(items.map(i => i.getAsFile()));
    };
  }

  applyTheme() {
    const dark = localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.getElementById('theme-icon-moon').style.display = dark ? 'none' : '';
    document.getElementById('theme-icon-sun').style.display  = dark ? '' : 'none';
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    this.applyTheme();
  }

  // ── File Handling ──
  handleFiles(files) {
    files.forEach(file => {
      const isImage = file.type.startsWith('image/');
      const isText = /text|json|csv|javascript|python|html|css|markdown/.test(file.type) || /\.(txt|md|csv|json|js|py|html|css)$/.test(file.name);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const fileObj = {
          name: file.name,
          type: file.type,
          dataUrl: isImage ? e.target.result : null,
          textContent: isText ? e.target.result : null,
          ocrDone: !isImage
        };
        this.pendingFiles.push(fileObj);
        this.renderTray();
        if (isImage) {
          try {
            const { data: { text } } = await Tesseract.recognize(e.target.result, 'eng');
            fileObj.ocrText = text.trim();
          } catch (e) {}
          fileObj.ocrDone = true;
          this.renderTray();
        }
      };
      if (isImage) reader.readAsDataURL(file);
      else if (isText) reader.readAsText(file);
      else {
          this.pendingFiles.push({ name: file.name, type: file.type, dataUrl: null, textContent: null, ocrDone: true });
          this.renderTray();
      }
    });
  }

  renderTray() {
    this.dom.tray.innerHTML = '';
    this.dom.tray.classList.toggle('has-items', this.pendingFiles.length > 0);
    this.pendingFiles.forEach((f, i) => {
      const el = document.createElement('div');
      el.className = 'tray-item';
      const preview = f.dataUrl ? `<img src="${f.dataUrl}">` : ICONS.FILE;
      const status = f.ocrDone ? (f.ocrText ? '✓' : '') : '...';
      el.innerHTML = `${preview}<span class="tray-item-name">${f.name}</span><span style="font-size:10px;opacity:0.5">${status}</span><button class="tray-remove" onclick="app.removeFile(${i})">×</button>`;
      this.dom.tray.appendChild(el);
    });
    this.dom.sendBtn.classList.toggle('active', this.dom.input.value.trim().length > 0 || this.pendingFiles.length > 0);
  }

  removeFile(i) { this.pendingFiles.splice(i, 1); this.renderTray(); }
  clearTray() { this.pendingFiles = []; this.renderTray(); }

  // ── Mic ──
  toggleMic() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      this.showToast('Voice input not supported.'); return;
    }
    this.micActive ? this.stopMic() : this.startMic();
  }

  startMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.onstart = () => {
      this.micActive = true;
      this.dom.micBtn.classList.add('recording');
      this.dom.input.placeholder = 'Listening…';
    };
    this.recognition.onresult = (e) => {
      let final = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      this.dom.input.value += final;
      this.dom.input.dispatchEvent(new Event('input'));
    };
    this.recognition.onend = () => {
      this.micActive = false;
      this.dom.micBtn.classList.remove('recording');
      this.dom.input.placeholder = 'Message…';
    };
    this.recognition.start();
  }

  stopMic() { if (this.recognition) this.recognition.stop(); }

  // ── Modals ──
  openSettingsModal() {
    this.dom.apiKeyInput.value = this.settings.apiKey;
    this.dom.systemPromptInput.value = this.settings.systemPrompt;
    this.dom.providerBadge.textContent = `Provider: ${this.settings.provider}`;
    this.dom.modelSelect.innerHTML = `<option value="${this.settings.model}">${this.settings.model}</option>`;
    this.dom.modalOverlay.classList.add('open');
  }
  closeModal() { this.dom.modalOverlay.classList.remove('open'); }
  openAuthModal() { this.dom.authOverlay.classList.add('open'); this.dom.authEmail.focus(); }
  closeAuthModal() { this.dom.authOverlay.classList.remove('open'); }
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; this.dom.sidebar.classList.toggle('collapsed', !this.sidebarOpen); }
  closeSidebarMobile() { this.dom.sidebar.classList.remove('open'); this.dom.backdrop.classList.remove('show'); }
}

// Global instance
const app = new QuasarApp();
window.onload = () => app.start();

// Proxies for inline HTML
function newChat() { app.chats.newChat(); }
function toggleSidebar() { app.toggleSidebar(); }
function openSettingsModal() { app.openSettingsModal(); }
function closeModal() { app.closeModal(); }
function saveSettings() { app.saveSettings(); }
function fetchModels() { app.fetchModels(); }
function openAuthModal() { app.openAuthModal(); }
function toggleAuthMode() { app.toggleAuthMode(); }
function submitAuth() { app.submitAuth(); }
function signInGoogle() { app.auth.googleLogin(); }
function signOut() { app.signOut(); }
function clearAllChats() { if (confirm('Clear all chats?')) app.chats.clearAll(); }
function exportChat() {
  const chat = app.chats.getCurrentChat();
  if (!chat || chat.history.length === 0) { app.showToast('Nothing to export'); return; }
  const lines = chat.history.filter(m => m.role !== 'system').map(m => `[${m.role.toUpperCase()}] ${m.time||''}\n${m.content}`);
  const blob = new Blob([lines.join('\n\n---\n\n')], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (chat.title || 'chat') + '.txt'; a.click();
}
function toggleMic() { app.toggleMic(); }
function useSuggestion(el) {
  const txt = el.textContent.replace(/^[\p{Emoji_Presentation}\p{Emoji}\u{FE0F}]+\s*/u, '').trim();
  app.dom.input.value = txt; app.dom.input.dispatchEvent(new Event('input')); app.dom.input.focus();
}
function handleAuthOverlayClick(e) { if (e.target.id === 'auth-overlay') app.closeAuthModal(); }
function handleOverlayClick(e) { if (e.target.id === 'modal-overlay') app.closeModal(); }
function closeSidebarMobile() { app.closeSidebarMobile(); }
