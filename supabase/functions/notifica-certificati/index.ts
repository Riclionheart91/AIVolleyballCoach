// supabase/functions/notifica-certificati/index.ts
//
// Notifica push settimanale (venerdì mattina, vedi cron.job
// "notifica_certificati_venerdi" nella migrazione 0064) sui certificati
// medici scaduti o in scadenza entro 30 giorni (stessa soglia del
// centro notifiche in-app, src/services/notifiche.ts).
//
// - Allenatore e vice-allenatore di una squadra ricevono UNA notifica
//   con l'elenco di tutte le atlete della loro squadra interessate.
// - Ogni atleta riceve una notifica solo per il PROPRIO certificato.
//
// Invocata dal database stesso (pg_cron + pg_net, vedi 0064), con la
// chiave anon come bearer — è il pattern raccomandato da Supabase per
// gli scheduled job (https://supabase.com/docs/guides/functions/schedule-functions):
// verify_jwt controlla solo che il token sia un JWT valido del
// progetto, non serve una sessione utente reale, quindi qui non si fa
// nessun controllo su chi chiama.
//
// Invio push: libreria "@pushforge/builder", zero-dipendenze e basata
// sulla sola Web Crypto API — a differenza del pacchetto "web-push" più
// diffuso, che su Deno ha un bug noto di cifratura AES-GCM che rompe la
// decodifica lato browser (https://github.com/denoland/deno/issues/23693).
//
// Chiave privata VAPID: NON è in questo file (finirebbe nel repository
// Git dell'utente al prossimo "pubblica_aggiornamento.sh", che copia
// anche supabase/functions/). Va impostata una sola volta come secret
// della funzione con:
//   supabase secrets set VAPID_PRIVATE_JWK='{"kty":"EC","crv":"P-256",...}'
// La chiave pubblica invece non è un segreto (serve anche al browser
// per l'iscrizione) ed è la stessa hardcoded in src/config.ts.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushHTTPRequest } from "npm:@pushforge/builder@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PRIVATE_JWK_RAW = Deno.env.get("VAPID_PRIVATE_JWK");
const VAPID_ADMIN_CONTACT = "mailto:lil.liu91@gmail.com";
const BASE_URL_WEB = "/AIVolleyballCoach";
const GIORNI_PREAVVISO_CERTIFICATO = 30; // stessa soglia di src/services/notifiche.ts

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region, accept",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface AthleteRow {
  id: string;
  team_id: string;
  nome: string;
  cognome: string;
  scadenza_certificato_medico: string;
}

interface TeamMemberRow {
  user_id: string;
  team_id: string;
  ruolo: string;
  atleta_id: string | null;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  chiave_p256dh: string;
  chiave_auth: string;
}

function formattaScadenza(iso: string): string {
  const d = new Date(iso);
  const oggi = new Date();
  const testo = d.toLocaleDateString("it-IT");
  return d < oggi ? `scaduto il ${testo}` : `scade il ${testo}`;
}

