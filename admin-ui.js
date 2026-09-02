/* Fenda Music Admin — camada de experiência do workspace */
(function () {
  'use strict';

  const TAB_TITLES = {
    overview: 'Visão geral',
    users: 'Usuários',
    privacy: 'Privacidade',
    health: 'Saúde do sistema',
    musics: 'Músicas',
    artists: 'Artistas',
    submissions: 'Submissões',
    requests: 'Solicitações',
    messages: 'Notificações',
    podcasts: 'Podcasts',
  };

  const TAB_ICONS = {
    overview: 'space_dashboard', users: 'group', privacy: 'privacy_tip', health: 'monitor_heart',
    musics: 'library_music', artists: 'mic', submissions: 'rate_review', requests: 'playlist_add_check', messages: 'campaign', podcasts: 'podcasts',
  };

  let paletteResults = [];
  let paletteIndex = 0;

  function escape(value) {
    return typeof window.escapeHtml === 'function'
      ? window.escapeHtml(value)
      : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function notify(message, type = 'success') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  function visibleRecordCount(container) {
    if (!container) return 0;
    return [...container.children].filter(item => !item.classList.contains('empty-state') && item.style.display !== 'none').length;
  }

  function setOverviewMetric(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
  }

  let overviewRefreshPromise = null;

  function withTimeout(promise, timeoutMs = 12000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('A consulta demorou mais que o esperado.')), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => window.clearTimeout(timer));
  }

  function renderOverviewQueryError(container, title, error) {
    if (!container) return;
    container.innerHTML = `<div class="activity-item is-error"><span class="activity-icon"><span class="material-symbols-rounded">error</span></span><span class="activity-body"><strong>${escape(title)}</strong><small>${escape(error?.message || 'Não foi possível carregar esta seção.')}</small></span></div>`;
  }

  async function refreshOverview() {
    if (overviewRefreshPromise) return overviewRefreshPromise;
    overviewRefreshPromise = (async () => {
      setOverviewMetric('overviewUsersCount', visibleRecordCount(document.getElementById('usersList')));
      setOverviewMetric('overviewMusicsCount', visibleRecordCount(document.getElementById('musicsList')));
      setOverviewMetric('overviewArtistsCount', visibleRecordCount(document.getElementById('artistsList')));

      const pendingContainer = document.getElementById('overviewPendingList');
      const activityContainer = document.getElementById('overviewRecentList');
      if (!pendingContainer || !activityContainer || !window.supabaseClient) return;

      pendingContainer.dataset.loading = '1';
      activityContainer.dataset.loading = '1';
      const responses = await Promise.all([
        withTimeout(supabaseClient.from('music_submissions').select('id, title, artist, status, created_at', { count: 'exact' }).eq('status', 'pending').order('created_at', { ascending: false }).limit(5)).then(value => ({ kind: 'pending', ...value })).catch(error => ({ kind: 'pending', data: [], error })),
        withTimeout(supabaseClient.from('admin_notifications').select('id, title, body, status, created_at, metadata').order('created_at', { ascending: false }).limit(5)).then(value => ({ kind: 'messages', ...value })).catch(error => ({ kind: 'messages', data: [], error })),
      ]);
      const pendingResponse = responses.find(item => item.kind === 'pending') || { data: [], error: new Error('Resposta ausente.') };
      const messagesResponse = responses.find(item => item.kind === 'messages') || { data: [], error: new Error('Resposta ausente.') };
      const pending = pendingResponse.error ? [] : (pendingResponse.data || []);
      const messages = messagesResponse.error ? [] : (messagesResponse.data || []);
      setOverviewMetric('overviewPendingCount', pendingResponse.error ? NaN : (pendingResponse.count ?? pending.length));

      if (pendingResponse.error) renderOverviewQueryError(pendingContainer, 'Fila de revisão indisponível', pendingResponse.error);
      else pendingContainer.innerHTML = pending.length ? pending.map(item => `
          <button class="activity-item" data-tab="submissions" type="button">
          <span class="activity-icon"><span class="material-symbols-rounded">music_note</span></span>
          <span class="activity-body"><strong>${escape(item.title || 'Sem título')}</strong><small>${escape(item.artist || 'Artista não informado')}</small></span>
          <span class="activity-status" style="color:var(--yellow)">pendente</span>
        </button>`).join('') : `
        <div class="activity-item"><span class="activity-icon"><span class="material-symbols-rounded">check_circle</span></span><span class="activity-body"><strong>Tudo em dia</strong><small>Nenhuma submissão pendente agora.</small></span></div>`;

      if (messagesResponse.error) renderOverviewQueryError(activityContainer, 'Atividade recente indisponível', messagesResponse.error);
      else activityContainer.innerHTML = messages.length ? messages.map(item => {
        const icon = TAB_ICONS.messages;
        const status = item.status === 'sent' ? 'enviado' : (item.status || 'pendente');
        const date = item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—';
        return `<button class="activity-item" data-tab="messages" type="button">
          <span class="activity-icon"><span class="material-symbols-rounded">${icon}</span></span>
          <span class="activity-body"><strong>${escape(item.title || 'Aviso sem título')}</strong><small>${escape(item.body || '')} · ${date}</small></span>
          <span class="activity-status">${escape(status)}</span>
        </button>`;
      }).join('') : `
        <div class="activity-item"><span class="activity-icon"><span class="material-symbols-rounded">campaign</span></span><span class="activity-body"><strong>Nenhuma atividade recente</strong><small>Os avisos enviados aparecerão aqui.</small></span></div>`;

      delete pendingContainer.dataset.loading;
      delete activityContainer.dataset.loading;
      bindTabTriggers(pendingContainer);
      bindTabTriggers(activityContainer);
    })().finally(() => { overviewRefreshPromise = null; });
    return overviewRefreshPromise;
  }

  function bindTabTriggers(scope = document) {
    scope.querySelectorAll('[data-tab]:not(.admin-tab)').forEach(element => {
      if (element.dataset.adminUiBound === '1') return;
      element.dataset.adminUiBound = '1';
      element.addEventListener('click', event => {
        const tabId = element.dataset.tab;
        if (!tabId) return;
        if (!element.classList.contains('admin-tab')) event.preventDefault();
        openTab(tabId, element.dataset.action || null);
      });
    });
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  function openTab(tabId, action = null) {
    const tab = document.querySelector(`.admin-tab[data-tab="${CSS.escape(tabId)}"]`);
    if (tab) tab.click();
    document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item.dataset.tab === tabId));
    const title = document.getElementById('adminSectionTitle');
    if (title) title.textContent = TAB_TITLES[tabId] || 'Painel';
    if (tabId) {
      try { history.replaceState(null, '', `#${tabId}`); localStorage.setItem('fenda-admin-last-tab', tabId); } catch (_) {}
    }
    closeSidebar();
    if (action === 'newMusic') window.setTimeout(() => document.getElementById('newMusicBtn')?.click(), 30);
    if (action === 'newMessage') window.setTimeout(() => document.getElementById('newMessageBtn')?.click(), 30);
    if (action === 'newArtist') window.setTimeout(() => document.getElementById('newArtistBtn')?.click(), 30);
    if (action === 'newPodcast') window.setTimeout(() => document.getElementById('newPodcastBtn')?.click(), 30);
  }

  function restoreTab() {
    let saved = '';
    try { saved = location.hash.slice(1) || localStorage.getItem('fenda-admin-last-tab') || ''; } catch (_) {}
    if (TAB_TITLES[saved]) openTab(saved);
  }

  function filterContainer(input) {
    const query = String(input.value || '').trim().toLowerCase();
    const target = input.dataset.filterTarget;
    const container = document.getElementById(target);
    if (!container) return;
    const items = target === 'messagesTab'
      ? container.querySelectorAll('.sub-card, .msg-card')
      : container.children;
    items.forEach(item => {
      if (item.classList.contains('empty-state')) return;
      item.style.display = !query || item.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
    input.dataset.filtered = query;
  }

  function reapplyFilters() {
    document.querySelectorAll('[data-filter-target]').forEach(input => {
      if (input.value) filterContainer(input);
    });
    applyMessagesFilter();
  }

  function applyMessagesFilter() {
    const select = document.getElementById('messagesFilterSelect');
    if (!select) return;
    const mode = select.value || 'all';
    const query = String(document.getElementById('messagesSearchInput')?.value || '').trim().toLowerCase();
    const messages = document.querySelectorAll('#messagesList .msg-card');
    messages.forEach(card => {
      const matchesMode = mode === 'all' || mode === 'sent' && card.dataset.messageStatus === 'sent' || ['new_music', 'new_artist', 'announcement', 'custom'].includes(mode) && card.dataset.messageType === mode;
      const matchesQuery = !query || card.textContent.toLowerCase().includes(query);
      card.style.display = matchesMode && matchesQuery ? '' : 'none';
    });
    try { localStorage.setItem('fenda-admin-message-filter', mode); } catch (_) {}
  }

  function collectSearchResults(query) {
    const q = String(query || '').trim().toLowerCase();
    const results = [];
    const modules = Object.keys(TAB_TITLES).filter(tab => tab !== 'overview');

    if (!q) {
      return [
        { kind: 'action', tab: 'musics', icon: 'upload', title: 'Adicionar música', meta: 'Abrir upload e catalogação' },
        { kind: 'action', tab: 'messages', action: 'newMessage', icon: 'campaign', title: 'Enviar aviso', meta: 'Notificar usuários do Fenda' },
        ...modules.map(tab => ({ kind: 'module', tab, icon: TAB_ICONS[tab], title: TAB_TITLES[tab], meta: 'Abrir seção' })),
      ];
    }

    modules.forEach(tab => {
      if (TAB_TITLES[tab].toLowerCase().includes(q)) results.push({ kind: 'module', tab, icon: TAB_ICONS[tab], title: TAB_TITLES[tab], meta: 'Abrir seção' });
      const pane = document.getElementById(`${tab}Tab`);
      if (!pane) return;
      const records = pane.querySelectorAll('.admin-card, .msg-card, .sub-card, .request-card, .privacy-record');
      records.forEach(record => {
        const text = record.textContent.toLowerCase();
        if (!text.includes(q) || results.length >= 20) return;
        const title = record.querySelector('h3, .msg-card-title, .sub-card-title strong, .privacy-record-main strong')?.textContent?.trim() || TAB_TITLES[tab];
        results.push({ kind: 'record', tab, icon: TAB_ICONS[tab], title, meta: TAB_TITLES[tab] });
      });
    });
    return results.slice(0, 20);
  }

  function renderPalette(query = '') {
    const container = document.getElementById('commandPaletteTitle');
    if (!container) return;
    paletteResults = collectSearchResults(query);
    paletteIndex = 0;
    if (!paletteResults.length) {
      container.innerHTML = '<div class="command-empty">Nenhum resultado encontrado no painel.</div>';
      return;
    }
    container.innerHTML = paletteResults.map((item, index) => `
      <button type="button" class="command-result ${index === 0 ? 'selected' : ''}" data-command-index="${index}">
        <span class="material-symbols-rounded">${item.icon}</span>
        <span class="command-result-body"><strong>${escape(item.title)}</strong><small>${escape(item.meta)}</small></span>
        ${item.kind === 'module' ? '<kbd>abrir</kbd>' : ''}
      </button>`).join('');
    container.querySelectorAll('.command-result').forEach(button => button.addEventListener('click', () => executePaletteItem(Number(button.dataset.commandIndex))));
  }

  function openPalette() {
    const palette = document.getElementById('commandPalette');
    const input = document.getElementById('commandSearchInput');
    if (!palette || !input) return;
    palette.hidden = false;
    palette.setAttribute('aria-hidden', 'false');
    input.value = '';
    renderPalette('');
    window.setTimeout(() => input.focus(), 0);
  }

  function closePalette() {
    const palette = document.getElementById('commandPalette');
    if (!palette) return;
    palette.hidden = true;
    palette.setAttribute('aria-hidden', 'true');
  }

  function executePaletteItem(index) {
    const item = paletteResults[index];
    if (!item) return;
    closePalette();
    openTab(item.tab, item.action || null);
  }

  function movePaletteSelection(delta) {
    if (!paletteResults.length) return;
    paletteIndex = (paletteIndex + delta + paletteResults.length) % paletteResults.length;
    document.querySelectorAll('.command-result').forEach((button, index) => button.classList.toggle('selected', index === paletteIndex));
    document.querySelector(`.command-result[data-command-index="${paletteIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function refreshers() {
    return {
      users: window.loadUsers,
      privacy: window.loadPrivacyData,
      health: window.loadOperationalMetrics,
      musics: window.loadMusics,
      artists: window.loadArtists,
      submissions: window.loadSubmissions,
      requests: window.loadMusicRequests,
      messages: window.loadMessages,
      podcasts: window.loadPodcasts,
    };
  }

  async function refreshAll() {
    const button = document.getElementById('refreshAllBtn');
    if (button) { button.disabled = true; button.classList.add('is-loading'); }
    const tasks = Object.values(refreshers()).filter(fn => typeof fn === 'function').map(fn => Promise.resolve().then(fn));
    await Promise.allSettled(tasks);
    await refreshOverview();
    reapplyFilters();
    if (button) { button.disabled = false; button.classList.remove('is-loading'); }
    notify('Dados atualizados', 'success');
  }

  function setupModalDismiss() {
    const modal = document.getElementById('genericModal');
    modal?.addEventListener('click', event => {
      if (event.target === modal) modal.classList.remove('active');
    });
  }

  function mount() {
    bindTabTriggers();

    document.getElementById('globalSearchBtn')?.addEventListener('click', openPalette);
    document.getElementById('commandSearchInput')?.addEventListener('input', event => renderPalette(event.target.value));
    document.getElementById('commandPalette')?.addEventListener('click', event => {
      if (event.target.id === 'commandPalette') closePalette();
    });

    document.querySelectorAll('[data-filter-target]').forEach(input => input.addEventListener('input', () => {
      filterContainer(input);
      if (input.id === 'messagesSearchInput') applyMessagesFilter();
    }));
    document.getElementById('messagesFilterSelect')?.addEventListener('change', applyMessagesFilter);
    try {
      const savedMessageFilter = localStorage.getItem('fenda-admin-message-filter');
      if (savedMessageFilter && document.querySelector(`#messagesFilterSelect option[value="${CSS.escape(savedMessageFilter)}"]`)) {
        document.getElementById('messagesFilterSelect').value = savedMessageFilter;
      }
    } catch (_) {}
    document.querySelectorAll('.refresh-section').forEach(button => button.addEventListener('click', async () => {
      const fn = refreshers()[button.dataset.refresh];
      if (typeof fn !== 'function') return;
      button.disabled = true;
      await Promise.resolve(fn());
      await refreshOverview();
      button.disabled = false;
      notify('Seção atualizada', 'success');
    }));
    document.getElementById('refreshAllBtn')?.addEventListener('click', refreshAll);
    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    document.getElementById('mobileBackdrop')?.addEventListener('click', closeSidebar);
    setupModalDismiss();

    document.addEventListener('keydown', event => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const editing = tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const palette = document.getElementById('commandPalette');
        if (palette?.hidden) openPalette(); else closePalette();
        return;
      }
      const palette = document.getElementById('commandPalette');
      if (palette && !palette.hidden) {
        if (event.key === 'Escape') closePalette();
        if (event.key === 'ArrowDown') { event.preventDefault(); movePaletteSelection(1); }
        if (event.key === 'ArrowUp') { event.preventDefault(); movePaletteSelection(-1); }
        if (event.key === 'Enter') { event.preventDefault(); executePaletteItem(paletteIndex); }
        return;
      }
      if (!editing && event.key === '/') { event.preventDefault(); openPalette(); return; }
      if (editing || event.altKey || event.ctrlKey || event.metaKey) return;
      const shortcut = { g: 'overview', h: 'overview', y: 'health', u: 'users', p: 'privacy', m: 'musics', a: 'artists', r: 'requests', s: 'messages', n: 'messages', o: 'podcasts' }[event.key.toLowerCase()];
      if (shortcut) openTab(shortcut);
      if (event.key === 'Escape') { closeSidebar(); document.getElementById('genericModal')?.classList.remove('active'); }
    });

    window.setTimeout(() => { refreshOverview(); restoreTab(); applyMessagesFilter(); }, 900);
    window.supabaseClient?.auth?.onAuthStateChange?.((event, session) => {
      if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        window.setTimeout(() => {
          refreshOverview();
          if (typeof window.loadOperationalMetrics === 'function') window.loadOperationalMetrics();
        }, 250);
      }
    });
    window.setInterval(() => {
      if (document.visibilityState === 'visible' && typeof window.loadOperationalMetrics === 'function') window.loadOperationalMetrics();
    }, 60000);
    let refreshTimer = null;
    const observer = new MutationObserver(() => {
      reapplyFilters();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (!document.hidden) refreshOverview();
      }, 350);
    });
      ['usersList', 'musicsList', 'artistsList', 'messagesList', 'subsList', 'requestsList', 'podcastsList'].forEach(id => {
      const node = document.getElementById(id);
      if (node) observer.observe(node, { childList: true });
    });
  }

  window.AdminUI = { openTab, openPalette, closePalette, refreshOverview, refreshAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
