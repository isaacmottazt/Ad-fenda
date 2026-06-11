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
  toast.className = 'toast';
  toast.innerHTML = `<span class="material-symbols-rounded">${type === 'success' ? 'check_circle' : 'error'}</span><span>${msg}</span>`;
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

// ========== BUSCA AUTOMÁTICA DE CAPA (Deezer + iTunes) ==========
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

// ========== BUSCA AUTOMÁTICA DE LETRA SINCRONIZADA (LRCLIB) ==========
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

// ========== CRUD USUÁRIOS ==========
async function loadUsers() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return showToast("Erro ao carregar usuários", "error");
  document.getElementById('usersCount').innerText = data.length;
  const container = document.getElementById('usersList');
  container.innerHTML = '';
  for (const user of data) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(user.full_name || 'Sem nome')} <span style="font-size:12px; background:${user.role === 'admin' ? '#924cff' : 'rgba(255,255,255,0.2)'}; padding:2px 8px; border-radius:20px;">${user.role || 'user'}</span></h3>
      <p><strong>E-mail:</strong> ${escapeHtml(user.email)}</p>
      <p><strong>Bio:</strong> ${escapeHtml(user.bio || '—')}</p>
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="btn-icon edit-user" data-id="${user.id}" data-name="${escapeHtml(user.full_name)}" data-email="${escapeHtml(user.email)}" data-bio="${escapeHtml(user.bio || '')}" data-role="${user.role}"><span class="material-symbols-rounded">edit</span> Editar</button>
        <button class="btn-icon danger delete-user" data-id="${user.id}" data-name="${escapeHtml(user.full_name)}"><span class="material-symbols-rounded">delete</span> Excluir</button>
      </div>
    `;
    container.appendChild(card);
  }
  document.querySelectorAll('.edit-user').forEach(btn => {
    btn.addEventListener('click', () => openEditUserModal(btn.dataset));
  });
  document.querySelectorAll('.delete-user').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.id, btn.dataset.name));
  });
}

function openEditUserModal(data) {
  document.getElementById('modalTitle').innerText = "Editar usuário";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Nome completo</label><input type="text" id="editUserName" value="${data.name}"></div>
    <div class="form-group"><label>E-mail</label><input type="email" id="editUserEmail" value="${data.email}"></div>
    <div class="form-group"><label>Bio</label><textarea id="editUserBio">${data.bio}</textarea></div>
    <div class="form-group"><label>Permissão</label><select id="editUserRole"><option value="user" ${data.role === 'user' ? 'selected' : ''}>Usuário comum</option><option value="admin" ${data.role === 'admin' ? 'selected' : ''}>Administrador</option></select></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const cancelBtn = document.getElementById('modalCancelBtn');
  const oldConfirm = confirmBtn.cloneNode(true);
  const oldCancel = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(oldConfirm, confirmBtn);
  cancelBtn.parentNode.replaceChild(oldCancel, cancelBtn);
  oldCancel.addEventListener('click', () => modal.classList.remove('active'));
  oldConfirm.addEventListener('click', async () => {
    const name = document.getElementById('editUserName').value.trim();
    const email = document.getElementById('editUserEmail').value.trim();
    const bio = document.getElementById('editUserBio').value.trim();
    const role = document.getElementById('editUserRole').value;
    if (!name || !email) { showToast("Nome e e-mail são obrigatórios", "error"); return; }
    const { error } = await supabaseClient
      .from('profiles')
      .update({ full_name: name, email: email, bio: bio, role: role })
      .eq('id', data.id);
    if (error) showToast("Erro ao atualizar: " + error.message, "error");
    else { showToast("Usuário atualizado!"); loadUsers(); modal.classList.remove('active'); }
  });
}

async function deleteUser(userId, userName) {
  if (!confirm(`Excluir permanentemente o usuário "${userName}"?`)) return;
  const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
  if (error) showToast("Erro ao excluir usuário", "error");
  else { showToast("Usuário excluído!"); loadUsers(); }
}

// ========== CRUD MÚSICAS (COM BUSCA AUTOMÁTICA E SELECT DE GÊNERO) ==========
async function loadMusics() {
  const musics = await window.loadMusicsFromSupabase();
  const container = document.getElementById('musicsList');
  container.innerHTML = '';
  for (const music of musics) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(music.title)} <span style="font-size:12px;">${escapeHtml(music.artist)}</span></h3>
      <img src="${music.cover || ''}" style="width:100%; max-height:150px; object-fit:cover; border-radius:12px; margin:8px 0;">
      <p><strong>Áudio:</strong> <a href="${music.src}" target="_blank" style="color:#c084fc;">ouvir</a></p>
      <p><strong>Gênero:</strong> ${music.genre || '—'}</p>
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="btn-icon edit-music" data-id="${music.id}" data-title="${escapeHtml(music.title)}" data-artist="${escapeHtml(music.artist)}" data-cover="${music.cover || ''}" data-src="${music.src}" data-lrc="${music.lrc || ''}" data-genre="${music.genre || ''}"><span class="material-symbols-rounded">edit</span> Editar</button>
        <button class="btn-icon danger delete-music" data-id="${music.id}" data-title="${escapeHtml(music.title)}"><span class="material-symbols-rounded">delete</span> Excluir</button>
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

// Modal de nova música (com select de gênero fixo)
function openNewMusicModal() {
  document.getElementById('modalTitle').innerText = "Nova música";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título *</label><input type="text" id="musicTitle" placeholder="Ex: Sinais de Fogo"></div>
    <div class="form-group"><label>Artista *</label><input type="text" id="musicArtist" placeholder="Ex: Preto no Branco"></div>
    <div style="display: flex; gap: 10px; margin-bottom: 16px;">
      <button type="button" id="autoFetchCoverBtn" class="btn-primary" style="flex:1;">🎨 Buscar capa</button>
      <button type="button" id="autoFetchLyricsBtn" class="btn-primary" style="flex:1;">📝 Buscar letra</button>
    </div>
    <div class="form-group"><label>Capa (URL ou arquivo)</label><input type="file" id="musicCoverFile" accept="image/*"></div>
    <div class="form-group"><label>URL da capa (se não usar arquivo)</label><input type="text" id="musicCoverUrl" placeholder="https://..."></div>
    <div class="form-group"><label>Arquivo de áudio *</label><input type="file" id="musicAudioFile" accept="audio/*"></div>
    <div class="form-group"><label>Letra (LRC) - URL ou arquivo .lrc</label><input type="text" id="musicLrc" placeholder="URL do arquivo .lrc"></div>
    <div class="form-group"><label>Arquivo .lrc (opcional)</label><input type="file" id="musicLrcFile" accept=".lrc"></div>
    <div class="form-group"><label>Gênero</label>
      <select id="musicGenre">
        <option value="">Selecione um gênero</option>
        <option value="MPB">MPB</option>
        <option value="Rock">Rock</option>
        <option value="Pop">Pop</option>
        <option value="Sertanejo">Sertanejo</option>
        <option value="Funk">Funk</option>
        <option value="Eletrônica">Eletrônica</option>
      </select>
    </div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');

  // Buscar capa automática
  document.getElementById('autoFetchCoverBtn').addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    if (!title || !artist) { showToast("Preencha título e artista primeiro", "error"); return; }
    showToast("Buscando capa...", "info");
    const coverUrl = await fetchCoverFromDeezer(artist, title);
    if (coverUrl) {
      document.getElementById('musicCoverUrl').value = coverUrl;
      showToast("Capa encontrada! URL preenchida.", "success");
    } else {
      showToast("Nenhuma capa encontrada. Tente novamente.", "error");
    }
  });

  // Buscar letra automática
  document.getElementById('autoFetchLyricsBtn').addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    if (!title || !artist) { showToast("Preencha título e artista primeiro", "error"); return; }
    showToast("Buscando letra sincronizada...", "info");
    const lyrics = await fetchSyncedLyricsFromLRCLIB(artist, title);
    if (lyrics) {
      const blob = new Blob([lyrics], { type: 'text/plain' });
      const file = new File([blob], `${title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.lrc`, { type: 'text/plain' });
      const lrcUrl = await window.uploadFileToSupabase(file, 'lyrics');
      if (lrcUrl) {
        document.getElementById('musicLrc').value = lrcUrl;
        showToast("Letra encontrada e enviada! URL preenchida.", "success");
      } else {
        showToast("Falha ao enviar letra", "error");
      }
    } else {
      showToast("Nenhuma letra encontrada no LRCLIB.", "error");
    }
  });

  setupModalSave(async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    const audioFile = document.getElementById('musicAudioFile').files[0];
    const coverFile = document.getElementById('musicCoverFile').files[0];
    const coverUrlInput = document.getElementById('musicCoverUrl').value.trim();
    const lrcText = document.getElementById('musicLrc').value.trim();
    const lrcFile = document.getElementById('musicLrcFile').files[0];
    const genre = document.getElementById('musicGenre').value || null;

    if (!title || !artist || !audioFile) { showToast("Preencha título, artista e arquivo de áudio", "error"); return; }

    let coverUrl = coverUrlInput || null;
    if (coverFile) coverUrl = await window.uploadFileToSupabase(coverFile, `covers/${Date.now()}`);
    
    let audioUrl = await window.uploadFileToSupabase(audioFile, `musics/${Date.now()}`);
    if (!audioUrl) { showToast("Falha no upload do áudio", "error"); return; }

    let finalLrc = lrcText;
    if (lrcFile) {
      const uploadedLrc = await window.uploadFileToSupabase(lrcFile, `lyrics/${Date.now()}`);
      if (uploadedLrc) finalLrc = uploadedLrc;
    }

    const newMusic = { id: Date.now(), title, artist, src: audioUrl, cover: coverUrl, lrc: finalLrc, genre };
    const saved = await window.saveMusicToSupabase(newMusic);
    if (saved) { showToast("Música adicionada!"); loadMusics(); modal.classList.remove('active'); }
    else showToast("Erro ao salvar", "error");
  });
}

// Modal de edição de música (com select de gênero fixo)
function openEditMusicModal(data) {
  document.getElementById('modalTitle').innerText = "Editar música";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título</label><input type="text" id="musicTitle" value="${data.title}"></div>
    <div class="form-group"><label>Artista</label><input type="text" id="musicArtist" value="${data.artist}"></div>
    <div style="display: flex; gap: 10px; margin-bottom: 16px;">
      <button type="button" id="autoFetchCoverEditBtn" class="btn-primary" style="flex:1;">🎨 Buscar capa</button>
      <button type="button" id="autoFetchLyricsEditBtn" class="btn-primary" style="flex:1;">📝 Buscar letra</button>
    </div>
    <div class="form-group"><label>Nova capa (opcional)</label><input type="file" id="musicCoverFile" accept="image/*"></div>
    <div class="form-group"><label>URL da capa (se não usar arquivo)</label><input type="text" id="musicCoverUrl" value="${data.cover || ''}"></div>
    <div class="form-group"><label>Novo áudio (opcional)</label><input type="file" id="musicAudioFile" accept="audio/*"></div>
    <div class="form-group"><label>Letra (URL)</label><input type="text" id="musicLrc" value="${data.lrc || ''}"></div>
    <div class="form-group"><label>Gênero</label>
      <select id="musicGenre">
        <option value="">Selecione um gênero</option>
        <option value="MPB" ${data.genre === 'MPB' ? 'selected' : ''}>MPB</option>
        <option value="Rock" ${data.genre === 'Rock' ? 'selected' : ''}>Rock</option>
        <option value="Pop" ${data.genre === 'Pop' ? 'selected' : ''}>Pop</option>
        <option value="Sertanejo" ${data.genre === 'Sertanejo' ? 'selected' : ''}>Sertanejo</option>
        <option value="Funk" ${data.genre === 'Funk' ? 'selected' : ''}>Funk</option>
        <option value="Eletrônica" ${data.genre === 'Eletrônica' ? 'selected' : ''}>Eletrônica</option>
      </select>
    </div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');

  // Buscar capa
  document.getElementById('autoFetchCoverEditBtn').addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    if (!title || !artist) { showToast("Preencha título e artista", "error"); return; }
    showToast("Buscando capa...", "info");
    const coverUrl = await fetchCoverFromDeezer(artist, title);
    if (coverUrl) {
      document.getElementById('musicCoverUrl').value = coverUrl;
      showToast("Capa encontrada! URL preenchida.", "success");
    } else {
      showToast("Nenhuma capa encontrada.", "error");
    }
  });

  // Buscar letra
  document.getElementById('autoFetchLyricsEditBtn').addEventListener('click', async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    if (!title || !artist) { showToast("Preencha título e artista", "error"); return; }
    showToast("Buscando letra...", "info");
    const lyrics = await fetchSyncedLyricsFromLRCLIB(artist, title);
    if (lyrics) {
      const blob = new Blob([lyrics], { type: 'text/plain' });
      const file = new File([blob], `${title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.lrc`, { type: 'text/plain' });
      const lrcUrl = await window.uploadFileToSupabase(file, 'lyrics');
      if (lrcUrl) {
        document.getElementById('musicLrc').value = lrcUrl;
        showToast("Letra encontrada e enviada!", "success");
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
      const audioFile = document.getElementById('musicAudioFile').files[0];
      const coverFile = document.getElementById('musicCoverFile').files[0];
      const coverUrl = document.getElementById('musicCoverUrl').value.trim();
      const lrc = document.getElementById('musicLrc').value.trim();
      const genre = document.getElementById('musicGenre').value || null;

      if (!title || !artist) {
        showToast("Título e artista são obrigatórios", "error");
        return;
      }

      let newCoverUrl = data.cover;
      if (coverFile) {
        const uploaded = await window.uploadFileToSupabase(coverFile, `covers/${Date.now()}`);
        if (!uploaded) throw new Error("Falha no upload da capa");
        newCoverUrl = uploaded;
      } else if (coverUrl && coverUrl !== data.cover) {
        newCoverUrl = coverUrl;
      }

      let newAudioUrl = data.src;
      if (audioFile) {
        const uploaded = await window.uploadFileToSupabase(audioFile, `musics/${Date.now()}`);
        if (!uploaded) throw new Error("Falha no upload do áudio");
        newAudioUrl = uploaded;
      }

      const updateData = {
        title,
        artist,
        src: newAudioUrl,
        cover: newCoverUrl,
        lrc: lrc || null,
        genre
      };

      const { error } = await supabaseClient
        .from('musics')
        .update(updateData)
        .eq('id', parseInt(data.id));

      if (error) throw error;

      showToast("Música atualizada com sucesso!");
      loadMusics();
      modal.classList.remove('active');
    } catch (err) {
      console.error("Erro ao editar música:", err);
      showToast(err.message || "Erro ao atualizar música", "error");
    }
  });
}

async function deleteMusic(musicId, title) {
  if (!confirm(`Excluir música "${title}"?`)) return;
  const ok = await window.deleteMusicFromSupabase(parseInt(musicId));
  if (ok) { showToast("Música excluída!"); loadMusics(); }
  else showToast("Erro ao excluir", "error");
}

// ========== CRUD ARTISTAS ==========
async function loadArtists() {
  const { data, error } = await supabaseClient.from('artists').select('*').order('name');
  if (error) { console.error(error); return; }
  const container = document.getElementById('artistsList');
  container.innerHTML = '';
  for (const artist of data) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(artist.name)}</h3>
      ${artist.image_url ? `<img src="${artist.image_url}" style="width:100%; max-height:150px; object-fit:cover; border-radius:12px; margin:8px 0;">` : ''}
      <p>${escapeHtml(artist.bio || 'Sem biografia')}</p>
      <div style="display: flex; gap: 8px;">
        <button class="btn-icon edit-artist" data-id="${artist.id}" data-name="${escapeHtml(artist.name)}" data-bio="${escapeHtml(artist.bio || '')}" data-image="${artist.image_url || ''}"><span class="material-symbols-rounded">edit</span> Editar</button>
        <button class="btn-icon danger delete-artist" data-id="${artist.id}" data-name="${escapeHtml(artist.name)}"><span class="material-symbols-rounded">delete</span> Excluir</button>
      </div>
    `;
    container.appendChild(card);
  }
  document.querySelectorAll('.edit-artist').forEach(btn => btn.addEventListener('click', () => openEditArtistModal(btn.dataset)));
  document.querySelectorAll('.delete-artist').forEach(btn => btn.addEventListener('click', () => deleteArtist(btn.dataset.id, btn.dataset.name)));
}

