
// =========================================================
// ===== CACHE DE DADOS DO USUÁRIO (IndexedDB) =============
// =========================================================
const UserCacheDB = {
    _db: null,
    _NAME: 'FendaUserCache_v1',
    _VER: 1,

    async open() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this._NAME, this._VER);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                // Cada store guarda um único "documento" por userId
                ['profile', 'playlists', 'favorites', 'history', 'searchHistory', 'avatarImage'].forEach(s => {
                    if (!db.objectStoreNames.contains(s))
                        db.createObjectStore(s);
                });
            };
        });
    },

    async set(store, userId, value) {
        try {
            const db = await this.open();
            return new Promise((res) => {
                const tx = db.transaction(store, 'readwrite');
                tx.objectStore(store).put(value, userId);
                tx.oncomplete = () => res(true);
                tx.onerror = () => res(false);
            });
        } catch { return false; }
    },

    async get(store, userId) {
        try {
            const db = await this.open();
            return new Promise((res) => {
                const tx = db.transaction(store, 'readonly');
                const req = tx.objectStore(store).get(userId);
                req.onsuccess = () => res(req.result ?? null);
                req.onerror = () => res(null);
            });
        } catch { return null; }
    },

    // Cacheia a foto de perfil como Blob para funcionar offline
    async cacheAvatarImage(userId, imageUrl) {
        if (!imageUrl) return;
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) return;
            const blob = await response.blob();
            await this.set('avatarImage', userId, { blob, url: imageUrl, cachedAt: Date.now() });
            console.log('[UserCache] ✅ Foto de perfil cacheada');
        } catch (e) {
            console.warn('[UserCache] Não foi possível cachear avatar:', e);
        }
    },

    // Retorna URL da foto: blob local se offline, URL remota se online
    async getAvatarUrl(userId, remoteUrl) {
        if (navigator.onLine && remoteUrl) return remoteUrl;
        const cached = await this.get('avatarImage', userId);
        if (cached?.blob) return URL.createObjectURL(cached.blob);
        return remoteUrl; // fallback
    },

    async clear(userId) {
        try {
            const db = await this.open();
            const stores = ['profile','playlists','favorites','history','searchHistory','avatarImage'];
            const tx = db.transaction(stores, 'readwrite');
            stores.forEach(s => tx.objectStore(s).delete(userId));
        } catch {}
    }
};

window.UserCacheDB = UserCacheDB;

// CONFIGURAÇÃO SUPABASE
const SUPABASE_URL = 'https://ublmmwatrqvthbcmnrps.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2I4PfvjVCTi5EOPkV-CMBA_bCVl-osH';
const STORAGE_BUCKET = 'music-files';

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
window.supabaseClient = supabaseClient;

// ========== CRUD MÚSICAS ==========
async function loadMusicsFromSupabase() {
    try {
        const { data, error } = await supabaseClient
            .from('musics')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('loadMusicsFromSupabase:', e);
        return [];
    }
}

async function saveMusicToSupabase(musicData) {
    try {
        const { data, error } = await supabaseClient
            .from('musics')
            .insert([musicData])
            .select();
        if (error) throw error;
        return data?.[0] || null;
    } catch (e) {
        console.error('saveMusicToSupabase:', e);
        return null;
    }
}

async function deleteMusicFromSupabase(musicId) {
    // Músicas são gerenciadas apenas pelo admin via Supabase Dashboard.
    // RLS bloqueia DELETE para usuários autenticados na tabela musics.
    console.warn('deleteMusicFromSupabase: operação bloqueada por RLS — apenas admin pode deletar músicas');
    return false;
}

