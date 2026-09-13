import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg, obiettiviFisici, obiettiviTattici, obiettiviTecnici } from "@/src/config";
import { andamentoSquadra } from "@/src/services/evaluations";
import type { BloccoPiano, PianoAnnuale, PropostaAggiornamentoPiano, RiepilogoBlocco, TipoBlocco } from "@/src/types/database";

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

// ─────────── Blocchi di periodizzazione ───────────

export const ETICHETTE_TIPO_BLOCCO: Record<TipoBlocco, string> = {
  preparazione_generale: "Preparazione generale",
  preparazione_specifica: "Preparazione specifica",
  pre_competitiva: "Pre-competitiva",
  competitiva: "Competitiva",
  scarico: "Scarico",
  transizione: "Transizione",
};

/** Colori per la timeline: il carico cresce dal verde (generale) al rosso (competitiva), lo scarico è azzurro. */
export const COLORI_TIPO_BLOCCO: Record<TipoBlocco, string> = {
  preparazione_generale: "#2E7D32",
  preparazione_specifica: "#689F38",
  pre_competitiva: "#F9A825",
  competitiva: "#C62828",
  scarico: "#0277BD",
  transizione: "#6A6A6A",
};

export async function elencaBlocchi(pianoId: string): Promise<BloccoPiano[]> {
  const { data, error } = await supabaseClient.from("blocchi_piano").select("*").eq("piano_id", pianoId).order("data_inizio");
  if (error) throw error;
  return data ?? [];
}

export type InputBlocco = Omit<BloccoPiano, "id" | "piano_id" | "creato_il">;

export async function creaBlocco(pianoId: string, input: InputBlocco): Promise<BloccoPiano> {
  const { data, error } = await supabaseClient.from("blocchi_piano").insert({ piano_id: pianoId, ...input }).select().single();
  if (error) throw error;
  return data;
}

export async function aggiornaBlocco(id: string, input: Partial<InputBlocco>): Promise<void> {
  const { error } = await supabaseClient.from("blocchi_piano").update(input).eq("id", id);
  if (error) throw error;
}

export async function eliminaBlocco(id: string): Promise<void> {
  const { error } = await supabaseClient.from("blocchi_piano").delete().eq("id", id);
  if (error) throw error;
}

/** Quante partite e quanti allenamenti cadono nel periodo di ogni blocco: serve a vedere i conflitti di carico. */
export async function riepilogoBlocchi(pianoId: string): Promise<RiepilogoBlocco[]> {
  const { data, error } = await supabaseClient.rpc("riepilogo_blocchi_piano", { p_piano_id: pianoId });
  if (error) throw error;
  return data ?? [];
}

export interface RisultatoGenerazioneBlocchi {
  errore: boolean;
  messaggio?: string;
  blocchi?: InputBlocco[];
}

/**
 * Chiede all'AI una periodizzazione in blocchi datati. Manual-first:
 * i blocchi proposti vengono mostrati e restano modificabili (o
 * cancellabili) uno per uno prima e dopo il salvataggio — mai
 * applicati come verità assoluta.
 */
export async function generaBlocchiAI(
  teamId: string,
  dataInizioStagione: string,
  dataFineStagione: string,
  contesto: string,
): Promise<RisultatoGenerazioneBlocchi> {
  const prompt =
    `Sei un preparatore di pallavolo. Costruisci la periodizzazione annuale dal ${dataInizioStagione} al ${dataFineStagione}.\n` +
    `Contesto squadra: ${contesto}\n\n` +
    `Rispondi SOLO con JSON, nessun altro testo, in questo formato:\n` +
    `{"blocchi":[{"nome":"...","tipo":"preparazione_generale","data_inizio":"AAAA-MM-GG","data_fine":"AAAA-MM-GG","obiettivi_tecnici":"...","obiettivi_fisici":"...","obiettivi_tattici":"..."}]}\n` +
    `I valori ammessi per "tipo" sono esattamente: preparazione_generale, preparazione_specifica, pre_competitiva, competitiva, scarico, transizione. ` +
    `Inserisci blocchi di scarico periodici. I blocchi devono coprire tutto il periodo senza sovrapporsi.`;

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt } });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) return { errore: true, messaggio: data.messaggio };

  try {
    const pulito = String(data.testo).trim().replace(/^```json\s*|```$/g, "");
    const parsed = JSON.parse(pulito);
    const tipiAmmessi = Object.keys(ETICHETTE_TIPO_BLOCCO);
    const blocchi: InputBlocco[] = (parsed.blocchi ?? [])
      .filter((b: Record<string, unknown>) => b.data_inizio && b.data_fine && b.nome)
      .map((b: Record<string, string>) => ({
        nome: String(b.nome),
        // Se l'AI inventa un tipo non previsto si ricade su quello più
        // neutro, invece di far fallire l'inserimento per il vincolo.
        tipo: (tipiAmmessi.includes(b.tipo) ? b.tipo : "preparazione_generale") as TipoBlocco,
        data_inizio: String(b.data_inizio).slice(0, 10),
        data_fine: String(b.data_fine).slice(0, 10),
        obiettivi_tecnici: String(b.obiettivi_tecnici ?? ""),
        obiettivi_fisici: String(b.obiettivi_fisici ?? ""),
        obiettivi_tattici: String(b.obiettivi_tattici ?? ""),
        note: "",
      }));
    if (blocchi.length === 0) return { errore: true, messaggio: "L'AI non ha proposto blocchi utilizzabili. Puoi comunque costruirli a mano." };
    return { errore: false, blocchi };
  } catch {
    return { errore: true, messaggio: "Risposta AI non nel formato atteso. Puoi comunque costruire i blocchi a mano." };
  }
}


