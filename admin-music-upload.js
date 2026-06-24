// ========== UPLOAD MÚLTIPLO DE MÚSICAS COM ID3 E BUSCA ==========

let uploadQueue = [];
let searchCache = {};

// ========== LER TAGS ID3 ==========
async function readID3Tags(file) {
  return new Promise((resolve) => {
    // Usar biblioteca jsmediatags (CDN)
    if (typeof jsmediatags === 'undefined') {
      console.warn('jsmediatags não carregado, pulando leitura de tags');
      resolve({ title: file.name.replace(/\.[^/.]+$/, ''), artist: '' });
      return;
    }

    jsmediatags.read(file, {
      onSuccess: function(tag) {
        const data = tag.tags;
        resolve({
          title: data.title || file.name.replace(/\.[^/.]+$/, ''),
          artist: data.artist || '',
          album: data.album || ''
        });
      },
      onError: function(error) {
        console.warn('Erro ao ler ID3:', error);
        resolve({ title: file.name.replace(/\.[^/.]+$/, ''), artist: '' });
      }
    });
  });
}

// ========== BUSCAR MÚLTIPLOS RESULTADOS (ARTISTA OU MÚSICA) ==========
async function searchMusic(query, type = 'track') {
  const cacheKey = `${type}:${query}`;
  if (searchCache[cacheKey]) return searchCache[cacheKey];

  try {
    // Buscar em iTunes (rápido, CORS-safe)
    let results = [];
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=${type === 'artist' ? 'musicArtist' : 'musicTrack'}&limit=10`;
    const itunesRes = await fetch(itunesUrl);
    const itunesData = await itunesRes.json();

    if (itunesData.results && itunesData.results.length > 0) {
      results = itunesData.results.map(item => {
        if (type === 'artist') {
          return {
            id: item.adamId,
            name: item.artistName,
            image: item.artistLinkUrl ? null : null,
            source: 'iTunes'
          };
        } else {
          return {
            id: item.trackId,
            title: item.trackName,
            artist: item.artistName,
            album: item.collectionName,
            image: item.artworkUrl600 || item.artworkUrl100,
            preview: item.previewUrl,
            source: 'iTunes'
          };
        }
      });
    }

    // Fallback: Deezer (melhor para artistas)
    if (results.length < 5) {
      const deezerUrl = `https://api.deezer.com/search/${type === 'artist' ? 'artist' : 'track'}?q=${encodeURIComponent(query)}&limit=10`;
      try {
        const deezerRes = await fetch(deezerUrl);
        const deezerData = await deezerRes.json();
        if (deezerData.data && deezerData.data.length > 0) {
          const deezerResults = deezerData.data.map(item => {
            if (type === 'artist') {
              return {
                id: item.id,
                name: item.name,
                image: item.picture_big || item.picture_medium,
                source: 'Deezer'
              };
            } else {
              return {
                id: item.id,
                title: item.title,
                artist: item.artist.name,
                album: item.album.title,
                image: item.album.cover_big || item.album.cover_medium,
                source: 'Deezer'
              };
            }
          });
          results = results.concat(deezerResults).slice(0, 10);
        }
      } catch (e) {
        console.warn('Erro ao buscar Deezer:', e);
      }
    }

    searchCache[cacheKey] = results;
    return results;
  } catch (e) {
    console.error('Erro ao buscar música:', e);
    return [];
  }
}

// ========== RENDERIZAR DROPDOWN DE RESULTADOS ==========
function showSearchResults(inputId, results, type, onSelect) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const existingDropdown = input.nextElementSibling;
  if (existingDropdown && existingDropdown.classList.contains('search-results')) {
    existingDropdown.remove();
  }

  if (results.length === 0) return;

  const dropdown = document.createElement('div');
  dropdown.className = 'search-results';
  dropdown.innerHTML = results.map((item, idx) => {
    if (type === 'artist') {
      return `
        <div class="search-result-item" data-idx="${idx}">
          ${item.image ? `<img src="${item.image}" alt="${item.name}">` : '<span style="font-size:24px;">🎤</span>'}
          <div class="search-result-info">
            <strong>${item.name}</strong>
            <small>${item.source}</small>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="search-result-item" data-idx="${idx}">
          ${item.image ? `<img src="${item.image}" alt="${item.title}">` : '<span style="font-size:24px;">🎵</span>'}
          <div class="search-result-info">
            <strong>${item.title}</strong>
            <small>${item.artist} • ${item.source}</small>
          </div>
        </div>
      `;
    }
  }).join('');

  input.parentNode.insertBefore(dropdown, input.nextSibling);

  dropdown.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      onSelect(results[idx]);
      dropdown.remove();
    });
  });
}