// ========== UPLOAD DE ARQUIVOS ==========
async function uploadFileToSupabase(file, subfolder) {
    if (!file) return null;
    try {
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${Date.now()}-${safeName}`;
        const filePath = `${subfolder}/${fileName}`;
        
        const { error } = await supabaseClient.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (error) throw error;
        
        const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
        return data.publicUrl;
    } catch (e) {
        console.error('uploadFileToSupabase:', e);
        return null;
    }
}

// ========== PERFIL DO USUÁRIO ==========
async function getUserProfile(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        const profile = data || { full_name: '', avatar_url: null, bio: '' };
        // Salva no cache
        await UserCacheDB.set('profile', userId, profile);
        // Cacheia foto de perfil em background
        if (profile.avatar_url) UserCacheDB.cacheAvatarImage(userId, profile.avatar_url);
        return profile;
    } catch (e) {
        console.error('getUserProfile:', e);
        // Tenta retornar do cache se offline
        const cached = await UserCacheDB.get('profile', userId);
        if (cached) { console.log('[UserCache] Perfil carregado do cache'); return cached; }
        return { full_name: '', avatar_url: null, bio: '' };
    }
}

async function updateUserProfile(userId, updates) {
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .upsert({ id: userId, ...updates, updated_at: new Date() });
        if (error) throw error;
        // Atualiza cache com novos dados
        const current = await UserCacheDB.get('profile', userId) || {};
        const updated = { ...current, ...updates };
        await UserCacheDB.set('profile', userId, updated);
        // Se avatar mudou, recacheia a imagem
        if (updates.avatar_url) UserCacheDB.cacheAvatarImage(userId, updates.avatar_url);
        return true;
    } catch (e) {
        console.error('updateUserProfile:', e);
        return false;
    }
}

// ========== PLAYLISTS DO USUÁRIO ==========
async function loadUserPlaylists(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('user_playlists')
            .select('*')
            .eq('user_id', userId);
        if (error) throw error;
        const playlists = data || [];
        await UserCacheDB.set('playlists', userId, playlists);
        return playlists;
    } catch (e) {
        console.error('loadUserPlaylists:', e);
        const cached = await UserCacheDB.get('playlists', userId);
        if (cached) { console.log('[UserCache] Playlists carregadas do cache'); return cached; }
        return [];
    }
}

async function saveUserPlaylist(playlist) {
    try {
        const { error } = await supabaseClient
            .from('user_playlists')
            .upsert(playlist);
        if (error) throw error;
        // Atualiza cache local também
        if (playlist.user_id) {
            const cached = await UserCacheDB.get('playlists', playlist.user_id) || [];
            const idx = cached.findIndex(p => p.id === playlist.id);
            if (idx >= 0) cached[idx] = playlist;
            else cached.push(playlist);
            await UserCacheDB.set('playlists', playlist.user_id, cached);
        }
        return true;
    } catch (e) {
        console.error('saveUserPlaylist:', e);
        return false;
    }
}

async function deleteUserPlaylist(playlistId, userId) {
    try {
        const { error } = await supabaseClient
            .from('user_playlists')
            .delete()
            .eq('id', playlistId)
            .eq('user_id', userId);
        if (error) throw error;
        // Remove do cache local também
        const cached = await UserCacheDB.get('playlists', userId) || [];
        const updated = cached.filter(p => p.id !== playlistId);
        await UserCacheDB.set('playlists', userId, updated);
        return true;
    } catch (e) {
        console.error('deleteUserPlaylist:', e);
        return false;
    }
}

// ========== HISTÓRICO DE REPRODUÇÃO ==========
async function addToListeningHistory(userId, musicId, listenedSeconds) {
    try {
        await supabaseClient
            .from('listening_history')
            .insert({ user_id: userId, music_id: musicId, listened_seconds: listenedSeconds });
        // Limitar histórico para 50 registros por usuário (opcional)
        return true;
    } catch (e) {
        console.error('addToListeningHistory:', e);
        return false;
    }
}

async function loadListeningHistory(userId, limit = 20) {
    try {
        const { data, error } = await supabaseClient
            .from('listening_history')
            .select('*')
            .eq('user_id', userId)
            .order('played_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        const history = data || [];
        await UserCacheDB.set('history', userId, history);
        return history;
    } catch (e) {
        console.error('loadListeningHistory:', e);
        const cached = await UserCacheDB.get('history', userId);
        if (cached) { console.log('[UserCache] Histórico carregado do cache'); return cached; }
        return [];
    }
}

// ========== HISTÓRICO DE BUSCA ==========
async function addToSearchHistory(userId, term) {
    if (!term) return;
    try {
        // Evita duplicatas recentes (opcional)
        const { data: existing } = await supabaseClient
            .from('search_history')
            .select('id')
            .eq('user_id', userId)
            .eq('term', term)
            .order('searched_at', { ascending: false })
            .limit(1);
        if (existing && existing.length > 0) {
            // Atualiza timestamp
            await supabaseClient
                .from('search_history')
                .update({ searched_at: new Date() })
                .eq('id', existing[0].id);
        } else {
            await supabaseClient
                .from('search_history')
                .insert({ user_id: userId, term: term });
        }
        return true;
    } catch (e) {
        console.error('addToSearchHistory:', e);
        return false;
    }
}

async function loadSearchHistory(userId, limit = 10) {
    try {
        const { data, error } = await supabaseClient
            .from('search_history')
            .select('term')
            .eq('user_id', userId)
            .order('searched_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        const terms = data.map(item => item.term);
        await UserCacheDB.set('searchHistory', userId, terms);
        return terms;
    } catch (e) {
        console.error('loadSearchHistory:', e);
        const cached = await UserCacheDB.get('searchHistory', userId);
        if (cached) { console.log('[UserCache] Histórico de busca carregado do cache'); return cached; }
        return [];
    }
}

async function clearSearchHistory(userId) {
    try {
        await supabaseClient
            .from('search_history')
            .delete()
            .eq('user_id', userId);
        return true;
    } catch (e) {
        console.error('clearSearchHistory:', e);
        return false;
    }
}

// ========== FAVORITOS ==========
async function loadUserFavorites(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('user_favorites')
            .select('music_id')
            .eq('user_id', userId);
        if (error) throw error;
        const favorites = data.map(f => f.music_id);
        await UserCacheDB.set('favorites', userId, favorites);
        return favorites;
    } catch (e) {
        console.error('loadUserFavorites:', e);
        const cached = await UserCacheDB.get('favorites', userId);
        if (cached) { console.log('[UserCache] Favoritos carregados do cache'); return cached; }
        return [];
    }
}

async function toggleFavorite(userId, musicId) {
    try {
        const { data: existing } = await supabaseClient
            .from('user_favorites')
            .select('music_id')
            .eq('user_id', userId)
            .eq('music_id', musicId);
        if (existing && existing.length > 0) {
            await supabaseClient
                .from('user_favorites')
                .delete()
                .eq('user_id', userId)
                .eq('music_id', musicId);
            return false; // removido
        } else {
            await supabaseClient
                .from('user_favorites')
                .insert({ user_id: userId, music_id: musicId });
            return true; // adicionado
        }
    } catch (e) {
        console.error('toggleFavorite:', e);
        return null;
    }
}

// Adicione ao final do arquivo, antes das exportações globais

// ========== ARTISTAS ==========
async function loadAllArtists() {
    try {
        const { data, error } = await supabaseClient
            .from('artists')
            .select('*')
            .order('name')
            .limit(1000);
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('loadAllArtists:', e);
        return [];
    }
}

async function searchArtists(query) {
    if (!query) return [];
    try {
        const { data, error } = await supabaseClient
            .from('artists')
            .select('*')
            .ilike('name', `%${query}%`)
            .limit(10);
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.error('searchArtists:', e);
        return [];
    }
}

// ========== SINCRONIZAR ARTISTAS A PARTIR DAS MÚSICAS ==========
async function syncArtistsFromMusics(musics) {
    if (!musics || musics.length === 0) return [];

    // Extrai nomes únicos dos artistas das músicas
    const artistNames = [...new Set(musics.map(m => m.artist).filter(a => a && a.trim()))];
    
    // Busca todos os artistas já cadastrados no banco
    const { data: existingArtists, error } = await supabaseClient
        .from('artists')
        .select('name');
    if (error) {
        console.error('Erro ao buscar artistas existentes:', error);
        return [];
    }
    
    const existingNames = new Set(existingArtists.map(a => a.name));
    const newArtists = artistNames.filter(name => !existingNames.has(name));
    
    if (newArtists.length === 0) return [];
    
    // Prepara os registros para inserção
    const artistsToInsert = newArtists.map(name => ({
        name: name,
        bio: null,  // ou 'Artista sem biografia'
        image_url: null,
        created_at: new Date(),
        updated_at: new Date()
    }));
    
    // Insere em lotes para evitar erro de tamanho
    const batchSize = 100;
    let inserted = [];
    for (let i = 0; i < artistsToInsert.length; i += batchSize) {
        const batch = artistsToInsert.slice(i, i + batchSize);
        const { data, error: insertError } = await supabaseClient
            .from('artists')
            .insert(batch)
            .select();
        if (insertError) {
            console.error('Erro ao inserir artistas:', insertError);
        } else if (data) {
            inserted = inserted.concat(data);
        }
    }
    
    console.log(`✅ Sincronizados ${inserted.length} novos artistas.`);
    return inserted;
}

// Exporte a função
window.syncArtistsFromMusics = syncArtistsFromMusics;

// Exposição global
window.loadAllArtists = loadAllArtists;
window.searchArtists = searchArtists;
// Exposição global
window.loadMusicsFromSupabase = loadMusicsFromSupabase;
window.saveMusicToSupabase = saveMusicToSupabase;
window.deleteMusicFromSupabase = deleteMusicFromSupabase;
window.uploadFileToSupabase = uploadFileToSupabase;

window.getUserProfile = getUserProfile;
window.updateUserProfile = updateUserProfile;
window.loadUserPlaylists = loadUserPlaylists;
window.saveUserPlaylist = saveUserPlaylist;
window.deleteUserPlaylist = deleteUserPlaylist;
window.addToListeningHistory = addToListeningHistory;
window.loadListeningHistory = loadListeningHistory;
window.addToSearchHistory = addToSearchHistory;
window.loadSearchHistory = loadSearchHistory;
window.clearSearchHistory = clearSearchHistory;
window.loadUserFavorites = loadUserFavorites;
window.toggleFavorite = toggleFavorite;
// ========== MENSAGENS DO ADMIN (polling) ==========

/**
 * Busca mensagens pendentes do admin para este usuário.
 * Marca como 'delivered' após buscar — evita mostrar de novo.
 * Chamado na abertura do app e periodicamente (a cada 5 min).
 */
async function loadAdminMessages(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('message_deliveries')
            .select('id, message_id, admin_messages(id, title, body, template_type, image_url, created_at)')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        if (!data?.length) return [];

        const messages = data.map(d => ({
            deliveryId: d.id,
            id:         d.message_id,
            title:      d.admin_messages?.title  || '',
            body:       d.admin_messages?.body   || '',
            type:       d.admin_messages?.template_type || 'system',
            image:      d.admin_messages?.image_url || null,
            createdAt:  d.admin_messages?.created_at || new Date().toISOString(),
        }));

        // Marca como entregue para não mostrar de novo
        const ids = data.map(d => d.id);
        await supabaseClient
            .from('message_deliveries')
            .update({ status: 'delivered' })
            .in('id', ids)
            .eq('user_id', userId);

        return messages;
    } catch (e) {
        console.error('loadAdminMessages:', e);
        return [];
    }
}

// ========== SALVAR SUBSCRIPTION PUSH ==========

/**
 * Salva/atualiza a subscription push do usuário no Supabase.
 * Chamado quando o usuário ativa as notificações push.
 */
async function savePushSubscription(userId, subscription) {
    try {
        const sub = JSON.parse(JSON.stringify(subscription));
        const { error } = await supabaseClient
            .from('push_subscriptions')
            .upsert({
                user_id:    userId,
                endpoint:   sub.endpoint,
                p256dh:     sub.keys.p256dh,
                auth:       sub.keys.auth,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id,endpoint' });

        if (error) throw error;
        console.log('[Push] Subscription salva no Supabase');
        return true;
    } catch (e) {
        console.error('savePushSubscription:', e);
        return false;
    }
}

window.loadAdminMessages   = loadAdminMessages;
window.savePushSubscription = savePushSubscription;
