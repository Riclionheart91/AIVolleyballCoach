// supabase/functions/notifica-reset-accesso/index.ts
//
// Push immediata quando qualcuno chiede il reset dell'accesso (tabella richieste_reset_accesso,
// migrazione 0093). La chiama il trigger del database con la chiave anon come bearer, con lo stesso
// schema di notifica-certificati (pg_net, vedi 0064): verify_jwt controlla solo che il token sia un
// JWT valido del progetto, quindi qui non si verifica chi chiama.
//
// Destinatari:
//   - richiesta di un'atleta (ambito 'atleta'): allenatore e vice-allenatore della squadra;
//   - richiesta di uno staff (ambito 'staff'): presidenti e co-presidenti in carica della società
//     (societa_presidenti con fine_mandato nulla) e superuser (app_admins).
//   Non si manda mai a chi ha fatto la richiesta.
//
// Secret necessario: VAPID_PRIVATE_JWK, lo stesso di notifica-certificati
//   supabase secrets set VAPID_PRIVATE_JWK='{"kty":"EC","crv":"P-256",...}'
// Deploy:  supabase functions deploy notifica-reset-accesso
// Il push arriva solo a chi ha attivato le notifiche su un dispositivo (push_subscriptions).
//
// Richiesta (POST, JSON): { richiesta_id: string }
// Risposta: { errore: false, destinatari, inviate, fallite }.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushHTTPRequest } from "npm:@pushforge/builder@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PRIVATE_JWK_RAW = Deno.env.get("VAPID_PRIVATE_JWK");
const VAPID_ADMIN_CONTACT = "mailto:lil.liu91@gmail.com";
const BASE_URL_WEB = "/AIVolleyballCoach";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RichiestaReset {
  id: string;
  team_id: string | null;
  societa_id: string | null;
  ambito: "atleta" | "staff";
  atleta_id: string | null;
  user_id: string | null;
  email: string | null;
  nome: string | null;
  stato: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  chiave_p256dh: string;
  chiave_auth: string;
}

type Admin = ReturnType<typeof createClient>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function invia(sub: SubscriptionRow, payload: unknown, admin: Admin): Promise<boolean> {
  if (!VAPID_PRIVATE_JWK_RAW) return false;
  try {
    const { endpoint, headers, body } = await buildPushHTTPRequest({
      privateJWK: JSON.parse(VAPID_PRIVATE_JWK_RAW),
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.chiave_p256dh, auth: sub.chiave_auth } },
      message: {
        payload,
        adminContact: VAPID_ADMIN_CONTACT,
        // Una richiesta di reset è urgente: l'atleta aspetta. Scade dopo 3 giorni, come i certificati.
        options: { ttl: 60 * 60 * 24 * 3, urgency: "high" },
      },
    });
    const risposta = await fetch(endpoint, { method: "POST", headers, body });
    if (risposta.status === 404 || risposta.status === 410) {
      // Abbonamento non più valido (app disinstallata o permesso revocato): lo rimuoviamo.
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
    }
    return risposta.ok;
  } catch (e) {
    console.error("Invio push fallito per abbonamento", sub.id, e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ errore: true, messaggio: "Metodo non consentito." }, 405);

  let richiestaId = "";
  try {
    const corpo = await req.json();
    richiestaId = typeof corpo?.richiesta_id === "string" ? corpo.richiesta_id : "";
  } catch {
    /* corpo mancante: gestito sotto */
  }
  if (!richiestaId) return jsonResponse({ errore: true, messaggio: "richiesta_id mancante." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  if (!VAPID_PRIVATE_JWK_RAW) {
    console.warn("VAPID_PRIVATE_JWK non impostato: nessuna notifica verrà inviata. Vedi il commento in testa a questo file.");
  }

  const { data: riga, error: errRichiesta } = await admin.from("richieste_reset_accesso").select("*").eq("id", richiestaId).maybeSingle();
  if (errRichiesta) return jsonResponse({ errore: true, messaggio: errRichiesta.message }, 500);
  const richiesta = riga as RichiestaReset | null;
  if (!richiesta) return jsonResponse({ errore: true, messaggio: "Richiesta non trovata." }, 404);
  // Già gestita (o annullata) nel frattempo: niente da notificare.
  if (richiesta.stato !== "in_attesa") return jsonResponse({ errore: false, destinatari: 0, inviate: 0, fallite: 0, messaggio: "Richiesta non più in attesa." });

  let nomeTeam = "la tua squadra";
  if (richiesta.team_id) {
    const { data: team } = await admin.from("teams").select("nome").eq("id", richiesta.team_id).maybeSingle();
    if (team?.nome) nomeTeam = team.nome as string;
  }

  // ── Destinatari ──
  const destinatari = new Set<string>();
  if (richiesta.ambito === "atleta") {
    if (richiesta.team_id) {
      const { data: staff } = await admin
        .from("team_members")
        .select("user_id")
        .eq("team_id", richiesta.team_id)
        .in("ruolo", ["allenatore", "vice_allenatore"]);
      for (const m of (staff ?? []) as { user_id: string }[]) destinatari.add(m.user_id);
    }
  } else {
    if (richiesta.societa_id) {
      const { data: presidenti } = await admin
        .from("societa_presidenti")
        .select("user_id")
        .eq("societa_id", richiesta.societa_id)
        .is("fine_mandato", null);
      for (const p of (presidenti ?? []) as { user_id: string }[]) destinatari.add(p.user_id);
    }
    const { data: admins } = await admin.from("app_admins").select("user_id");
    for (const a of (admins ?? []) as { user_id: string }[]) destinatari.add(a.user_id);
  }
  // Chi ha fatto la richiesta non riceve il proprio push (vale per lo staff che ha già un account).
  if (richiesta.user_id) destinatari.delete(richiesta.user_id);

  if (destinatari.size === 0) return jsonResponse({ errore: false, destinatari: 0, inviate: 0, fallite: 0 });

  const { data: abbonamenti } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, chiave_p256dh, chiave_auth")
    .in("user_id", [...destinatari]);

  const nome = (richiesta.nome ?? "").trim() || "Una persona";
  const payload = {
    title: "Richiesta di reset accesso",
    body: `${nome} (${nomeTeam}) chiede un nuovo link di accesso`,
    url: `${BASE_URL_WEB}/notifiche`,
  };

  let inviate = 0;
  let fallite = 0;
  await Promise.all(
    ((abbonamenti ?? []) as SubscriptionRow[]).map((sub) =>
      invia(sub, payload, admin).then((ok) => {
        if (ok) inviate++;
        else fallite++;
      }),
    ),
  );

  return jsonResponse({ errore: false, destinatari: destinatari.size, inviate, fallite, vapidConfigurato: !!VAPID_PRIVATE_JWK_RAW });
});
