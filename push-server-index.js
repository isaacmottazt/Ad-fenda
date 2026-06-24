// ========== PUSH NOTIFICATION SERVER ==========
// Deploy em: Render.com, Railway.app, ou seu VPS
// Arquivo: index.js (ou server.js)

const express = require('express');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// ========== CONFIGURAÇÕES ==========
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'seu-email@exemplo.com';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Usar SERVICE ROLE KEY!

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ VAPID keys não configuradas!');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Supabase não configurado!');
  process.exit(1);
}

// Configurar web-push
webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Cliente Supabase (com SERVICE ROLE para acesso total)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ========== ENVIAR PUSH NOTIFICATIONS ==========
app.post('/send-push', async (req, res) => {
  try {
    const { message_id, user_ids, title, body } = req.body;

    if (!message_id || !user_ids || !title || !body) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    console.log(`\n📤 [PUSH] Enviando para ${user_ids.length} usuários...`);

    // Buscar subscriptions dos usuários
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', user_ids);

    if (subError) {
      console.error('❌ Erro ao buscar subscriptions:', subError);
      return res.status(500).json({ error: subError.message });
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('⚠️ Nenhuma subscription encontrada');
      
      // Mesmo assim, marcar como "sent" (será entregue no polling)
      await supabase
        .from('message_deliveries')
        .update({ status: 'sent' })
        .eq('message_id', message_id);

      return res.json({ 
        message: 'Nenhuma subscription push, mas mensagem foi salva para polling',
        sent: 0 
      });
    }

    // Payload da notificação
    const notificationPayload = {
      title,
      body,
      icon: 'https://fendamusic.com.br/icon-192x192.png',
      badge: 'https://fendamusic.com.br/badge-72x72.png',
      tag: `message-${message_id}`,
      data: {
        messageId: message_id,
        url: 'https://fendamusic.com.br/'
      }
    };

    // Enviar para cada subscription
    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        await webpush.sendNotification(pushSubscription, JSON.stringify(notificationPayload));
        sent++;
        console.log(`✅ Enviado para usuário ${sub.user_id}`);

        // Registrar sucesso
        await supabase.from('notification_logs').insert({
          user_id: sub.user_id,
          message_id,
          status: 'sent'
        });

        // Atualizar status de entrega
        await supabase
          .from('message_deliveries')
          .update({ status: 'sent' })
          .match({ message_id, user_id: sub.user_id });

      } catch (e) {
        failed++;
        console.error(`❌ Erro ao enviar para ${sub.user_id}:`, e.message);

        // Registrar falha
        await supabase.from('notification_logs').insert({
          user_id: sub.user_id,
          message_id,
          status: 'failed',
          error_message: e.message
        });

        // Se subscription inválida (410), deletar
        if (e.statusCode === 410) {
          console.log(`🗑️ Deletando subscription inválida para ${sub.user_id}`);
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('user_id', sub.user_id);
        }
      }
    }

    console.log(`\n📊 Resultado: ${sent} enviadas, ${failed} falhadas`);

    res.json({
      success: true,
      message_id,
      sent,
      failed,
      total: subscriptions.length
    });

  } catch (e) {
    console.error('❌ Erro na requisição:', e);
    res.status(500).json({ error: e.message });
  }
});

// ========== DISPARAR PUSH AUTOMÁTICO (chamar do admin) ==========
app.post('/trigger-push', async (req, res) => {
  try {
    const { message_id } = req.body;

    if (!message_id) {
      return res.status(400).json({ error: 'message_id obrigatório' });
    }

    // Buscar mensagem
    const { data: message, error: msgError } = await supabase
      .from('admin_messages')
      .select('*')
      .eq('id', message_id)
      .single();

    if (msgError || !message) {
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }

    // Buscar usuários que devem receber
    const { data: deliveries, error: delError } = await supabase
      .from('message_deliveries')
      .select('user_id')
      .eq('message_id', message_id)
      .eq('status', 'pending');

    if (delError) {
      return res.status(500).json({ error: delError.message });
    }

    const user_ids = deliveries.map(d => d.user_id);

    // Chamar função de envio
    return res.json(await sendPushNotifications(message_id, user_ids, message.title, message.body));

  } catch (e) {
    console.error('❌ Erro:', e);
    res.status(500).json({ error: e.message });
  }
});

async function sendPushNotifications(message_id, user_ids, title, body) {
  // Buscar subscriptions
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', user_ids);

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, message: 'Nenhuma subscription' };
  }

  const payload = {
    title,
    body,
    icon: 'https://fendamusic.com.br/icon-192x192.png',
    data: { messageId: message_id }
  };

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e) {
      console.error('Erro:', e.message);
    }
  }

  return { sent, total: subscriptions.length };
}

// ========== LISTAR SUBSCRIPTIONS (DEBUG) ==========
app.get('/subscriptions/:user_id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, created_at')
      .eq('user_id', req.params.user_id);

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== PORTA E LISTEN ==========
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Push Notification Server rodando em http://localhost:${PORT}`);
  console.log(`✅ VAPID público: ${VAPID_PUBLIC_KEY.substring(0, 20)}...`);
  console.log(`✅ Supabase: ${SUPABASE_URL}\n`);
});
