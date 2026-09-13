// supabase/functions/sync-sporteasy/index.ts
//
// Equivalente di SportEasySync.gs. Fa SOLO import di eventi
// (allenamenti/partite) dal calendario iCal della squadra — mai
// anagrafica atlete.
//
// Deploy: supabase functions deploy sync-sporteasy
//
// V2 — corregge due bug reali trovati dopo il primo utilizzo:
// 1. Il calendario SportEasy usa eventi RICORRENTI (RRULE) per gli
//    allenamenti settimanali fissi ("ogni martedì e giovedì") — un
//    parser che legge solo DTSTART importava al massimo UNA sola
//    occorrenza invece di tutte le sedute. Ora espande FREQ=WEEKLY con
//    BYDAY/COUNT/UNTIL in una finestra di alcuni mesi.
// 2. La classifica "allenamento vs partita" richiedeva la parola esatta
//    "allenamento"/"training" nel titolo. Invertita: un evento è una
//    PARTITA solo se il titolo somiglia a un incontro (vs/contro/
//    partita/campionato), altrimenti si assume allenamento — riflette
//    meglio la realtà di un calendario club (la maggioranza delle
//    voci sono sedute di allenamento, le partite sono l'eccezione
//    nominata esplicitamente).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GIORNI_ICS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const FINESTRA_ESPANSIONE_GIORNI = 180; // ~6 mesi di occorrenze future/passate generate per gli eventi ricorrenti

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

    const { data: squadra } = await admin.from("teams").select("nome").eq("id", team_id).maybeSingle();
    const nomeSquadra = squadra?.nome ?? null;

    const { data: integrazione } = await admin.from("team_integrations").select("*").eq("team_id", team_id).maybeSingle();
    if (!integrazione?.sporteasy_ical_url) {
      return jsonResponse({ errore: true, messaggio: "Nessun link calendario SportEasy configurato per questa squadra." }, 400);
    }

    const url = integrazione.sporteasy_ical_url.replace(/^webcal:\/\//i, "https://");

    // Alcuni servizi (SportEasy compreso, a seconda della
    // configurazione) rifiutano richieste che non sembrano provenire
    // da un browser: senza queste intestazioni il calendario può
    // tornare 403/406 pur essendo scaricabile a mano dal browser.
    const resp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AIVolleyballCoach/1.0; +https://github.com/)",
        "Accept": "text/calendar, text/plain, */*",
      },
    });
    if (!resp.ok) {
      const anteprima = (await resp.text().catch(() => "")).slice(0, 200);
      const messaggio = `Errore HTTP ${resp.status} nello scaricare il calendario${anteprima ? ` — risposta: ${anteprima}` : ""}`;
      await registraEsito(admin, team_id, messaggio);
      return jsonResponse({ errore: true, messaggio: `${messaggio}. Verifica che il link sia ancora valido (SportEasy → Impostazioni squadra → Esporta calendario).` }, 400);
    }
    const testoIcs = await resp.text();

    // Il calendario è stato scaricato ma non contiene eventi: meglio
    // dirlo subito e con chiarezza, invece di riportare "0 creati" che
    // sembra un problema dell'app.
    if (!testoIcs.includes("BEGIN:VCALENDAR")) {
      const messaggio = `Il contenuto scaricato non è un calendario iCal (${testoIcs.length} byte). Probabilmente il link è scaduto e restituisce una pagina web.`;
      await registraEsito(admin, team_id, messaggio);
      return jsonResponse({ errore: true, messaggio }, 400);
    }

    const eventi = analizzaIcs(testoIcs);

    let allenamentiCreati = 0, allenamentiAggiornati = 0, partiteCreate = 0, partiteAggiornate = 0;
    const dettaglioClassificazione: { titolo: string; tipo: string }[] = [];
    const erroriScrittura: string[] = [];

    for (const ev of eventi) {
      const eAllenamento = !sembraPartita(ev.summary, nomeSquadra);
      dettaglioClassificazione.push({ titolo: ev.summary, tipo: eAllenamento ? "allenamento" : "partita" });

      if (eAllenamento) {
        const { data: esistente } = await admin.from("trainings").select("id").eq("team_id", team_id).eq("sporteasy_uid", ev.uid).maybeSingle();
        if (esistente) {
          const { error } = await admin.from("trainings").update({ titolo: titoloAllenamento(ev.summary, nomeSquadra), data: ev.dataInizio }).eq("id", esistente.id);
          if (error) erroriScrittura.push(`"${ev.summary}": ${error.message}`); else allenamentiAggiornati++;
        } else {
          const { error } = await admin.from("trainings").insert({ team_id, titolo: titoloAllenamento(ev.summary, nomeSquadra), data: ev.dataInizio, note: "", sporteasy_uid: ev.uid });
          if (error) erroriScrittura.push(`"${ev.summary}": ${error.message}`); else allenamentiCreati++;
        }
      } else {
        const avversario = estraiAvversario(ev.summary, nomeSquadra);
        const { data: esistente } = await admin.from("matches").select("id").eq("team_id", team_id).eq("sporteasy_uid", ev.uid).maybeSingle();
        if (esistente) {
          // Aggiorna solo avversario/data: il campionato, se già
          // assegnato (magari corretto a mano dall'allenatore), non
          // viene mai sovrascritto da una risincronizzazione.
          const { error } = await admin.from("matches").update({ avversario, data: ev.dataInizio }).eq("id", esistente.id);
          if (error) erroriScrittura.push(`"${ev.summary}": ${error.message}`); else partiteAggiornate++;
        } else {
          // Solo alla PRIMA creazione: assegna in automatico il
          // campionato il cui periodo copre la data della partita —
          // sempre modificabile a mano dopo, dalla tab Partite.
          const dataSolaData = ev.dataInizio.slice(0, 10);
          const { data: campionatoId } = await admin.rpc("trova_campionato_per_data", { p_team_id: team_id, p_data: dataSolaData });
          const { error } = await admin.from("matches").insert({
            team_id, avversario, data: ev.dataInizio, luogo: "casa", stato: "programmata", sporteasy_uid: ev.uid,
            campionato_id: campionatoId ?? null, tipo_gara: campionatoId ? "campionato" : "amichevole",
          });
          if (error) erroriScrittura.push(`"${ev.summary}": ${error.message}`); else partiteCreate++;
        }
      }
    }

    await registraEsito(admin, team_id, erroriScrittura.length > 0 ? `${erroriScrittura.length} errori di scrittura` : "ok");

    return jsonResponse({
      errore: false,
      allenamentiCreati, allenamentiAggiornati, partiteCreate, partiteAggiornate,
      totaleEventiNelCalendario: eventi.length,
      // Diagnostica: il coach può vedere ESATTAMENTE come ogni titolo è
      // stato classificato, invece di dover indovinare perché un evento
      // è finito nella categoria sbagliata.
      dettaglioClassificazione,
      // Errori di scrittura REALI: prima venivano ignorati del tutto e
      // i contatori venivano incrementati comunque, quindi la
      // sincronizzazione dichiarava "N creati" anche quando nel
      // database non finiva nulla.
      erroriScrittura,
      // Se il calendario viene scaricato ma non contiene eventi
      // riconoscibili, questi due valori lo dicono subito invece di
      // lasciare pensare a un problema dell'app.
      byteScaricati: testoIcs.length,
      blocchiVeventTrovati: (testoIcs.match(/BEGIN:VEVENT/g) ?? []).length,
    });
  } catch (e) {
    return jsonResponse({ errore: true, messaggio: "Errore interno: " + (e as Error).message }, 500);
  }
});

