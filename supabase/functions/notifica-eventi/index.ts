// supabase/functions/notifica-eventi/index.ts
//
// Notifiche push per eventi (migrazione 0098):
//   - tipo "partita_live":  una partita è passata a "in corso". Destinatari: membri della squadra della partita e
//                           presidenti in carica della sua società che hanno acceso "Partita in diretta".
//   - tipo "convocazioni":  la distinta di una partita è stata pubblicata/aggiornata. Destinatarie: le atlete (con
//                           account) aggiunte o tolte rispetto all'ultimo invio che hanno acceso "Convocazioni".
//
// Chi la chiama: il database stesso (trigger/pg_cron + pg_net, vedi 0098), con
//   - Authorization: Bearer <chiave pubblicabile>  -> serve solo al gateway Supabase, come per le altre funzioni;
//   - x-notifiche-secret: <segreto condiviso>      -> è questo che autorizza davvero la richiesta.
// In alternativa si accetta come bearer la chiave di servizio. Qualsiasi altra richiesta riceve 401: a differenza
// di notifica-certificati, qui il chiamante sceglie la partita, quindi non basta un JWT qualunque del progetto.
//
// Segreti della funzione (mai nel repository):
//   supabase secrets set VAPID_PRIVATE_JWK='{"kty":"EC","crv":"P-256",...}'   (già impostato per i certificati)
//   supabase secrets set NOTIFICHE_EVENTI_SECRET='<stringa casuale lunga>'     (uguale al secret Vault
//                                                                              "notifiche_eventi_secret")
//
// Rispetto di ruoli/RLS: la funzione usa la chiave di servizio (salta la RLS) ma i destinatari sono ricavati solo da
// team_members / societa_presidenti / preferenze_notifiche, cioè dalle stesse relazioni su cui si basano le regole
// di accesso, e il testo delle notifiche contiene solo squadra, avversario e data della partita (visibili a tutti i
// destinatari). Nessun dato personale di altre persone viene incluso.
//
// Invio push: stessa libreria e stesso schema di notifica-certificati.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushHTTPRequest } from "npm:@pushforge/builder@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PRIVATE_JWK_RAW = Deno.env.get("VAPID_PRIVATE_JWK");
const SEGRETO_CONDIVISO = Deno.env.get("NOTIFICHE_EVENTI_SECRET");
const VAPID_ADMIN_CONTACT = "mailto:lil.liu91@gmail.com";
const BASE_URL_WEB = "/AIVolleyballCoach";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region, accept, x-notifiche-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tipo = "partita_live" | "convocazioni";

interface MatchRow {
  id: string;
  team_id: string;
  avversario: string;
  data: string;
  stato: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  chiave_p256dh: string;
  chiave_auth: string;
}

interface Payload {
  title: string;
  body: string;
  url: string;
}

type Admin = ReturnType<typeof createClient>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

/** Confronto a tempo costante tra due stringhe. */
function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function autorizzata(req: Request): boolean {
  const bearer = req.headers.get("authorization") ?? "";
  if (SERVICE_ROLE_KEY && uguali(bearer, `Bearer ${SERVICE_ROLE_KEY}`)) return true;
  const segreto = req.headers.get("x-notifiche-secret") ?? "";
  return !!SEGRETO_CONDIVISO && segreto.length > 0 && uguali(segreto, SEGRETO_CONDIVISO);
}

function dataLeggibile(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      timeZone: "Europe/Rome",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

async function invia(sub: SubscriptionRow, payload: Payload, admin: Admin): Promise<boolean> {
  if (!VAPID_PRIVATE_JWK_RAW) return false;
  try {
    const { endpoint, headers, body } = await buildPushHTTPRequest({
      privateJWK: JSON.parse(VAPID_PRIVATE_JWK_RAW),
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.chiave_p256dh, auth: sub.chiave_auth } },
      message: {
        payload,
        adminContact: VAPID_ADMIN_CONTACT,
        options: { ttl: 60 * 60 * 6, urgency: "high" },
      },
    });
    const risposta = await fetch(endpoint, { method: "POST", headers, body });
    if (risposta.status === 404 || risposta.status === 410) {
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
    }
    return risposta.ok;
  } catch (e) {
    console.error("Invio push fallito per abbonamento", sub.id, e);
    return false;
  }
}

