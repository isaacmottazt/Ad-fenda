// ========== SISTEMA DE MENSAGENS COM TEMPLATES DINÂMICOS ==========

// URL do servidor push (deploy no Render.com ou Railway)
// Deixe null se ainda não deployou — mensagens chegam via polling
const PUSH_SERVER_URL = null; // ex: 'https://fenda-push.onrender.com'

let allUsers = [];

// ========== CARREGAR USUÁRIOS PARA SELEÇÃO ==========
async function loadUsersForMessages() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, full_name, email')
    .order('full_name', { ascending: true });
  if (error) {
    console.error('Erro ao carregar usuários:', error);
    return [];
  }
  allUsers = data || [];
  return allUsers;
}

// ========== TEMPLATES ==========
const messageTemplates = {
  new_music: {
    title: 'Nova música disponível',
    template: 'Olá {user_name}! Uma nova música chegou: {music_title} de {artist_name}',
    variables: ['{user_name}', '{music_title}', '{artist_name}']
  },
  new_artist: {
    title: 'Novo artista adicionado',
    template: 'Oi {user_name}! Conhece {artist_name}? Temos {music_count} músicas deles',
    variables: ['{user_name}', '{artist_name}', '{music_count}']
  },
  special_message: {
    title: 'Mensagem especial',
    template: 'Olá {user_name}! {custom_message}',
    variables: ['{user_name}', '{custom_message}']
  },
  announcement: {
    title: 'Anúncio geral',
    template: 'Aviso para todos: {announcement_text}',
    variables: ['{announcement_text}']
  }
};

async function sendAdminNotification({ title, body, type = 'custom', recipientIds = [], sendPush = true, musicId = null, imageUrl = null }) {
  const metadata = {
    template_type: type,
    recipient_ids: Array.isArray(recipientIds) ? recipientIds.map(String) : [],
    send_push: sendPush !== false,
    ...(musicId ? { musicId: String(musicId) } : {}),
  };
  const { data, error } = await supabaseClient.rpc('create_admin_notification', {
    p_title: title,
    p_body: body,
    p_deep_link: null,
    p_image_url: /^https:\/\//i.test(imageUrl || '') ? imageUrl : null,
    p_metadata: metadata,
  });
  if (error) throw error;
  return data;
}

