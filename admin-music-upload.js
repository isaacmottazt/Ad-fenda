// ========== UPLOAD DE MÚSICAS: ARQUIVOS SOLTOS OU ZIP + REVISÃO POR FAIXA ==========
//
// Fluxo:
// 1. Solta arquivos de áudio e/ou um .zip na área de upload.
// 2. ZIPs são extraídos no navegador (JSZip); cada áudio vira um item.
// 3. Cada faixa ganha um CARD DE REVISÃO editável (título, artista, gênero,
//    capa) preenchido pelas tags ID3 ou pelo nome do arquivo.
//    — a versão antiga tinha UM formulário para N arquivos e o insert usava
//    `item.title || title`, então editar só afetava arquivos sem ID3.
// 4. "Publicar" sobe os áudios em sequência e insere cada faixa com os SEUS
//    metadados.

let uploadQueue = [];

const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus'];

function _isAudioName(name) {
  const ext = name.split('.').pop().toLowerCase();
  return AUDIO_EXT.includes(ext);
}

// ========== LER TAGS ID3 ==========
async function readID3Tags(file) {
  return new Promise((resolve) => {
    const fallback = _guessFromFilename(file.name);
    if (typeof jsmediatags === 'undefined') { resolve(fallback); return; }
    jsmediatags.read(file, {
      onSuccess: (tag) => {
        const t = tag.tags || {};
        resolve({
          title:  (t.title  || '').trim() || fallback.title,
          artist: (t.artist || '').trim() || fallback.artist,
          album:  (t.album  || '').trim() || '',
        });
      },
      onError: () => resolve(fallback),
    });
  });
}

// "Artista - Título.mp3" → { artist, title }
function _guessFromFilename(name) {
  const base = name.replace(/\.[^/.]+$/, '').replace(/^\d+\s*[-.]?\s*/, '');
  const dash = base.indexOf(' - ');
  if (dash > 0) {
    return { artist: base.slice(0, dash).trim(), title: base.slice(dash + 3).trim(), album: '' };
  }
  return { artist: '', title: base.trim(), album: '' };
}

// ========== EXTRAIR ÁUDIOS DE UM ZIP ==========
async function extractAudioFromZip(zipFile, onProgress) {
  if (typeof JSZip === 'undefined') {
    showToast('JSZip não carregou — verifique a conexão', 'error');
    return [];
  }
  const zip = await JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files).filter(f => !f.dir && _isAudioName(f.name));
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (onProgress) onProgress(i + 1, entries.length, entry.name);
    const blob = await entry.async('blob');
    const shortName = entry.name.split('/').pop();
    const ext = shortName.split('.').pop().toLowerCase();
    const mime = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus' }[ext] || 'audio/mpeg';
    out.push(new File([blob], shortName, { type: mime }));
  }
  return out;
}

// ========== BUSCA iTunes/Deezer (título ⇄ artista) ==========
let _searchCache = {};

async function searchMusic(query, type = 'track') {
  const key = `${type}:${query.toLowerCase()}`;
  if (_searchCache[key]) return _searchCache[key];
  let results = [];
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=${type === 'artist' ? 'musicArtist' : 'musicTrack'}&limit=6`;
    const r = await fetch(itunesUrl);
    const d = await r.json();
    if (d.results?.length) {
      results = d.results.map(it => type === 'artist'
        ? { name: it.artistName, image: null, source: 'iTunes' }
        : { title: it.trackName, artist: it.artistName,
            image: (it.artworkUrl100 || '').replace('100x100', '600x600') || null,
            source: 'iTunes' });
    }
  } catch (e) {}
  if (results.length < 4) {
    try {
      const dz = await fetch(`https://api.deezer.com/search/${type === 'artist' ? 'artist' : 'track'}?q=${encodeURIComponent(query)}&limit=6`);
      const dd = await dz.json();
      if (dd.data?.length) {
        results = results.concat(dd.data.map(it => type === 'artist'
          ? { name: it.name, image: it.picture_medium || null, source: 'Deezer' }
          : { title: it.title, artist: it.artist?.name || '',
              image: it.album?.cover_big || it.album?.cover_medium || null,
              source: 'Deezer' }));
      }
    } catch (e) {}
  }
  _searchCache[key] = results.slice(0, 8);
  return _searchCache[key];
}