function openNewArtistModal() {
  document.getElementById('modalTitle').innerText = "Novo artista";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Nome *</label><input type="text" id="artistName"></div>
    <div class="form-group"><label>Biografia</label><textarea id="artistBio"></textarea></div>
    <div class="form-group"><label>Foto</label><input type="file" id="artistImage" accept="image/*"></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const name = document.getElementById('artistName').value.trim();
    const bio = document.getElementById('artistBio').value.trim();
    const imageFile = document.getElementById('artistImage').files[0];
    if (!name) { showToast("Nome do artista é obrigatório", "error"); return; }
    let imageUrl = null;
    if (imageFile) imageUrl = await window.uploadFileToSupabase(imageFile, `artists/${Date.now()}`);
    const { error } = await supabaseClient.from('artists').insert([{ name, bio, image_url: imageUrl }]);
    if (error) showToast("Erro ao salvar artista", "error");
    else { showToast("Artista adicionado!"); loadArtists(); modal.classList.remove('active'); }
  });
}

function openEditArtistModal(data) {
  document.getElementById('modalTitle').innerText = "Editar artista";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Nome</label><input type="text" id="artistName" value="${data.name}"></div>
    <div class="form-group"><label>Biografia</label><textarea id="artistBio">${data.bio}</textarea></div>
    <div class="form-group"><label>Nova foto (opcional)</label><input type="file" id="artistImage" accept="image/*"></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const name = document.getElementById('artistName').value.trim();
    const bio = document.getElementById('artistBio').value.trim();
    const imageFile = document.getElementById('artistImage').files[0];
    let imageUrl = data.image;
    if (imageFile) imageUrl = await window.uploadFileToSupabase(imageFile, `artists/${Date.now()}`);
    const { error } = await supabaseClient.from('artists').update({ name, bio, image_url: imageUrl }).eq('id', parseInt(data.id));
    if (error) showToast("Erro ao atualizar", "error");
    else { showToast("Artista atualizado!"); loadArtists(); modal.classList.remove('active'); }
  });
}

