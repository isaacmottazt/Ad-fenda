import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH_SIZE = 100;

type JsonObject = Record<string, unknown>;

function json(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function splitIntoBatches<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function recipientIdsFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).recipient_ids;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter(Boolean))];
}

async function handlePush(request: Request): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Método não permitido" });

  const internalSecret = Deno.env.get("FENDA_PUSH_EDGE_SECRET");
  if (!internalSecret || request.headers.get("authorization") !== `Bearer ${internalSecret}`) {
    return json(401, { error: "Origem não autorizada" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Configuração Supabase ausente" });

  const input = await request.json().catch(() => null) as { notification_id?: string } | null;
  const notificationId = input?.notification_id;
  if (!notificationId) return json(400, { error: "notification_id é obrigatório" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: notification, error: notificationError } = await supabase
    .from("admin_notifications")
    .select("id,title,body,image_url,deep_link,metadata,status")
    .eq("id", notificationId)
    .maybeSingle();

  if (notificationError || !notification) return json(404, { error: "Comunicado não encontrado" });
  if (notification.status === "cancelled") return json(409, { error: "Comunicado cancelado" });

  const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
  const recipientIds = recipientIdsFromMetadata(metadata);
  const pushEnabled = metadata.send_push !== false;

  // Mesmo sem push, o comunicado deve ficar disponível dentro do aplicativo.
  if (!pushEnabled) {
    await supabase.from("admin_notifications").update({
      status: "sent",
      dispatched_at: new Date().toISOString(),
    }).eq("id", notificationId);
    return json(200, { ok: true, notification_id: notificationId, accepted: 0, push: false });
  }

  let tokenQuery = supabase
    .from("mobile_push_tokens")
    .select("id,user_id,expo_push_token")
    .eq("active", true);
  if (recipientIds.length) tokenQuery = tokenQuery.in("user_id", recipientIds);

  const { data: tokens, error: tokenError } = await tokenQuery;
  if (tokenError) {
    await supabase.from("admin_notifications").update({
      status: "sent",
      dispatched_at: new Date().toISOString(),
      metadata: { ...metadata, push_error: "Não foi possível carregar dispositivos" },
    }).eq("id", notificationId);
    return json(200, { ok: true, notification_id: notificationId, accepted: 0, push: false, in_app: true });
  }

  const validTokens = (tokens ?? []).filter((item: any) =>
    /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(item.expo_push_token),
  );
  const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  const invalidTokenIds: string[] = [];
  let accepted = 0;

  try {
    for (const batch of splitIntoBatches(validTokens, MAX_BATCH_SIZE)) {
      const messages = batch.map((item: any) => ({
        to: item.expo_push_token,
        sound: "default",
        priority: "high",
        title: String(notification.title).slice(0, 120),
        body: String(notification.body ?? "").slice(0, 500),
        data: {
          source: "admin",
          type: "admin",
          notificationId: notification.id,
          url: notification.deep_link ?? null,
          image: notification.image_url ?? null,
          musicId: metadata.musicId ?? null,
        },
      }));

      const expoResponse = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
        },
        body: JSON.stringify(messages),
      });
      const expoResult = await expoResponse.json().catch(() => null) as { data?: any[] } | null;
      if (!expoResponse.ok || !Array.isArray(expoResult?.data)) {
        throw new Error(`Expo Push respondeu ${expoResponse.status}`);
      }

      expoResult.data.forEach((ticket: any, index: number) => {
        if (ticket.status === "ok") accepted += 1;
        if (ticket.details?.error === "DeviceNotRegistered") invalidTokenIds.push(batch[index].id);
      });
    }

    if (invalidTokenIds.length) {
      await supabase.from("mobile_push_tokens").update({ active: false }).in("id", invalidTokenIds);
    }

    // A entrega in-app usa este mesmo estado como confirmação de despacho.
    await supabase.from("admin_notifications").update({
      status: "sent",
      dispatched_at: new Date().toISOString(),
      metadata: { ...metadata, accepted_pushes: accepted },
    }).eq("id", notificationId);

    return json(200, {
      ok: true,
      notification_id: notificationId,
      accepted,
      disabled_tokens: invalidTokenIds.length,
    });
  } catch (error) {
    // A central dentro do app não depende do push nativo. Se o Expo falhar,
    // mantém o comunicado como sent e registra o erro apenas no metadata.
    await supabase.from("admin_notifications").update({
      status: "sent",
      dispatched_at: new Date().toISOString(),
      metadata: { ...metadata, push_error: String(error?.message || error).slice(0, 240) },
    }).eq("id", notificationId);
    console.error("send-fenda-push failed; in-app delivery preserved", error);
    return json(200, { ok: true, notification_id: notificationId, accepted: 0, push: false, in_app: true });
  }
}

Deno.serve(handlePush);
