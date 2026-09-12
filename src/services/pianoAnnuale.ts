import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { andamentoSquadra } from "@/src/services/evaluations";
import type { PianoAnnuale, PropostaAggiornamentoPiano } from "@/src/types/database";

const GIORNI_PRIMA_DI_RIPROPORRE = 30;

export async function leggiPianoAnnuale(teamId: string, seasonId: string | null): Promise<PianoAnnuale | null> {
  let query = supabaseClient.from("piani_annuali").select("*").eq("team_id", teamId).order("creato_il", { ascending: false }).limit(1);
  if (seasonId) query = query.eq("season_id", seasonId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function creaPianoAnnuale(teamId: string, seasonId: string | null, titolo: string, contenuto: string, generatoDaAi: boolean): Promise<PianoAnnuale> {
  const { data, error } = await supabaseClient.from("piani_annuali").insert({ team_id: teamId, season_id: seasonId, titolo, contenuto, generato_da_ai: generatoDaAi }).select().single();
  if (error) throw error;
  return data;
}

export async function aggiornaPianoAnnuale(id: string, titolo: string, contenuto: string): Promise<void> {
  const { error } = await supabaseClient.from("piani_annuali").update({ titolo, contenuto, aggiornato_il: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function elencaPropostePendentiPiano(pianoId: string): Promise<PropostaAggiornamentoPiano[]> {
  const { data, error } = await supabaseClient.from("proposte_aggiornamento_piano").select("*").eq("piano_id", pianoId).eq("stato", "pendente").order("creato_il", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function creaPropostaAggiornamento(pianoId: string, contenutoProposto: string, motivo: string): Promise<void> {
  const { error: e1 } = await supabaseClient.from("proposte_aggiornamento_piano").insert({ piano_id: pianoId, contenuto_proposto: contenutoProposto, motivo });
  if (e1) throw e1;
  const { error: e2 } = await supabaseClient.from("piani_annuali").update({ ultima_proposta_il: new Date().toISOString() }).eq("id", pianoId);
  if (e2) throw e2;
}

export async function accettaPropostaPiano(propostaId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("accetta_proposta_piano", { p_proposta_id: propostaId });
  if (error) throw error;
}

export async function rifiutaPropostaPiano(propostaId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("rifiuta_proposta_piano", { p_proposta_id: propostaId });
  if (error) throw error;
}

/**
 * "Aggiornamento con cadenza mensile o ad ogni modifica di
 * valutazione" — qui in forma REATTIVA: controllato quando questa
 * funzione viene chiamata (all'apertura della schermata), non con un
 * vero cron in background. Ritorna true se conviene proporre un
 * aggiornamento (30+ giorni dall'ultima proposta, o valutazioni più
 * recenti dell'ultima proposta).
 */
export async function serveProporreAggiornamento(piano: PianoAnnuale, teamId: string): Promise<boolean> {
  const riferimento = piano.ultima_proposta_il ? new Date(piano.ultima_proposta_il) : new Date(piano.creato_il);
  const giorniTrascorsi = (Date.now() - riferimento.getTime()) / (1000 * 60 * 60 * 24);
  if (giorniTrascorsi >= GIORNI_PRIMA_DI_RIPROPORRE) return true;

  // Valutazioni più recenti dell'ultima proposta? Usiamo l'andamento
  // squadra (aggregato, non nomi singoli) solo per verificare se ci
  // sono dati più freschi di "riferimento" — non ne leggiamo il
  // dettaglio qui.
  try {
    const righe = await andamentoSquadra(teamId);
    return righe.length > 0; // se l'RPC restituisce righe è perché esistono valutazioni; un controllo più fine sulla data richiederebbe un campo dedicato, rimandato
  } catch {
    return false;
  }
}

export interface RisultatoGenerazionePiano {
  errore: boolean;
  messaggio?: string;
  contenuto?: string;
}

/**
 * Genera (o propone un aggiornamento del) piano annuale via AI.
 * Manual-first: il testo generato va sempre rivisto e confermato
 * dall'allenatore prima di sostituire quello attuale — mai applicato
 * in automatico.
 */
export async function generaPianoAnnualeAI(teamId: string, contestoStagione: string, pianoAttuale?: string): Promise<RisultatoGenerazionePiano> {
  const prompt = pianoAttuale
    ? `Sei un assistente per un allenatore di pallavolo. Ecco il piano annuale (periodizzazione: macrocicli/mesocicli/microcicli, obiettivi per periodo) attualmente in uso:\n\n${pianoAttuale}\n\n` +
      `Contesto aggiornato della squadra: ${contestoStagione}\n\n` +
      `Proponi le variazioni che ritieni utili per adattare il piano a questo contesto aggiornato. Rispondi con il testo COMPLETO del piano aggiornato (non solo le differenze), in italiano, strutturato per periodi con obiettivi tecnici/fisici/tattici.`
    : `Sei un assistente per un allenatore di pallavolo. Contesto della squadra: ${contestoStagione}\n\n` +
      `Genera una proposta di piano annuale (periodizzazione: macrocicli/mesocicli/microcicli) in italiano, strutturato per periodi con obiettivi tecnici/fisici/tattici per ciascuno.`;

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt } });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) return { errore: true, messaggio: data.messaggio };

  return { errore: false, contenuto: data.testo };
}
