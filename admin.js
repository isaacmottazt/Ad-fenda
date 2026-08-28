// ========== VERIFICAÇÃO DE ADMIN ==========
let currentAdminUserId = null;
let currentUserRole = null;

async function checkAdminAndRedirect() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showToast("Você precisa estar logado como administrador.", "error");
    window.location.href = "index.html";
    return false;
  }
  currentAdminUserId = session.user.id;
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', currentAdminUserId)
    .single();
  if (error || !profile || profile.role !== 'admin') {
    showToast("Acesso negado. Você não é administrador.", "error");
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
    return false;
  }
  currentUserRole = profile.role;
  return true;
}

// ========== UTILIDADES ==========
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? 'check_circle' : (type === 'error' ? 'error' : 'info');
  toast.innerHTML = `<span class="material-symbols-rounded">${icon}</span><span>${msg}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== BUSCA CAPA DE MÚSICA (Deezer + iTunes) ==========
async function fetchCoverFromDeezer(artist, track) {
  const normalize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const queries = [`${artist} ${track}`, track, artist, normalize(`${artist} ${track}`), normalize(track)];
  for (let query of queries) {
    if (!query || query.length < 2) continue;
    try {
      const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.data && data.data.length > 0) {
        const cover = data.data[0].album.cover_big || data.data[0].album.cover_xl || data.data[0].album.cover_medium;
        if (cover) return cover;
      }
    } catch (err) {}
  }
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${track}`)}&entity=musicTrack&limit=1`;
    const itunesRes = await fetch(itunesUrl);
    const itunesData = await itunesRes.json();
    if (itunesData.results && itunesData.results.length > 0) {
      let artwork = itunesData.results[0].artworkUrl100;
      if (artwork) return artwork.replace('100x100', '600x600');
    }
  } catch (err) {}
  return null;
}

// ========== BUSCA FOTO DO ARTISTA (Deezer) ==========
async function fetchArtistImageFromDeezer(artistName) {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const artist = data.data[0];
      return artist.picture_xl || artist.picture_big || artist.picture_medium || null;
    }
  } catch (err) {
    console.error("Erro ao buscar artista no Deezer:", err);
  }
  return null;
}

// ========== BUSCA LETRA SINCRONIZADA (LRCLIB) ==========
async function fetchSyncedLyricsFromLRCLIB(artist, track) {
  try {
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.syncedLyrics || null;
  } catch (e) {
    console.error('LRCLIB error:', e);
    return null;
  }
}

// ========== CRUD USUÁRIOS (SIMPLIFICADO) ==========
async function loadUsers() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, full_name, email')
    .order('created_at', { ascending: false });
  if (error) return showToast("Erro ao carregar usuários", "error");
  document.getElementById('usersCount').innerText = data.length;
  const container = document.getElementById('usersList');
  container.innerHTML = '';
  for (const user of data) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(user.full_name || 'Sem nome')}</h3>
      <p><strong>E-mail:</strong> <span style="color:rgba(255,255,255,0.7);">${escapeHtml(user.email)}</span></p>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button class="btn-icon danger delete-user" data-id="${escapeAttr(user.id)}" data-name="${escapeAttr(user.full_name || 'Usuário')}">
          <span class="material-symbols-rounded">delete</span> Excluir
        </button>
      </div>
    `;
    container.appendChild(card);
  }
  document.querySelectorAll('.delete-user').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.id, btn.dataset.name));
  });
}

let adminPrivacyRows = [];

function _privacyDomId(userId) {
  return `privacyDetail_${String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function _privacyDate(value) {
  if (!value) return 'não informado';
  try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  catch { return escapeHtml(value); }
}

function _privacyChip(label, enabled, extraClass = '') {
  return `<span class="privacy-chip ${enabled ? `on ${extraClass}` : ''}">${enabled ? 'Ativo' : 'Desativado'} · ${label}</span>`;
}

function renderPrivacyRows() {
  const container = document.getElementById('privacyList');
  if (!container) return;
  const query = String(document.getElementById('privacySearchInput')?.value || '').trim().toLowerCase();
  const rows = adminPrivacyRows.filter(row => {
    if (!query) return true;
    const haystack = [row.user_id, row.profile?.full_name, row.profile?.email].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(query);
  });

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">privacy_tip</span><h3>Nenhum registro encontrado</h3><p>Os usuários só aparecem aqui depois de autorizarem alguma finalidade.</p></div>`;
    return;
  }

  container.innerHTML = rows.map(row => {
    const id = escapeHtml(row.user_id);
    const domId = _privacyDomId(row.user_id);
    const name = escapeHtml(row.profile?.full_name || 'Usuário sem nome');
    const email = escapeHtml(row.profile?.email || 'E-mail não disponível');
    const deviceSummary = row.device_data_consent
      ? `${escapeHtml(row.device_platform || 'plataforma não informada')} · ${escapeHtml(row.device_language || 'idioma não informado')} · ${escapeHtml(row.device_timezone || 'fuso não informado')}`
      : 'não autorizado';
    const locationAction = row.location_consent
      ? `<button class="btn-icon privacy-detail-btn" data-user-id="${id}" aria-expanded="false"><span class="material-symbols-rounded">location_on</span> Ver localização</button>`
      : '';
    const deviceAction = row.device_data_consent
      ? `<button class="btn-icon privacy-device-btn" data-user-id="${id}" aria-expanded="false"><span class="material-symbols-rounded">devices</span> Ver dados técnicos</button>`
      : '';
    return `<article class="privacy-record">
      <div class="privacy-record-head">
        <span class="msg-card-icon"><span class="material-symbols-rounded">person</span></span>
        <div class="privacy-record-main"><strong>${name}</strong><small>${email}</small><small>ID: <code>${id}</code></small></div>
        <small style="color:var(--text-faint); white-space:nowrap;">${_privacyDate(row.updated_at || row.consented_at || row.revoked_at)}</small>
      </div>
      <div class="privacy-chips">
        ${_privacyChip('análise de uso', row.analytics_consent)}
        ${_privacyChip('recomendações', row.recommendations_consent)}
        ${_privacyChip('localização', row.location_consent, 'location')}
        ${_privacyChip('dados técnicos', row.device_data_consent)}
      </div>
      <div style="margin-top:10px; font-size:11px; color:var(--text-secondary);">Dispositivo autorizado: ${deviceSummary}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:11px;">${locationAction}${deviceAction}</div>
      <div class="privacy-detail" id="${domId}" hidden></div>
    </article>`;
  }).join('');

  container.querySelectorAll('.privacy-detail-btn').forEach(button => {
    button.addEventListener('click', () => togglePrivacyDetail(button, 'location'));
  });
  container.querySelectorAll('.privacy-device-btn').forEach(button => {
    button.addEventListener('click', () => togglePrivacyDetail(button, 'device'));
  });
}

function togglePrivacyDetail(button, kind) {
  const row = adminPrivacyRows.find(item => String(item.user_id) === String(button.dataset.userId));
  const detail = document.getElementById(_privacyDomId(button.dataset.userId));
  if (!row || !detail) return;
  const willOpen = detail.hidden;
  detail.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
  if (!willOpen) return;

  if (kind === 'location') {
    const latitude = Number(row.location_latitude);
    const longitude = Number(row.location_longitude);
    if (!row.location_consent || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      detail.innerHTML = '<strong>Localização</strong><br>O usuário autorizou a finalidade, mas não há coordenadas válidas armazenadas.';
      return;
    }
    detail.innerHTML = `<strong>Localização precisa autorizada</strong><br>Latitude: <code>${latitude.toFixed(6)}</code><br>Longitude: <code>${longitude.toFixed(6)}</code><br>Precisão informada: <strong>${Number.isFinite(Number(row.location_accuracy_m)) ? `${Number(row.location_accuracy_m).toFixed(2)} m` : 'não informada'}</strong><br>Capturada em: ${_privacyDate(row.location_captured_at)}<br>Fonte: ${escapeHtml(row.location_source || 'navegador')}`;
  } else {
    detail.innerHTML = `<strong>Dados técnicos autorizados</strong><br>Plataforma: ${escapeHtml(row.device_platform || 'não informada')}<br>Idioma: ${escapeHtml(row.device_language || 'não informado')}<br>Fuso horário: ${escapeHtml(row.device_timezone || 'não informado')}`;
  }
}