/** Utenti con la preferenza accesa per il tipo indicato, tra quelli candidati. */
async function utentiConPreferenza(admin: Admin, tipo: Tipo, candidati: string[]): Promise<string[]> {
  if (candidati.length === 0) return [];
  const { data, error } = await admin
    .from("preferenze_notifiche")
    .select("user_id")
    .eq("tipo", tipo)
    .eq("attiva", true)
    .in("user_id", candidati);
  if (error) {
    console.error("Lettura preferenze fallita (migrazione 0098 applicata?)", error.message);
    return [];
  }
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

async function abbonamentiDi(admin: Admin, utenti: string[]): Promise<Map<string, SubscriptionRow[]>> {
  const mappa = new Map<string, SubscriptionRow[]>();
  if (utenti.length === 0) return mappa;
  const { data } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, chiave_p256dh, chiave_auth")
    .in("user_id", utenti);
  for (const s of (data ?? []) as SubscriptionRow[]) {
    const lista = mappa.get(s.user_id) ?? [];
    lista.push(s);
    mappa.set(s.user_id, lista);
  }
  return mappa;
}

/** Invia un payload per utente (ogni utente può avere più dispositivi). Restituisce {inviate, fallite}. */
async function inviaAUtenti(
  admin: Admin,
  destinatari: Map<string, Payload>,
): Promise<{ inviate: number; fallite: number }> {
  const abbonamenti = await abbonamentiDi(admin, [...destinatari.keys()]);
  let inviate = 0;
  let fallite = 0;
  const invii: Promise<void>[] = [];
  for (const [uid, payload] of destinatari) {
    for (const sub of abbonamenti.get(uid) ?? []) {
      invii.push(
        invia(sub, payload, admin).then((ok) => {
          if (ok) inviate++;
          else fallite++;
        }),
      );
    }
  }
  await Promise.all(invii);
  return { inviate, fallite };
}

async function caricaPartita(admin: Admin, matchId: string): Promise<{ match: MatchRow; nomeSquadra: string; societaId: string | null } | null> {
  const { data: match } = await admin
    .from("matches")
    .select("id, team_id, avversario, data, stato")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) return null;
  const { data: team } = await admin.from("teams").select("nome, societa_id").eq("id", (match as MatchRow).team_id).maybeSingle();
  return {
    match: match as MatchRow,
    nomeSquadra: (team as { nome?: string } | null)?.nome ?? "La tua squadra",
    societaId: (team as { societa_id?: string | null } | null)?.societa_id ?? null,
  };
}

// ── Partita in diretta ───────────────────────────────────────────────────────────────────────────────────────
async function notificaPartitaLive(admin: Admin, matchId: string) {
  const info = await caricaPartita(admin, matchId);
  if (!info) return { messaggio: "Partita non trovata." };
  const { match, nomeSquadra, societaId } = info;
  if (match.stato !== "in_corso") return { messaggio: "La partita non è in corso: nessuna notifica." };

  const candidati = new Set<string>();
  const { data: membri } = await admin.from("team_members").select("user_id").eq("team_id", match.team_id);
  for (const m of (membri ?? []) as { user_id: string }[]) candidati.add(m.user_id);
  if (societaId) {
    const { data: presidenti } = await admin
      .from("societa_presidenti")
      .select("user_id")
      .eq("societa_id", societaId)
      .is("fine_mandato", null);
    for (const p of (presidenti ?? []) as { user_id: string }[]) candidati.add(p.user_id);
  }

  const abilitati = await utentiConPreferenza(admin, "partita_live", [...candidati]);
  const payload: Payload = {
    title: "Partita in diretta",
    body: `${nomeSquadra} - ${match.avversario}: la partita è iniziata.`,
    url: `${BASE_URL_WEB}/live`,
  };
  const destinatari = new Map<string, Payload>(abilitati.map((uid) => [uid, payload]));
  const esito = await inviaAUtenti(admin, destinatari);
  return { destinatari: destinatari.size, ...esito };
}

