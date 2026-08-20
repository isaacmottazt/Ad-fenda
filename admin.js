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
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
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
        <button class="btn-icon danger delete-user" data-id="${user.id}" data-name="${escapeHtml(user.full_name || 'Usuário')}">
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

async function deleteUser(userId, userName) {
  if (!confirm(`Excluir permanentemente o usuário "${userName}"? Esta ação não pode ser desfeita.`)) return;
  const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
  if (error) showToast("Erro ao excluir usuário", "error");
  else { showToast("Usuário excluído!"); loadUsers(); }
}

// ========== CRUD MÚSICAS ==========
async function loadMusics() {
  const musics = await window.loadMusicsFromSupabase();
  const container = document.getElementById('musicsList');
  container.innerHTML = '';
  for (const music of musics) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(music.title)}</h3>
      <p><strong>Artista:</strong> ${escapeHtml(music.artist)}</p>
      ${music.cover ? `<img src="${music.cover}" alt="Capa">` : ''}
      <p><strong>Gênero:</strong> ${music.genre || '—'}</p>
      <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
        <button class="btn-icon edit-music" data-id="${music.id}" data-title="${escapeHtml(music.title)}" data-artist="${escapeHtml(music.artist)}" data-cover="${music.cover || ''}" data-src="${music.src}" data-lrc="${music.lrc || ''}" data-genre="${music.genre || ''}">
          <span class="material-symbols-rounded">edit</span> Editar
        </button>
        <button class="btn-icon danger delete-music" data-id="${music.id}" data-title="${escapeHtml(music.title)}">
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
}

function openEditMusicModal(data) {
  document.getElementById('modalTitle').innerText = "Editar música";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título</label><input type="text" id="musicTitle" value="${data.title}"></div>
    <div class="form-group"><label>Artista</label><input type="text" id="musicArtist" value="${data.artist}"></div>
    <div style="display: flex; gap: 10px; margin-bottom: 16px;">
      <button type="button" id="autoFetchCoverEditBtn" class="btn-primary" style="flex:1;">🎨 Buscar capa</button>
      <button type="button" id="autoFetchLyricsEditBtn" class="btn-primary" style="flex:1;">📝 Buscar letra</button>
    </div>
    <div class="form-group"><label>URL da capa</label><input type="text" id="musicCoverUrl" value="${data.cover || ''}"></div>
    <div class="form-group"><label>Letra sincronizada (.lrc)</label><input type="text" id="musicLrc" value="${data.lrc || ''}" placeholder="URL do arquivo .lrc"></div>
    <div class="form-group"><label>Gênero</label>
      <select id="musicGenre">
        <option value="">Selecione um gênero</option>
        <option value="Gospel" ${data.genre === 'Gospel' ? 'selected' : ''}>Gospel</option>
        <option value="Adoração" ${data.genre === 'Adoração' ? 'selected' : ''}>Adoração</option>
        <option value="MPB" ${data.genre === 'MPB' ? 'selected' : ''}>MPB</option>
        <option value="Rock" ${data.genre === 'Rock' ? 'selected' : ''}>Rock</option>
        <option value="Pop" ${data.genre === 'Pop' ? 'selected' : ''}>Pop</option>
      </select>
    </div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');

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

      if (!title || !artist) {
        showToast("Título e artista são obrigatórios", "error");
        return;
      }

      const lrc = document.getElementById('musicLrc')?.value.trim() || null;
      const { error } = await supabaseClient
        .from('musics')
        .update({ title, artist, cover: coverUrl, genre, lrc })
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
      ${artist.avatar ? `<img src="${artist.avatar}" alt="Avatar">` : ''}
      <p><strong>Bio:</strong> ${escapeHtml(artist.bio || '—')}</p>
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="btn-icon edit-artist" data-id="${artist.id}" data-name="${escapeHtml(artist.name)}" data-bio="${escapeHtml(artist.bio || '')}" data-avatar="${artist.avatar || ''}">
          <span class="material-symbols-rounded">edit</span> Editar
        </button>
        <button class="btn-icon danger delete-artist" data-id="${artist.id}" data-name="${escapeHtml(artist.name)}">
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
    <div class="form-group"><label>Nome</label><input type="text" id="artistName" value="${data.name}"></div>
    <div class="form-group"><label>Bio</label><textarea id="artistBio">${data.bio}</textarea></div>
    <div class="form-group"><label>Avatar (URL)</label><input type="text" id="artistAvatar" value="${data.avatar}"></div>
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
  if (file.size > PODCAST_MAX_AUDIO_BYTES) return 'O áudio não pode ultrapassar 500 MB.';
  return null;
}