// ========== MODAL DE NOVA MENSAGEM ==========
async function openNewMessageModal() {
  await loadUsersForMessages();

  document.getElementById('modalTitle').innerText = "Enviar notificação";
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group">
      <label>Tipo de mensagem</label>
      <select id="messageType">
        <option value="custom">Personalizada (digitar)</option>
        <option value="new_music">Nova música disponível</option>
        <option value="new_artist">Novo artista</option>
        <option value="announcement">Anúncio geral</option>
      </select>
    </div>

    <div class="form-group" id="templatePreview" style="display:none; background:rgba(146,76,255,0.1); padding:12px; border-radius:12px; border:1px solid rgba(146,76,255,0.2);">
      <strong style="font-size:12px; color:rgba(255,255,255,0.6);">Template:</strong>
      <p id="templateText" style="margin-top:6px; font-size:13px;"></p>
    </div>

    <!-- CAMPOS DINÂMICOS (aparecem conforme tipo) -->
    <div id="dynamicFields"></div>

    <div class="form-group">
      <label>Destinatários</label>
      <select id="recipientType">
        <option value="all">Todos os usuários</option>
        <option value="specific">Usuários específicos</option>
      </select>
    </div>

    <div class="form-group" id="userSelector" style="display:none;">
      <label>Selecione usuários</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; max-height:200px; overflow-y:auto;">
        ${allUsers.map(user => `
          <label style="display:flex; align-items:center; gap:8px; padding:8px; border-radius:8px; cursor:pointer; background:rgba(255,255,255,0.02); margin-bottom:4px;">
            <input type="checkbox" class="user-checkbox" value="${user.id}" data-name="${user.full_name}">
            <span style="font-size:12px;">${user.full_name}</span>
          </label>
        `).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>Assunto / Título</label>
      <input type="text" id="messageTitle" placeholder="Título da notificação">
    </div>

    <div class="form-group">
      <label>Mensagem *</label>
      <textarea id="messageBody" placeholder="Digite sua mensagem..." style="min-height:100px;"></textarea>
    </div>

    <div class="form-group" id="customVarsGroup" style="display:none;">
      <label style="color:rgba(255,255,255,0.5); font-size:12px;">Variáveis disponíveis: {user_name}, {user_email}</label>
    </div>

    <div class="form-group" style="background:rgba(76,175,80,0.1); padding:12px; border-radius:12px; border:1px solid rgba(76,175,80,0.3);">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="sendPush" checked>
        <span style="font-size:13px;">Enviar como notificação push</span>
      </label>
    </div>
  `;

  const modal = document.getElementById('genericModal');
  modal.classList.add('active');

  const messageType = document.getElementById('messageType');
  const templatePreview = document.getElementById('templatePreview');
  const templateText = document.getElementById('templateText');
  const recipientType = document.getElementById('recipientType');
  const userSelector = document.getElementById('userSelector');
  const customVarsGroup = document.getElementById('customVarsGroup');
  const dynamicFields = document.getElementById('dynamicFields');
  const messageBody = document.getElementById('messageBody');
  let updatingTemplateBody = false;

  function syncTemplateBody() {
    const template = messageTemplates[messageType.value];
    if (!template || messageBody.dataset.manual === '1') return;
    let rendered = template.template;
    const values = {
      '{music_title}': document.getElementById('musicTitle')?.value.trim() || '{music_title}',
      '{artist_name}': document.getElementById('musicArtist')?.value.trim() || '{artist_name}',
      '{music_count}': document.getElementById('musicCount')?.value || '{music_count}',
      '{announcement_text}': document.getElementById('announcementText')?.value.trim() || '{announcement_text}',
      '{custom_message}': '{custom_message}',
    };
    Object.entries(values).forEach(([token, value]) => { rendered = rendered.replaceAll(token, value); });
    updatingTemplateBody = true;
    messageBody.value = rendered;
    messageBody.dataset.autofilled = '1';
    updatingTemplateBody = false;
  }

  messageBody.addEventListener('input', () => {
    if (!updatingTemplateBody) messageBody.dataset.manual = '1';
  });

  // Função para renderizar campos dinâmicos
  function renderDynamicFields() {
    const type = messageType.value;
    dynamicFields.innerHTML = '';

    if (type === 'new_artist') {
      dynamicFields.innerHTML = `
        <div class="form-group">
          <label>Nome do artista *</label>
          <input type="text" id="artistName" placeholder="Ex: Hillsong">
        </div>
        <div class="form-group">
          <label>Quantidade de músicas *</label>
          <input type="number" id="musicCount" placeholder="Ex: 15" value="1">
        </div>
      `;
    } else if (type === 'new_music') {
      dynamicFields.innerHTML = `
        <div class="form-group">
          <label>Título da música *</label>
          <input type="text" id="musicTitle" placeholder="Ex: Oceans">
        </div>
        <div class="form-group">
          <label>Nome do artista *</label>
          <input type="text" id="musicArtist" placeholder="Ex: Hillsong">
        </div>
      `;
    } else if (type === 'announcement') {
      dynamicFields.innerHTML = `
        <div class="form-group">
          <label>Texto do anúncio *</label>
          <input type="text" id="announcementText" placeholder="Ex: Nova playlist disponível!">
        </div>
      `;
    }
  }

  messageType.addEventListener('change', () => {
    const template = messageTemplates[messageType.value];
    renderDynamicFields();

    if (template) {
      templatePreview.style.display = 'block';
      templateText.textContent = template.template;
      document.getElementById('messageTitle').value = template.title;
      messageBody.dataset.manual = '0';
      customVarsGroup.style.display = 'none';
      syncTemplateBody();
      ['musicTitle', 'musicArtist', 'musicCount', 'announcementText'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', syncTemplateBody);
      });
    } else {
      templatePreview.style.display = 'none';
      document.getElementById('messageTitle').value = '';
      customVarsGroup.style.display = 'block';
    }
  });

  recipientType.addEventListener('change', () => {
    userSelector.style.display = recipientType.value === 'specific' ? 'block' : 'none';
  });

  // Renderizar campos inicialmente
  renderDynamicFields();
  messageBody.dataset.manual = '0';

  setupModalSave(async () => {
    const title = document.getElementById('messageTitle').value.trim();
    const body = document.getElementById('messageBody').value.trim();
    const type = messageType.value;
    const recipients = recipientType.value;
    const sendPush = document.getElementById('sendPush').checked;

    if (!title || !body) {
      showToast("Título e mensagem são obrigatórios", "error");
      return;
    }

    let targetUsers = [];
    if (recipients === 'all') {
      targetUsers = allUsers.map(u => u.id);
    } else if (recipients === 'specific') {
      const selected = document.querySelectorAll('.user-checkbox:checked');
      targetUsers = Array.from(selected).map(cb => cb.value);
      if (targetUsers.length === 0) {
        showToast("Selecione pelo menos um usuário", "error");
        return;
      }
    }

    // Processar variáveis de template
    let finalBody = body;
    if (type === 'new_artist') {
      const artistName = document.getElementById('artistName')?.value.trim() || '';
      const musicCount = document.getElementById('musicCount')?.value || '0';
      if (!artistName) {
        showToast("Nome do artista é obrigatório", "error");
        return;
      }
      finalBody = body
        .replace('{artist_name}', artistName)
        .replace('{music_count}', musicCount);
    } else if (type === 'new_music') {
      const musicTitle = document.getElementById('musicTitle')?.value.trim() || '';
      const musicArtist = document.getElementById('musicArtist')?.value.trim() || '';
      if (!musicTitle || !musicArtist) {
        showToast("Título e artista são obrigatórios", "error");
        return;
      }
      finalBody = body
        .replace('{music_title}', musicTitle)
        .replace('{artist_name}', musicArtist);
    } else if (type === 'announcement') {
      const announcementText = document.getElementById('announcementText')?.value.trim() || '';
      if (!announcementText) {
        showToast("Texto do anúncio é obrigatório", "error");
        return;
      }
      finalBody = body.replace('{announcement_text}', announcementText);
    }

    showToast("Enviando mensagens...");

    try {
      // O app lê admin_notifications; recipients e push ficam no metadata.
      let linkedMusic = null;
      if (type === 'new_music') {
        const musicTitle = document.getElementById('musicTitle')?.value.trim() || '';
        const musicArtist = document.getElementById('musicArtist')?.value.trim() || '';
        const { data: match } = await supabaseClient
          .from('musics')
          .select('id, cover')
          .ilike('title', musicTitle)
          .ilike('artist', musicArtist)
          .limit(1)
          .maybeSingle();
        linkedMusic = match || null;
      }

      const messageId = await sendAdminNotification({
        title,
        body: finalBody.replaceAll('{user_name}', '').replace(/\s{2,}/g, ' ').trim(),
        type,
        recipientIds: recipients === 'specific' ? targetUsers : [],
        sendPush,
        musicId: linkedMusic?.id || null,
        imageUrl: /^https:\/\//i.test(linkedMusic?.cover || '') ? linkedMusic.cover : null,
      });

      console.log('[Mensagem] Comunicado criado:', messageId);
      const recipientLabel = recipients === 'all'
        ? 'todos os usuários'
        : `${targetUsers.length} usuário(s)`;
      showToast(`Notificação enviada para ${recipientLabel}!`, "success");
      loadMessages();
      modal.classList.remove('active');
    } catch (e) {
      showToast("Erro ao enviar: " + (e.message || e), "error");
    }
  });
}

// ========== NOTIFICAÇÃO AUTOMÁTICA AO ADICIONAR ARTISTA ==========
// Esta função é chamada quando artista é criado (em admin.js openNewArtistModal)
async function sendNewArtistNotification(artistName, artistId) {
  try {
    console.log('[Auto] Enviando notificação de novo artista:', artistName);

    // Contar músicas deste artista
    const { data: musics, error: musicError } = await supabaseClient
      .from('musics')
      .select('id')
      .eq('artist', artistName);

    if (musicError) {
      console.warn('[Auto] Erro ao contar músicas:', musicError);
      return;
    }

    const musicCount = musics ? musics.length : 0;

    // Se tiver 0 músicas, não envia (ainda não tá pronto)
    if (musicCount === 0) {
      console.log('[Auto] Artista sem músicas, não enviando notificação');
      return;
    }

    const title = 'Novo artista adicionado';
    const body = `Conheça ${artistName}: agora temos ${musicCount} música(s) desse artista no Fenda Music.`;
    const messageId = await sendAdminNotification({
      title,
      body,
      type: 'new_artist',
      recipientIds: [],
      sendPush: true,
    });

    console.log('[Auto] ✅ Comunicado criado para todos os usuários:', messageId);
  } catch (e) {
    console.error('[Auto] Erro ao enviar notificação automática:', e);
  }
}

// ========== CARREGAR E LISTAR MENSAGENS ENVIADAS ==========
async function loadMessages() {
  const { data, error } = await supabaseClient
    .from('admin_notifications')
    .select('id, title, body, target, status, created_at, dispatched_at, metadata')
    .order('created_at', { ascending: false })
    .limit(50);

  const container = document.getElementById('messagesList');
  if (!container) return;
  if (error) { console.error('Erro ao carregar mensagens:', error); return; }
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">campaign</span>
        <h3>Nenhuma mensagem enviada</h3>
        <p>Use "Nova" para notificar os usuários.</p>
      </div>`;
    return;
  }

  const typeMeta = {
    new_music:    { icon: 'music_note', label: 'Nova música' },
    new_artist:   { icon: 'mic',        label: 'Novo artista' },
    announcement: { icon: 'campaign',   label: 'Anúncio' },
    custom:       { icon: 'chat',       label: 'Personalizada' },
  };

  for (const msg of data) {
    const meta = typeMeta[msg.metadata?.template_type] || typeMeta.custom;
    const d = new Date(msg.created_at);
    const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const recipientIds = Array.isArray(msg.metadata?.recipient_ids) ? msg.metadata.recipient_ids : [];
    const targetLabel = msg.target === 'all'
      ? 'todos os usuários'
      : `${recipientIds.length} usuário(s)`;
    const statusLabel = msg.status === 'sent' ? 'entregue' : (msg.status || 'pendente');

    const card = document.createElement('div');
    card.className = 'msg-card';
    card.dataset.messageType = msg.metadata?.template_type || 'custom';
    card.dataset.messageStatus = msg.status || '';
    card.innerHTML = `
      <div class="msg-card-icon"><span class="material-symbols-rounded">${meta.icon}</span></div>
      <div class="msg-card-body">
        <div class="msg-card-title">${escapeHtml(msg.title)}</div>
        <div class="msg-card-text">${escapeHtml(msg.body)}</div>
        <div class="msg-card-meta">
          <span class="msg-type-chip">${meta.label}</span>
          <span>${dateStr}</span>
          <span>${targetLabel}</span>
          <span>${statusLabel}</span>
        </div>
        <div class="msg-card-actions">
          <button type="button" class="btn-icon danger msg-delete" data-id="${escapeHtml(msg.id)}" data-title="${escapeHtml(msg.title)}">
            <span class="material-symbols-rounded">delete</span> Apagar
          </button>
        </div>
      </div>
    `;
    card.querySelector('.msg-delete')?.addEventListener('click', () => deleteAdminNotification(msg.id, msg.title, card));
    container.appendChild(card);
  }
}