async function registraEsito(admin: ReturnType<typeof createClient>, teamId: string, esito: string) {
  await admin.from("team_integrations").update({ ultima_sincronizzazione: new Date().toISOString(), ultimo_esito: esito }).eq("team_id", teamId);
}

/**
 * SportEasy nomina gli eventi "NomeSquadra - Qualcosa", dove
 * "Qualcosa" è il tipo di seduta ("Allenamento", "Sitting Volley") per
 * gli allenamenti e il nome dell'avversario per le partite. Quindi:
 * si toglie il prefisso con il nome della squadra e si guarda cosa
 * resta — se somiglia a un tipo di seduta è un allenamento, altrimenti
 * è una partita contro quella squadra. Restano riconosciute anche le
 * diciture esplicite ("vs", "contro", "partita"...) per i calendari
 * che non seguono quel formato.
 */
const PAROLE_ALLENAMENTO = /(allenamento|training|riscaldamento|preparazione|atletica|palestra|sitting|tecnica|seduta|raduno)/i;
const PAROLE_PARTITA = /\b(vs\.?|contro|partita|campionato|match|gara|torneo|amichevole)\b/i;

function separaPrefissoSquadra(summary: string, nomeSquadra?: string | null): string {
  if (nomeSquadra) {
    const prefisso = new RegExp(`^\\s*${nomeSquadra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–]\\s*`, "i");
    if (prefisso.test(summary)) return summary.replace(prefisso, "").trim();
  }
  return summary;
}