// ── Convocazioni ─────────────────────────────────────────────────────────────────────────────────────────────
async function notificaConvocazioni(admin: Admin, matchId: string) {
  const info = await caricaPartita(admin, matchId);
  if (!info) return { messaggio: "Partita non trovata." };
  const { match, nomeSquadra } = info;
  if (match.stato === "conclusa") return { messaggio: "Partita conclusa: nessuna notifica." };

  const { data: righe } = await admin.from("match_convocati").select("athlete_id").eq("match_id", matchId);
  const attuali = new Set<string>(((righe ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id));

  const { data: coda } = await admin
    .from("notifiche_eventi_coda")
    .select("atlete_notificate")
    .eq("tipo", "convocazioni")
    .eq("match_id", matchId)
    .maybeSingle();
  const precedenti = new Set<string>(((coda as { atlete_notificate?: string[] } | null)?.atlete_notificate) ?? []);

  const aggiunte = [...attuali].filter((id) => !precedenti.has(id));
  const tolte = [...precedenti].filter((id) => !attuali.has(id));

  let esito = { inviate: 0, fallite: 0 };
  let destinatariTotali = 0;

  if (aggiunte.length + tolte.length > 0) {
    const { data: collegamenti } = await admin
      .from("team_members")
      .select("user_id, atleta_id")
      .eq("team_id", match.team_id)
      .eq("ruolo", "atleta")
      .in("atleta_id", [...aggiunte, ...tolte]);
    const utentePerAtleta = new Map<string, string[]>();
    for (const c of (collegamenti ?? []) as { user_id: string; atleta_id: string }[]) {
      const lista = utentePerAtleta.get(c.atleta_id) ?? [];
      lista.push(c.user_id);
      utentePerAtleta.set(c.atleta_id, lista);
    }

    const tutti = [...new Set([...utentePerAtleta.values()].flat())];
    const abilitati = new Set(await utentiConPreferenza(admin, "convocazioni", tutti));

    const quando = dataLeggibile(match.data);
    const dettaglio = `${nomeSquadra} - ${match.avversario}${quando ? `, ${quando}` : ""}`;
    const url = `${BASE_URL_WEB}/partita/${match.id}`;
    const destinatari = new Map<string, Payload>();
    for (const id of aggiunte) {
      for (const uid of utentePerAtleta.get(id) ?? []) {
        if (abilitati.has(uid)) destinatari.set(uid, { title: "Convocazione", body: `Sei in lista per ${dettaglio}.`, url });
      }
    }
    for (const id of tolte) {
      for (const uid of utentePerAtleta.get(id) ?? []) {
        if (abilitati.has(uid) && !destinatari.has(uid)) {
          destinatari.set(uid, { title: "Convocazione aggiornata", body: `Non sei più in lista per ${dettaglio}.`, url });
        }
      }
    }
    destinatariTotali = destinatari.size;
    esito = await inviaAUtenti(admin, destinatari);
  }

  // Ricorda chi era in lista a questo invio, così il prossimo aggiornamento avvisa solo le differenze.
  // Senza chiave VAPID non si aggiorna: nulla è stato davvero consegnato.
  if (VAPID_PRIVATE_JWK_RAW) {
    await admin
      .from("notifiche_eventi_coda")
      .update({ atlete_notificate: [...attuali] })
      .eq("tipo", "convocazioni")
      .eq("match_id", matchId);
  }
  return { aggiunte: aggiunte.length, tolte: tolte.length, destinatari: destinatariTotali, ...esito };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ errore: true, messaggio: "Metodo non consentito." }, 405);
  if (!autorizzata(req)) return jsonResponse({ errore: true, messaggio: "Non autorizzato." }, 401);

  let corpo: { tipo?: string; match_id?: string } = {};
  try {
    corpo = await req.json();
  } catch {
    return jsonResponse({ errore: true, messaggio: "Corpo della richiesta non valido." }, 400);
  }
  const tipo = corpo.tipo;
  const matchId = corpo.match_id;
  if ((tipo !== "partita_live" && tipo !== "convocazioni") || typeof matchId !== "string" || !UUID_RE.test(matchId)) {
    return jsonResponse({ errore: true, messaggio: "Parametri non validi." }, 400);
  }

  if (!VAPID_PRIVATE_JWK_RAW) {
    console.warn("VAPID_PRIVATE_JWK non impostato: nessuna notifica verrà inviata.");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const esito = tipo === "partita_live" ? await notificaPartitaLive(admin, matchId) : await notificaConvocazioni(admin, matchId);
    return jsonResponse({ errore: false, tipo, vapidConfigurato: !!VAPID_PRIVATE_JWK_RAW, ...esito });
  } catch (e) {
    console.error("notifica-eventi fallita", e);
    return jsonResponse({ errore: true, messaggio: "Invio notifiche non riuscito." }, 500);
  }
});