async function loadPrivacyData() {
  const container = document.getElementById('privacyList');
  if (!container) return;
  container.innerHTML = '<div class="privacy-loading">Carregando dados de privacidade…</div>';
  const { data, error } = await supabaseClient
    .from('user_privacy_settings')
    .select('user_id, analytics_consent, recommendations_consent, location_consent, device_data_consent, location_latitude, location_longitude, location_accuracy_m, location_captured_at, location_source, device_timezone, device_language, device_platform, consent_version, consented_at, revoked_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) {
    adminPrivacyRows = [];
    container.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">lock</span><h3>Dados indisponíveis</h3><p>${escapeHtml(error.message || 'Não foi possível consultar a tabela de privacidade.')}</p></div>`;
    return;
  }

  const ids = [...new Set((data || []).map(row => row.user_id).filter(Boolean))];
  const profiles = ids.length ? await supabaseClient.from('profiles').select('id, full_name, email').in('id', ids).limit(1000) : { data: [], error: null };
  const profilesById = Object.fromEntries((profiles.data || []).map(profile => [String(profile.id), profile]));
  adminPrivacyRows = (data || []).map(row => ({ ...row, profile: profilesById[String(row.user_id)] || null }));

  const total = adminPrivacyRows.length;
  const count = key => adminPrivacyRows.filter(row => row[key] === true).length;
  document.getElementById('privacyUserCount').textContent = String(total);
  document.getElementById('privacyLocationCount').textContent = String(count('location_consent'));
  document.getElementById('privacyAnalyticsCount').textContent = String(count('analytics_consent'));
  document.getElementById('privacyRecommendationCount').textContent = String(count('recommendations_consent'));
  renderPrivacyRows();
}

async function deleteUser(userId, userName) {
  if (!confirm(`Excluir permanentemente o usuário "${userName}"? Esta ação não pode ser desfeita.`)) return;
  const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
  if (error) showToast("Erro ao excluir usuário", "error");
  else { showToast("Usuário excluído!"); loadUsers(); }
}

// ========== TRIAGEM DE RITMO DO CATÁLOGO ==========
let adminRhythmRows = [];
let adminRhythmSelectedIds = new Set();
let adminRhythmBusy = false;
let adminRhythmControlsBound = false;

function musicNeedsRhythmAudit(music) {
  const bpm = Number(music?.tempo_bpm);
  const rhythm = String(music?.rhythm_profile || '').trim();
  return !(Number.isFinite(bpm) && bpm > 0 && rhythm);
}

function rhythmRowById(id) {
  return adminRhythmRows.find(row => String(row.music.id) === String(id));
}

function rhythmSelectedRows() {
  return adminRhythmRows.filter(row => adminRhythmSelectedIds.has(String(row.music.id)));
}

function rhythmResultHtml(row) {
  const parts = [];
  if (row.status === 'searching') parts.push('<strong>Pesquisando gênero/estilo…</strong>');
  if (row.status === 'analyzing') parts.push('<strong>Analisando áudio salvo…</strong>');
  if (row.online) {
    const tags = [...new Set((row.online.genres || []).filter(Boolean))];
    parts.push(tags.length
      ? `<strong>Busca online:</strong> ${escapeHtml(tags.join(' · '))}${row.online.source ? ` <small>(${escapeHtml(row.online.source)})</small>` : ''}`
      : `<strong>Busca online:</strong> nenhum gênero confirmado${row.online.searchUrl ? ` · <a href="${escapeAttr(row.online.searchUrl)}" target="_blank" rel="noopener">abrir pesquisa</a>` : ''}`);
  }
  if (row.analysis) {
    const a = row.analysis;
    parts.push(`<strong>Áudio:</strong> ${a.bpm ? `${escapeHtml(a.bpm)} BPM` : 'BPM não detectado'} · ${escapeHtml(a.rhythmProfile || 'ritmo indefinido')} · confiança ${Math.round((Number(a.confidence) || 0) * 100)}%`);
  }
  if (row.error) parts.push(`<span style="color:var(--red);">${escapeHtml(row.error)}</span>`);
  if (!parts.length) parts.push('<span>Aguardando pesquisa ou análise.</span>');
  return parts.join('<br>');
}

function renderRhythmAuditItems() {
  const results = document.getElementById('rhythmAuditResults');
  if (!results) return;
  if (!adminRhythmRows.length) {
    results.innerHTML = '<div class="empty-state"><span class="material-symbols-rounded">check_circle</span><h3>Catálogo em dia</h3><p>Nenhuma música está sem BPM e perfil de ritmo.</p></div>';
    updateRhythmAuditControls();
    return;
  }
  results.innerHTML = adminRhythmRows.map(row => {
    const music = row.music;
    const id = escapeAttr(String(music.id));
    const cover = music.cover
      ? `<img src="${escapeAttr(music.cover)}" alt="">`
      : '<span class="material-symbols-rounded">music_note</span>';
    const statusClass = row.status === 'error' ? ' is-error' : (row.status === 'searching' || row.status === 'analyzing' ? ' is-busy' : '');
    return `<article class="rhythm-audit-item${statusClass}" data-rhythm-id="${id}">
      <input class="rhythm-audit-check" type="checkbox" data-rhythm-select="${id}" ${adminRhythmSelectedIds.has(String(music.id)) ? 'checked' : ''} aria-label="Selecionar ${escapeAttr(music.title || 'música')}">
      <div class="rhythm-audit-cover">${cover}</div>
      <div class="rhythm-audit-copy"><strong>${escapeHtml(music.title || 'Sem título')}</strong><small>${escapeHtml(music.artist || 'Artista não informado')} · ${music.tempo_bpm ? `${escapeHtml(music.tempo_bpm)} BPM` : 'sem BPM'}${music.rhythm_profile ? ` · ${escapeHtml(music.rhythm_profile)}` : ''}</small></div>
      <div class="rhythm-audit-result">${rhythmResultHtml(row)}</div>
      <button type="button" class="btn-icon" data-rhythm-action="search-one" data-rhythm-id="${id}" ${adminRhythmBusy ? 'disabled' : ''}><span class="material-symbols-rounded">travel_explore</span>Pesquisar</button>
      <button type="button" class="btn-icon" data-rhythm-action="analyze-one" data-rhythm-id="${id}" ${adminRhythmBusy ? 'disabled' : ''}><span class="material-symbols-rounded">graphic_eq</span>Analisar</button>
    </article>`;
  }).join('');
  updateRhythmAuditControls();
}

function updateRhythmAuditControls() {
  const panel = document.getElementById('rhythmAuditPanel');
  if (!panel) return;
  const count = document.getElementById('rhythmAuditCount');
  const status = document.getElementById('rhythmAuditStatus');
  const selectAll = document.getElementById('rhythmAuditSelectAll');
  const selected = rhythmSelectedRows().length;
  const hasResults = rhythmSelectedRows().some(row => row.online || row.analysis);
  const setDisabled = (id, disabled) => { const el = document.getElementById(id); if (el) el.disabled = disabled; };
  if (count) count.textContent = `${adminRhythmRows.length} pendente${adminRhythmRows.length === 1 ? '' : 's'}`;
  if (selectAll) {
    selectAll.disabled = adminRhythmBusy || !adminRhythmRows.length;
    selectAll.checked = Boolean(adminRhythmRows.length && selected === adminRhythmRows.length);
    selectAll.indeterminate = Boolean(selected && selected < adminRhythmRows.length);
  }
  setDisabled('rhythmAuditSearchBtn', adminRhythmBusy || !selected);
  setDisabled('rhythmAuditAnalyzeBtn', adminRhythmBusy || !selected);
  setDisabled('rhythmAuditSaveBtn', adminRhythmBusy || !hasResults);
  if (status && !adminRhythmBusy && !adminRhythmRows.length) status.textContent = 'Nenhuma música pendente no momento.';
}