async function deleteAdminNotification(messageId, title, card) {
  if (!messageId) return;
  if (!confirm(`Apagar a notificação "${title || 'sem título'}"? Essa ação remove o aviso do histórico administrativo e da central dos usuários.`)) return;

  const button = card?.querySelector('.msg-delete');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="material-symbols-rounded">progress_activity</span> Apagando…';
  }

  try {
    const { data, error } = await supabaseClient.rpc('delete_admin_notification', {
      p_notification_id: messageId,
    });
    if (error) throw error;
    if (data !== true) {
      showToast('Essa notificação já não está disponível.', 'error');
      await loadMessages();
      return;
    }
    showToast('Notificação apagada.', 'success');
    await loadMessages();
    window.AdminUI?.refreshOverview?.();
  } catch (error) {
    console.error('deleteAdminNotification:', error);
    showToast(`Não foi possível apagar: ${error.message || error}`, 'error');
    if (button) {
      button.disabled = false;
      button.innerHTML = '<span class="material-symbols-rounded">delete</span> Apagar';
    }
  }
}

function viewMessageDetails(messageId) {
  alert('Detalhes da mensagem:\nID: ' + messageId);
}


// ========== SUBMISSÕES DE MÚSICAS DOS USUÁRIOS ==========
// Tabela: music_submissions (title, artist, file_url, cover, message,
// status pending/approved/rejected). O lado do usuário será feito depois;
// esta tela já lê, aprova (insere em musics) e recusa.