export interface RisposteGuida {
  livello: string;
  seduteSettimana: string;
  obiettivoStagione: string;
}

/**
 * Versione "guidata" della generazione: invece di chiedere all'AI un
 * piano libero, le si passano tre risposte dell'allenatore e la si
 * vincola a scegliere gli obiettivi SOLO dagli elenchi predefiniti.
 * Il risultato è più prevedibile, coerente tra stagioni e già pronto
 * per i menù a tendina, senza testo libero da ripulire a mano.
 */
export async function generaBlocchiGuidatoAI(
  teamId: string,
  dataInizio: string,
  dataFine: string,
  risposte: RisposteGuida,
  numeroAtlete: number,
): Promise<RisultatoGenerazioneBlocchi> {
  const prompt =
    `Sei un preparatore di pallavolo. Costruisci la periodizzazione dal ${dataInizio} al ${dataFine}.\n` +
    `Squadra: ${numeroAtlete} atlete, livello "${risposte.livello}", ${risposte.seduteSettimana} sedute a settimana. ` +
    `Obiettivo principale della stagione: "${risposte.obiettivoStagione}".\n\n` +
    `Gli obiettivi di ogni blocco devono essere scelti ESCLUSIVAMENTE da questi elenchi, copiati alla lettera:\n` +
    `TECNICI: ${obiettiviTecnici.join(" | ")}\n` +
    `FISICI: ${obiettiviFisici.join(" | ")}\n` +
    `TATTICI: ${obiettiviTattici.join(" | ")}\n\n` +
    `Rispondi SOLO con JSON, senza altro testo:\n` +
    `{"blocchi":[{"nome":"...","tipo":"preparazione_generale","data_inizio":"AAAA-MM-GG","data_fine":"AAAA-MM-GG","obiettivi_tecnici":["voce esatta","voce esatta"],"obiettivi_fisici":["..."],"obiettivi_tattici":["..."]}]}\n` +
    `Valori ammessi per "tipo": preparazione_generale, preparazione_specifica, pre_competitiva, competitiva, scarico, transizione. ` +
    `Massimo 3 obiettivi per categoria per blocco. Inserisci blocchi di scarico periodici. I blocchi coprono tutto il periodo senza sovrapporsi.`;

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt } });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) return { errore: true, messaggio: data.messaggio };

  try {
    const pulito = String(data.testo).trim().replace(/^```json\s*|```$/g, "");
    const parsed = JSON.parse(pulito);
    const tipiAmmessi = Object.keys(ETICHETTE_TIPO_BLOCCO);

    // Le voci proposte vengono filtrate contro gli elenchi ufficiali:
    // se l'AI ne inventa una che non esiste viene scartata, così i
    // menù a tendina restano coerenti e non si popolano di varianti.
    const soloAmmessi = (valori: unknown, ammessi: readonly string[]) =>
      (Array.isArray(valori) ? valori : [])
        .map(String)
        .filter((v) => ammessi.includes(v))
        .join(", ");

    const blocchi: InputBlocco[] = (parsed.blocchi ?? [])
      .filter((b: Record<string, unknown>) => b.data_inizio && b.data_fine && b.nome)
      .map((b: Record<string, unknown>) => ({
        nome: String(b.nome),
        tipo: (tipiAmmessi.includes(String(b.tipo)) ? String(b.tipo) : "preparazione_generale") as TipoBlocco,
        data_inizio: String(b.data_inizio).slice(0, 10),
        data_fine: String(b.data_fine).slice(0, 10),
        obiettivi_tecnici: soloAmmessi(b.obiettivi_tecnici, obiettiviTecnici),
        obiettivi_fisici: soloAmmessi(b.obiettivi_fisici, obiettiviFisici),
        obiettivi_tattici: soloAmmessi(b.obiettivi_tattici, obiettiviTattici),
        note: "",
      }));

    if (blocchi.length === 0) return { errore: true, messaggio: "L'AI non ha proposto blocchi utilizzabili. Puoi comunque costruirli a mano." };
    return { errore: false, blocchi };
  } catch {
    return { errore: true, messaggio: "Risposta AI non nel formato atteso. Puoi comunque costruire i blocchi a mano." };
  }
}
