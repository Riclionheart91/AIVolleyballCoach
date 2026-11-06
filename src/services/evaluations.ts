import { supabaseClient } from "@/src/lib/supabase";
import { messaggioErroreRouter } from "@/src/services/aiProviders";
import { supabase as cfg, fondamentali } from "@/src/config";
import { istruzioniAggiuntive } from "@/src/services/pianoAnnuale";
import { ATLETA_ANONIMA } from "@/src/lib/anonimizza";
import type { Evaluation, EvaluationProposal, Fondamentale } from "@/src/types/database";

/** Percorso manuale puro — identico indipendentemente dallo stato dell'AI. */
export async function registraValutazione(
  teamId: string,
  athleteId: string,
  fondamentale: Fondamentale,
  punteggio: number,
  note = "",
): Promise<Evaluation> {
  const { data: userData } = await supabaseClient.auth.getUser();
  const { data, error } = await supabaseClient
    .from("evaluations")
    .insert({ team_id: teamId, athlete_id: athleteId, fondamentale, punteggio, note, valutatore: userData.user?.id, origine: "manuale" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function elencaValutazioni(athleteId: string, fondamentale?: Fondamentale): Promise<Evaluation[]> {
  let query = supabaseClient.from("evaluations").select("*").eq("athlete_id", athleteId).order("data_valutazione", { ascending: false });
  if (fondamentale) query = query.eq("fondamentale", fondamentale);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function elencaPropostePendenti(teamId: string): Promise<EvaluationProposal[]> {
  const { data, error } = await supabaseClient
    .from("evaluation_proposals")
    .select("*")
    .eq("team_id", teamId)
    .eq("stato", "proposta")
    .order("creata_il", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface AndamentoSquadraVoce {
  fondamentale: Fondamentale;
  mese: string;
  media: number;
  numero_valutazioni: number;
}

/** Aggregato di squadra per fondamentale/mese — MAI scomposto per singola atleta. Visibile a qualunque ruolo del team, incluse la rosa (RPC lo garantisce lato server). */
export async function andamentoSquadra(teamId: string): Promise<AndamentoSquadraVoce[]> {
  const { data, error } = await supabaseClient.rpc("andamento_squadra_valutazioni", { p_team_id: teamId });
  if (error) throw error;
  return data ?? [];
}
export interface RisultatoSuggerimentoAI {
  errore: boolean;
  messaggio?: string;
  proposta?: EvaluationProposal;
  chiamateResidue?: number;
  limite?: number;
}

/**
 * Chiede all'AI un suggerimento di punteggio per atleta/fondamentale,
 * crea la riga in evaluation_proposals e la ritorna. Non tocca mai
 * "evaluations": la valutazione vera nasce solo quando l'allenatore
 * decide (vedi decidiProposta più sotto) — stesso contratto di
 * generaPropostaValutazioneAI in EvaluationsAI.gs.
 *
 * In caso di errore ritorna { errore: true, messaggio } invece di
 * lanciare un'eccezione: la UI deve poter mostrare "usa il percorso
 * manuale" senza un try/catch ad ogni chiamata.
 */
export async function generaPropostaValutazioneAI(
  teamId: string,
  athleteId: string,
  atletaNomeCompleto: string,
  fondamentale: Fondamentale,
  storicoRecente: { punteggio: number; data: string }[],
  istruzioniExtra?: string,
): Promise<RisultatoSuggerimentoAI> {
  const prompt = costruisciPromptValutazione(fondamentale, storicoRecente) + istruzioniAggiuntive(istruzioniExtra, [atletaNomeCompleto]);

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, {
    body: { team_id: teamId, prompt, funzione: "voti" },
  });
  if (error) return { errore: true, messaggio: await messaggioErroreRouter(error) };
  if (data.errore) return { errore: true, messaggio: [data.messaggio, data.dettagli, (data.chiaviMancanti ?? []).length ? `Chiavi non configurate: ${(data.chiaviMancanti ?? []).join(", ")}` : ""].filter(Boolean).join("\n\n") };

  const suggerimento = interpretaRispostaAI(data.testo);
  const valoreAttuale = storicoRecente[0]?.punteggio ?? null;

  const { data: proposta, error: erroreInsert } = await supabaseClient
    .from("evaluation_proposals")
    .insert({
      team_id: teamId,
      athlete_id: athleteId,
      fondamentale,
      valore_attuale: valoreAttuale,
      valore_proposto: suggerimento.valore,
      confidenza: suggerimento.confidenza,
      motivazione: suggerimento.motivazione,
      provider_usato: data.providerUsato,
    })
    .select()
    .single();
  if (erroreInsert) return { errore: true, messaggio: erroreInsert.message };

  return { errore: false, proposta, chiamateResidue: data.chiamateResidue, limite: data.limite };
}

/** Chiude una proposta: se il valore finale coincide col suggerimento è "approvata", altrimenti "modificata". In entrambi i casi crea la valutazione reale. */
export async function decidiProposta(propostaId: string, valoreFinale: number, note = ""): Promise<string> {
  const { data, error } = await supabaseClient.rpc("decidi_proposta_valutazione", {
    p_proposta_id: propostaId,
    p_valore_finale: valoreFinale,
    p_note: note,
  });
  if (error) throw error;
  return data as string;
}

export async function rigettaProposta(propostaId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("rigetta_proposta_valutazione", { p_proposta_id: propostaId });
  if (error) throw error;
}

function costruisciPromptValutazione(fondamentale: Fondamentale, storico: { punteggio: number; data: string }[]): string {
  const storicoTesto = storico.length
    ? storico.map((s) => `${s.data.slice(0, 10)}: ${s.punteggio}`).join(", ")
    : "nessuna valutazione precedente";
  return (
    `Proponi un punteggio da 1 a 10 per il fondamentale "${fondamentale}" ` +
    `di ${ATLETA_ANONIMA}, in base allo storico recente (${storicoTesto}). ` +
    `Rispondi SOLO in formato JSON: {"valore": numero, "confidenza": "bassa"|"media"|"alta", "motivazione": "una frase breve"}.`
  );
}

function interpretaRispostaAI(testo: string): { valore: number; confidenza: "bassa" | "media" | "alta"; motivazione: string } {
  try {
    const pulito = testo.trim().replace(/^```json\s*|```$/g, "");
    const parsed = JSON.parse(pulito);
    const valore = Math.min(10, Math.max(1, Number(parsed.valore)));
    return {
      valore: Math.round(valore * 2) / 2, // arrotonda a 0.5, come i punteggi manuali
      confidenza: ["bassa", "media", "alta"].includes(parsed.confidenza) ? parsed.confidenza : "media",
      motivazione: String(parsed.motivazione ?? "").slice(0, 300),
    };
  } catch {
    // Se il modello non ha rispettato il formato JSON richiesto, meglio
    // una proposta "a bassa confidenza" evidente che un errore secco:
    // l'allenatore la vede, la corregge o la rigetta in un tap.
    return { valore: 6, confidenza: "bassa", motivazione: "Risposta AI non nel formato atteso, valore indicativo." };
  }
}

export interface AtletaDaValutare {
  athlete_id: string;
  nome: string;
  cognome: string;
  numero_maglia: number | null;
  ultima_valutazione: string | null;
  giorni_dall_ultima: number | null;
}

/** Rosa mai valutate o la cui valutazione più recente supera la cadenza impostata per la squadra (30 giorni di default). */
export async function atleteDaValutare(teamId: string): Promise<AtletaDaValutare[]> {
  const { data, error } = await supabaseClient.rpc("atlete_da_valutare", { p_team_id: teamId });
  if (error) throw error;
  return data ?? [];
}

export async function impostaCadenzaValutazione(teamId: string, giorni: number): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_cadenza_valutazione", { p_team_id: teamId, p_giorni: giorni });
  if (error) throw error;
}

/** Parere discorsivo dell'AI sull'andamento della partita, su richiesta esplicita (non automatico). */
export async function chiediParerePartitaAI(teamId: string, riassunto: string, domanda?: string): Promise<{ errore: boolean; messaggio?: string; testo?: string }> {
  const prompt =
    `Situazione della partita in corso:\n\n${riassunto}\n\n` +
    (domanda?.trim() ? `Domanda specifica dell'allenatore: ${domanda.trim().slice(0, 500)}\n\n` : "") +
    `Indica cosa bilanciare o cambiare.`;

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt, funzione: "parere_partita" } });
  if (error) return { errore: true, messaggio: await messaggioErroreRouter(error) };
  if (data.errore) return { errore: true, messaggio: [data.messaggio, data.dettagli].filter(Boolean).join("\n\n") };
  return { errore: false, testo: data.testo };
}


// ---------------------------------------------------------------------------
// Controllo a tappeto: l'AI rilegge lo storico di tutta la rosa e propone aggiornamenti
// ---------------------------------------------------------------------------

const ATLETE_PER_CHIAMATA = 5;
const CONFIDENZE = ["bassa", "media", "alta"] as const;

export interface GruppoControllo {
  prompt: string;
  /** Codice anonimo usato nel prompt (A1, A2…) -> atleta vera e ultimo voto per fondamentale. */
  atlete: Record<string, { athleteId: string; ultimi: Partial<Record<Fondamentale, number>> }>;
}

export interface PreparazioneControllo {
  gruppi: GruppoControllo[];
  atleteControllate: number;
  atleteSenzaStorico: number;
}

/**
 * Prepara il controllo: legge tutte le valutazioni della squadra, tiene le atlete con almeno un fondamentale già
 * valutato (senza storico l'AI inventerebbe) e salta le coppie atleta/fondamentale che hanno già una proposta in attesa.
 * I nomi non escono mai: nel prompt le atlete sono A1, A2… con il solo ruolo.
 */
export async function preparaControlloATappeto(
  teamId: string,
  atlete: { id: string; ruolo_campo?: string | null }[],
  pendenti: { athlete_id: string; fondamentale: string }[],
): Promise<PreparazioneControllo> {
  const { data, error } = await supabaseClient
    .from("evaluations")
    .select("athlete_id, fondamentale, punteggio, data_valutazione")
    .eq("team_id", teamId)
    .order("data_valutazione", { ascending: false })
    .limit(5000);
  if (error) throw error;

  const storico = new Map<string, Map<Fondamentale, { punteggio: number; data: string }[]>>();
  for (const r of data ?? []) {
    const f = r.fondamentale as Fondamentale;
    const perAtleta = storico.get(r.athlete_id) ?? new Map();
    const lista = perAtleta.get(f) ?? [];
    if (lista.length < 5) lista.push({ punteggio: Number(r.punteggio), data: String(r.data_valutazione) });
    perAtleta.set(f, lista);
    storico.set(r.athlete_id, perAtleta);
  }
  const inAttesa = new Set(pendenti.map((p) => `${p.athlete_id}|${p.fondamentale}`));

  const candidate = atlete
    .map((a) => {
      const perAtleta = storico.get(a.id);
      const fondamentaliValidi = fondamentali.filter((f) => (perAtleta?.get(f)?.length ?? 0) > 0 && !inAttesa.has(`${a.id}|${f}`));
      return { a, perAtleta, fondamentaliValidi };
    });
  const conStorico = candidate.filter((c) => c.fondamentaliValidi.length > 0);

  const gruppi: GruppoControllo[] = [];
  for (let i = 0; i < conStorico.length; i += ATLETE_PER_CHIAMATA) {
    const parte = conStorico.slice(i, i + ATLETE_PER_CHIAMATA);
    const atleteGruppo: GruppoControllo["atlete"] = {};
    const righe: string[] = [];
    parte.forEach((c, j) => {
      const codice = `A${j + 1}`;
      const ultimi: Partial<Record<Fondamentale, number>> = {};
      const pezzi = c.fondamentaliValidi.map((f) => {
        const lista = c.perAtleta!.get(f)!;
        ultimi[f] = lista[0].punteggio;
        return `${f} [${lista.map((v) => `${v.data.slice(0, 10)}: ${v.punteggio}`).join(", ")}]`;
      });
      atleteGruppo[codice] = { athleteId: c.a.id, ultimi };
      righe.push(`${codice} (${c.a.ruolo_campo || "ruolo non indicato"}): ${pezzi.join("; ")}`);
    });
    const prompt =
      `Controllo periodico dei voti di un gruppo di atlete. Per ognuna sono indicati i fondamentali con lo storico recente (dal più recente, data: punteggio).\n\n` +
      `${righe.join("\n")}\n\n` +
      `Per ogni coppia atleta/fondamentale proponi un aggiornamento SOLO se lo storico lo giustifica (tendenza chiara in salita o in discesa, voto fermo da molto tempo, ` +
      `dato anomalo). Se il voto attuale resta adeguato NON includerla. Il voto proposto è da 1 a 10, a passi di 0,5. ` +
      `Rispondi SOLO con un array JSON, senza altro testo: ` +
      `[{"atleta":"A1","fondamentale":"Servizio","valore":7.5,"confidenza":"bassa"|"media"|"alta","motivazione":"una frase breve che cita il dato"}]. ` +
      `Se nessun aggiornamento è necessario rispondi [].`;
    gruppi.push({ prompt, atlete: atleteGruppo });
  }

  return { gruppi, atleteControllate: conStorico.length, atleteSenzaStorico: atlete.length - conStorico.length };
}

export interface EsitoControllo {
  errore: boolean;
  messaggio?: string;
  proposteCreate: number;
  gruppiFatti: number;
  chiamateResidue?: number;
  limite?: number;
}

function leggiArrayProposte(testo: string): unknown[] {
  const pulito = testo.trim().replace(/^```(?:json)?\s*|```$/g, "");
  const inizio = pulito.indexOf("[");
  const fine = pulito.lastIndexOf("]");
  if (inizio === -1 || fine <= inizio) return [];
  try {
    const arr = JSON.parse(pulito.slice(inizio, fine + 1));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Esegue il controllo: una chiamata AI per gruppo; crea le proposte in attesa (mai valutazioni vere). Si ferma al primo errore tenendo quanto già fatto. */
export async function eseguiControlloATappeto(
  teamId: string,
  gruppi: GruppoControllo[],
  onAvanzamento?: (fatti: number, totale: number) => void,
): Promise<EsitoControllo> {
  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso.", proposteCreate: 0, gruppiFatti: 0 };

  let create = 0;
  let fatti = 0;
  let residue: number | undefined;
  let limite: number | undefined;
  onAvanzamento?.(0, gruppi.length);

  for (const g of gruppi) {
    const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt: g.prompt, funzione: "voti" } });
    if (error) return { errore: true, messaggio: await messaggioErroreRouter(error), proposteCreate: create, gruppiFatti: fatti, chiamateResidue: residue, limite };
    if (data.errore) return { errore: true, messaggio: [data.messaggio, data.dettagli].filter(Boolean).join("\n\n"), proposteCreate: create, gruppiFatti: fatti, chiamateResidue: residue, limite };
    residue = data.chiamateResidue; limite = data.limite;

    const righe: Record<string, unknown>[] = [];
    for (const voce of leggiArrayProposte(String(data.testo ?? ""))) {
      const v = voce as { atleta?: string; fondamentale?: string; valore?: unknown; confidenza?: string; motivazione?: unknown };
      const atleta = v.atleta ? g.atlete[v.atleta] : undefined;
      const f = fondamentali.find((x) => x === v.fondamentale);
      const numero = Number(v.valore);
      if (!atleta || !f || Number.isNaN(numero)) continue;
      const valore = Math.round(Math.min(10, Math.max(1, numero)) * 2) / 2;
      const attuale = atleta.ultimi[f] ?? null;
      if (attuale !== null && Math.abs(valore - attuale) < 0.5) continue; // nessun aggiornamento reale
      righe.push({
        team_id: teamId,
        athlete_id: atleta.athleteId,
        fondamentale: f,
        valore_attuale: attuale,
        valore_proposto: valore,
        confidenza: (CONFIDENZE as readonly string[]).includes(v.confidenza ?? "") ? v.confidenza : "media",
        motivazione: String(v.motivazione ?? "").slice(0, 300),
        provider_usato: data.providerUsato,
      });
    }
    if (righe.length > 0) {
      const { error: erroreInsert } = await supabaseClient.from("evaluation_proposals").insert(righe);
      if (erroreInsert) return { errore: true, messaggio: erroreInsert.message, proposteCreate: create, gruppiFatti: fatti, chiamateResidue: residue, limite };
      create += righe.length;
    }
    fatti++;
    onAvanzamento?.(fatti, gruppi.length);
  }
  return { errore: false, proposteCreate: create, gruppiFatti: fatti, chiamateResidue: residue, limite };
}