function _debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Dropdown ancorado no .form-group do input (que é position:relative)
function _attachDropdown(inputEl, results, type, onPick) {
  _closeDropdowns(inputEl.closest('.track-review'));
  if (!results.length) return;
  const dd = document.createElement('div');
  dd.className = 'search-results';
  dd.innerHTML = results.map((r, i) => `
    <div class="search-result-item" data-i="${i}">
      ${r.image ? `<img src="${r.image}" alt="">` : `<span class="material-symbols-rounded" style="font-size:22px;">${type === 'artist' ? 'mic' : 'music_note'}</span>`}
      <div class="search-result-info">
        <strong>${escapeHtml(type === 'artist' ? r.name : r.title)}</strong>
        <small>${escapeHtml(type === 'artist' ? r.source : `${r.artist} · ${r.source}`)}</small>
      </div>
    </div>`).join('');
  dd.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => { onPick(results[parseInt(el.dataset.i)]); dd.remove(); });
  });
  inputEl.closest('.form-group').appendChild(dd);
}

function _closeDropdowns(scope) {
  (scope || document).querySelectorAll('.search-results').forEach(d => d.remove());
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-results') && !e.target.closest('.tr-title') && !e.target.closest('.tr-artist')) {
    _closeDropdowns();
  }
});

