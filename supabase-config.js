// CONFIGURAÇÃO SUPABASE
const SUPABASE_URL = 'https://ublmmwatrqvthbcmnrps.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2I4PfvjVCTi5EOPkV-CMBA_bCVl-osH';
const STORAGE_BUCKET = 'music-files';

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    try {
        const { error } = await supabaseClient
            .from('musics')
            .delete()
            .eq('id', musicId);
        if (error) throw error;
        return true;
    } catch (e) {
        console.error('deleteMusicFromSupabase:', e);
        return false;
    }
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
        return data || { full_name: '', avatar_url: null, bio: '' };
    } catch (e) {
        console.error('getUserProfile:', e);
        return { full_name: '', avatar_url: null, bio: '' };
    }
}

async function updateUserProfile(userId, updates) {
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .upsert({ id: userId, ...updates, updated_at: new Date() });
        if (error) throw error;
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
        return data || [];
    } catch (e) {
        console.error('loadUserPlaylists:', e);
        return [];
    }
}

async function saveUserPlaylist(playlist) {
    try {
        const { error } = await supabaseClient
            .from('user_playlists')
            .upsert(playlist);
        if (error) throw error;
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
        return data || [];
    } catch (e) {
        console.error('loadListeningHistory:', e);
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
        return data.map(item => item.term);
    } catch (e) {
        console.error('loadSearchHistory:', e);
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
        return data.map(f => f.music_id);
    } catch (e) {
        console.error('loadUserFavorites:', e);
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