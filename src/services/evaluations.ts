import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
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

/** Aggregato di squadra per fondamentale/mese — MAI scomposto per singola atleta. Visibile a qualunque ruolo del team, incluse le atlete (RPC lo garantisce lato server). */
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
): Promise<RisultatoSuggerimentoAI> {
  const prompt = costruisciPromptValutazione(atletaNomeCompleto, fondamentale, storicoRecente);

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, {
    body: { team_id: teamId, prompt },
  });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) return { errore: true, messaggio: data.messaggio };

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

function costruisciPromptValutazione(nomeAtleta: string, fondamentale: Fondamentale, storico: { punteggio: number; data: string }[]): string {
  const storicoTesto = storico.length
    ? storico.map((s) => `${s.data.slice(0, 10)}: ${s.punteggio}`).join(", ")
    : "nessuna valutazione precedente";
  return (
    `Sei un assistente per un allenatore di pallavolo. Proponi un punteggio da 1 a 10 per il fondamentale "${fondamentale}" ` +
    `dell'atleta ${nomeAtleta}, in base allo storico recente (${storicoTesto}). ` +
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
      motivazione: String(parsed.motivazione ?? ""),
    };
  } catch {
    // Se il modello non ha rispettato il formato JSON richiesto, meglio
    // una proposta "a bassa confidenza" evidente che un errore secco:
    // l'allenatore la vede, la corregge o la rigetta in un tap.
    return { valore: 6, confidenza: "bassa", motivazione: "Risposta AI non nel formato atteso, valore indicativo." };
  }
}