function sembraPartita(summary: string, nomeSquadra?: string | null): boolean {
  if (PAROLE_PARTITA.test(summary)) return true;
  const resto = separaPrefissoSquadra(summary, nomeSquadra);
  // Nessun prefisso rimosso: senza altri indizi si assume allenamento
  // (in un calendario di squadra sono la maggioranza).
  if (resto === summary) return false;
  // Prefisso rimosso: se ciò che resta non è un tipo di seduta, è il
  // nome dell'avversario.
  return !PAROLE_ALLENAMENTO.test(resto);
}

function estraiAvversario(summary: string, nomeSquadra?: string | null): string {
  const resto = separaPrefissoSquadra(summary, nomeSquadra);
  return resto.replace(/^(partita|match|gara)?\s*(vs\.?|contro)\s*/i, "").trim() || summary;
}

/** Titolo più leggibile per l'allenamento: "Peach Gate - Allenamento" diventa "Allenamento". */
function titoloAllenamento(summary: string, nomeSquadra?: string | null): string {
  return separaPrefissoSquadra(summary, nomeSquadra) || summary;
}

/** Unfolding + parsing minimale di un feed ICS, con espansione delle occorrenze ricorrenti (RRULE FREQ=WEEKLY). */
function analizzaIcs(testo: string): VEvent[] {
  const righeSenzaFold = testo.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const blocchi = righeSenzaFold.split("BEGIN:VEVENT").slice(1);

  const eventi: VEvent[] = [];
  for (const blocco of blocchi) {
    const corpo = blocco.split("END:VEVENT")[0];
    const uid = estraiCampo(corpo, "UID");
    const summary = decodificaTestoIcs(estraiCampo(corpo, "SUMMARY"));
    const dtstartTesto = estraiCampoConParametri(corpo, "DTSTART");
    const rruleTesto = estraiCampo(corpo, "RRULE");
    if (!uid || !dtstartTesto) continue;

    // Il fuso orario dichiarato sulla riga DTSTART (es.
    // "DTSTART;TZID=Europe/Rome:...") va letto e applicato, altrimenti
    // l'orario slitta.
    const rigaDtstart = corpo.match(/^DTSTART[^\n]*$/m)?.[0] ?? "";
    const fuso = rigaDtstart.match(/TZID=([^:;]+)/)?.[1] ?? null;

    const dataInizio = parsaDataIcs(dtstartTesto, fuso);
    if (!dataInizio) continue;

    if (rruleTesto) {
      eventi.push(...espandiRicorrenza(uid, summary || "Evento SportEasy", dataInizio, rruleTesto, fuso));
    } else {
      eventi.push({ uid, summary: summary || "Evento SportEasy", dataInizio });
    }
  }
  return eventi;
}

/**
 * Espande una regola di ricorrenza settimanale in occorrenze concrete,
 * ciascuna con un UID proprio (base + data) per la deduplica — l'UID
 * del file ICS è condiviso da TUTTE le occorrenze di uno stesso evento
 * ricorrente, quindi va reso univoco per occorrenza qui, altrimenti il
 * vincolo di unicità (team_id, sporteasy_uid) ne farebbe sopravvivere
 * solo una. Solo FREQ=WEEKLY è gestita: è il caso quasi universale per
 * allenamenti fissi settimanali; altre frequenze vengono lasciate come
 * singola occorrenza (meglio un'importazione parziale che nessuna).
 */