function renderRhythmAudit(musics) {
  const panel = document.getElementById('rhythmAuditPanel');
  if (!panel) return;
  const previous = new Map(adminRhythmRows.map(row => [String(row.music.id), row]));
  adminRhythmRows = (musics || []).filter(musicNeedsRhythmAudit).map(music => {
    const old = previous.get(String(music.id));
    return old ? { ...old, music } : { music, status: 'pending', online: null, analysis: null, error: '' };
  });
  const validIds = new Set(adminRhythmRows.map(row => String(row.music.id)));
  adminRhythmSelectedIds = new Set([...adminRhythmSelectedIds].filter(id => validIds.has(id)));
  panel.hidden = false;
  if (!adminRhythmBusy) {
    const status = document.getElementById('rhythmAuditStatus');
    if (status) status.textContent = adminRhythmRows.length ? 'Selecione as faixas e escolha uma ação. Os resultados ficam para revisão.' : 'Nenhuma música pendente no momento.';
  }
  renderRhythmAuditItems();
}

async function runRhythmSearch(rows = rhythmSelectedRows()) {
  if (adminRhythmBusy) return;
  if (!rows.length) { showToast('Selecione pelo menos uma música.', 'error'); return; }
  if (typeof window.searchStyleOnline !== 'function') { showToast('A busca online ainda não carregou.', 'error'); return; }
  adminRhythmBusy = true;
  const status = document.getElementById('rhythmAuditStatus');
  try {
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      row.status = 'searching'; row.error = '';
      if (status) status.textContent = `Pesquisando ${index + 1} de ${rows.length}: ${row.music.title || 'música'}…`;
      renderRhythmAuditItems();
      try {
        row.online = await window.searchStyleOnline(row.music.title || '', row.music.artist || '', row.music.genre || '');
        row.status = 'searched';
      } catch (error) {
        row.status = 'error';
        row.error = error.message || 'Pesquisa indisponível';
      }
    }
  } finally {
    adminRhythmBusy = false;
    if (status) status.textContent = `Pesquisa concluída para ${rows.length} faixa${rows.length === 1 ? '' : 's'}. Revise os resultados antes de salvar.`;
    renderRhythmAuditItems();
  }
}

async function runRhythmAudioAnalysis(rows = rhythmSelectedRows()) {
  if (adminRhythmBusy) return;
  if (!rows.length) { showToast('Selecione pelo menos uma música.', 'error'); return; }
  if (typeof window.FendaMusicAnalyzer?.analyzeAudioFile !== 'function') { showToast('O analisador de áudio ainda não carregou.', 'error'); return; }
  adminRhythmBusy = true;
  const status = document.getElementById('rhythmAuditStatus');
  try {
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      row.status = 'analyzing'; row.error = '';
      if (status) status.textContent = `Analisando ${index + 1} de ${rows.length}: ${row.music.title || 'música'}…`;
      renderRhythmAuditItems();
      try {
        if (!row.music.src) throw new Error('Esta música não possui áudio salvo.');
        const response = await fetch(row.music.src, { mode: 'cors' });
        if (!response.ok) throw new Error(`Áudio indisponível (HTTP ${response.status})`);
        const blob = await response.blob();
        const file = new File([blob], `${row.music.title || 'musica'}.audio`, { type: blob.type || 'audio/mpeg' });
        row.analysis = await window.FendaMusicAnalyzer.analyzeAudioFile(file, {
          title: row.music.title || '',
          artist: row.music.artist || '',
          genre: row.music.genre || '',
          useOpenModel: true,
          onModelProgress: progress => {
            if (progress?.progress != null && status) status.textContent = `Carregando IA aberta: ${Math.round(progress.progress)}%…`;
          },
        });
        row.status = 'analyzed';
      } catch (error) {
        row.status = 'error';
        row.error = error.message || 'Análise indisponível';
      }
    }
  } finally {
    adminRhythmBusy = false;
    if (status) status.textContent = `Análise concluída para ${rows.length} faixa${rows.length === 1 ? '' : 's'}. Revise os resultados antes de salvar.`;
    renderRhythmAuditItems();
  }
}

async function saveRhythmResults() {
  if (adminRhythmBusy) return;
  const rows = rhythmSelectedRows().filter(row => row.online || row.analysis);
  if (!rows.length) { showToast('Selecione uma faixa com resultado antes de salvar.', 'error'); return; }
  adminRhythmBusy = true;
  const status = document.getElementById('rhythmAuditStatus');
  let saved = 0;
  let failed = 0;
  try {
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (status) status.textContent = `Salvando ${index + 1} de ${rows.length}: ${row.music.title || 'música'}…`;
      const updates = {};
      const onlineTags = [...new Set((row.online?.genres || []).filter(Boolean))];
      const analysis = row.analysis;
      const existingTags = Array.isArray(row.music.style_tags) ? row.music.style_tags : [];
      if (onlineTags.length) {
        if (!String(row.music.genre || '').trim()) updates.genre = onlineTags[0];
        if (!String(row.music.style || '').trim()) updates.style = onlineTags[0];
        updates.style_tags = [...new Set([...existingTags, ...onlineTags])];
        updates.analysis_source = row.online.source ? `metadata-search-v1+${row.online.source}` : 'metadata-search-v1';
        updates.analysis_version = 'metadata-search-v1';
        updates.analyzed_at = new Date().toISOString();
      }
      if (analysis) {
        updates.style = String(row.music.style || '').trim() || analysis.style || null;
        updates.style_tags = [...new Set([...(updates.style_tags || existingTags), ...(analysis.styleTags || [])])];
        updates.rhythm_profile = analysis.rhythmProfile || null;
        updates.tempo_bpm = Number(analysis.bpm) || null;
        updates.energy_score = Number.isFinite(Number(analysis.energy)) ? analysis.energy : null;
        updates.danceability_score = Number.isFinite(Number(analysis.danceability)) ? analysis.danceability : null;
        updates.analysis_confidence = Number.isFinite(Number(analysis.confidence)) ? analysis.confidence : null;
        updates.analysis_source = analysis.source || 'browser-acoustic-v1';
        updates.analysis_version = analysis.version || '1.0.0';
        updates.analyzed_at = analysis.analyzedAt || new Date().toISOString();
      }
      if (!Object.keys(updates).length) continue;
      const { error } = await supabaseClient.from('musics').update(updates).eq('id', row.music.id);
      if (error) { failed++; row.error = `Falha ao salvar: ${error.message}`; row.status = 'error'; }
      else saved++;
    }
  } finally {
    adminRhythmBusy = false;
  }
  if (failed) showToast(`${saved} salva(s), ${failed} falhou(aram).`, 'error');
  else showToast(`${saved} resultado(s) salvo(s) no catálogo.`, 'success');
  if (status) status.textContent = failed ? 'Alguns resultados não foram salvos; revise os erros abaixo.' : 'Resultados salvos. Atualizando o catálogo…';
  await loadMusics();
}

