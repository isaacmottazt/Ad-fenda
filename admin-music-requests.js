(() => {
  'use strict';

  const REQUEST_STATUS_LABELS = {
    pending: 'Aguardando revisão',
    reviewing: 'Em análise',
    approved: 'Aprovada',
    rejected: 'Recusada',
    blocked: 'Bloqueada',
    published: 'Publicada',
  };
  const requestStore = new Map();
  let selectedRequestId = null;
  let uiBound = false;

  function esc(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value ?? '');
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function safeUrl(value) {
    if (typeof sanitizeUrl === 'function') return sanitizeUrl(value || '') || '';
    try {
      const url = new URL(value || '', window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }

  function notify(message, type = 'success') {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function requesterName(request) {
    return request?.profiles?.full_name || request?.profiles?.email || 'Usuário';
  }

  function isOpenStatus(status) {
    return ['pending', 'reviewing', 'approved'].includes(status);
  }

  function updateSummary() {
    const requests = [...requestStore.values()];
    const open = requests.filter(request => isOpenStatus(request.status));
    const pending = requests.filter(request => request.status === 'pending' || request.status === 'reviewing');
    const approved = requests.filter(request => request.status === 'approved');
    const blocked = requests.filter(request => request.status === 'blocked' || request.status === 'rejected');
    const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = String(value); };
    setText('requestTotalCount', open.length);
    setText('requestPendingCount', pending.length);
    setText('requestApprovedCount', approved.length);
    setText('requestBlockedCount', blocked.length);
    setText('requestsCount', `${open.length} aberta${open.length === 1 ? '' : 's'}`);
    const badge = document.getElementById('requestsNavCount');
    if (badge) {
      badge.textContent = String(pending.length);
      badge.classList.toggle('visible', pending.length > 0);
    }
  }

  function currentRequest() {
    return selectedRequestId == null ? null : requestStore.get(String(selectedRequestId)) || requestStore.get(selectedRequestId) || null;
  }

  function requestAudioPath(request) {
    return safeUrl(request?.audio_url);
  }

  function ensureRequestEnhancementPanel() {
    if (document.getElementById('requestAudioPlayer')) return;
    const content = document.getElementById('requestDetailContent');
    const upload = document.getElementById('requestAudioInput')?.closest('label');
    if (!content || !upload) return;

    const panel = document.createElement('section');
    panel.id = 'requestEnhancementPanel';
    panel.style.cssText = 'margin-top:12px;padding:12px;background:rgba(119,169,255,.055);border:1px solid rgba(119,169,255,.18);border-radius:12px;';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;"><strong style="font-size:11px;">Áudio e metadados</strong><a id="requestAudioOpenLink" hidden target="_blank" rel="noopener noreferrer" class="btn-icon" style="min-height:30px;text-decoration:none;">Abrir áudio</a></div>
      <audio id="requestAudioPlayer" controls preload="metadata" hidden style="width:100%;height:36px;margin-bottom:10px;"></audio>
      <p id="requestAudioEmptyNote" style="margin:0 0 10px;color:var(--text-muted);font-size:10px;line-height:1.45;">O player aparecerá assim que um áudio for anexado pelo aplicativo ou manualmente.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="display:grid;gap:5px;color:var(--text-muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Título<input id="requestMetaTitle" type="text" style="padding:9px;color:var(--text);background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:9px;font-size:11px;text-transform:none;"></label>
        <label style="display:grid;gap:5px;color:var(--text-muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Artista<input id="requestMetaArtist" type="text" style="padding:9px;color:var(--text);background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:9px;font-size:11px;text-transform:none;"></label>
        <label style="display:grid;gap:5px;color:var(--text-muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Álbum<input id="requestMetaAlbum" type="text" style="padding:9px;color:var(--text);background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:9px;font-size:11px;text-transform:none;"></label>
        <label style="display:grid;gap:5px;color:var(--text-muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Gênero<input id="requestMetaGenre" type="text" style="padding:9px;color:var(--text);background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:9px;font-size:11px;text-transform:none;"></label>
      </div>
      <label style="display:grid;gap:5px;margin-top:8px;color:var(--text-muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Capa (URL)<input id="requestMetaCover" type="url" style="padding:9px;color:var(--text);background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:9px;font-size:11px;text-transform:none;"></label>
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;"><button id="requestFindMetadataBtn" type="button" class="btn-icon"><span class="material-symbols-rounded">travel_explore</span>Pesquisar capa e dados</button><button id="requestSaveMetadataBtn" type="button" class="btn-icon"><span class="material-symbols-rounded">save</span>Salvar metadados</button><button id="requestFindLyricsBtn" type="button" class="btn-icon"><span class="material-symbols-rounded">lyrics</span>Procurar letra</button></div>
      <div id="requestMetadataResults" style="display:grid;gap:7px;margin-top:10px;"></div>
      <p id="requestLyricsStatus" style="margin:9px 0 0;color:var(--text-muted);font-size:10px;"></p>
    `;
    upload.insertAdjacentElement('beforebegin', panel);
  }

  function updateRequestEnhancementPanel(request) {
    ensureRequestEnhancementPanel();
    const audio = document.getElementById('requestAudioPlayer');
    const openLink = document.getElementById('requestAudioOpenLink');
    const emptyNote = document.getElementById('requestAudioEmptyNote');
    const audioUrl = requestAudioPath(request);
    if (audio) {
      audio.pause?.();
      audio.removeAttribute('src');
      if (audioUrl) { audio.src = audioUrl; audio.hidden = false; }
      else audio.hidden = true;
      audio.load?.();
    }
    if (openLink) { openLink.hidden = !audioUrl; if (audioUrl) openLink.href = audioUrl; }
    if (emptyNote) emptyNote.hidden = Boolean(audioUrl);
    const setInput = (id, value) => { const input = document.getElementById(id); if (input) input.value = value || ''; };
    setInput('requestMetaTitle', request.title);
    setInput('requestMetaArtist', request.artist);
    setInput('requestMetaAlbum', request.album);
    setInput('requestMetaGenre', request.genre);
    setInput('requestMetaCover', request.cover_url);
    const lyricsStatus = document.getElementById('requestLyricsStatus');
    if (lyricsStatus) lyricsStatus.textContent = request.lyrics_url ? 'Letra sincronizada anexada e pronta para publicação.' : 'A letra será pesquisada apenas quando você solicitar e ficará vinculada a esta solicitação.';
    const results = document.getElementById('requestMetadataResults');
    if (results) results.innerHTML = '';
  }

  async function updateRequestRecord(id, values) {
    const { data, error } = await supabaseClient.from('music_requests')
      .update({ ...values, reviewed_by: typeof currentAdminUserId !== 'undefined' ? currentAdminUserId : null, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, profiles:requested_by ( full_name, email )')
      .maybeSingle();
    if (error) throw error;
    if (data) requestStore.set(String(id), data);
    renderList();
    updateSummary();
    return data;
  }

  async function findRequestMetadata() {
    const request = currentRequest();
    if (!request) return;
    const title = String(document.getElementById('requestMetaTitle')?.value || request.title).trim();
    const artist = String(document.getElementById('requestMetaArtist')?.value || request.artist).trim();
    if (!title || !artist) { notify('Preencha título e artista antes de pesquisar.', 'error'); return; }
    const button = document.getElementById('requestFindMetadataBtn');
    const resultsNode = document.getElementById('requestMetadataResults');
    if (button) { button.disabled = true; button.textContent = 'Pesquisando…'; }
    if (resultsNode) resultsNode.textContent = 'Consultando catálogos musicais…';
    try {
      const query = encodeURIComponent(`${artist} ${title}`);
      const [itunes, deezer] = await Promise.all([
        fetch(`https://itunes.apple.com/search?term=${query}&entity=musicTrack&limit=5`).then(response => response.ok ? response.json() : { results: [] }).catch(() => ({ results: [] })),
        fetch(`https://api.deezer.com/search/track?q=${query}&limit=5`).then(response => response.ok ? response.json() : { data: [] }).catch(() => ({ data: [] })),
      ]);
      const candidates = [
        ...(itunes.results || []).map(item => ({ title: item.trackName, artist: item.artistName, album: item.collectionName || '', genre: item.primaryGenreName || '', cover: (item.artworkUrl100 || '').replace('100x100', '600x600'), source: 'iTunes' })),
        ...(deezer.data || []).map(item => ({ title: item.title, artist: item.artist?.name || '', album: item.album?.title || '', genre: '', cover: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || '', source: 'Deezer' })),
      ].filter(item => item.title && item.artist).slice(0, 8);
      if (!resultsNode) return;
      if (!candidates.length) { resultsNode.textContent = 'Nenhum resultado encontrado. Você pode preencher os campos manualmente.'; return; }
      resultsNode.innerHTML = candidates.map((item, index) => `<button type="button" class="btn-secondary" data-request-meta-index="${index}" style="width:100%;height:auto;justify-content:flex-start;padding:8px;text-align:left;"><span style="width:34px;height:34px;overflow:hidden;border-radius:8px;background:var(--surface-3);display:grid;place-items:center;flex:0 0 auto;">${item.cover ? `<img src="${esc(safeUrl(item.cover))}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<span class="material-symbols-rounded">album</span>'}</span><span style="min-width:0;flex:1;"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.title)}</strong><small style="display:block;margin-top:2px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.artist)} · ${esc(item.album || item.source)}</small></span></button>`).join('');
      resultsNode.querySelectorAll('[data-request-meta-index]').forEach(node => node.addEventListener('click', () => {
        const item = candidates[Number(node.dataset.requestMetaIndex)];
        const setInput = (id, value) => { const input = document.getElementById(id); if (input) input.value = value || ''; };
        setInput('requestMetaTitle', item.title); setInput('requestMetaArtist', item.artist); setInput('requestMetaAlbum', item.album); setInput('requestMetaGenre', item.genre); setInput('requestMetaCover', item.cover);
        resultsNode.innerHTML = '<span style="color:var(--green);font-size:10px;">Resultado aplicado aos campos. Revise e clique em Salvar metadados.</span>';
      }));
    } finally {
      if (button) { button.disabled = false; button.innerHTML = '<span class="material-symbols-rounded">travel_explore</span>Pesquisar capa e dados'; }
    }
  }

  async function saveRequestMetadata() {
    const request = currentRequest();
    if (!request) return;
    const value = id => String(document.getElementById(id)?.value || '').trim();
    const title = value('requestMetaTitle');
    const artist = value('requestMetaArtist');
    if (!title || !artist) { notify('Título e artista são obrigatórios.', 'error'); return; }
    try {
      await updateRequestRecord(request.id, { title, artist, album: value('requestMetaAlbum') || null, genre: value('requestMetaGenre') || null, cover_url: value('requestMetaCover') || null });
      notify('Metadados da solicitação salvos. A publicação continuará sob sua revisão.', 'success');
    } catch (error) { notify('Não foi possível salvar metadados: ' + (error.message || error), 'error'); }
  }

  async function findRequestLyrics() {
    const request = currentRequest();
    if (!request) return;
    const title = String(document.getElementById('requestMetaTitle')?.value || request.title).trim();
    const artist = String(document.getElementById('requestMetaArtist')?.value || request.artist).trim();
    const status = document.getElementById('requestLyricsStatus');
    if (!title || !artist) { notify('Preencha título e artista antes de procurar a letra.', 'error'); return; }
    if (status) status.textContent = 'Buscando letra sincronizada…';
    try {
      const lyrics = await fetchSyncedLyricsFromLRCLIB(artist, title);
      if (!lyrics) { if (status) status.textContent = 'Nenhuma letra sincronizada foi encontrada. Você pode manter a solicitação sem letra.'; return; }
      const safeName = `${title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'letra'}-${Date.now()}.lrc`;
      const path = `request-lyrics/${request.id}/${safeName}`;
      const { error: uploadError } = await supabaseClient.storage.from('music-files').upload(path, new Blob([lyrics], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabaseClient.storage.from('music-files').getPublicUrl(path);
      await updateRequestRecord(request.id, { lyrics_url: urlData.publicUrl });
      if (status) status.textContent = 'Letra sincronizada anexada. Ela será publicada junto com a música quando você aprovar.';
      notify('Letra sincronizada anexada à solicitação.', 'success');
    } catch (error) {
      if (status) status.textContent = 'Não foi possível anexar a letra agora.';
      notify('Falha ao procurar ou salvar letra: ' + (error.message || error), 'error');
    }
  }

  function renderDetail(request) {
    const empty = document.getElementById('requestDetailEmpty');
    const content = document.getElementById('requestDetailContent');
    if (!request) {
      if (empty) empty.hidden = false;
      if (content) content.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value || '—'; };
    setText('requestDetailTitle', request.title || 'Sem título');
    setText('requestDetailArtist', request.artist || 'Artista não informado');
    const sourceNode = document.getElementById('requestDetailSource');
    const sourceLabel = request.source_provider || 'Busca do usuário';
    const sourceUrl = safeUrl(request.source_url);
    if (sourceNode) sourceNode.innerHTML = sourceUrl
      ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(sourceLabel)} <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>`
      : esc(sourceLabel);
    setText('requestDetailAlbum', request.album || 'Não informado');
    setText('requestDetailAudio', request.audio_url ? 'Áudio autorizado anexado' : 'Ainda não enviado');
    setText('requestDetailStatus', REQUEST_STATUS_LABELS[request.status] || request.status || '—');
    const audioInput = document.getElementById('requestAudioInput');
    const terminal = ['published', 'blocked', 'rejected'].includes(request.status);
    if (audioInput) audioInput.disabled = terminal;
    const fileName = document.getElementById('requestAudioFileName');
    if (fileName) fileName.textContent = request.audio_url ? 'Arquivo anexado. Você pode substituir.' : 'Nenhum arquivo selecionado';
    const art = document.getElementById('requestDetailArt');
    if (art) {
      const cover = safeUrl(request.cover_url);
      art.className = 'request-detail-art request-cover-ocean';
      art.innerHTML = cover ? `<img src="${esc(cover)}" alt="">` : '<span class="material-symbols-rounded">music_note</span>';
    }
    const approve = document.getElementById('requestApproveBtn');
    const reject = document.getElementById('requestRejectBtn');
    const publish = document.getElementById('requestPublishBtn');
    if (approve) { approve.disabled = terminal || request.status === 'approved'; approve.innerHTML = request.status === 'approved' ? '<span class="material-symbols-rounded">check_circle</span>Aprovada' : '<span class="material-symbols-rounded">fact_check</span>Marcar aprovada'; }
    if (reject) { reject.disabled = terminal; reject.innerHTML = request.status === 'blocked' || request.status === 'rejected' ? '<span class="material-symbols-rounded">block</span>Bloqueada' : '<span class="material-symbols-rounded">block</span>Bloquear'; }
    if (publish) publish.disabled = terminal || !request.audio_url;
    updateRequestEnhancementPanel(request);
  }

  function selectRequest(id) {
    selectedRequestId = String(id);
    document.querySelectorAll('#requestsList .request-card').forEach(card => card.classList.toggle('selected', card.dataset.requestId === selectedRequestId));
    renderDetail(currentRequest());
  }

  function getFilteredRequests() {
    const query = String(document.getElementById('requestsSearchInput')?.value || '').trim().toLowerCase();
    const status = document.getElementById('requestsFilterSelect')?.value || 'all';
    return [...requestStore.values()].filter(request => {
      const haystack = [request.title, request.artist, request.search_query, request.source_provider, requesterName(request), request.status].join(' ').toLowerCase();
      const matchesStatus = status === 'all' || request.status === status;
      const matchesSpotify = status === 'spotify' && String(request.source_provider || '').toLowerCase() === 'spotify';
      return (!query || haystack.includes(query)) && (matchesStatus || matchesSpotify);
    });
  }

  function renderList() {
    const container = document.getElementById('requestsList');
    if (!container) return;
    const requests = getFilteredRequests();
    if (!requests.length) {
      container.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">inbox</span><h3>Nenhuma solicitação encontrada</h3><p>Quando um usuário pedir uma música, ela aparecerá nesta fila.</p></div>`;
      renderDetail(null);
      return;
    }
    container.innerHTML = requests.map(request => {
      const cover = safeUrl(request.cover_url);
      const status = REQUEST_STATUS_LABELS[request.status] || request.status || 'Sem status';
      const source = request.source_provider || 'Busca do usuário';
      const requester = requesterName(request);
      const audio = request.audio_url ? 'Áudio autorizado anexado' : 'Áudio ainda não enviado';
      return `<article class="request-card${String(request.id) === String(selectedRequestId) ? ' selected' : ''}" data-request-id="${esc(request.id)}" tabindex="0" role="button" aria-label="Abrir solicitação ${esc(request.title)}">
        <div class="request-card-head"><div class="request-card-art">${cover ? `<img src="${esc(cover)}" alt="">` : '<span class="material-symbols-rounded">music_note</span>'}</div><div class="request-card-main"><strong>${esc(request.title)}</strong><small>${esc(request.artist)} · solicitada por ${esc(requester)}</small></div><span class="request-status ${esc(request.status)}">${esc(status)}</span></div>
        <div class="request-card-meta"><span><span class="material-symbols-rounded">search</span>${esc(source)}</span><span><span class="material-symbols-rounded">${request.audio_url ? 'audio_file' : 'upload_file'}</span>${esc(audio)}</span><span><span class="material-symbols-rounded">schedule</span>${esc(formatDate(request.created_at))}</span></div>
        <div class="request-card-actions"><button type="button" class="btn-icon" data-request-open><span class="material-symbols-rounded">visibility</span>Detalhes</button>${request.status === 'pending' || request.status === 'reviewing' ? '<button type="button" class="btn-icon ok" data-request-approve><span class="material-symbols-rounded">fact_check</span>Aprovar</button>' : ''}${request.status === 'approved' && request.audio_url ? '<button type="button" class="btn-primary" data-request-publish><span class="material-symbols-rounded">publish</span>Publicar</button>' : ''}${isOpenStatus(request.status) ? '<button type="button" class="btn-icon danger" data-request-block><span class="material-symbols-rounded">block</span>Bloquear</button>' : ''}</div>
      </article>`;
    }).join('');
    container.querySelectorAll('.request-card').forEach(card => {
      const id = card.dataset.requestId;
      card.addEventListener('click', event => { if (!event.target.closest('button')) selectRequest(id); });
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRequest(id); } });
      card.querySelector('[data-request-open]')?.addEventListener('click', () => selectRequest(id));
      card.querySelector('[data-request-approve]')?.addEventListener('click', () => updateRequestStatus(id, 'approved'));
      card.querySelector('[data-request-block]')?.addEventListener('click', () => updateRequestStatus(id, 'blocked'));
      card.querySelector('[data-request-publish]')?.addEventListener('click', () => publishRequest(id));
    });
    if (!currentRequest() || !requests.some(request => String(request.id) === String(selectedRequestId))) selectRequest(requests[0].id);
    else renderDetail(currentRequest());
  }

  async function loadMusicRequests() {
    const container = document.getElementById('requestsList');
    if (!container) return;
    const { data, error } = await supabaseClient.from('music_requests').select('*, profiles:requested_by ( full_name, email )').order('created_at', { ascending: false }).limit(120);
    if (error) {
      container.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">error</span><h3>Não foi possível carregar solicitações</h3><p>${esc(error.message || 'Verifique a migration e as políticas do Supabase.')}</p></div>`;
      updateSummary();
      return;
    }
    requestStore.clear();
    (data || []).forEach(request => requestStore.set(String(request.id), request));
    renderList();
    updateSummary();
    const updated = document.getElementById('requestsLastUpdated');
    if (updated) updated.textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function updateRequestStatus(id, status) {
    const request = requestStore.get(String(id));
    if (!request) return;
    if (status === 'blocked' && !window.confirm(`Bloquear a solicitação “${request.title}”?`)) return;
    const { data, error } = await supabaseClient.from('music_requests').update({ status, reviewed_by: typeof currentAdminUserId !== 'undefined' ? currentAdminUserId : null, reviewed_at: new Date().toISOString() }).eq('id', id).select('*, profiles:requested_by ( full_name, email )').maybeSingle();
    if (error) { notify('Não foi possível atualizar a solicitação: ' + error.message, 'error'); return; }
    if (data) requestStore.set(String(id), data);
    notify(status === 'approved' ? 'Solicitação aprovada para revisão final.' : 'Solicitação bloqueada.', 'success');
    renderList();
    updateSummary();
  }

  async function uploadRequestAudio(event) {
    const request = currentRequest();
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!request || !file) return;
    if (['published', 'blocked', 'rejected'].includes(request.status)) { notify('Esta solicitação não aceita novos arquivos neste estado.', 'error'); return; }
    if (!file.type.startsWith('audio/')) { notify('Escolha um arquivo de áudio válido.', 'error'); return; }
    if (file.size > 80 * 1024 * 1024) { notify('O áudio precisa ter no máximo 80 MB.', 'error'); return; }
    const fileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `request-audio/${request.id}/${Date.now()}-${fileName}`;
    const label = document.getElementById('requestAudioFileName');
    if (label) label.textContent = 'Enviando arquivo…';
    const { error: uploadError } = await supabaseClient.storage.from('music-files').upload(path, file, { cacheControl: '3600', upsert: false });
    if (uploadError) { if (label) label.textContent = 'Falha no envio'; notify('Não foi possível enviar o áudio: ' + uploadError.message, 'error'); return; }
    const { data: urlData } = supabaseClient.storage.from('music-files').getPublicUrl(path);
    const { data, error } = await supabaseClient.from('music_requests').update({ audio_url: urlData.publicUrl, reviewed_by: typeof currentAdminUserId !== 'undefined' ? currentAdminUserId : null, reviewed_at: new Date().toISOString() }).eq('id', request.id).select('*, profiles:requested_by ( full_name, email )').maybeSingle();
    if (error) { notify('Áudio enviado, mas não foi possível vincular à solicitação: ' + error.message, 'error'); return; }
    if (data) requestStore.set(String(request.id), data);
    notify('Áudio autorizado anexado à solicitação.', 'success');
    renderList();
    updateSummary();
  }

  async function publishRequest(id) {
    const request = requestStore.get(String(id));
    if (!request) return;
    if (!request.audio_url) { notify('Anexe um áudio autorizado antes de publicar.', 'error'); return; }
    if (!window.confirm(`Publicar “${request.title}” no catálogo?`)) return;
    const { error } = await supabaseClient.rpc('admin_publish_music_request', {
      p_request_id: request.id,
      p_src: request.audio_url,
      p_cover: request.cover_url || null,
      p_genre: request.genre || null,
      p_style: null,
      p_style_tags: [],
      p_notes: null,
      p_lrc: request.lyrics_url || null,
    });
    if (error) { notify('Não foi possível publicar: ' + error.message, 'error'); return; }
    notify('Música publicada no catálogo com sucesso.', 'success');
    await loadMusicRequests();
    if (typeof loadMusics === 'function') loadMusics();
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    document.getElementById('requestsSearchInput')?.addEventListener('input', renderList);
    document.getElementById('requestsFilterSelect')?.addEventListener('change', renderList);
    document.getElementById('refreshRequestsBtn')?.addEventListener('click', loadMusicRequests);
    document.getElementById('requestAudioInput')?.addEventListener('change', uploadRequestAudio);
    document.getElementById('requestApproveBtn')?.addEventListener('click', () => { const request = currentRequest(); if (request) updateRequestStatus(request.id, 'approved'); });
    document.getElementById('requestRejectBtn')?.addEventListener('click', () => { const request = currentRequest(); if (request) updateRequestStatus(request.id, 'blocked'); });
    document.getElementById('requestPublishBtn')?.addEventListener('click', () => { const request = currentRequest(); if (request) publishRequest(request.id); });
    ensureRequestEnhancementPanel();
    document.getElementById('requestFindMetadataBtn')?.addEventListener('click', findRequestMetadata);
    document.getElementById('requestSaveMetadataBtn')?.addEventListener('click', saveRequestMetadata);
    document.getElementById('requestFindLyricsBtn')?.addEventListener('click', findRequestLyrics);
  }

  window.loadMusicRequests = loadMusicRequests;
  window.refreshMusicRequests = loadMusicRequests;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi, { once: true });
  else bindUi();
})();