function espandiRicorrenza(uidBase: string, summary: string, primaOccorrenza: string, rrule: string, fuso?: string | null): VEvent[] {
  const parametri = Object.fromEntries(rrule.split(";").map((p) => { const [k, v] = p.split("="); return [k, v]; }));
  if (parametri.FREQ !== "WEEKLY") return [{ uid: uidBase, summary, dataInizio: primaOccorrenza }];

  const giorniSettimana = parametri.BYDAY
    ? parametri.BYDAY.split(",").map((g) => GIORNI_ICS[g]).filter((g) => g !== undefined)
    : [new Date(primaOccorrenza).getUTCDay()];

  const dataInizio = new Date(primaOccorrenza);
  // Ore/minuti presi in UTC: "primaOccorrenza" è già l'istante UTC
  // corretto, e replicarlo alla stessa ora UTC nei giorni successivi
  // mantiene la stessa ora locale (salvo il salto dell'ora legale, che
  // sposta di un'ora le occorrenze oltre il cambio — accettabile, e
  // comunque correggibile a mano sul singolo allenamento).
  const oraOre = dataInizio.getUTCHours(), oraMin = dataInizio.getUTCMinutes();

  let dataFine: Date;
  if (parametri.UNTIL) {
    const untilIso = parsaDataIcs(parametri.UNTIL, fuso);
    dataFine = untilIso ? new Date(untilIso) : addGiorni(dataInizio, FINESTRA_ESPANSIONE_GIORNI);
  } else {
    dataFine = addGiorni(dataInizio, FINESTRA_ESPANSIONE_GIORNI);
  }
  const limiteConteggio = parametri.COUNT ? parseInt(parametri.COUNT, 10) : Infinity;

  const occorrenze: VEvent[] = [];
  const cursore = new Date(Date.UTC(dataInizio.getUTCFullYear(), dataInizio.getUTCMonth(), dataInizio.getUTCDate()));
  let generate = 0;

  while (cursore <= dataFine && generate < limiteConteggio && generate < 200) {
    if (giorniSettimana.includes(cursore.getUTCDay())) {
      const occorrenza = new Date(Date.UTC(cursore.getUTCFullYear(), cursore.getUTCMonth(), cursore.getUTCDate(), oraOre, oraMin));
      if (occorrenza >= dataInizio) {
        occorrenze.push({ uid: `${uidBase}-${occorrenza.toISOString().slice(0, 10)}`, summary, dataInizio: occorrenza.toISOString() });
        generate++;
      }
    }
    cursore.setUTCDate(cursore.getUTCDate() + 1);
  }

  return occorrenze.length > 0 ? occorrenze : [{ uid: uidBase, summary, dataInizio: primaOccorrenza }];
}

function addGiorni(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function estraiCampo(corpo: string, nome: string): string | null {
  const m = corpo.match(new RegExp(`^${nome}:(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

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

/**
 * Converte una data/ora "naive" espressa in un fuso orario indicato
 * (TZID) nell'istante UTC corrispondente. Serve perché
 * "DTSTART;TZID=Europe/Rome:20260915T183000" significa 18:30 ORA
 * ITALIANA: interpretarlo come UTC (come faceva la versione
 * precedente) faceva slittare tutti gli allenamenti di 1-2 ore, a
 * seconda dell'ora legale.
 */
function daFusoOrarioAUtc(anno: number, mese: number, giorno: number, ora: number, minuto: number, secondo: number, fuso: string): Date {
  // Primo tentativo: assumiamo che i componenti siano già UTC, poi
  // misuriamo di quanto il fuso indicato si discosta in quell'istante
  // e correggiamo. Un secondo giro copre i casi al confine del cambio
  // di ora legale, dove l'offset del primo tentativo può essere quello
  // "sbagliato" dei due.
  let istante = Date.UTC(anno, mese - 1, giorno, ora, minuto, secondo);
  for (let i = 0; i < 2; i++) {
    const scarto = scartoFusoOrario(new Date(istante), fuso);
    const corretto = Date.UTC(anno, mese - 1, giorno, ora, minuto, secondo) - scarto;
    if (corretto === istante) break;
    istante = corretto;
  }
  return new Date(istante);
}

/** Di quanti millisecondi il fuso indicato è avanti rispetto a UTC, nell'istante dato. */
function scartoFusoOrario(istante: Date, fuso: string): number {
  try {
    const formattatore = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p: Record<string, string> = {};
    for (const parte of formattatore.formatToParts(istante)) p[parte.type] = parte.value;
    const comeUtc = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute), Number(p.second),
    );
    return comeUtc - istante.getTime();
  } catch {
    // Fuso non riconosciuto: meglio nessuna correzione che un errore.
    return 0;
  }
}

function parsaDataIcs(valore: string, fuso?: string | null): string | null {
  const m = valore.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, anno, mese, giorno, ora = "00", min = "00", sec = "00", zulu] = m;

  // Con la "Z" finale è già UTC; con un TZID va convertito; senza né
  // l'uno né l'altro è "ora locale fluttuante" e la trattiamo come ora
  // italiana, che è il caso reale per un calendario di una squadra
  // italiana.
  if (!zulu) {
    const data = daFusoOrarioAUtc(Number(anno), Number(mese), Number(giorno), Number(ora), Number(min), Number(sec), fuso || "Europe/Rome");
    return isNaN(data.getTime()) ? null : data.toISOString();
  }

  const data = new Date(`${anno}-${mese}-${giorno}T${ora}:${min}:${sec}Z`);
  return isNaN(data.getTime()) ? null : data.toISOString();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}