async function deleteArtist(id, name) {
  if (!confirm(`Excluir artista "${name}"?`)) return;
  const { error } = await supabaseClient.from('artists').delete().eq('id', parseInt(id));
  if (error) showToast("Erro ao excluir", "error");
  else { showToast("Artista excluído!"); loadArtists(); }
}

// ========== CRUD PODCASTS ==========
async function loadPodcasts() {
  const { data, error } = await supabaseClient.from('podcasts').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  const container = document.getElementById('podcastsList');
  container.innerHTML = '';
  for (const pod of data) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${escapeHtml(pod.title)}</h3>
      ${pod.cover_url ? `<img src="${pod.cover_url}" style="width:100%; max-height:150px; object-fit:cover; border-radius:12px; margin:8px 0;">` : ''}
      <p>${escapeHtml(pod.description || '')}</p>
      <p><strong>Áudio:</strong> <a href="${pod.audio_url}" target="_blank" style="color:#c084fc;">ouvir</a></p>
      <div style="display: flex; gap: 8px;">
        <button class="btn-icon edit-podcast" data-id="${pod.id}" data-title="${escapeHtml(pod.title)}" data-desc="${escapeHtml(pod.description || '')}" data-cover="${pod.cover_url || ''}" data-audio="${pod.audio_url}"><span class="material-symbols-rounded">edit</span> Editar</button>
        <button class="btn-icon danger delete-podcast" data-id="${pod.id}" data-title="${escapeHtml(pod.title)}"><span class="material-symbols-rounded">delete</span> Excluir</button>
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
    <div class="form-group"><label>Descrição</label><textarea id="podcastDesc"></textarea></div>
    <div class="form-group"><label>Capa</label><input type="file" id="podcastCover" accept="image/*"></div>
    <div class="form-group"><label>Arquivo de áudio *</label><input type="file" id="podcastAudio" accept="audio/*"></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const title = document.getElementById('podcastTitle').value.trim();
    const desc = document.getElementById('podcastDesc').value.trim();
    const audioFile = document.getElementById('podcastAudio').files[0];
    const coverFile = document.getElementById('podcastCover').files[0];
    if (!title || !audioFile) { showToast("Preencha título e arquivo de áudio", "error"); return; }
    let coverUrl = null;
    if (coverFile) coverUrl = await window.uploadFileToSupabase(coverFile, `podcasts/${Date.now()}`);
    const audioUrl = await window.uploadFileToSupabase(audioFile, `podcasts/${Date.now()}`);
    if (!audioUrl) { showToast("Falha no upload do áudio", "error"); return; }
    const { error } = await supabaseClient.from('podcasts').insert([{ title, description: desc, audio_url: audioUrl, cover_url: coverUrl }]);
    if (error) showToast("Erro ao salvar podcast", "error");
    else { showToast("Podcast adicionado!"); loadPodcasts(); modal.classList.remove('active'); }
  });
}