// ========== MODAL DE NOVA MÚSICA (COM UPLOAD MÚLTIPLO) ==========
function openNewMusicModal() {
  document.getElementById('modalTitle').innerText = "Adicionar músicas";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group">
      <label>Selecionar arquivos de áudio</label>
      <div class="upload-area" id="uploadArea">
        <span class="material-symbols-rounded">cloud_upload</span>
        <p>Clique ou arraste arquivos aqui</p>
        <small style="color: rgba(255,255,255,0.4); display:block; margin-top:8px;">MP3, M4A, WAV suportados</small>
      </div>
      <input type="file" id="musicFilesInput" multiple accept="audio/*" style="display:none;">
      <div id="uploadPreview" class="upload-preview" style="display:none;"></div>
    </div>

    <div id="uploadForm" style="display:none;">
      <div class="form-group">
        <label>Título da música *</label>
        <input type="text" id="musicTitle" placeholder="Digite o título">
        <div id="titleResults" class="search-results" style="display:none;"></div>
      </div>

      <div class="form-group">
        <label>Artista *</label>
        <input type="text" id="musicArtist" placeholder="Digite o artista">
        <div id="artistResults" class="search-results" style="display:none;"></div>
      </div>

      <div class="form-group">
        <label>Capa (será buscada automaticamente)</label>
        <input type="text" id="musicCover" placeholder="URL da capa" readonly>
      </div>

      <div class="form-group">
        <label>Gênero</label>
        <select id="musicGenre">
          <option value="">Selecione um gênero</option>
          <option value="Gospel">Gospel</option>
          <option value="Adoração">Adoração</option>
          <option value="Louvores">Louvores</option>
          <option value="Contemporâneo">Contemporâneo</option>
          <option value="Rock Cristão">Rock Cristão</option>
          <option value="MPB">MPB</option>
        </select>
      </div>
    </div>

    <div id="uploadStatus" style="display:none;">
      <p id="statusText"></p>
      <div style="width:100%; height:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden; margin-top:8px;">
        <div id="statusBar" style="width:0%; height:100%; background:linear-gradient(90deg, #924cff, #6a2ad4); transition:width 0.3s;"></div>
      </div>
    </div>
  `;

  const modal = document.getElementById('genericModal');
  modal.classList.add('active');

  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('musicFilesInput');
  const preview = document.getElementById('uploadPreview');
  const uploadForm = document.getElementById('uploadForm');

  uploadQueue = [];

  // Drag and drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  uploadArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  async function handleFiles(files) {
    uploadQueue = [];
    preview.innerHTML = '';
    preview.style.display = 'block';
    uploadArea.style.display = 'none';

    for (const file of files) {
      const tags = await readID3Tags(file);
      uploadQueue.push({
        file,
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        cover: null,
        genre: ''
      });

      const item = document.createElement('div');
      item.className = 'upload-preview-item';
      item.innerHTML = `
        <span class="material-symbols-rounded">audio_file</span>
        <div class="name">${file.name}</div>
        <button class="remove" data-idx="${uploadQueue.length - 1}">
          <span class="material-symbols-rounded">close</span>
        </button>
      `;
      preview.appendChild(item);
    }

    preview.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        uploadQueue.splice(idx, 1);
        btn.parentElement.remove();
        if (uploadQueue.length === 0) {
          preview.style.display = 'none';
          uploadArea.style.display = 'block';
        }
      });
    });

    uploadForm.style.display = 'block';
    if (uploadQueue.length > 0) {
      const first = uploadQueue[0];
      document.getElementById('musicTitle').value = first.title;
      document.getElementById('musicArtist').value = first.artist;
      document.getElementById('musicGenre').value = first.genre;
    }
  }

  // Busca ao digitar
  document.getElementById('musicTitle').addEventListener('input', async (e) => {
    if (e.target.value.length < 2) {
      document.getElementById('titleResults').style.display = 'none';
      return;
    }
    const results = await searchMusic(e.target.value, 'track');
    if (results.length > 0) {
      showSearchResults('musicTitle', results, 'track', (item) => {
        document.getElementById('musicTitle').value = item.title;
        document.getElementById('musicArtist').value = item.artist;
        document.getElementById('musicCover').value = item.image || '';
      });
    }
  });

  document.getElementById('musicArtist').addEventListener('input', async (e) => {
    if (e.target.value.length < 2) {
      document.getElementById('artistResults').style.display = 'none';
      return;
    }
    const results = await searchMusic(e.target.value, 'artist');
    if (results.length > 0) {
      showSearchResults('musicArtist', results, 'artist', (item) => {
        document.getElementById('musicArtist').value = item.name;
        // Buscar capa deste artista
        (async () => {
          const musicResults = await searchMusic(item.name, 'track');
          if (musicResults.length > 0 && musicResults[0].image) {
            document.getElementById('musicCover').value = musicResults[0].image;
          }
        })();
      });
    }
  });

  setupModalSave(async () => {
    const title = document.getElementById('musicTitle').value.trim();
    const artist = document.getElementById('musicArtist').value.trim();
    const cover = document.getElementById('musicCover').value.trim();
    const genre = document.getElementById('musicGenre').value || null;

    if (!title || !artist) {
      showToast("Título e artista são obrigatórios", "error");
      return;
    }

    uploadForm.style.display = 'none';
    const statusDiv = document.getElementById('uploadStatus');
    const statusText = document.getElementById('statusText');
    const statusBar = document.getElementById('statusBar');
    statusDiv.style.display = 'block';

    const total = uploadQueue.length;
    for (let i = 0; i < total; i++) {
      const item = uploadQueue[i];
      const percent = Math.round(((i + 1) / total) * 100);
      statusText.textContent = `Enviando ${i + 1} de ${total}...`;
      statusBar.style.width = percent + '%';

      const audioUrl = await window.uploadFileToSupabase(item.file, `musics/${Date.now()}`);
      if (!audioUrl) {
        showToast(`Erro ao enviar ${item.file.name}`, "error");
        continue;
      }

      const musicData = {
        title: item.title || title,
        artist: item.artist || artist,
        src: audioUrl,
        cover: cover || null,
        genre: genre,
        lrc: null
      };

      const { error } = await supabaseClient.from('musics').insert([musicData]);
      if (error) {
        showToast(`Erro ao salvar ${item.title}`, "error");
      }
    }

    statusText.textContent = 'Concluído!';
    statusBar.style.width = '100%';
    setTimeout(() => {
      showToast(`${total} música(s) adicionada(s)!`, "success");
      loadMusics();
      modal.classList.remove('active');
    }, 1000);
  });
}

// Carregar biblioteca jsmediatags via CDN
const script = document.createElement('script');
script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js';
document.head.appendChild(script);
