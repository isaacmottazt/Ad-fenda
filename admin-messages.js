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
      customVarsGroup.style.display = 'none';
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
      // Inserir mensagens no banco
      const messageRecord = {
        admin_id: currentAdminUserId,
        title,
        body: finalBody,
        template_type: type,
        created_at: new Date()
      };

      const { data: savedMessage, error: msgError } = await supabaseClient
        .from('admin_messages')
        .insert([messageRecord])
        .select();

      if (msgError) throw msgError;
      const messageId = savedMessage[0].id;

      // Criar registros de entrega
      const deliveryRecords = targetUsers.map(userId => ({
        message_id: messageId,
        user_id: userId,
        status: 'pending',
        created_at: new Date()
      }));

      const { error: deliveryError } = await supabaseClient
        .from('message_deliveries')
        .insert(deliveryRecords);

      if (deliveryError) throw deliveryError;

      // Se ativado, disparar push (sem servidor por enquanto funciona via polling)
      if (sendPush) {
        console.log('[Mensagem] Push será entregue via polling');
      }

      // Dispara push server se configurado
      if (PUSH_SERVER_URL && sendPush) {
          fetch(`${PUSH_SERVER_URL}/trigger-push`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message_id: messageId }),
          })
          .then(r => r.json())
          .then(r => console.log('[Push Server]', r))
          .catch(e => console.warn('[Push Server] Offline ou erro:', e.message));
      }

      showToast(`Notificação enviada para ${targetUsers.length} usuário(s)!`, "success");
      loadMessages();
      modal.classList.remove('active');
    } catch (e) {
      showToast("Erro ao enviar: " + e.message, "error");
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

    // Pegar todos os usuários
    const { data: allUsersData } = await supabaseClient
      .from('profiles')
      .select('id');

    const userIds = allUsersData ? allUsersData.map(u => u.id) : [];
    if (userIds.length === 0) return;

    // Criar mensagem automática
    const title = 'Novo artista adicionado';
    const body = `Oi {user_name}! Conhece ${artistName}? Temos ${musicCount} músicas deles`;

    const { data: savedMessage, error: msgError } = await supabaseClient
      .from('admin_messages')
      .insert([{
        admin_id: currentAdminUserId,
        title,
        body,
        template_type: 'new_artist',
        created_at: new Date()
      }])
      .select();

    if (msgError) throw msgError;
    const messageId = savedMessage[0].id;

    // Criar registros de entrega
    const deliveryRecords = userIds.map(userId => ({
      message_id: messageId,
      user_id: userId,
      status: 'pending',
      created_at: new Date()
    }));

    await supabaseClient
      .from('message_deliveries')
      .insert(deliveryRecords);

    console.log('[Auto] ✅ Notificação enviada para', userIds.length, 'usuários');
  } catch (e) {
    console.error('[Auto] Erro ao enviar notificação automática:', e);
  }
}

// ========== CARREGAR E LISTAR MENSAGENS ENVIADAS ==========
async function loadMessages() {
  const { data, error } = await supabaseClient
    .from('admin_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Erro ao carregar mensagens:', error);
    return;
  }

  const container = document.getElementById('messagesList');
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="empty-state"><span>💬</span><h3>Nenhuma mensagem enviada</h3></div>';
    return;
  }

  for (const msg of data) {
    const card = document.createElement('div');
    card.className = 'admin-card';
    const date = new Date(msg.created_at).toLocaleDateString('pt-BR');
    card.innerHTML = `
      <h3>${escapeHtml(msg.title)}</h3>
      <p><strong>Data:</strong> ${date}</p>
      <p><strong>Tipo:</strong> ${msg.template_type || 'Personalizada'}</p>
      <p style="margin-top:12px; color:rgba(255,255,255,0.7);">${escapeHtml(msg.body.substring(0, 100))}${msg.body.length > 100 ? '...' : ''}</p>
    `;
    container.appendChild(card);
  }
}

function viewMessageDetails(messageId) {
  alert('Detalhes da mensagem:\nID: ' + messageId);
}