function bindRhythmAuditControls() {
  if (adminRhythmControlsBound) return;
  const panel = document.getElementById('rhythmAuditPanel');
  if (!panel) return;
  adminRhythmControlsBound = true;
  panel.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-rhythm-select]');
    if (!checkbox) return;
    const id = String(checkbox.dataset.rhythmSelect);
    if (checkbox.checked) adminRhythmSelectedIds.add(id);
    else adminRhythmSelectedIds.delete(id);
    updateRhythmAuditControls();
  });
  panel.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-rhythm-action]');
    if (actionButton) {
      const row = rhythmRowById(actionButton.dataset.rhythmId);
      if (!row) return;
      adminRhythmSelectedIds.add(String(actionButton.dataset.rhythmId));
      updateRhythmAuditControls();
      if (actionButton.dataset.rhythmAction === 'search-one') runRhythmSearch([row]);
      if (actionButton.dataset.rhythmAction === 'analyze-one') runRhythmAudioAnalysis([row]);
    }
  });
  document.getElementById('rhythmAuditSelectAll')?.addEventListener('change', event => {
    adminRhythmSelectedIds = event.target.checked
      ? new Set(adminRhythmRows.map(row => String(row.music.id)))
      : new Set();
    renderRhythmAuditItems();
  });
  document.getElementById('rhythmAuditSearchBtn')?.addEventListener('click', () => runRhythmSearch());
  document.getElementById('rhythmAuditAnalyzeBtn')?.addEventListener('click', () => runRhythmAudioAnalysis());
  document.getElementById('rhythmAuditSaveBtn')?.addEventListener('click', saveRhythmResults);
  updateRhythmAuditControls();
}

// ========== CRUD MÚSICAS ==========
async function loadMusics() {
  const container = document.getElementById('musicsList');
  try {
    const loadedMusics = await window.loadMusicsFromSupabase();
    const musics = Array.isArray(loadedMusics) ? loadedMusics : [];
    if (!container) return;
    container.innerHTML = '';
    for (const music of musics) {
      const card = document.createElement('div');
      card.className = 'admin-card';
      card.innerHTML = `
        <h3>${escapeHtml(music.title)}</h3>
        <p><strong>Artista:</strong> ${escapeHtml(music.artist)}</p>
        ${music.cover ? `<img src="${escapeAttr(music.cover)}" alt="Capa">` : ''}
        <p><strong>Gênero:</strong> ${escapeHtml(music.genre || '—')}</p>
        <p><strong>Estilo:</strong> ${escapeHtml(music.style || (music.style_tags || []).join(', ') || '—')}</p>
        <p><strong>Ritmo:</strong> ${music.tempo_bpm ? `${music.tempo_bpm} BPM · ${escapeHtml(music.rhythm_profile || 'indefinido')}` : 'não analisado'}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
          <button class="btn-icon edit-music" data-id="${escapeAttr(music.id)}" data-title="${escapeAttr(music.title)}" data-artist="${escapeAttr(music.artist)}" data-cover="${escapeAttr(music.cover || '')}" data-src="${escapeAttr(music.src || '')}" data-lrc="${escapeAttr(music.lrc || '')}" data-genre="${escapeAttr(music.genre || '')}" data-style="${escapeAttr(music.style || '')}" data-style-tags="${escapeAttr((music.style_tags || []).join(', '))}" data-tempo-bpm="${escapeAttr(music.tempo_bpm || '')}" data-energy="${escapeAttr(music.energy_score || '')}" data-danceability="${escapeAttr(music.danceability_score || '')}" data-rhythm-profile="${escapeAttr(music.rhythm_profile || '')}" data-analysis-confidence="${escapeAttr(music.analysis_confidence || '')}" data-analysis-source="${escapeAttr(music.analysis_source || '')}" data-analysis-version="${escapeAttr(music.analysis_version || '')}" data-analyzed-at="${escapeAttr(music.analyzed_at || '')}">
            <span class="material-symbols-rounded">edit</span> Editar
          </button>
          <button class="btn-icon danger delete-music" data-id="${escapeAttr(music.id)}" data-title="${escapeAttr(music.title)}">
            <span class="material-symbols-rounded">delete</span> Excluir
          </button>
        </div>
      `;
      container.appendChild(card);
    }
    document.querySelectorAll('.edit-music').forEach(btn => {
      btn.addEventListener('click', () => openEditMusicModal(btn.dataset));
    });
    document.querySelectorAll('.delete-music').forEach(btn => {
      btn.addEventListener('click', () => deleteMusic(btn.dataset.id, btn.dataset.title));
    });
    bindRhythmAuditControls();
    renderRhythmAudit(musics);
  } catch (error) {
    console.error('loadMusics:', error);
    adminRhythmRows = [];
    adminRhythmSelectedIds.clear();
    if (container) container.innerHTML = '<div class="empty-state"><span class="material-symbols-rounded">error</span><h3>Não foi possível carregar o catálogo</h3><p>Tente atualizar o painel novamente.</p></div>';
    renderRhythmAudit([]);
    const status = document.getElementById('rhythmAuditStatus');
    if (status) status.textContent = 'Erro ao carregar as músicas. Tente atualizar o painel.';
    showToast('Erro ao carregar músicas.', 'error');
  }
}

