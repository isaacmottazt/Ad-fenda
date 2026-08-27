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
      return (!query || haystack.includes(query)) && (status === 'all' || request.status === status);
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
      p_style_tags: null,
      p_notes: null,
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
  }

  window.loadMusicRequests = loadMusicRequests;
  window.refreshMusicRequests = loadMusicRequests;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi, { once: true });
  else bindUi();
})();