async function loadSubmissions() {
  const container = document.getElementById('subsList');
  if (!container) return;

  const { data, error } = await supabaseClient
    .from('music_submissions')
    .select('*, profiles:user_id ( full_name, email )')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    // Tabela ainda não existe → instrução em vez de erro silencioso
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">build</span>
        <h3>Tabela music_submissions não encontrada</h3>
        <p>Rode o SQL de criação no Supabase para ativar esta seção.</p>
      </div>`;
    _updateSubsBadge(0);
    return;
  }

  const subs = data || [];
  const pending = subs.filter(s => s.status === 'pending');
  _updateSubsBadge(pending.length);
  const countEl = document.getElementById('subsCount');
  if (countEl) countEl.textContent = `${pending.length} pendente${pending.length === 1 ? '' : 's'}`;

  container.innerHTML = '';
  if (!subs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">inbox</span>
        <h3>Nenhuma música enviada ainda</h3>
        <p>Quando um usuário enviar uma música, ela aparece aqui para análise.</p>
      </div>`;
    return;
  }

  // Pendentes primeiro
  subs.sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1)
                   || new Date(b.created_at) - new Date(a.created_at));

  const statusLabel = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Recusada' };

  for (const sub of subs) {
    const sender = sub.profiles?.full_name || sub.profiles?.email || 'Usuário';
    const d = new Date(sub.created_at);
    const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

    const card = document.createElement('div');
    card.className = `sub-card ${sub.status}`;
    card.dataset.submissionStatus = sub.status || '';
    card.innerHTML = `
      <div class="sub-card-head">
        <div class="sub-card-title">
          <strong>${escapeHtml(sub.title || 'Sem título')}</strong>
          <small>${escapeHtml(sub.artist || 'Artista não informado')}</small>
        </div>
        <span class="sub-status ${sub.status}">${statusLabel[sub.status] || sub.status}</span>
      </div>
      <div class="sub-meta">Enviada por ${escapeHtml(sender)} · ${dateStr}</div>
      ${sub.message ? `<div class="sub-msg">${escapeHtml(sub.message)}</div>` : ''}
      ${sub.file_url ? `<audio controls preload="none" src="${sub.file_url}"></audio>`
                     : '<div class="sub-msg">Sem arquivo de áudio anexado.</div>'}
      ${sub.status === 'pending' ? `
      <div class="sub-actions">
        <button class="btn-icon ok sub-approve">
          <span class="material-symbols-rounded">check_circle</span> Aprovar e publicar
        </button>
        <button class="btn-icon danger sub-reject">
          <span class="material-symbols-rounded">cancel</span> Recusar
        </button>
      </div>` : ''}
    `;

    card.querySelector('.sub-approve')?.addEventListener('click', () => openApproveSubmissionModal(sub));
    card.querySelector('.sub-reject')?.addEventListener('click', () => rejectSubmission(sub));
    container.appendChild(card);
  }
}