function openEditMusicModal(data) {
  let editAnalysis = null;
  let onlineStyleSource = null;
  document.getElementById('modalTitle').innerText = "Editar música";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título</label><input type="text" id="musicTitle" value="${escapeAttr(data.title || '')}"></div>
    <div class="form-group"><label>Artista</label><input type="text" id="musicArtist" value="${escapeAttr(data.artist || '')}"></div>
    <div style="display: flex; gap: 10px; margin-bottom: 16px;">
      <button type="button" id="autoFetchCoverEditBtn" class="btn-primary" style="flex:1;">🎨 Buscar capa</button>
      <button type="button" id="autoFetchLyricsEditBtn" class="btn-primary" style="flex:1;">📝 Buscar letra</button>
    </div>
    <div class="form-group"><label>URL da capa</label><input type="text" id="musicCoverUrl" value="${escapeAttr(data.cover || '')}"></div>
    <div class="form-group"><label>Letra sincronizada (.lrc)</label><input type="text" id="musicLrc" value="${escapeAttr(data.lrc || '')}" placeholder="URL do arquivo .lrc"></div>
    <div class="form-group"><label>Gênero</label>
      <input type="text" id="musicGenre" list="adminGenreOptions" value="${escapeAttr(data.genre || '')}" placeholder="Digite o gênero: Gospel, MPB, sertanejo…">
      <datalist id="adminGenreOptions">
        ${['Gospel','Adoração','Louvores','Contemporâneo','Rock Cristão','MPB','Pop','Rock','Sertanejo','Pagode','Samba','Funk','Forró','Eletrônica','Jazz','Clássico','Reggae','Hip-Hop','Trap','R&B'].map(g => `<option value="${escapeAttr(g)}">`).join('')}
      </datalist>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" id="searchGenreOnlineBtn" class="btn-icon" style="flex:1; justify-content:center;">Pesquisar gênero</button>
      </div>
      <div id="genreSearchResults" style="margin-top:8px;"></div>
    </div>
    <div style="margin:4px 0 14px; padding:12px 14px; border:1px solid rgba(192,132,252,.25); border-radius:14px; background:rgba(146,76,255,.08);">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" id="analyzeExistingMusicBtn" class="btn-primary" style="flex:1; min-width:210px;">
          <span class="material-symbols-rounded">auto_awesome</span> Analisar estilo e ritmo
        </button>
        <button type="button" id="chooseEditAudioBtn" class="btn-icon" style="flex:1; min-width:170px; justify-content:center;">
          <span class="material-symbols-rounded">upload_file</span> Escolher áudio
        </button>
      </div>
      <input type="file" id="editAudioFileInput" accept="audio/*" style="display:none;">
      <div id="editAnalysisStatus" style="margin-top:8px; font-size:11px; color:rgba(255,255,255,.68);">
        ${data.analysisSource ? `Última análise: ${escapeHtml(data.analysisSource)}${data.analysisVersion ? ` · v${escapeHtml(data.analysisVersion)}` : ''}` : 'Analise o áudio salvo ou escolha outro arquivo para preencher os metadados automaticamente.'}
      </div>
    </div>
    <div class="form-group"><label>Estilo da música</label>
      <div style="display:flex; gap:8px; align-items:stretch;">
        <input type="text" id="musicStyle" list="adminStyleOptions" value="${escapeAttr(data.style || data.styleTags || '')}" placeholder="Digite livremente: Soul, worship, acústico…" style="flex:1; min-width:0;">
        <button type="button" id="searchStyleOnlineBtn" class="btn-icon" style="white-space:nowrap;">Buscar sugestões</button>
      </div>
      <small style="display:block; margin-top:6px; color:rgba(255,255,255,.58);">Você pode escrever um estilo próprio ou separar vários por vírgula. A busca automática é opcional.</small>
      <div id="styleSearchResults" style="margin-top:8px;"></div>
    </div>
    <div class="form-group"><label>Ritmo detectado</label><input type="text" id="musicRhythmProfile" value="${escapeAttr(data.rhythmProfile || '')}" placeholder="lento, moderado, rápido"></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
      <div class="form-group"><label>BPM</label><input type="number" id="musicTempoBpm" min="30" max="240" step="0.1" value="${escapeAttr(data.tempoBpm || '')}"></div>
      <div class="form-group"><label>Energia</label><input type="number" id="musicEnergy" min="0" max="1" step="0.01" value="${escapeAttr(data.energy || '')}"></div>
      <div class="form-group"><label>Dança</label><input type="number" id="musicDanceability" min="0" max="1" step="0.01" value="${escapeAttr(data.danceability || '')}"></div>
    </div>
    <datalist id="adminStyleOptions">${(window.FendaMusicAnalyzer?.styles || []).map(s => `<option value="${escapeAttr(s)}">`).join('')}</datalist>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');

  const analyzeBtn = document.getElementById('analyzeExistingMusicBtn');
  const chooseAudioBtn = document.getElementById('chooseEditAudioBtn');
  const audioInput = document.getElementById('editAudioFileInput');
  const analysisStatus = document.getElementById('editAnalysisStatus');
  const searchStyleBtn = document.getElementById('searchStyleOnlineBtn');
  const styleSearchResults = document.getElementById('styleSearchResults');
  const searchGenreBtn = document.getElementById('searchGenreOnlineBtn');
  const genreSearchResults = document.getElementById('genreSearchResults');

  searchGenreBtn.addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    if (!title || !artist) {
      showToast('Preencha título e artista antes de pesquisar o gênero', 'error');
      return;
    }
    searchGenreBtn.disabled = true;
    searchGenreBtn.textContent = 'Pesquisando gênero…';
    genreSearchResults.textContent = 'Consultando fontes musicais…';
    try {
      const result = await window.searchStyleOnline(title, artist, '');
      onlineStyleSource = result.source;
      const genres = [...new Set((result.genres || []).filter(Boolean))];
      if (!genres.length) {
        genreSearchResults.innerHTML = `<span style="font-size:11px; color:rgba(255,255,255,.65);">Nenhum gênero encontrado. <a href="${result.searchUrl}" target="_blank" rel="noopener">Abrir pesquisa no Google</a></span>`;
        return;
      }
      genreSearchResults.innerHTML = `<div style="font-size:11px; color:rgba(255,255,255,.7); margin-bottom:6px;">Gênero encontrado${result.source ? ` (${escapeHtml(result.source)})` : ''} para ${escapeHtml(result.match?.title || title)} · ${escapeHtml(result.match?.artist || artist)}:</div><div style="display:flex; gap:6px; flex-wrap:wrap;">${genres.map(genreName => `<button type="button" class="btn-icon genre-suggestion" data-genre="${escapeHtml(genreName)}">${escapeHtml(genreName)}</button>`).join('')}<a class="btn-icon" href="${result.searchUrl}" target="_blank" rel="noopener">Abrir pesquisa</a></div>`;
      genreSearchResults.querySelectorAll('.genre-suggestion').forEach(button => button.addEventListener('click', () => {
        const input = document.getElementById('musicGenre');
        input.value = button.dataset.genre;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        showToast('Gênero aplicado ao formulário', 'success');
      }));
    } catch (error) {
      genreSearchResults.innerHTML = `<span style="font-size:11px; color:rgba(255,255,255,.65);">Pesquisa indisponível. <a href="https://www.google.com/search?q=${encodeURIComponent(`${title} ${artist} gênero musical`)}" target="_blank" rel="noopener">Abrir no Google</a></span>`;
    } finally {
      searchGenreBtn.disabled = false;
      searchGenreBtn.textContent = 'Pesquisar gênero';
    }
  });

  searchStyleBtn.addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    const genre = document.getElementById('musicGenre').value || data.genre || '';
    if (!title || !artist) {
      showToast('Preencha título e artista antes de pesquisar', 'error');
      return;
    }
    searchStyleBtn.disabled = true;
    searchStyleBtn.textContent = 'Buscando…';
    styleSearchResults.textContent = 'Consultando fontes musicais…';
    try {
      const result = await window.searchStyleOnline(title, artist, genre);
      onlineStyleSource = result.source;
      if (!result.genres.length && !result.match) {
        styleSearchResults.innerHTML = `<span style="font-size:11px; color:rgba(255,255,255,.65);">Nenhum gênero encontrado. Você pode pesquisar manualmente no Google.</span>`;
        return;
      }
      const tags = result.genres.length ? result.genres : [result.match?.genre].filter(Boolean);
      styleSearchResults.innerHTML = `<div style="font-size:11px; color:rgba(255,255,255,.7); margin-bottom:6px;">Resultado online${result.source ? ` (${escapeHtml(result.source)})` : ''}: ${escapeHtml(result.match?.title || title)} · ${escapeHtml(result.match?.artist || artist)}</div><div style="display:flex; gap:6px; flex-wrap:wrap;">${tags.map(tag => `<button type="button" class="btn-icon style-suggestion" data-style="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}<a class="btn-icon" href="${result.searchUrl}" target="_blank" rel="noopener">Abrir pesquisa</a></div>`;
      styleSearchResults.querySelectorAll('.style-suggestion').forEach(button => button.addEventListener('click', () => {
        const input = document.getElementById('musicStyle');
        input.value = button.dataset.style;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        showToast('Estilo aplicado ao formulário', 'success');
      }));
    } catch (error) {
      styleSearchResults.innerHTML = `<span style="font-size:11px; color:rgba(255,255,255,.65);">Pesquisa indisponível. <a href="https://www.google.com/search?q=${encodeURIComponent(`${title} ${artist} gênero estilo música`)}" target="_blank" rel="noopener">Abrir no Google</a></span>`;
    } finally {
      searchStyleBtn.disabled = false;
      searchStyleBtn.textContent = 'Buscar sugestões';
    }
  });

  function applyEditAnalysis(analysis) {
    editAnalysis = analysis;
    const styleTags = analysis.styleTags || [];
    document.getElementById('musicStyle').value = analysis.style || styleTags[0] || '';
    document.getElementById('musicRhythmProfile').value = analysis.rhythmProfile || '';
    document.getElementById('musicTempoBpm').value = analysis.bpm || '';
    document.getElementById('musicEnergy').value = analysis.energy ?? '';
    document.getElementById('musicDanceability').value = analysis.danceability ?? '';
    const evidence = analysis.contextEvidence?.length ? ` · pistas: ${escapeHtml(analysis.contextEvidence.join(' · '))}` : '';
    analysisStatus.innerHTML = `<strong>Análise concluída:</strong> ${analysis.bpm ? `${analysis.bpm} BPM` : 'BPM não detectado'} · energia ${Math.round((analysis.energy || 0) * 100)}% · ritmo ${escapeHtml(analysis.rhythmProfile || 'indefinido')} · confiança ${Math.round((analysis.confidence || 0) * 100)}%<br><small>Estilos sugeridos: ${escapeHtml(styleTags.join(', ') || 'nenhum')}${evidence}</small>`;
  }

  async function runEditAnalysis(file) {
    if (!file || !window.FendaMusicAnalyzer?.analyzeAudioFile) return;
    analyzeBtn.disabled = true;
    chooseAudioBtn.disabled = true;
    analysisStatus.textContent = 'Analisando BPM, energia, ritmo e estilo…';
    try {
      const analysis = await window.FendaMusicAnalyzer.analyzeAudioFile(file, {
        title: document.getElementById('musicTitle').value.trim(),
        artist: document.getElementById('musicArtist').value.trim(),
        genre: document.getElementById('musicGenre').value || data.genre || '',
        useOpenModel: true,
        onModelProgress: progress => {
          if (progress?.progress != null) analysisStatus.textContent = `Carregando IA aberta: ${Math.round(progress.progress)}%…`;
        },
      });
      applyEditAnalysis(analysis);
      showToast('Análise concluída!', 'success');
    } catch (error) {
      analysisStatus.textContent = `Não foi possível analisar este áudio: ${error.message || 'formato não suportado'}`;
      showToast('Não foi possível analisar o áudio', 'error');
    } finally {
      analyzeBtn.disabled = false;
      chooseAudioBtn.disabled = false;
    }
  }

  analyzeBtn.addEventListener('click', async () => {
    if (!data.src) {
      showToast('Esta música não possui um áudio salvo. Use Escolher áudio.', 'error');
      return;
    }
    analyzeBtn.disabled = true;
    chooseAudioBtn.disabled = true;
    analysisStatus.textContent = 'Carregando o áudio salvo…';
    try {
      const response = await fetch(data.src, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], `${data.title || 'musica'}.audio`, { type: blob.type || 'audio/mpeg' });
      await runEditAnalysis(file);
    } catch (error) {
      analyzeBtn.disabled = false;
      chooseAudioBtn.disabled = false;
      analysisStatus.textContent = 'O áudio salvo não permitiu leitura automática. Escolha o arquivo original no botão ao lado.';
      showToast('Não foi possível ler o áudio salvo. Use Escolher áudio.', 'error');
    }
  });

  chooseAudioBtn.addEventListener('click', () => audioInput.click());
  audioInput.addEventListener('change', () => {
    const file = audioInput.files?.[0];
    if (file) runEditAnalysis(file);
    audioInput.value = '';
  });

  document.getElementById('autoFetchCoverEditBtn').addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    if (!title || !artist) { showToast("Preencha título e artista", "error"); return; }
    showToast("Buscando capa...");
    const coverUrl = await fetchCoverFromDeezer(artist, title);
    if (coverUrl) {
      document.getElementById('musicCoverUrl').value = coverUrl;
      showToast("Capa encontrada!", "success");
    } else {
      showToast("Nenhuma capa encontrada.", "error");
    }
  });

  document.getElementById('autoFetchLyricsEditBtn').addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    if (!title || !artist) { showToast("Preencha título e artista", "error"); return; }
    showToast("Buscando letra...");
    const lyrics = await fetchSyncedLyricsFromLRCLIB(artist, title);
    if (lyrics) {
      const blob = new Blob([lyrics], { type: 'text/plain' });
      const file = new File([blob], `${title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.lrc`, { type: 'text/plain' });
      const lrcUrl = await window.uploadFileToSupabase(file, 'lyrics');
      if (lrcUrl) {
        document.getElementById('musicLrc').value = lrcUrl;
        showToast("Letra encontrada!", "success");
      } else {
        showToast("Falha ao enviar letra", "error");
      }
    } else {
      showToast("Nenhuma letra encontrada.", "error");
    }
  });

  setupModalSave(async () => {
    try {
      const title = document.getElementById('musicTitle').value.trim();
      const artist = document.getElementById('musicArtist').value.trim();
      const coverUrl = document.getElementById('musicCoverUrl').value.trim();
      const genre = document.getElementById('musicGenre').value || null;
      const style = document.getElementById('musicStyle')?.value.trim() || null;
      const rhythm_profile = document.getElementById('musicRhythmProfile')?.value.trim() || null;
      const tempo_bpm = Number(document.getElementById('musicTempoBpm')?.value) || null;
      const energy_score = Number(document.getElementById('musicEnergy')?.value) || null;
      const danceability_score = Number(document.getElementById('musicDanceability')?.value) || null;
      const style_tags = [...new Set([
        ...(style ? style.split(',').map(s => s.trim()).filter(Boolean) : []),
        ...(editAnalysis?.styleTags || []),
      ])];

      if (!title || !artist) {
        showToast("Título e artista são obrigatórios", "error");
        return;
      }

      const lrc = document.getElementById('musicLrc')?.value.trim() || null;
      const updates = { title, artist, cover: coverUrl, genre, style, style_tags, rhythm_profile, tempo_bpm, energy_score, danceability_score, lrc };
      if (editAnalysis) {
        updates.analysis_confidence = editAnalysis.confidence ?? null;
        updates.analysis_source = onlineStyleSource ? `${editAnalysis.source || 'browser-acoustic-v1'}+${onlineStyleSource}` : (editAnalysis.source || 'browser-acoustic-v1');
        updates.analysis_version = editAnalysis.version || '1.0.0';
        updates.analyzed_at = editAnalysis.analyzedAt || new Date().toISOString();
      } else if (onlineStyleSource) {
        updates.analysis_source = onlineStyleSource;
        updates.analysis_version = 'metadata-search-v1';
        updates.analyzed_at = new Date().toISOString();
      }
      const { error } = await supabaseClient
        .from('musics')
        .update(updates)
        .eq('id', data.id);

      if (error) showToast("Erro ao atualizar", "error");
      else { showToast("Música atualizada!"); loadMusics(); modal.classList.remove('active'); }
    } catch (e) {
      showToast("Erro: " + e.message, "error");
    }
  });
}