// ========== MODAL DE ADICIONAR MÚSICAS ==========
function openNewMusicModal() {
  document.getElementById('modalTitle').innerText = 'Adicionar músicas';
  document.getElementById('modalBody').innerHTML = `
    <div class="upload-area" id="uploadArea">
      <span class="material-symbols-rounded">cloud_upload</span>
      <p>Toque para escolher arquivos</p>
      <small>MP3, M4A, WAV, OGG, FLAC — ou um ZIP com várias músicas</small>
    </div>
    <input type="file" id="musicFilesInput" multiple
           accept="audio/*,.zip,application/zip" style="display:none;">

    <div id="zipStatus" class="upload-progress" style="display:none;"></div>

    <div id="reviewList"></div>

    <div id="reviewTools" style="display:none; margin:4px 0 8px;">
      <button type="button" id="fetchAllCoversBtn" class="btn-icon" style="width:100%; justify-content:center;">
        <span class="material-symbols-rounded">image_search</span>
        Buscar capa de todas as faixas
      </button>
    </div>

    <div id="uploadStatus" class="upload-progress" style="display:none;">
      <p id="statusText"></p>
      <div class="upload-progress-bar"><div id="statusBar"></div></div>
    </div>
  `;

  const modal      = document.getElementById('genericModal');
  const uploadArea = document.getElementById('uploadArea');
  const fileInput  = document.getElementById('musicFilesInput');
  const reviewList = document.getElementById('reviewList');
  const zipStatus  = document.getElementById('zipStatus');

  modal.classList.add('active');
  uploadQueue = [];

  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    handleIncoming(e.dataTransfer.files);
  });
  uploadArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { handleIncoming(e.target.files); e.target.value = ''; });

  async function handleIncoming(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    // Separa ZIPs de áudios soltos
    const audioFiles = [];
    for (const f of files) {
      const isZip = /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
      if (isZip) {
        zipStatus.style.display = 'block';
        zipStatus.textContent = `Extraindo ${f.name}…`;
        try {
          const extracted = await extractAudioFromZip(f, (i, total, name) => {
            zipStatus.textContent = `Extraindo ${i}/${total}: ${name.split('/').pop()}`;
          });
          if (!extracted.length) showToast(`Nenhum áudio dentro de ${f.name}`, 'error');
          audioFiles.push(...extracted);
        } catch (e) {
          console.error('ZIP:', e);
          showToast(`Falha ao ler ${f.name} — ZIP corrompido?`, 'error');
        }
        zipStatus.style.display = 'none';
      } else if (_isAudioName(f.name) || (f.type || '').startsWith('audio/')) {
        audioFiles.push(f);
      }
    }

    if (!audioFiles.length) { showToast('Nenhum arquivo de áudio reconhecido', 'error'); return; }

    // Lê tags e adiciona à fila de revisão
    for (const file of audioFiles) {
      const tags = await readID3Tags(file);
      uploadQueue.push({
        file,
        title:  tags.title,
        artist: tags.artist,
        genre:  '',
        cover:  '',
        lrc:    null,
      });
    }
    renderReviewList();
  }

  // ── Lista de revisão: um card editável por faixa ──
  function renderReviewList() {
    reviewList.innerHTML = '';
    document.getElementById('reviewTools').style.display = uploadQueue.length ? 'block' : 'none';
    uploadArea.querySelector('p').textContent = uploadQueue.length
      ? 'Adicionar mais arquivos'
      : 'Toque para escolher arquivos';

    uploadQueue.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'track-review';
      card.dataset.idx = idx;
      card.innerHTML = `
        <div class="track-review-head">
          <span class="track-review-num">${idx + 1}</span>
          <img class="track-review-cover" src="${item.cover || ''}"
               style="${item.cover ? '' : 'visibility:hidden;'}" alt="">
          <span class="track-review-file">${escapeHtml(item.file.name)}</span>
          <button type="button" class="track-review-remove" title="Remover">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <div class="track-row-2">
          <div class="form-group">
            <label>Título *</label>
            <input type="text" class="tr-title" value="${escapeHtml(item.title)}">
          </div>
          <div class="form-group">
            <label>Artista *</label>
            <input type="text" class="tr-artist" value="${escapeHtml(item.artist)}">
          </div>
        </div>
        <div class="track-row-2">
          <div class="form-group">
            <label>Gênero</label>
            <select class="tr-genre">
              <option value="">Sem gênero</option>
              ${['Gospel','Adoração','Louvores','Contemporâneo','Rock Cristão','MPB','Pop','Rock']
                .map(g => `<option value="${g}" ${item.genre === g ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Capa (URL)</label>
            <input type="text" class="tr-cover" value="${escapeHtml(item.cover)}" placeholder="Auto ou cole uma URL">
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn-icon tr-fetch-cover">
            <span class="material-symbols-rounded">image_search</span> Buscar capa
          </button>
          <button type="button" class="btn-icon tr-fetch-lyrics">
            <span class="material-symbols-rounded">lyrics</span>
            <span class="tr-lyrics-label">${item.lrc ? 'Letra ✓' : 'Buscar letra'}</span>
          </button>
        </div>
      `;

      // Edições gravam direto no item da fila
      const titleInput  = card.querySelector('.tr-title');
      const artistInput = card.querySelector('.tr-artist');

      // Digitar busca no iTunes/Deezer; escolher um resultado preenche
      // título + artista + capa DESTA faixa (na versão antiga a busca
      // preenchia um formulário global, não a faixa certa)
      titleInput.addEventListener('input', e => { item.title = e.target.value; });
      titleInput.addEventListener('input', _debounce(async e => {
        const q = e.target.value.trim();
        if (q.length < 2) { _closeDropdowns(card); return; }
        const results = await searchMusic(q, 'track');
        if (document.activeElement !== titleInput) return; // usuário já saiu do campo
        _attachDropdown(titleInput, results, 'track', (r) => {
          item.title = r.title; item.artist = r.artist || item.artist;
          titleInput.value = item.title; artistInput.value = item.artist;
          if (r.image && !item.cover) {
            item.cover = r.image;
            card.querySelector('.tr-cover').value = r.image;
            const img = card.querySelector('.track-review-cover');
            img.src = r.image; img.style.visibility = 'visible';
          }
        });
      }, 350));

      artistInput.addEventListener('input', e => { item.artist = e.target.value; });
      artistInput.addEventListener('input', _debounce(async e => {
        const q = e.target.value.trim();
        if (q.length < 2) { _closeDropdowns(card); return; }
        const results = await searchMusic(q, 'artist');
        if (document.activeElement !== artistInput) return;
        _attachDropdown(artistInput, results, 'artist', (r) => {
          item.artist = r.name; artistInput.value = r.name;
        });
      }, 350));
      card.querySelector('.tr-genre').addEventListener('change', e => { item.genre  = e.target.value; });
      card.querySelector('.tr-cover').addEventListener('input',  e => {
        item.cover = e.target.value.trim();
        const img = card.querySelector('.track-review-cover');
        img.src = item.cover; img.style.visibility = item.cover ? 'visible' : 'hidden';
      });
      card.querySelector('.tr-fetch-cover').addEventListener('click', async () => {
        if (!item.title || !item.artist) { showToast('Preencha título e artista primeiro', 'error'); return; }
        showToast('Buscando capa…');
        const url = await fetchCoverFromDeezer(item.artist, item.title);
        if (url) {
          item.cover = url;
          card.querySelector('.tr-cover').value = url;
          const img = card.querySelector('.track-review-cover');
          img.src = url; img.style.visibility = 'visible';
          showToast('Capa encontrada!', 'success');
        } else {
          showToast('Nenhuma capa encontrada', 'error');
        }
      });
      card.querySelector('.tr-fetch-lyrics').addEventListener('click', async (e) => {
        const label = card.querySelector('.tr-lyrics-label');
        if (!item.title || !item.artist) { showToast('Preencha título e artista primeiro', 'error'); return; }
        label.textContent = 'Buscando…';
        const lyrics = await fetchSyncedLyricsFromLRCLIB(item.artist, item.title);
        if (!lyrics) { label.textContent = 'Buscar letra'; showToast('Nenhuma letra sincronizada encontrada', 'error'); return; }
        const blob = new Blob([lyrics], { type: 'text/plain' });
        const file = new File([blob], `${item.title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.lrc`, { type: 'text/plain' });
        const lrcUrl = await window.uploadFileToSupabase(file, 'lyrics');
        if (lrcUrl) { item.lrc = lrcUrl; label.textContent = 'Letra ✓'; showToast('Letra sincronizada anexada!', 'success'); }
        else { label.textContent = 'Buscar letra'; showToast('Falha ao enviar o arquivo .lrc', 'error'); }
      });

      card.querySelector('.track-review-remove').addEventListener('click', () => {
        uploadQueue.splice(idx, 1);
        renderReviewList();
      });

      reviewList.appendChild(card);
    });
  }

  // Buscar capas de todas as faixas sem capa
  document.getElementById('fetchAllCoversBtn').addEventListener('click', async () => {
    const pending = uploadQueue.filter(i => !i.cover && i.title && i.artist);
    if (!pending.length) { showToast('Nada para buscar', 'error'); return; }
    for (const item of pending) {
      const url = await fetchCoverFromDeezer(item.artist, item.title);
      if (url) item.cover = url;
    }
    renderReviewList();
    showToast('Busca de capas concluída', 'success');
  });

  // ── Publicar ──
  setupModalSave(async () => {
    if (!uploadQueue.length) { showToast('Nenhuma faixa para publicar', 'error'); return; }

    // Valida TODAS antes de subir qualquer coisa
    const invalid = uploadQueue.findIndex(i => !i.title.trim() || !i.artist.trim());
    if (invalid !== -1) {
      showToast(`Faixa ${invalid + 1} sem título ou artista`, 'error');
      document.querySelectorAll('.track-review')[invalid]?.scrollIntoView({ block: 'center' });
      return;
    }

    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.disabled = true;
    const statusDiv  = document.getElementById('uploadStatus');
    const statusText = document.getElementById('statusText');
    const statusBar  = document.getElementById('statusBar');
    statusDiv.style.display = 'block';

    const total = uploadQueue.length;
    let ok = 0, failed = [];

    for (let i = 0; i < total; i++) {
      const item = uploadQueue[i];
      statusText.textContent = `Enviando ${i + 1} de ${total}: ${item.title}`;
      statusBar.style.width = Math.round((i / total) * 100) + '%';

      const audioUrl = await window.uploadFileToSupabase(item.file, `musics/${Date.now()}`);
      if (!audioUrl) { failed.push(item.title); continue; }

      const { error } = await supabaseClient.from('musics').insert([{
        title:  item.title.trim(),
        artist: item.artist.trim(),
        src:    audioUrl,
        cover:  item.cover || null,
        genre:  item.genre || null,
        lrc:    item.lrc || null,
      }]);
      if (error) { console.error(error); failed.push(item.title); }
      else ok++;
    }

    statusBar.style.width = '100%';
    statusText.textContent = failed.length
      ? `${ok} publicadas, ${failed.length} falharam: ${failed.join(', ')}`
      : 'Concluído!';
    confirmBtn.disabled = false;

    if (failed.length === 0) {
      setTimeout(() => {
        showToast(`${ok} música(s) publicada(s)!`, 'success');
        loadMusics();
        document.getElementById('genericModal').classList.remove('active');
      }, 800);
    } else {
      showToast(`${failed.length} faixa(s) falharam — veja o status`, 'error');
      // Mantém na fila só o que falhou, para tentar de novo
      uploadQueue = uploadQueue.filter(i => failed.includes(i.title));
      renderReviewList();
      loadMusics();
    }
  });
}

// ========== BIBLIOTECAS (CDN) ==========
(function loadLibs() {
  const jsm = document.createElement('script');
  jsm.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js';
  document.head.appendChild(jsm);

  const jz = document.createElement('script');
  jz.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  document.head.appendChild(jz);
})();
