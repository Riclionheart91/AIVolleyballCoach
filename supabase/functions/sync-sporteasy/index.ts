// supabase/functions/sync-sporteasy/index.ts
//
// Equivalente di SportEasySync.gs. Fa SOLO import di eventi
// (allenamenti/partite) dal calendario iCal della squadra — mai
// anagrafica atlete, come da richiesta esplicita.
//
// Deploy: supabase functions deploy sync-sporteasy
// (nessun secret da configurare: il link iCal non è segreto, è
// salvato in team_integrations e leggibile da chiunque abbia il link
// — esattamente come funzionava il webcal:// originale.)
//
// Parser ICS scritto a mano (niente librerie esterne): il formato
// iCal è abbastanza regolare da non giustificare una dipendenza pesante
// solo per estrarre UID/SUMMARY/DTSTART da un feed di sola lettura.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VEvent {
  uid: string;
  summary: string;
  dataInizio: string; // ISO
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ errore: true, messaggio: "Sessione non valida." }, 401);

    const { team_id } = await req.json();
    if (!team_id) return jsonResponse({ errore: true, messaggio: "team_id mancante." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: membro } = await admin.from("team_members").select("ruolo").eq("team_id", team_id).eq("user_id", userData.user.id).maybeSingle();
    if (!membro || !["allenatore", "vice_allenatore"].includes(membro.ruolo)) {
      return jsonResponse({ errore: true, messaggio: "Utente non autorizzato su questo team." }, 403);
    }

    const { data: integrazione } = await admin.from("team_integrations").select("*").eq("team_id", team_id).maybeSingle();
    if (!integrazione?.sporteasy_ical_url) {
      return jsonResponse({ errore: true, messaggio: "Nessun link calendario SportEasy configurato per questa squadra." }, 400);
    }

    // webcal:// è solo un alias di https:// per dire al sistema operativo
    // "apri col calendario" — per un fetch HTTP va convertito.
    const url = integrazione.sporteasy_ical_url.replace(/^webcal:\/\//i, "https://");

    const resp = await fetch(url);
    if (!resp.ok) {
      await registraEsito(admin, team_id, `Errore HTTP ${resp.status} nello scaricare il calendario`);
      return jsonResponse({ errore: true, messaggio: `Impossibile scaricare il calendario (HTTP ${resp.status}). Verifica che il link sia corretto e ancora valido.` }, 400);
    }
    const testoIcs = await resp.text();
    const eventi = analizzaIcs(testoIcs);

    let allenamentiCreati = 0, allenamentiAggiornati = 0, partiteCreate = 0, partiteAggiornate = 0;

    for (const ev of eventi) {
      const eAllenamento = /allenamento|training/i.test(ev.summary);

      if (eAllenamento) {
        const { data: esistente } = await admin.from("trainings").select("id").eq("team_id", team_id).eq("sporteasy_uid", ev.uid).maybeSingle();
        if (esistente) {
          await admin.from("trainings").update({ titolo: ev.summary, data: ev.dataInizio }).eq("id", esistente.id);
          allenamentiAggiornati++;
        } else {
          await admin.from("trainings").insert({ team_id, titolo: ev.summary, data: ev.dataInizio, note: "", sporteasy_uid: ev.uid });
          allenamentiCreati++;
        }
      } else {
        const avversario = estraiAvversario(ev.summary);
        const { data: esistente } = await admin.from("matches").select("id").eq("team_id", team_id).eq("sporteasy_uid", ev.uid).maybeSingle();
        if (esistente) {
          // Non tocchiamo mai "stato": se l'allenatore ha già iniziato o
          // chiuso questa partita in app, una risincronizzazione non deve
          // resettarla a "programmata".
          await admin.from("matches").update({ avversario, data: ev.dataInizio }).eq("id", esistente.id);
          partiteAggiornate++;
        } else {
          await admin.from("matches").insert({ team_id, avversario, data: ev.dataInizio, luogo: "casa", stato: "programmata", sporteasy_uid: ev.uid });
          partiteCreate++;
        }
      }
    }

    await registraEsito(admin, team_id, "ok");

    return jsonResponse({
      errore: false,
      allenamentiCreati, allenamentiAggiornati, partiteCreate, partiteAggiornate,
      totaleEventiNelCalendario: eventi.length,
    });
  } catch (e) {
    return jsonResponse({ errore: true, messaggio: "Errore interno: " + (e as Error).message }, 500);
  }
});

async function registraEsito(admin: ReturnType<typeof createClient>, teamId: string, esito: string) {
  await admin.from("team_integrations").update({ ultima_sincronizzazione: new Date().toISOString(), ultimo_esito: esito }).eq("team_id", teamId);
}

/** "Partita vs Volley Bologna" / "vs Volley Bologna" / "Volley Bologna" -> "Volley Bologna". Euristica semplice, mai bloccante: se non trova un prefisso noto usa il titolo così com'è. */
function estraiAvversario(summary: string): string {
  return summary.replace(/^(partita|match)?\s*(vs\.?|contro)\s*/i, "").trim() || summary;
}

/** Unfolding + parsing minimale di un feed ICS: estrae UID, SUMMARY, DTSTART per ogni VEVENT. Ignora tutto il resto (RRULE, ALARM, timezone avanzate) perché per lo scopo — sapere data e titolo dell'evento — non serve altro. */
function analizzaIcs(testo: string): VEvent[] {
  // RFC 5545: le righe lunghe sono "foldate" con un a-capo seguito da uno
  // spazio; vanno riunite prima di qualunque altro parsing.
  const righeSenzaFold = testo.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const blocchi = righeSenzaFold.split("BEGIN:VEVENT").slice(1);

  const eventi: VEvent[] = [];
  for (const blocco of blocchi) {
    const corpo = blocco.split("END:VEVENT")[0];
    const uid = estraiCampo(corpo, "UID");
    const summary = decodificaTestoIcs(estraiCampo(corpo, "SUMMARY"));
    const dtstart = estraiCampoConParametri(corpo, "DTSTART");
    if (!uid || !dtstart) continue;

    const dataInizio = parsaDataIcs(dtstart);
    if (!dataInizio) continue;

    eventi.push({ uid, summary: summary || "Evento SportEasy", dataInizio });
  }
  return eventi;
}

function estraiCampo(corpo: string, nome: string): string | null {
  const m = corpo.match(new RegExp(`^${nome}:(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

/** Come estraiCampo, ma il nome del campo può avere parametri (es. "DTSTART;TZID=Europe/Rome:20260912T180000"). */
function estraiCampoConParametri(corpo: string, nome: string): string | null {
  const m = corpo.match(new RegExp(`^${nome}[;:]([^\n]*)$`, "m"));
  if (!m) return null;
  const riga = m[0];
  const idx = riga.indexOf(":");
  return idx === -1 ? null : riga.slice(idx + 1).trim();
}

function decodificaTestoIcs(testo: string | null): string {
  if (!testo) return "";
  return testo.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Formati tipici DTSTART: "20260912T180000Z" (UTC) o "20260912T180000" (locale, senza Z) o "20260912" (solo data). */
function parsaDataIcs(valore: string): string | null {
  const m = valore.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, anno, mese, giorno, ora = "00", min = "00", sec = "00", zulu] = m;
  const iso = `${anno}-${mese}-${giorno}T${ora}:${min}:${sec}${zulu ? "Z" : ""}`;
  const data = new Date(iso);
  return isNaN(data.getTime()) ? null : data.toISOString();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}