async function deleteMusic(musicId, title) {
  if (!confirm(`Excluir música "${title}"?`)) return;
  const { error } = await supabaseClient.from('musics').delete().eq('id', musicId);
  if (error) showToast("Erro ao excluir", "error");
  else { showToast("Música excluída!"); loadMusics(); }
}

// ========== CRUD ARTISTAS ==========
async function loadArtists() {
  const { data, error } = await supabaseClient
    .from('artists')
    .select('*')
    .order('name', { ascending: true })
    .limit(1000);
  if (error) { console.error(error); return; }
  const container = document.getElementById('artistsList');
  container.innerHTML = '';
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><span>🎤</span><h3>Nenhum artista cadastrado</h3><p>Artistas são criados automaticamente ao adicionar músicas.</p></div>';
    return;
  }
  for (const artist of data) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(artist.name)}</h3>
      ${artist.avatar ? `<img src="${escapeAttr(artist.avatar)}" alt="Avatar">` : ''}
      <p><strong>Bio:</strong> ${escapeHtml(artist.bio || '—')}</p>
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="btn-icon edit-artist" data-id="${escapeAttr(artist.id)}" data-name="${escapeAttr(artist.name)}" data-bio="${escapeAttr(artist.bio || '')}" data-avatar="${escapeAttr(artist.avatar || '')}">
          <span class="material-symbols-rounded">edit</span> Editar
        </button>
        <button class="btn-icon danger delete-artist" data-id="${escapeAttr(artist.id)}" data-name="${escapeAttr(artist.name)}">
          <span class="material-symbols-rounded">delete</span> Excluir
        </button>
      </div>
    `;
    container.appendChild(card);
  }
  document.querySelectorAll('.edit-artist').forEach(btn => {
    btn.addEventListener('click', () => openEditArtistModal(btn.dataset));
  });
  document.querySelectorAll('.delete-artist').forEach(btn => {
    btn.addEventListener('click', () => deleteArtist(btn.dataset.id, btn.dataset.name));
  });
}

function openNewArtistModal() {
  document.getElementById('modalTitle').innerText = "Novo artista";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Nome *</label><input type="text" id="artistName"></div>
    <div class="form-group"><label>Bio</label><textarea id="artistBio"></textarea></div>
    <div class="form-group"><label>Avatar (URL)</label><input type="text" id="artistAvatar" placeholder="https://..."></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const name = document.getElementById('artistName').value.trim();
    const bio = document.getElementById('artistBio').value.trim();
    const avatar = document.getElementById('artistAvatar').value.trim();
    if (!name) { showToast("Nome é obrigatório", "error"); return; }
    const { data: artistData, error } = await supabaseClient.from('artists').insert([{ name, bio: bio || null, avatar: avatar || null }]).select();
    if (error) showToast("Erro ao criar artista", "error");
    else { 
      showToast("Artista criado!"); 
      loadArtists(); 
      modal.classList.remove('active');
      // Enviar notificação automática
      if (artistData && artistData[0]) {
        if (typeof sendNewArtistNotification === 'function') {
          sendNewArtistNotification(name, artistData[0].id).catch(e => console.warn('Erro ao enviar notificação automática:', e));
        }
      }
    }
  });
}

function openEditArtistModal(data) {
  document.getElementById('modalTitle').innerText = "Editar artista";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Nome</label><input type="text" id="artistName" value="${escapeAttr(data.name || '')}"></div>
    <div class="form-group"><label>Bio</label><textarea id="artistBio">${escapeHtml(data.bio || '')}</textarea></div>
    <div class="form-group"><label>Avatar (URL)</label><input type="text" id="artistAvatar" value="${escapeAttr(data.avatar || '')}"></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const name = document.getElementById('artistName').value.trim();
    const bio = document.getElementById('artistBio').value.trim();
    const avatar = document.getElementById('artistAvatar').value.trim();
    if (!name) { showToast("Nome é obrigatório", "error"); return; }
    const { error } = await supabaseClient.from('artists').update({ name, bio: bio || null, avatar: avatar || null }).eq('id', data.id);
    if (error) showToast("Erro ao atualizar", "error");
    else { showToast("Artista atualizado!"); loadArtists(); modal.classList.remove('active'); }
  });
}

async function deleteArtist(artistId, name) {
  if (!confirm(`Excluir artista "${name}"?`)) return;
  const { error } = await supabaseClient.from('artists').delete().eq('id', artistId);
  if (error) showToast("Erro ao excluir", "error");
  else { showToast("Artista excluído!"); loadArtists(); }
}

// ========== CRUD PODCASTS ==========
const PODCAST_MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const PODCAST_AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'opus', 'flac'];

function validatePodcastAudio(file) {
  if (!file) return 'Selecione um arquivo de áudio.';
  const ext = file.name.split('.').pop().toLowerCase();
  if (!(file.type || '').startsWith('audio/') && !PODCAST_AUDIO_EXTENSIONS.includes(ext)) {
    return 'O arquivo precisa ser um áudio (MP3, M4A, WAV, OGG, AAC, OPUS ou FLAC).';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return 'O arquivo de áudio está vazio. Selecione um arquivo válido.';
  if (file.size > PODCAST_MAX_AUDIO_BYTES) return 'O áudio não pode ultrapassar 500 MB.';
  return null;
}

async function uploadPodcastAsset(file, folder) {
  if (!file) return null;
  const validation = folder.startsWith('podcasts/audio') ? validatePodcastAudio(file) : null;
  if (validation) { showToast(validation, 'error'); return null; }
  try {
    const uploader = typeof window.uploadFileToSupabase === 'function'
      ? window.uploadFileToSupabase
      : uploadFileToSupabase;
    return await uploader(file, folder);
  } catch (error) {
    console.error('uploadPodcastAsset:', error);
    return null;
  }
}

function storagePathFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = '/storage/v1/object/public/music-files/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  try { return decodeURIComponent(url.slice(index + marker.length)); }
  catch (_) { return url.slice(index + marker.length); }
}

async function removeUploadedPodcastAssets(urls) {
  const paths = [...new Set((urls || []).map(storagePathFromPublicUrl).filter(Boolean))];
  if (!paths.length) return;
  const { error } = await supabaseClient.storage.from('music-files').remove(paths);
  if (error) console.warn('removeUploadedPodcastAssets:', error);
}

function podcastErrorMessage(error, fallback = 'Não foi possível concluir o salvamento.') {
  const message = error?.message || error?.error_description || '';
  if (/row[- ]level security|permission|not authorized|unauthorized/i.test(message)) {
    return 'Sem permissão para salvar este podcast. Verifique a sessão de administrador.';
  }
  if (/duplicate|already exists/i.test(message)) return 'Este arquivo já foi enviado. Escolha o arquivo novamente.';
  return message ? `Erro: ${message}` : fallback;
}

async function loadPodcasts() {
  const { data, error } = await supabaseClient.from('podcasts').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('loadPodcasts:', error);
    const container = document.getElementById('podcastsList');
    if (container) container.innerHTML = '<div class="empty-state"><span class="material-symbols-rounded">podcasts</span><p>Não foi possível carregar os podcasts.</p></div>';
    return;
  }
  const container = document.getElementById('podcastsList');
  container.innerHTML = '';
  for (const pod of data) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(pod.title)}</h3>
      ${pod.cover_url ? `<img src="${escapeAttr(pod.cover_url)}" alt="Capa">` : ''}
      <p>${escapeHtml(pod.description || '')}</p>
      ${pod.audio_url ? `<audio controls preload="none" src="${escapeAttr(pod.audio_url)}" style="width:100%; margin:10px 0 12px;"></audio>` : ''}
      <small style="display:block;color:var(--text-faint);margin-bottom:10px;">Publicado em ${pod.created_at ? new Date(pod.created_at).toLocaleDateString('pt-BR') : '—'}</small>
      <div style="display: flex; gap: 8px; flex-wrap:wrap;">
        <button class="btn-icon edit-podcast" data-id="${escapeAttr(pod.id)}" data-title="${escapeAttr(pod.title)}" data-desc="${escapeAttr(pod.description || '')}" data-cover="${escapeAttr(pod.cover_url || '')}" data-audio="${escapeAttr(pod.audio_url || '')}">
          <span class="material-symbols-rounded">edit</span> Editar
        </button>
        <button class="btn-icon danger delete-podcast" data-id="${escapeAttr(pod.id)}" data-title="${escapeAttr(pod.title)}">
          <span class="material-symbols-rounded">delete</span> Excluir
        </button>
      </div>
    `;
    container.appendChild(card);
  }
  document.querySelectorAll('.edit-podcast').forEach(btn => btn.addEventListener('click', () => openEditPodcastModal(btn.dataset)));
  document.querySelectorAll('.delete-podcast').forEach(btn => btn.addEventListener('click', () => deletePodcast(btn.dataset.id, btn.dataset.title)));
}

