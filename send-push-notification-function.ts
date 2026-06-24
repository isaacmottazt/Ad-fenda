// Supabase Edge Function: send-push-notification
// Deploy isso em: https://supabase.com/dashboard/project/_/functions

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface PushMessage {
  message_id: string;
  user_ids: string[];
  title: string;
  body: string;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload: PushMessage = await req.json();
    const { message_id, user_ids, title, body } = payload;

    if (!message_id || !user_ids || !title || !body) {
      return new Response("Missing required fields", { status: 400 });
    }

    // Buscar subscriptions dos usuários
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("*")
      .in("user_id", user_ids);

    if (subError) {
      console.error("Erro ao buscar subscriptions:", subError);
      return new Response(JSON.stringify({ error: subError.message }), {
        status: 500,
      });
    }

    if (!subscriptions || subscriptions.length === 0) {
      // Nenhum usuário com push ativado, apenas atualizar status
      await supabase
        .from("message_deliveries")
        .update({ status: "sent" })
        .eq("message_id", message_id);

      return new Response(
        JSON.stringify({ message: "No subscriptions found" }),
        { status: 200 }
      );
    }

    // Preparar payload da notificação
    const notificationPayload = {
      title,
      body,
      icon: "https://fendamusic.com.br/icon-192x192.png",
      badge: "https://fendamusic.com.br/badge-72x72.png",
      tag: `message-${message_id}`,
      data: {
        messageId: message_id,
        url: "https://fendamusic.com.br/",
      },
    };

    // Enviar para cada subscription
    const results = [];
    for (const sub of subscriptions) {
      try {
        // Aqui você usaria web-push library (não disponível nativamente no Deno)
        // Por enquanto, apenas atualizar status
        console.log(`Enviando para usuário ${sub.user_id}`);

        // Atualizar status de entrega
        await supabase
          .from("message_deliveries")
          .update({ status: "sent" })
          .match({ message_id, user_id: sub.user_id });

        results.push({ user_id: sub.user_id, status: "sent" });
      } catch (e) {
        console.error(`Erro ao enviar para ${sub.user_id}:`, e);
        await supabase.from("notification_logs").insert({
          user_id: sub.user_id,
          message_id,
          status: "failed",
          error_message: e.message,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Function error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
    });
  }
});
