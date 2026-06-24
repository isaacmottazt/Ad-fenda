/* ============================================================
   FENDA MUSIC — NOTIFICATIONS (notifications.js)
   Gerencia notificações locais geradas pelo app e notificações
   push recebidas pelo Service Worker.

   Armazenamento: localStorage 'fenda_notifications'
   Cada notificação: { id, type, title, body, image, icon,
                       iconBg, time, read, musicId }
   ============================================================ */

const FendaNotifications = (() => {
    'use strict';

    const KEY = 'fenda_notifications';
    const MAX = 100; // máximo de notificações guardadas

    // ── Tipos e visual ──────────────────────────────────────────
    const TYPE_META = {
        recommendation: { icon: 'recommend',             bg: '#7c3aed' },
        achievement:    { icon: 'emoji_events',          bg: '#f59e0b' },
        release:        { icon: 'new_releases',          bg: '#059669' },
        social:         { icon: 'favorite',              bg: '#ec4899' },
        playlist:       { icon: 'queue_music',           bg: '#6d28d9' },
        system:         { icon: 'notifications',         bg: '#475569' },
        fire:           { icon: 'local_fire_department', bg: '#ea580c' },
        trending:       { icon: 'trending_up',           bg: '#7c3aed' },
    };

    // ── Storage ─────────────────────────────────────────────────
    function getAll() {
        try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
        catch { return []; }
    }

    function save(list) {
        localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    }

    function add(notif) {
        const meta = TYPE_META[notif.type] || TYPE_META.system;
        const entry = {
            id:     `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            type:   notif.type  || 'system',
            title:  notif.title || '',
            body:   notif.body  || '',
            image:  notif.image || null,
            icon:   notif.icon  || meta.icon,
            iconBg: notif.iconBg || meta.bg,
            time:   Date.now(),
            read:   false,
            musicId: notif.musicId || null,
        };
        const all = getAll();
        // Evita duplicata nas últimas 24h (mesmo título)
        const recent = all.filter(n => Date.now() - n.time < 86_400_000);
        if (recent.some(n => n.title === entry.title)) return;

        all.unshift(entry);
        save(all);
        _updateDot();
    }

    function markAllRead() {
        save(getAll().map(n => ({ ...n, read: true })));
        _updateDot();
    }

    function markRead(id) {
        save(getAll().map(n => n.id === id ? { ...n, read: true } : n));
        _updateDot();
    }

    function getUnreadCount() {
        return getAll().filter(n => !n.read).length;
    }

    // ── Dot no sino ─────────────────────────────────────────────
    function _updateDot() {
        const dot   = document.getElementById('notifDot');
        const count = getUnreadCount();
        if (!dot) return;
        dot.style.display = count > 0 ? 'flex' : 'none';
        dot.textContent   = count > 9 ? '9+' : (count > 0 ? String(count) : '');
    }

    // ── Geração de notificações locais ──────────────────────────
    function _dayKey(ts) {
        return new Date(ts || Date.now()).toDateString();
    }

    function checkAndGenerate() {
        const musics     = window.AppState?.musics     || [];
        const history    = window.AppState?.history    || [];
        const favorites  = window.AppState?.favorites  || new Set();
        const playlists  = window.AppState?.userPlaylists || [];
        let   playCounts = {};
        try { playCounts = JSON.parse(localStorage.getItem('play_counts') || '{}'); } catch {}

        _checkRecommendation(musics, history);
        _checkWeeklyTop(musics, playCounts);
        _checkStreak(history);
        _checkNewReleases(musics);
    }

    function _checkRecommendation(musics, history) {
        const lsKey = 'fenda_notif_rec_day';
        if (localStorage.getItem(lsKey) === _dayKey()) return;

        const recentIds = new Set((history || []).slice(0, 15).map(h => String(h.id)));
        const pool = musics.filter(m => !recentIds.has(String(m.id)));
        if (!pool.length) return;

        const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 20))];
        add({
            type:    'recommendation',
            title:   pick.title,
            body:    'foi recomendada para você',
            image:   pick.cover,
            musicId: pick.id,
        });
        localStorage.setItem(lsKey, _dayKey());
    }

    function _checkWeeklyTop(musics, playCounts) {
        const lsKey = 'fenda_notif_top_week';
        const lastWeek = localStorage.getItem(lsKey);
        const thisWeek = new Date().toLocaleDateString('pt-BR', { week: 'numeric', year: 'numeric' });
        if (lastWeek === thisWeek) return;

        const totalPlays = Object.values(playCounts).reduce((a, b) => a + Number(b), 0);
        if (totalPlays < 5) return;

        add({
            type:  'trending',
            title: 'Você está no Top da Semana!',
            body:  `Parabéns! Você ouviu ${totalPlays} músicas esta semana.`,
        });
        localStorage.setItem(lsKey, thisWeek);
    }

    function _checkStreak(history) {
        const lsKey = 'fenda_notif_streak_day';
        if (localStorage.getItem(lsKey) === _dayKey()) return;

        const daySet = new Set((history || []).map(h => new Date(h.playedAt || 0).toDateString()));
        let streak = 0;
        const d = new Date();
        while (daySet.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }

        if (streak >= 3) {
            add({
                type:  'fire',
                title: `${streak} dias seguidos ouvindo! 🔥`,
                body:  'Você está em sequência no Fenda Music. Continue assim!',
            });
            localStorage.setItem(lsKey, _dayKey());
        }
    }

    function _checkNewReleases(musics) {
        const lsKey    = 'fenda_notif_release_day';
        if (localStorage.getItem(lsKey) === _dayKey()) return;

        const sevenDaysAgo = Date.now() - 7 * 86_400_000;
        const newOnes = musics.filter(m => m.created_at && new Date(m.created_at).getTime() > sevenDaysAgo);
        if (!newOnes.length) return;

        const pick = newOnes[0];
        add({
            type:  'release',
            title: `${pick.artist} adicionou uma nova música`,
            body:  `"${pick.title}" já está disponível no Fenda Music!`,
            image: pick.cover,
            musicId: pick.id,
        });
        localStorage.setItem(lsKey, _dayKey());
    }

    // ── Recebe push do SW ────────────────────────────────────────
    function addFromPush(data) {
        add({
            type:    data.type    || 'system',
            title:   data.title   || 'Fenda Music',
            body:    data.body    || '',
            image:   data.image   || null,
            musicId: data.musicId || null,
        });
        _showInAppToast(data.title, data.body);
    }

    function _showInAppToast(title, body) {
        if (typeof window.showToast === 'function') {
            window.showToast(`🔔 ${title}: ${body}`, 'success');
        }
    }

    // ── Renderização da tela ─────────────────────────────────────
    function _timeLabel(ts) {
        if (!ts) return '';
        const now  = new Date();
        const d    = new Date(ts);
        const diff = now - d;
        if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}min atrás`;
        if (d.toDateString() === now.toDateString())
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const yest = new Date(now); yest.setDate(yest.getDate() - 1);
        if (d.toDateString() === yest.toDateString()) return 'Ontem';
        const mo = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
        return `${d.getDate()} de ${mo[d.getMonth()]}`;
    }

    function _groupLabel(ts) {
        const now  = new Date();
        const d    = new Date(ts);
        if (d.toDateString() === now.toDateString()) return 'Hoje';
        const yest = new Date(now); yest.setDate(yest.getDate() - 1);
        if (d.toDateString() === yest.toDateString()) return 'Ontem';
        const diff = Math.floor((now - d) / 86_400_000);
        if (diff < 7) return 'Esta semana';
        return 'Mais antigas';
    }

    function renderScreen(filter = 'all') {
        const list = document.getElementById('notifList');
        if (!list) return;

        let notifs = getAll();
        if (filter === 'unread') notifs = notifs.filter(n => !n.read);

        if (!notifs.length) {
            list.innerHTML = `
                <div class="notif-empty">
                    <span class="material-symbols-rounded">notifications_off</span>
                    <p>${filter === 'unread' ? 'Nenhuma notificação não lida' : 'Nenhuma notificação ainda'}</p>
                </div>`;
            return;
        }

        // Agrupa por data
        const groups = [];
        const seen   = new Map();
        notifs.forEach(n => {
            const g = _groupLabel(n.time);
            if (!seen.has(g)) { seen.set(g, groups.length); groups.push({ label: g, items: [] }); }
            groups[seen.get(g)].items.push(n);
        });

        list.innerHTML = groups.map(g => `
            <div class="notif-group">
                <div class="notif-group-label">${g.label}</div>
                ${g.items.map(n => `
                    <div class="notif-card ${n.read ? '' : 'notif-unread'}" data-id="${n.id}" data-music="${n.musicId || ''}">
                        <div class="notif-thumb">
                            ${n.image
                                ? `<img src="${n.image}" alt="" class="notif-thumb-img">`
                                : `<div class="notif-thumb-icon" style="background:${n.iconBg}">
                                       <span class="material-symbols-rounded">${n.icon}</span>
                                   </div>`}
                        </div>
                        <div class="notif-content">
                            <p class="notif-title"><strong>${_esc(n.title)}</strong> ${_esc(n.body)}</p>
                            <span class="notif-time">${_timeLabel(n.time)}</span>
                        </div>
                        ${!n.read ? `<span class="notif-dot-indicator"></span>` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('');

        // Cliques nas notificações
        list.querySelectorAll('.notif-card').forEach(card => {
            card.addEventListener('click', () => {
                const id      = card.dataset.id;
                const musicId = card.dataset.music;
                markRead(id);
                card.classList.remove('notif-unread');
                card.querySelector('.notif-dot-indicator')?.remove();
                _updateDot();

                if (musicId) {
                    const music = (window.AppState?.musics || []).find(
                        m => String(m.id) === String(musicId)
                    );
                    if (music && typeof window.playMusicTrack === 'function') {
                        closeNotifications();
                        window.playMusicTrack(music);
                    }
                }
            });
        });
    }

    function _esc(str) {
        return String(str || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Abrir / fechar overlay ───────────────────────────────────
    function openNotifications() {
        const overlay = document.getElementById('notificationsOverlay');
        if (!overlay) return;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        // Renderiza PRIMEIRO com o estado real (não lidas visíveis)
        // Marca como lidas apenas ao FECHAR — evita inconsistência visual
        renderScreen('all');
        // Verifica permissão de push para mostrar/ocultar prompt
        _checkPushPermission();
    }

    function closeNotifications() {
        const overlay = document.getElementById('notificationsOverlay');
        if (!overlay) return;
        // Marca tudo como lido ao fechar (não ao abrir)
        markAllRead();
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        _updateDot();
    }

    // ── Permissão push e visibilidade do prompt ───────────────────
    function _checkPushPermission() {
        const card = document.getElementById('notifPromptCard');
        if (!card) return;
        // Sem suporte → esconde
        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
            card.style.display = 'none'; return;
        }
        // Já decidido (granted ou denied) → esconde
        if (Notification.permission !== 'default') {
            card.style.display = 'none';
        } else {
            card.style.display = 'flex'; // só mostra se ainda não decidiu
        }
    }

    function _requestPushPermission() {
        if (!('Notification' in window)) {
            window.showToast?.('Seu navegador não suporta notificações', 'danger');
            return;
        }
        // Usa função do player-core.js se disponível
        if (typeof window.subscribePushNotifications === 'function') {
            window.subscribePushNotifications().then(sub => {
                if (sub) {
                    document.getElementById('notifPromptCard')?.remove();
                    window.showToast?.('✅ Notificações ativadas!', 'success');
                    _updateDot();
                }
            });
            return;
        }
        // Fallback: solicita permissão diretamente
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                document.getElementById('notifPromptCard')?.remove();
                window.showToast?.('✅ Notificações ativadas!', 'success');
            } else {
                window.showToast?.('Permissão negada pelo navegador', 'danger');
            }
        });
    }

    // ── Init ─────────────────────────────────────────────────────
    function init() {
        _updateDot();

        // Botão de fechar dentro do overlay
        document.getElementById('notifCloseBtn')
            ?.addEventListener('click', closeNotifications);

        // Tabs Todas / Não lidas
        document.querySelectorAll('.notif-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderScreen(tab.dataset.tab);
            });
        });

        // Botão ativar notificações push
        document.getElementById('notifActivateBtn')?.addEventListener('click', () => {
            _requestPushPermission();
        });

        // Atualiza bolinha imediatamente no init
        _updateDot();

        // Gera notificações locais após 3s (aguarda dados do app)
        setTimeout(() => {
            checkAndGenerate();
            _updateDot();
        }, 3000);
    }

    // ── Mensagens do admin (polling) ─────────────────────────────
    // Verifica se há mensagens do admin pendentes no Supabase.
    // Chamado na abertura do app e a cada 5 minutos.
    // Funciona mesmo sem servidor push — é o fallback de entrega.
    async function checkAdminMessages() {
        const userId = window.AppState?.userId;
        if (!userId || typeof window.loadAdminMessages !== 'function') return;
        if (!navigator.onLine) return;

        try {
            const messages = await window.loadAdminMessages(userId);
            if (!messages.length) return;

            const typeMap = {
                new_music:       'release',
                new_artist:      'release',
                announcement:    'system',
                special_message: 'system',
                custom:          'system',
            };

            messages.forEach(msg => {
                add({
                    type:    typeMap[msg.type] || 'system',
                    title:   msg.title,
                    body:    msg.body,
                    image:   msg.image || null,
                    icon:    'admin_panel_settings',
                    iconBg:  '#6d28d9',
                });
            });

            console.log('[Notifications] Mensagens do admin:', messages.length);
        } catch (e) {
            console.warn('[Notifications] checkAdminMessages:', e);
        }
    }

    // Polling a cada 5 minutos quando o app está aberto
    let _pollInterval = null;
    function startPolling() {
        if (_pollInterval) return;
        checkAdminMessages(); // verifica imediatamente
        _pollInterval = setInterval(checkAdminMessages, 5 * 60 * 1000);
    }
    function stopPolling() {
        clearInterval(_pollInterval);
        _pollInterval = null;
    }

    // Retoma polling quando o app volta para primeiro plano
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkAdminMessages();
    });

    return {
        init,
        add,
        addFromPush,
        openNotifications,
        closeNotifications,
        checkAndGenerate,
        checkAdminMessages,
        startPolling,
        stopPolling,
        getAll,
        getUnreadCount,
        updateDot: _updateDot,
    };
})();

window.FendaNotifications = FendaNotifications;