function openNewPodcastModal() {
  document.getElementById('modalTitle').innerText = "Novo podcast";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título *</label><input type="text" id="podcastTitle"></div>
    <div class="form-group"><label>Descrição</label><textarea id="podcastDesc" placeholder="Sobre este episódio..."></textarea></div>
    <div class="form-group"><label>Capa (URL opcional)</label><input type="url" id="podcastCover" placeholder="https://..."></div>
    <div class="form-group"><label>Enviar capa (opcional)</label><input type="file" id="podcastCoverFile" accept="image/*"></div>
    <div class="form-group"><label>Arquivo de áudio *</label><input type="file" id="podcastAudio" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.opus,.flac"></div>
    <p style="font-size:11px;color:var(--text-faint);">O áudio será publicado no catálogo e poderá ser reproduzido na Biblioteca.</p>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const uploadedUrls = [];
    try {
      const title = document.getElementById('podcastTitle').value.trim();
      const desc = document.getElementById('podcastDesc').value.trim();
      const audioFile = document.getElementById('podcastAudio').files[0];
      const coverFile = document.getElementById('podcastCoverFile').files[0];
      let coverUrl = document.getElementById('podcastCover').value.trim();
      if (!title || !audioFile) { showToast('Preencha título e arquivo de áudio', 'error'); return; }
      const validation = validatePodcastAudio(audioFile);
      if (validation) { showToast(validation, 'error'); return; }

      const audioUrl = await uploadPodcastAsset(audioFile, `podcasts/audio/${Date.now()}`);
      if (!audioUrl) throw new Error('Falha no upload do áudio. Tente novamente.');
      uploadedUrls.push(audioUrl);

      if (coverFile) {
        coverUrl = await uploadPodcastAsset(coverFile, `podcasts/covers/${Date.now()}`);
        if (!coverUrl) throw new Error('Falha no upload da capa.');
        uploadedUrls.push(coverUrl);
      }

      const { error } = await supabaseClient.from('podcasts').insert([{
        title,
        description: desc || null,
        audio_url: audioUrl,
        cover_url: coverUrl || null,
      }]);
      if (error) throw error;

      showToast('Podcast adicionado!');
      loadPodcasts();
      modal.classList.remove('active');
    } catch (error) {
      console.error('savePodcast:', error);
      await removeUploadedPodcastAssets(uploadedUrls);
      showToast(podcastErrorMessage(error, 'Não foi possível salvar o podcast.'), 'error');
    }
  });
}