function _updateSubsBadge(n) {
  const badge = document.getElementById('navMsgBadge');
  if (!badge) return;
  badge.style.display = n > 0 ? 'flex' : 'none';
  badge.textContent = n > 9 ? '9+' : String(n);
}

// Aprovar = revisar metadados e inserir em musics
function openApproveSubmissionModal(sub) {
  if (!sub.file_url) { showToast('Submissão sem arquivo de áudio — não dá para publicar', 'error'); return; }

  document.getElementById('modalTitle').innerText = 'Revisar e publicar';
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group"><label>Título *</label>
      <input type="text" id="subTitle" value="${escapeHtml(sub.title || '')}"></div>
    <div class="form-group"><label>Artista *</label>
      <input type="text" id="subArtist" value="${escapeHtml(sub.artist || '')}"></div>
    <div class="form-group"><label>Gênero</label>
      <select id="subGenre">
        <option value="">Sem gênero</option>
        ${['Gospel','Adoração','Louvores','Contemporâneo','Rock Cristão','MPB','Pop','Rock']
          .map(g => `<option value="${g}">${g}</option>`).join('')}
      </select></div>
    <div class="form-group"><label>Capa (URL ou arquivo)</label>
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <input type="text" id="subCover" value="${escapeHtml(sub.cover || '')}" placeholder="URL" style="flex:1">
        <label style="display:flex; align-items:center; gap:4px; padding:10px 12px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); border-radius:10px; cursor:pointer; font-size:12px; font-weight:700;">
          <span class="material-symbols-rounded" style="font-size:16px;">upload</span>
          <input type="file" id="subCoverFile" accept="image/*" style="display:none">
        </label>
      </div>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <button type="button" id="subFetchCover" class="btn-icon" style="flex:1; justify-content:center;">
        <span class="material-symbols-rounded">image_search</span> Buscar capa
      </button>
    </div>
    <audio controls preload="none" src="${sub.file_url}" style="width:100%; margin-top:12px; height:38px;"></audio>
  `;
  document.getElementById('genericModal').classList.add('active');

  document.getElementById('subCoverFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('Enviando capa…');
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = `covers/${Date.now()}-${safe}`;
      const { error } = await supabaseClient.storage
        .from('music-files')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      const { data } = supabaseClient.storage.from('music-files').getPublicUrl(path);
      document.getElementById('subCover').value = data.publicUrl;
      showToast('Capa enviada!', 'success');
    } catch (err) {
      showToast('Erro na capa: ' + (err.message || err), 'error');
    }
  });

  document.getElementById('subFetchCover').addEventListener('click', async () => {
    const t = document.getElementById('subTitle').value.trim();
    const a = document.getElementById('subArtist').value.trim();
    if (!t || !a) { showToast('Preencha título e artista', 'error'); return; }
    showToast('Buscando capa…');
    const url = await fetchCoverFromDeezer(a, t);
    if (url) { document.getElementById('subCover').value = url; showToast('Capa encontrada!', 'success'); }
    else showToast('Nenhuma capa encontrada', 'error');
  });

  setupModalSave(async () => {
    const title  = document.getElementById('subTitle').value.trim();
    const artist = document.getElementById('subArtist').value.trim();
    const genre  = document.getElementById('subGenre').value || null;
    const cover  = document.getElementById('subCover').value.trim() || null;
    if (!title || !artist) { showToast('Título e artista são obrigatórios', 'error'); return; }

    // 1) publica no catálogo
    const { error: insErr } = await supabaseClient.from('musics').insert([{
      title, artist, genre, cover, src: sub.file_url, lrc: null,
    }]);
    if (insErr) { showToast('Erro ao publicar: ' + insErr.message, 'error'); return; }

    // 2) marca a submissão como aprovada
    const { error: updErr } = await supabaseClient
      .from('music_submissions')
      .update({ status: 'approved', reviewed_by: currentAdminUserId, reviewed_at: new Date() })
      .eq('id', sub.id);
    if (updErr) {
      // Música já foi publicada; avisa que só o status falhou
      showToast('Publicada, mas falhou ao marcar como aprovada: ' + updErr.message, 'error');
    } else {
      showToast('Música publicada no catálogo!', 'success');
    }
    document.getElementById('genericModal').classList.remove('active');
    loadSubmissions();
    loadMusics();
  });
}

async function rejectSubmission(sub) {
  if (!confirm(`Recusar "${sub.title || 'esta música'}"?`)) return;
  const { error } = await supabaseClient
    .from('music_submissions')
    .update({ status: 'rejected', reviewed_by: currentAdminUserId, reviewed_at: new Date() })
    .eq('id', sub.id);
  if (error) showToast('Erro ao recusar: ' + error.message, 'error');
  else { showToast('Submissão recusada'); loadSubmissions(); }
}