async function uploadPodcastAsset(file, folder) {
  if (!file) return null;
  const validation = folder.startsWith('podcasts/audio') ? validatePodcastAudio(file) : null;
  if (validation) { showToast(validation, 'error'); return null; }
  return typeof window.uploadFileToSupabase === 'function'
    ? window.uploadFileToSupabase(file, folder)
    : await uploadFileToSupabase(file, folder);
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
      ${pod.cover_url ? `<img src="${escapeHtml(pod.cover_url)}" alt="Capa">` : ''}
      <p>${escapeHtml(pod.description || '')}</p>
      ${pod.audio_url ? `<audio controls preload="none" src="${escapeHtml(pod.audio_url)}" style="width:100%; margin:10px 0 12px;"></audio>` : ''}
      <small style="display:block;color:var(--text-faint);margin-bottom:10px;">Publicado em ${pod.created_at ? new Date(pod.created_at).toLocaleDateString('pt-BR') : '—'}</small>
      <div style="display: flex; gap: 8px; flex-wrap:wrap;">
        <button class="btn-icon edit-podcast" data-id="${pod.id}" data-title="${escapeHtml(pod.title)}" data-desc="${escapeHtml(pod.description || '')}" data-cover="${pod.cover_url || ''}" data-audio="${pod.audio_url}">
          <span class="material-symbols-rounded">edit</span> Editar
        </button>
        <button class="btn-icon danger delete-podcast" data-id="${pod.id}" data-title="${escapeHtml(pod.title)}">
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
    const title = document.getElementById('podcastTitle').value.trim();
    const desc = document.getElementById('podcastDesc').value.trim();
    const audioFile = document.getElementById('podcastAudio').files[0];
    const coverFile = document.getElementById('podcastCoverFile').files[0];
    let coverUrl = document.getElementById('podcastCover').value.trim();
    if (!title || !audioFile) { showToast('Preencha título e arquivo de áudio', 'error'); return; }
    const audioUrl = await uploadPodcastAsset(audioFile, `podcasts/audio/${Date.now()}`);
    if (!audioUrl) { showToast('Falha no upload do áudio', 'error'); return; }
    if (coverFile) {
      coverUrl = await uploadPodcastAsset(coverFile, `podcasts/covers/${Date.now()}`);
      if (!coverUrl) { showToast('Falha no upload da capa', 'error'); return; }
    }
    const { error } = await supabaseClient.from('podcasts').insert([{ title, description: desc || null, audio_url: audioUrl, cover_url: coverUrl || null }]);
    if (error) showToast("Erro ao salvar podcast", "error");
    else { showToast("Podcast adicionado!"); loadPodcasts(); modal.classList.remove('active'); }
  });
}

function openEditPodcastModal(data) {
  document.getElementById('modalTitle').innerText = "Editar podcast";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título</label><input type="text" id="podcastTitle" value="${data.title}"></div>
    <div class="form-group"><label>Descrição</label><textarea id="podcastDesc">${data.desc}</textarea></div>
    <div class="form-group"><label>Capa (URL opcional)</label><input type="url" id="podcastCover" value="${data.cover}" placeholder="https://..."></div>
    <div class="form-group"><label>Nova capa (opcional)</label><input type="file" id="podcastCoverFile" accept="image/*"></div>
    <div class="form-group"><label>Novo áudio (opcional)</label><input type="file" id="podcastAudio" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.opus,.flac"></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const title = document.getElementById('podcastTitle').value.trim();
    const desc = document.getElementById('podcastDesc').value.trim();
    const audioFile = document.getElementById('podcastAudio').files[0];
    const coverFile = document.getElementById('podcastCoverFile').files[0];
    let coverUrl = document.getElementById('podcastCover').value.trim();
    let audioUrl = data.audio;
    if (audioFile) {
      audioUrl = await uploadPodcastAsset(audioFile, `podcasts/audio/${Date.now()}`);
      if (!audioUrl) { showToast('Falha no upload do áudio', 'error'); return; }
    }
    if (coverFile) {
      coverUrl = await uploadPodcastAsset(coverFile, `podcasts/covers/${Date.now()}`);
      if (!coverUrl) { showToast('Falha no upload da capa', 'error'); return; }
    }
    const { error } = await supabaseClient.from('podcasts').update({ title, description: desc || null, audio_url: audioUrl, cover_url: coverUrl || null }).eq('id', data.id);
    if (error) showToast("Erro ao atualizar", "error");
    else { showToast("Podcast atualizado!"); loadPodcasts(); modal.classList.remove('active'); }
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
  oldConfirm.addEventListener('click', onSave);
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
  ]);

  const tabs = document.querySelectorAll('.admin-tab');
  const panes = document.querySelectorAll('.tab-pane');
  
  if (tabs.length === 0 || panes.length === 0) {
    console.error('Abas ou painéis não encontrados no DOM');
    return;
  }

  const TAB_TITLES = {
    users: 'Usuários', musics: 'Músicas', artists: 'Artistas',
    messages: 'Mensagens', podcasts: 'Podcasts',
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

  if (tabs.length > 0 && tabs[0].dataset.tab) {
    switchTab(tabs[0].dataset.tab);
  }

  const newMusicBtn = document.getElementById('newMusicBtn');
  const newArtistBtn = document.getElementById('newArtistBtn');
  const newPodcastBtn = document.getElementById('newPodcastBtn');
  const newMessageBtn = document.getElementById('newMessageBtn');
  
  if (newMusicBtn) newMusicBtn.addEventListener('click', openNewMusicModal);
  if (newArtistBtn) newArtistBtn.addEventListener('click', openNewArtistModal);
  if (newPodcastBtn) newPodcastBtn.addEventListener('click', openNewPodcastModal);
  if (newMessageBtn) newMessageBtn.addEventListener('click', openNewMessageModal);
  
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