function openEditPodcastModal(data) {
  document.getElementById('modalTitle').innerText = "Editar podcast";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título</label><input type="text" id="podcastTitle" value="${escapeAttr(data.title || '')}"></div>
    <div class="form-group"><label>Descrição</label><textarea id="podcastDesc">${escapeHtml(data.desc || '')}</textarea></div>
    <div class="form-group"><label>Capa (URL opcional)</label><input type="url" id="podcastCover" value="${escapeAttr(data.cover || '')}" placeholder="https://..."></div>
    <div class="form-group"><label>Nova capa (opcional)</label><input type="file" id="podcastCoverFile" accept="image/*"></div>
    <div class="form-group"><label>Novo áudio (opcional)</label><input type="file" id="podcastAudio" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.opus,.flac"></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const uploadedUrls = [];
    try {
      const title = document.getElementById('podcastTitle').value.trim();
      const desc = document.getElementById('podcastDesc').value.trim();
      const audioFile = document.getElementById('podcastAudio').files[0];
      const coverFile = document.getElementById('podcastCoverFile').files[0];
      let coverUrl = document.getElementById('podcastCover').value.trim();
      let audioUrl = data.audio;
      if (!title) { showToast('Título é obrigatório', 'error'); return; }
      if (audioFile) {
        const validation = validatePodcastAudio(audioFile);
        if (validation) { showToast(validation, 'error'); return; }
        audioUrl = await uploadPodcastAsset(audioFile, `podcasts/audio/${Date.now()}`);
        if (!audioUrl) throw new Error('Falha no upload do áudio. Tente novamente.');
        uploadedUrls.push(audioUrl);
      }
      if (coverFile) {
        coverUrl = await uploadPodcastAsset(coverFile, `podcasts/covers/${Date.now()}`);
        if (!coverUrl) throw new Error('Falha no upload da capa.');
        uploadedUrls.push(coverUrl);
      }

      const { error } = await supabaseClient.from('podcasts').update({
        title,
        description: desc || null,
        audio_url: audioUrl,
        cover_url: coverUrl || null,
      }).eq('id', data.id);
      if (error) throw error;

      showToast('Podcast atualizado!');
      loadPodcasts();
      modal.classList.remove('active');
    } catch (error) {
      console.error('updatePodcast:', error);
      await removeUploadedPodcastAssets(uploadedUrls);
      showToast(podcastErrorMessage(error, 'Não foi possível atualizar o podcast.'), 'error');
    }
  });
}

async function deletePodcast(id, title) {
  if (!confirm(`Excluir podcast "${title}"?`)) return;
  const { error } = await supabaseClient.from('podcasts').delete().eq('id', parseInt(id));
  if (error) showToast("Erro ao excluir", "error");
  else { showToast("Podcast excluído!"); loadPodcasts(); }
}

// ========== HELPERS ==========
function setupModalSave(onSave) {
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const cancelBtn = document.getElementById('modalCancelBtn');
  const oldConfirm = confirmBtn.cloneNode(true);
  const oldCancel = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(oldConfirm, confirmBtn);
  cancelBtn.parentNode.replaceChild(oldCancel, cancelBtn);
  oldCancel.addEventListener('click', () => document.getElementById('genericModal').classList.remove('active'));

  let saving = false;
  const originalLabel = oldConfirm.innerHTML;
  oldConfirm.addEventListener('click', async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    oldConfirm.disabled = true;
    oldConfirm.setAttribute('aria-busy', 'true');
    oldConfirm.innerHTML = '<span class="material-symbols-rounded">progress_activity</span> Salvando...';
    try {
      await onSave();
    } catch (error) {
      console.error('modalSave:', error);
      showToast(podcastErrorMessage(error, 'Não foi possível concluir a operação.'), 'error');
    } finally {
      saving = false;
      oldConfirm.disabled = false;
      oldConfirm.removeAttribute('aria-busy');
      oldConfirm.innerHTML = originalLabel;
    }
  });
}

// ========== INICIALIZAÇÃO ==========
async function initAdmin() {
  const isAdmin = await checkAdminAndRedirect();
  if (!isAdmin) return;

  await Promise.all([
    loadUsers(),
    loadMusics(),
    loadArtists(),
    loadPodcasts(),
    // A versão anterior nunca carregava mensagens no boot —
    // a aba começava vazia até você enviar algo
    (typeof loadMessages === 'function' ? loadMessages() : Promise.resolve()),
    (typeof loadSubmissions === 'function' ? loadSubmissions() : Promise.resolve()),
    (typeof loadMusicRequests === 'function' ? loadMusicRequests() : Promise.resolve()),
    loadPrivacyData(),
  ]);

  const tabs = document.querySelectorAll('.admin-tab');
  const panes = document.querySelectorAll('.tab-pane');
  
  if (tabs.length === 0 || panes.length === 0) {
    console.error('Abas ou painéis não encontrados no DOM');
    return;
  }

  const TAB_TITLES = {
    overview: 'Visão geral', users: 'Usuários', privacy: 'Privacidade', musics: 'Músicas', artists: 'Artistas',
    submissions: 'Submissões', requests: 'Solicitações', messages: 'Notificações', podcasts: 'Podcasts',
  };
  function switchTab(tabId) {
    panes.forEach(pane => pane.classList.remove('active'));
    const targetPane = document.getElementById(tabId + 'Tab');
    if (targetPane) targetPane.classList.add('active');
    tabs.forEach(tab => {
      if (tab.dataset.tab === tabId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    const titleEl = document.getElementById('adminSectionTitle');
    if (titleEl) titleEl.textContent = TAB_TITLES[tabId] || 'Painel';
    window.scrollTo({ top: 0 });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = tab.dataset.tab;
      if (tabId) switchTab(tabId);
    });
  });

  const requestedTab = String(location.hash || '').replace(/^#/, '');
  const initialTab = TAB_TITLES[requestedTab] && document.querySelector(`.admin-tab[data-tab="${CSS.escape(requestedTab)}"]`)
    ? requestedTab
    : tabs[0]?.dataset.tab;
  if (initialTab) switchTab(initialTab);

  const newMusicBtn = document.getElementById('newMusicBtn');
  const newArtistBtn = document.getElementById('newArtistBtn');
  const newPodcastBtn = document.getElementById('newPodcastBtn');
  const newMessageBtn = document.getElementById('newMessageBtn');
  
  if (newMusicBtn) newMusicBtn.addEventListener('click', openNewMusicModal);
  if (newArtistBtn) newArtistBtn.addEventListener('click', openNewArtistModal);
  if (newPodcastBtn) newPodcastBtn.addEventListener('click', openNewPodcastModal);
  if (newMessageBtn) newMessageBtn.addEventListener('click', openNewMessageModal);

  const refreshPrivacyBtn = document.getElementById('refreshPrivacyBtn');
  if (refreshPrivacyBtn) refreshPrivacyBtn.addEventListener('click', () => loadPrivacyData());
  const privacySearchInput = document.getElementById('privacySearchInput');
  if (privacySearchInput) privacySearchInput.addEventListener('input', renderPrivacyRows);
  
  const logoutBtn = document.getElementById('adminLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      window.location.href = 'index.html';
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
