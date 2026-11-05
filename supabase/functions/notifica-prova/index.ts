// supabase/functions/notifica-prova/index.ts
//
// "Invia una notifica di prova": manda una notifica push ai dispositivi iscritti di CHI chiama (e di nessun altro).
// Serve a controllare che le notifiche arrivino davvero sul telefono. Richiede un utente autenticato (verify_jwt):
// l'utente si ricava dal suo token, non dal corpo della richiesta.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushHTTPRequest } from "npm:@pushforge/builder@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_ADMIN_CONTACT = "mailto:lil.liu91@gmail.com";
const BASE_URL_WEB = "/AIVolleyballCoach";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function risposta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return risposta({ errore: true, messaggio: "Metodo non consentito." }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: utente } = await admin.auth.getUser(token);
  if (!utente?.user || (utente.user as { is_anonymous?: boolean }).is_anonymous) {
    return risposta({ errore: true, messaggio: "Devi essere autenticato." }, 401);
  }

  let chiave: string | null = Deno.env.get("VAPID_PRIVATE_JWK") ?? null;
  if (!chiave) {
    const { data } = await admin.rpc("leggi_vapid_privata");
    chiave = typeof data === "string" && data.length > 0 ? data : null;
  }
  if (!chiave) return risposta({ errore: true, messaggio: "Le notifiche push non sono ancora configurate sul server." }, 503);

  const { data: abbonamenti } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, chiave_p256dh, chiave_auth")
    .eq("user_id", utente.user.id);
  const lista = (abbonamenti ?? []) as { id: string; endpoint: string; chiave_p256dh: string; chiave_auth: string }[];
  if (lista.length === 0) return risposta({ errore: true, messaggio: "Nessun dispositivo iscritto: attiva prima le notifiche su questo telefono." }, 404);

  let inviate = 0;
  let fallite = 0;
  await Promise.all(lista.map(async (sub) => {
    try {
      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK: JSON.parse(chiave!),
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.chiave_p256dh, auth: sub.chiave_auth } },
        message: {
          payload: { title: "Notifica di prova", body: "Funziona! Le notifiche di AI Volleyball Coach arrivano su questo dispositivo.", url: `${BASE_URL_WEB}/` },
          adminContact: VAPID_ADMIN_CONTACT,
          options: { ttl: 60 * 10, urgency: "high" },
        },
      });
      const esito = await fetch(endpoint, { method: "POST", headers, body });
      if (esito.status === 404 || esito.status === 410) await admin.from("push_subscriptions").delete().eq("id", sub.id);
      if (esito.ok) inviate++; else fallite++;
    } catch (e) {
      console.error("Invio di prova fallito", sub.id, e);
      fallite++;
    }
  }));

  return risposta({ errore: false, inviate, fallite });
});
