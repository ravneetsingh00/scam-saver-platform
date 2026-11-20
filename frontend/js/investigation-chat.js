(() => {
  'use strict';

  const historyEl = document.getElementById('investigationHistory');
  const conversationEl = document.getElementById('investigationConversation');
  const welcomeEl = document.getElementById('investigationWelcome');
  const messagesEl = document.getElementById('investigationMessages');
  const form = document.getElementById('investigationChatForm');
  const input = document.getElementById('investigationChatInput');
  const sendButton = document.getElementById('investigationSend');
  const stopButton = document.getElementById('investigationStop');
  const statusEl = document.getElementById('investigationServiceStatus');
  const pageContext = new URLSearchParams(location.search);
  const context = Object.fromEntries(['businessId','reportId','businessName','category','location','website'].map(key => [key,pageContext.get(key) || '']));
  let conversationId = null;
  let sending = false;
  let activeController = null;
  let activeBubble = null;
  let activeText = '';

  if (!form) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const formatDate = value => value ? new Date(value).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : '';
  const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';
  async function copyText(value) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
      const helper = document.createElement('textarea'); helper.value = value; helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.append(helper); helper.select();
      const copied = document.execCommand('copy'); helper.remove(); return copied;
    } catch { return false; }
  }

  function markdownToHtml(markdown) {
    const codeBlocks = [];
    let text = escape(markdown).replace(/```([\w.+-]*)\s*\n([\s\S]*?)```/g, (_, language, code) => {
      const index = codeBlocks.push(`<div class="code-block"><button class="code-copy" type="button" data-copy-code="${codeBlocks.length}">Copy code</button><pre><code class="language-${escape(language)}">${code}</code></pre></div>`) - 1;
      return `\u0000CODE${index}\u0000`;
    });
    const inline = value => value
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>');
    const blocks = text.split(/\n\s*\n/);
    const html = blocks.map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^\u0000CODE\d+\u0000$/.test(trimmed)) return trimmed;
      const lines = trimmed.split('\n');
      if (lines.every(line => /^\s*[-*+]\s+/.test(line))) return `<ul>${lines.map(line => `<li>${inline(line.replace(/^\s*[-*+]\s+/, ''))}</li>`).join('')}</ul>`;
      if (lines.every(line => /^\s*\d+[.)]\s+/.test(line))) return `<ol>${lines.map(line => `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      if (lines.every(line => /^\s*&gt;\s?/.test(line))) return `<blockquote>${lines.map(line => inline(line.replace(/^\s*&gt;\s?/, ''))).join('<br>')}</blockquote>`;
      if (/^#{1,3}\s/.test(trimmed)) { const level = Math.min(trimmed.match(/^#+/)[0].length, 3); return `<h${level}>${inline(trimmed.replace(/^#{1,3}\s+/, ''))}</h${level}>`; }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
    return html.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeBlocks[Number(index)] || '');
  }

  function sourceMarkup(sources = []) {
    const usable = sources.filter(source => safeUrl(source.url));
    if (!usable.length) return '';
    return `<div class="investigation-message-sources"><span>Sources</span>${usable.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title || source.url)} ↗</a>`).join('')}</div>`;
  }

  function communityMatchesMarkup(matches = []) {
    if (!matches.length) return '<section class="community-match-panel"><strong>Matching SCAM SAVER reports</strong><p>No matching submitted reports were found for these search terms.</p></section>';
    return `<section class="community-match-panel"><strong>Matching SCAM SAVER reports <span>${matches.length}</span></strong><p>These are user-submitted allegations. Moderation status does not establish wrongdoing.</p><div>${matches.map(match => `<article><b>${escape(match.businessName || 'Name not provided')}</b><small>${escape(match.fraudType || match.category || 'Report')} · ${escape(match.location || 'Location not provided')}</small><small>Submitted ${escape(formatDate(match.submittedAt))} · Status: <em class="report-status status-${escape(String(match.status || '').toLowerCase().replace(/[^a-z]+/g, '-'))}">${escape(match.status || 'Pending')}</em></small></article>`).join('')}</div></section>`;
  }

  function makeMessage(message, index, messages) {
    const article = document.createElement('article');
    article.className = `investigation-message ${message.role === 'user' ? 'from-user' : 'from-assistant'}`;
    const label = document.createElement('div'); label.className = 'investigation-message-label'; label.textContent = message.role === 'user' ? 'You' : 'SCAM SAVER AI';
    const body = document.createElement('div'); body.className = 'investigation-message-body';
    if (message.role === 'assistant') body.innerHTML = markdownToHtml(message.text); else body.textContent = message.text;
    article.append(label, body);
    if (message.role === 'assistant') {
      if (message.sources?.length) article.insertAdjacentHTML('beforeend', sourceMarkup(message.sources));
      const actions = document.createElement('div'); actions.className = 'investigation-message-actions';
      const copy = document.createElement('button'); copy.type = 'button'; copy.dataset.copyMessage = String(index); copy.textContent = 'Copy'; actions.append(copy);
      if (index === messages.length - 1) { const regenerate = document.createElement('button'); regenerate.type = 'button'; regenerate.dataset.regenerate = 'true'; regenerate.textContent = 'Regenerate'; actions.append(regenerate); }
      article.append(actions);
    }
    return article;
  }

  function renderMessages(messages = [], matches = []) {
    messagesEl.replaceChildren(...messages.map((message, index) => makeMessage(message, index, messages)));
    if (matches) messagesEl.insertAdjacentHTML('beforeend', communityMatchesMarkup(matches));
    welcomeEl.hidden = messages.length > 0;
    scrollToLatest();
  }

  function scrollToLatest() { conversationEl.scrollTop = conversationEl.scrollHeight; }

  async function loadHistory() {
    historyEl.innerHTML = '<div class="loader">Loading your history…</div>';
    try {
      const { investigations = [] } = await api('/investigations');
      historyEl.innerHTML = investigations.length ? investigations.map(item => `<div class="investigation-history-item-wrap"><button class="investigation-history-item${item._id === conversationId ? ' active' : ''}" type="button" data-conversation="${escape(item._id)}"><strong>${escape(item.businessName || 'New chat')}</strong><small>${escape(formatDate(item.createdAt))} · ${escape((item.summary || '').slice(0, 100))}</small></button><button class="investigation-history-delete" type="button" data-delete-conversation="${escape(item._id)}" aria-label="Delete ${escape(item.businessName || 'conversation')}">×</button></div>`).join('') : '<p class="history-empty">Your private investigation chats will appear here.</p>';
    } catch (error) {
      historyEl.innerHTML = `<p class="history-empty">${escape(error.message)}</p>`;
    }
  }

  async function openConversation(id) {
    if (sending) stopGeneration();
    try {
      const { investigation } = await api(`/investigations/${encodeURIComponent(id)}`);
      conversationId = investigation.id;
      renderMessages(investigation.messages || [], investigation.communityMatches || []);
      renderInvestigationContext(investigation);
      input.focus();
      await loadHistory();
    } catch (error) { toast(error.message, 'error'); }
  }

  function renderInvestigationContext(investigation) {
    messagesEl.querySelector('.investigation-record-context')?.remove();
    const panel = document.createElement('section'); panel.className = 'investigation-record-context';
    const title = document.createElement('strong'); title.textContent = `Investigation ${investigation.id || investigation._id}`; panel.append(title);
    const status = document.createElement('span'); status.textContent = investigation.status || 'Status not recorded'; panel.append(status);
    if (investigation.businessId) { const link = document.createElement('a'); link.href = `business-details.html?id=${encodeURIComponent(investigation.businessId)}`; link.textContent = `Business: ${investigation.businessName}`; panel.append(link); }
    if (investigation.reportId) { const link = document.createElement('a'); link.href = `report-details.html?id=${encodeURIComponent(investigation.reportId)}`; link.textContent = `Related report: ${investigation.reportId}`; panel.append(link); }
    if (investigation.assignedModerator) { const moderator = document.createElement('span'); moderator.textContent = `Assigned moderator ID: ${investigation.assignedModerator}`; panel.append(moderator); }
    if (investigation.moderatorNotes) { const notes = document.createElement('p'); notes.textContent = investigation.moderatorNotes; panel.append(notes); }
    if (investigation.outcome) { const outcome = document.createElement('p'); outcome.textContent = `Outcome: ${investigation.outcome}`; panel.append(outcome); }
    for (const event of investigation.timeline || []) { const item = document.createElement('small'); item.textContent = `${event.action} · ${event.at ? formatDate(event.at) : 'Date not recorded'}${event.note ? ` · ${event.note}` : ''}`; panel.append(item); }
    messagesEl.prepend(panel);
  }

  function appendUserMessage(text) {
    welcomeEl.hidden = true;
    const article = document.createElement('article'); article.className = 'investigation-message from-user';
    const label = document.createElement('div'); label.className = 'investigation-message-label'; label.textContent = 'You';
    const body = document.createElement('div'); body.className = 'investigation-message-body'; body.textContent = text;
    article.append(label, body); messagesEl.append(article); scrollToLatest();
  }

  function beginAssistantBubble() {
    const article = document.createElement('article'); article.className = 'investigation-message from-assistant is-typing';
    const label = document.createElement('div'); label.className = 'investigation-message-label'; label.textContent = 'SCAM SAVER AI · thinking';
    const body = document.createElement('div'); body.className = 'investigation-message-body';
    const dots = document.createElement('div'); dots.className = 'typing-dots'; dots.setAttribute('aria-label', 'AI is thinking'); dots.innerHTML = '<i></i><i></i><i></i>';
    article.append(label, dots, body); messagesEl.append(article); activeBubble = article; activeText = ''; scrollToLatest();
  }

  function finishAssistantBubble(sources = []) {
    if (!activeBubble) return;
    activeBubble.classList.remove('is-typing');
    activeBubble.querySelector('.investigation-message-label').textContent = 'SCAM SAVER AI';
    activeBubble.querySelector('.typing-dots')?.remove();
    const body = activeBubble.querySelector('.investigation-message-body');
    body.innerHTML = markdownToHtml(activeText);
    if (sources.length) activeBubble.insertAdjacentHTML('beforeend', sourceMarkup(sources));
    const actions = document.createElement('div'); actions.className = 'investigation-message-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.dataset.copyLast = 'true'; copy.textContent = 'Copy'; actions.append(copy);
    const regenerate = document.createElement('button'); regenerate.type = 'button'; regenerate.dataset.regenerate = 'true'; regenerate.textContent = 'Regenerate'; actions.append(regenerate);
    activeBubble.append(actions); activeBubble = null; scrollToLatest();
  }

  function parseSseBlock(block, handlers) {
    let eventName = 'message';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    let payload;
    try { payload = JSON.parse(data.join('\n')); } catch { return; }
    handlers[eventName]?.(payload);
  }

  async function requestChat({ text = '', regenerate = false } = {}) {
    if (sending) return;
    if (!localStorage.getItem('ss_token') && !localStorage.getItem('ss_admin_token')) { location.href = 'login.html?next=investigate.html'; return; }
    if (!regenerate && text.trim().length < 2) return;
    sending = true; activeController = new AbortController();
    input.disabled = true; sendButton.hidden = true; stopButton.hidden = false; stopButton.disabled = false;
    if (!regenerate) appendUserMessage(text.trim());
    else {
      const previous = [...messagesEl.querySelectorAll('.investigation-message.from-assistant')].at(-1);
      previous?.remove();
      messagesEl.querySelector('.community-match-panel:last-of-type')?.remove();
    }
    beginAssistantBubble();
    try {
      const sessionToken = localStorage.getItem('ss_admin_token') || localStorage.getItem('ss_token');
      const headers = { 'Content-Type':'application/json', Authorization:`Bearer ${sessionToken}` };
      const response = await fetch('/api/investigations/chat', {
        method:'POST', headers, signal:activeController.signal,
        body:JSON.stringify({ conversationId, message:text.trim(), regenerate, ...(conversationId ? {} : context) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = /requested endpoint was not found/i.test(data.message || '')
          ? 'The running backend has not loaded the AI chat endpoint. Restart Scam Saver’s backend, then reload this page.'
          : data.message || `The chat request failed (${response.status}).`;
        throw new Error(message);
      }
      if (!response.body) throw new Error('This server did not start a streaming response. Restart the backend and try again.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const handlers = {
        start: data => { conversationId = data.conversationId; loadHistory(); },
        delta: data => { activeText += data.text || ''; const body = activeBubble?.querySelector('.investigation-message-body'); if (body) body.textContent = activeText; scrollToLatest(); },
        done: data => { conversationId = data.conversationId; finishAssistantBubble(data.sources || []); if (data.communityMatches) messagesEl.insertAdjacentHTML('beforeend', communityMatchesMarkup(data.communityMatches)); api(`/investigations/${encodeURIComponent(conversationId)}`).then(result => renderInvestigationContext(result.investigation)).catch(() => {}); loadHistory(); },
        error: data => { throw new Error(data.message || 'The AI could not complete the response.'); },
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream:true });
        const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || '';
        for (const block of blocks) parseSseBlock(block, handlers);
      }
      if (buffer.trim()) parseSseBlock(buffer, handlers);
      if (activeBubble) throw new Error('The response stream ended before the answer was complete. Try regenerating the response.');
    } catch (error) {
      if (error.name === 'AbortError') {
        if (activeBubble) {
          const body = activeBubble.querySelector('.investigation-message-body');
          body.innerHTML = activeText ? `${markdownToHtml(activeText)}<p class="form-note">Generation stopped. This partial response wasn’t saved.</p>` : '<p class="form-note">Generation stopped.</p>';
          activeBubble.querySelector('.typing-dots')?.remove(); activeBubble.querySelector('.investigation-message-label').textContent = 'SCAM SAVER AI · stopped'; activeBubble.classList.remove('is-typing'); activeBubble = null;
        }
      } else {
        if (activeBubble) {
          const body = activeBubble.querySelector('.investigation-message-body');
          body.innerHTML = `${activeText ? markdownToHtml(activeText) : ''}<p class="form-note error-text">${escape(error.message)}</p>`;
          activeBubble.querySelector('.typing-dots')?.remove(); activeBubble.querySelector('.investigation-message-label').textContent = 'Could not complete response'; activeBubble.classList.add('error-message'); activeBubble.classList.remove('is-typing'); activeBubble = null;
        } else toast(error.message, 'error');
      }
      scrollToLatest();
    } finally {
      sending = false; activeController = null; input.disabled = false; sendButton.hidden = false; stopButton.hidden = true; stopButton.disabled = false; input.focus(); loadHistory();
    }
  }

  function stopGeneration() { if (!activeController) return; stopButton.disabled = true; activeController.abort(); }

  form.addEventListener('submit', event => { event.preventDefault(); const value = input.value; requestChat({ text:value }); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 150)}px`; });
  stopButton.addEventListener('click', stopGeneration);
  document.getElementById('newInvestigationChat')?.addEventListener('click', () => { if (sending) stopGeneration(); conversationId = null; renderMessages([]); input.value = ''; input.focus(); loadHistory(); });
  document.getElementById('refreshInvestigationHistory')?.addEventListener('click', loadHistory);
  historyEl.addEventListener('click', event => {
    const del = event.target.closest('[data-delete-conversation]');
    if (del) {
      event.stopPropagation();
      if (!confirm('Delete this private conversation permanently?')) return;
      api(`/investigations/${encodeURIComponent(del.dataset.deleteConversation)}`, { method:'DELETE' }).then(() => {
        if (conversationId === del.dataset.deleteConversation) { conversationId = null; renderMessages([]); }
        loadHistory();
      }).catch(error => toast(error.message, 'error'));
      return;
    }
    const item = event.target.closest('[data-conversation]'); if (item) openConversation(item.dataset.conversation);
  });
  conversationEl.addEventListener('click', async event => {
    const suggestion = event.target.closest('[data-suggestion]');
    if (suggestion) { input.value = suggestion.dataset.suggestion; input.focus(); return; }
    const codeCopy = event.target.closest('[data-copy-code]');
    if (codeCopy) {
      const code = codeCopy.parentElement.querySelector('code')?.textContent || '';
      const copied = await copyText(code); codeCopy.textContent = copied ? 'Copied' : 'Copy failed'; setTimeout(() => { codeCopy.textContent = 'Copy code'; }, 1300); return;
    }
    const copy = event.target.closest('[data-copy-message],[data-copy-last]');
    if (copy) {
      const article = copy.closest('.investigation-message'); const text = article?.querySelector('.investigation-message-body')?.innerText || '';
      const copied = await copyText(text); copy.textContent = copied ? 'Copied' : 'Copy failed'; setTimeout(() => { copy.textContent = 'Copy'; }, 1300); return;
    }
    if (event.target.closest('[data-regenerate]')) {
      if (conversationId) requestChat({ regenerate:true });
    }
  });

  api('/investigations/status').then(data => {
    const endpointReady = data.chatEndpointAvailable === true;
    statusEl.textContent = !endpointReady
      ? 'The backend needs a restart to load the chat endpoint. Restart Scam Saver, then reload this page.'
      : data.configured
        ? `Connected to ${data.provider || 'AI'} web research and SCAM SAVER report search.`
        : 'AI service is not configured yet. Add GEMINI_API_KEY to the project .env file and restart the backend.';
    statusEl.classList.toggle('is-unconfigured', !endpointReady || !data.configured);
  }).catch(() => { statusEl.textContent = 'AI service status is unavailable. Check the server connection.'; statusEl.classList.add('is-unconfigured'); });
  if (context.businessId && context.businessName) input.value = `Investigate this business: ${context.businessName}`;
  const requestedConversation = pageContext.get('conversationId');
  if (requestedConversation) openConversation(requestedConversation);
  loadHistory();
})();