async function invia(sub: SubscriptionRow, payload: unknown, admin: ReturnType<typeof createClient>): Promise<boolean> {
  if (!VAPID_PRIVATE_JWK_RAW) return false;
  try {
    const { endpoint, headers, body } = await buildPushHTTPRequest({
      privateJWK: JSON.parse(VAPID_PRIVATE_JWK_RAW),
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.chiave_p256dh, auth: sub.chiave_auth } },
      message: {
        payload,
        adminContact: VAPID_ADMIN_CONTACT,
        options: { ttl: 60 * 60 * 24 * 3, urgency: "normal" },
      },
    });
    const risposta = await fetch(endpoint, { method: "POST", headers, body });
    if (risposta.status === 404 || risposta.status === 410) {
      // Abbonamento non più valido (utente ha disinstallato/revocato): lo rimuoviamo.
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (!VAPID_PRIVATE_JWK_RAW) {
    console.warn("VAPID_PRIVATE_JWK non impostato: nessuna notifica verrà inviata. Vedi il commento in testa a questo file.");
  }

  const oggi = new Date();
  const soglia = new Date(oggi.getTime() + GIORNI_PREAVVISO_CERTIFICATO * 24 * 60 * 60 * 1000);

  const { data: atlete, error: erroreAtlete } = await admin
    .from("athletes")
    .select("id, team_id, nome, cognome, scadenza_certificato_medico")
    .eq("status", "attiva")
    .not("scadenza_certificato_medico", "is", null)
    .lte("scadenza_certificato_medico", soglia.toISOString().slice(0, 10));

  if (erroreAtlete) return jsonResponse({ errore: true, messaggio: erroreAtlete.message }, 500);

  const atleteInteressate = (atlete ?? []) as AthleteRow[];
  if (atleteInteressate.length === 0) {
    return jsonResponse({ errore: false, messaggio: "Nessun certificato in scadenza: nessuna notifica da inviare." });
  }

  const teamIds = [...new Set(atleteInteressate.map((a) => a.team_id))];

  const [{ data: teams }, { data: membri }, { data: abbonamenti }] = await Promise.all([
    admin.from("teams").select("id, nome").in("id", teamIds),
    admin.from("team_members").select("user_id, team_id, ruolo, atleta_id").in("team_id", teamIds),
    admin.from("push_subscriptions").select("id, user_id, endpoint, chiave_p256dh, chiave_auth"),
  ]);

  const nomeTeam = new Map((teams ?? []).map((t: { id: string; nome: string }) => [t.id, t.nome]));
  const membriRighe = (membri ?? []) as TeamMemberRow[];
  const abbonamentiPerUtente = new Map<string, SubscriptionRow[]>();
  for (const s of (abbonamenti ?? []) as SubscriptionRow[]) {
    const lista = abbonamentiPerUtente.get(s.user_id) ?? [];
    lista.push(s);
    abbonamentiPerUtente.set(s.user_id, lista);
  }

  const atletePerTeam = new Map<string, AthleteRow[]>();
  for (const a of atleteInteressate) {
    const lista = atletePerTeam.get(a.team_id) ?? [];
    lista.push(a);
    atletePerTeam.set(a.team_id, lista);
  }

  let inviate = 0;
  let fallite = 0;
  const invii: Promise<void>[] = [];

  function accoda(sub: SubscriptionRow, payload: unknown) {
    invii.push(
      invia(sub, payload, admin).then((ok) => {
        if (ok) inviate++;
        else fallite++;
      }),
    );
  }

  for (const [teamId, atleteSquadra] of atletePerTeam) {
    const nome = nomeTeam.get(teamId) ?? "la tua squadra";

    // Notifica aggregata per allenatore/vice-allenatore.
    const righeElenco = atleteSquadra
      .slice(0, 15)
      .map((a) => `${a.nome} ${a.cognome} — ${formattaScadenza(a.scadenza_certificato_medico)}`);
    const extra = atleteSquadra.length > 15 ? ` e altre ${atleteSquadra.length - 15}` : "";
    const payloadStaff = {
      title: `Certificati in scadenza — ${nome}`,
      body: righeElenco.join("\n") + extra,
      url: `${BASE_URL_WEB}/(tabs)/atlete`,
    };
    const staffUserIds = membriRighe
      .filter((m) => m.team_id === teamId && (m.ruolo === "allenatore" || m.ruolo === "vice_allenatore"))
      .map((m) => m.user_id);
    for (const uid of new Set(staffUserIds)) {
      for (const sub of abbonamentiPerUtente.get(uid) ?? []) accoda(sub, payloadStaff);
    }

    // Notifica personale per ciascuna atleta.
    for (const a of atleteSquadra) {
      const membroAtleta = membriRighe.filter((m) => m.team_id === teamId && m.ruolo === "atleta" && m.atleta_id === a.id);
      const payloadAtleta = {
        title: "Certificato medico in scadenza",
        body: `Il tuo certificato medico ${formattaScadenza(a.scadenza_certificato_medico)}.`,
        url: `${BASE_URL_WEB}/atleta/${a.id}`,
      };
      for (const m of membroAtleta) {
        for (const sub of abbonamentiPerUtente.get(m.user_id) ?? []) accoda(sub, payloadAtleta);
      }
    }
  }

  await Promise.all(invii);

  return jsonResponse({
    errore: false,
    atleteInteressate: atleteInteressate.length,
    squadreCoinvolte: atletePerTeam.size,
    notifichePushInviate: inviate,
    notifichePushFallite: fallite,
    vapidConfigurato: !!VAPID_PRIVATE_JWK_RAW,
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}