function openEditPodcastModal(data) {
  document.getElementById('modalTitle').innerText = "Editar podcast";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título</label><input type="text" id="podcastTitle" value="${data.title}"></div>
    <div class="form-group"><label>Descrição</label><textarea id="podcastDesc">${data.desc}</textarea></div>
    <div class="form-group"><label>Nova capa (opcional)</label><input type="file" id="podcastCover" accept="image/*"></div>
    <div class="form-group"><label>Novo áudio (opcional)</label><input type="file" id="podcastAudio" accept="audio/*"></div>
  `;
  const modal = document.getElementById('genericModal');
  modal.classList.add('active');
  setupModalSave(async () => {
    const title = document.getElementById('podcastTitle').value.trim();
    const desc = document.getElementById('podcastDesc').value.trim();
    const audioFile = document.getElementById('podcastAudio').files[0];
    const coverFile = document.getElementById('podcastCover').files[0];
    let coverUrl = data.cover;
    let audioUrl = data.audio;
    if (coverFile) coverUrl = await window.uploadFileToSupabase(coverFile, `podcasts/${Date.now()}`);
    if (audioFile) audioUrl = await window.uploadFileToSupabase(audioFile, `podcasts/${Date.now()}`);
    const { error } = await supabaseClient.from('podcasts').update({ title, description: desc, audio_url: audioUrl, cover_url: coverUrl }).eq('id', parseInt(data.id));
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

// ========== HELPERS DO MODAL ==========
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

  await loadUsers();
  await loadMusics();
  await loadArtists();
  await loadPodcasts();

  const tabs = document.querySelectorAll('.admin-tab');
  const panes = document.querySelectorAll('.tab-pane');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab + 'Tab';
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      panes.forEach(pane => pane.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
    });
  });

  document.getElementById('newMusicBtn').addEventListener('click', openNewMusicModal);
  document.getElementById('newArtistBtn').addEventListener('click', openNewArtistModal);
  document.getElementById('newPodcastBtn').addEventListener('click', openNewPodcastModal);
  document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  });
}

initAdmin();