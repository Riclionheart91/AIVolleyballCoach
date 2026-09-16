import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { istruzioniAggiuntive } from "@/src/services/pianoAnnuale";
import type { Exercise, TrainingExercise } from "@/src/types/database";

export interface VoceRiepilogoPiano {
  /** Vuoto se l'esercizio è nuovo e non ancora salvato in catalogo. */
  exerciseId: string;
  nome: string;
  durataMinuti: number;
  note: string;
  categoria?: string;
  descrizione?: string;
  /** true = non esiste in catalogo, va aggiunto prima di poterlo salvare nel piano. */
  nuovo?: boolean;
}

export async function impostaPianoAllenamento(trainingId: string, argomento: string, esercizi: VoceRiepilogoPiano[]): Promise<void> {
  const payload = esercizi.map((e, i) => ({ exercise_id: e.exerciseId, durata_minuti: e.durataMinuti, note: e.note, ordine: i }));
  const { error } = await supabaseClient.rpc("imposta_piano_allenamento", { p_training_id: trainingId, p_argomento: argomento, p_esercizi: payload });
  if (error) throw error;
}

export async function elencaPianoAllenamento(trainingId: string): Promise<TrainingExercise[]> {
  const { data, error } = await supabaseClient.from("training_exercises").select("*").eq("training_id", trainingId).order("ordine");
  if (error) throw error;
  return data ?? [];
}

export interface RisultatoGenerazionePiano {
  errore: boolean;
  messaggio?: string;
  argomentoSuggerito?: string;
  esercizi?: VoceRiepilogoPiano[];
}

/**
 * Chiede all'AI una proposta di piano allenamento a partire da
 * argomento + durata totale desiderata, usando SOLO esercizi già nel
 * catalogo della squadra (mai esercizi inventati). La proposta popola
 * il form ma resta interamente modificabile prima di salvare — stesso
 * principio manual-first delle valutazioni AI: se l'AI non risponde,
 * il piano si costruisce comunque a mano scegliendo dal catalogo.
 */
/** Blocco di periodizzazione in cui cade una certa data: se il piano annuale esiste, la seduta viene generata coerentemente con gli obiettivi di quel periodo. */
export async function leggiBloccoPerData(teamId: string, dataIso: string): Promise<{ nome: string; tipo: string; obiettivi_tecnici: string; obiettivi_fisici: string; obiettivi_tattici: string } | null> {
  const { data, error } = await supabaseClient.rpc("blocco_per_data", { p_team_id: teamId, p_data: dataIso.slice(0, 10) });
  if (error) return null;
  return (data && data.length > 0) ? data[0] : null;
}

export async function generaPianoAllenamentoAI(teamId: string, argomento: string, durataTotaleMinuti: number, catalogo: Exercise[], dataSeduta?: string, istruzioniExtra?: string): Promise<RisultatoGenerazionePiano> {
  if (catalogo.length === 0) {
    return { errore: true, messaggio: "Il catalogo esercizi è vuoto: aggiungi almeno qualche esercizio nella tab Esercizi prima di generare un piano con l'AI." };
  }

  const elencoCatalogo = catalogo.map((e) => `- ${e.nome}${e.categoria ? ` (${e.categoria})` : ""}`).join("\n");

  // Se la seduta cade dentro un blocco del piano annuale, i suoi
  // obiettivi entrano nel prompt: è ciò che rende la pianificazione
  // annuale operativa invece che decorativa — la singola seduta
  // eredita il periodo in cui si trova.
  const blocco = dataSeduta ? await leggiBloccoPerData(teamId, dataSeduta) : null;
  const contestoPeriodo = blocco
    ? `Questa seduta ricade nel periodo "${blocco.nome}" (${blocco.tipo.replace(/_/g, " ")}) del piano annuale. ` +
      `Obiettivi del periodo — tecnici: ${blocco.obiettivi_tecnici || "non indicati"}; fisici: ${blocco.obiettivi_fisici || "non indicati"}; tattici: ${blocco.obiettivi_tattici || "non indicati"}. ` +
      `Scegli gli esercizi coerenti con questi obiettivi e con il tipo di periodo (in un periodo di scarico riduci volume e intensità).\n\n`
    : "";

  const prompt = contestoPeriodo +
    `Sei un assistente per un allenatore di pallavolo. Proponi un piano per una sessione di allenamento sul tema "${argomento}", ` +
    `della durata totale di circa ${durataTotaleMinuti} minuti. USA SOLO esercizi da questo catalogo (mai inventarne altri, scrivi il nome esattamente come qui):\n${elencoCatalogo}\n\n` +
    `Puoi proporre anche esercizi NON presenti in catalogo se utili: in quel caso indica "nuovo": true e una descrizione completa.\n` +
    `Rispondi SOLO in formato JSON: {"esercizi": [{"nome": "...", "durata_minuti": numero, "note": "breve indicazione", "nuovo": false, "categoria": "...", "descrizione": "..."}], "argomento_suggerito": "..."}. ` +
    `La somma delle durate deve avvicinarsi a ${durataTotaleMinuti} minuti.` + istruzioniAggiuntive(istruzioniExtra);

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt } });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) return { errore: true, messaggio: [data.messaggio, data.dettagli, (data.chiaviMancanti ?? []).length ? `Chiavi non configurate: ${(data.chiaviMancanti ?? []).join(", ")}` : ""].filter(Boolean).join("\n\n") };

  try {
    const pulito = data.testo.trim().replace(/^```json\s*|```$/g, "");
    const parsed = JSON.parse(pulito);
    const eserciziProposti: VoceRiepilogoPiano[] = [];

    const nuovi: EsercizioNuovoProposto[] = [];

    for (const item of parsed.esercizi ?? []) {
      const trovato = catalogo.find((e) => e.nome.trim().toLowerCase() === String(item.nome).trim().toLowerCase());
      const durata = Number(item.durata_minuti) || 15;
      if (trovato) {
        eserciziProposti.push({ exerciseId: trovato.id, nome: trovato.nome, durataMinuti: durata, note: String(item.note ?? "") });
      } else if (item.nome) {
        // Prima gli esercizi non riconosciuti venivano scartati in
        // silenzio, e con un catalogo poco coperto il risultato era
        // "nessun esercizio riconoscibile". Ora si propongono per
        // l'inserimento in catalogo, così la proposta non va persa.
        nuovi.push({
          nome: String(item.nome).trim(),
          categoria: String(item.categoria ?? argomento).trim(),
          descrizione: String(item.descrizione ?? item.note ?? "").trim(),
          durataMinuti: durata,
        });
      }
    }

    if (eserciziProposti.length === 0 && nuovi.length === 0) {
      return { errore: true, messaggio: "L'AI non ha proposto esercizi utilizzabili. Puoi comunque costruire il piano a mano." };
    }

    return { errore: false, argomentoSuggerito: parsed.argomento_suggerito || argomento, esercizi: eserciziProposti, nuovi };
  } catch {
    return { errore: true, messaggio: "Risposta AI non nel formato atteso — percorso manuale sempre disponibile qui sopra." };
  }
}

// ─────────── Sessione dal vivo ───────────

export interface VoceSessione {
  id: string;
  exercise_id: string;
  nome: string;
  /** Descrizione dal catalogo: serve a bordo campo per spiegare l'esercizio senza uscire dalla sessione. */
  descrizione: string;
  durata_minuti: number | null;
  note: string;
  ordine: number;
  iniziato_il: string | null;
  concluso_il: string | null;
  durata_effettiva_secondi: number | null;
}

/** Esercizi del piano con lo stato di esecuzione, per la schermata da bordo campo. */
export async function elencaSessione(trainingId: string, catalogo: Exercise[]): Promise<VoceSessione[]> {
  const { data, error } = await supabaseClient
    .from("training_exercises")
    .select("id, exercise_id, durata_minuti, note, ordine, iniziato_il, concluso_il, durata_effettiva_secondi")
    .eq("training_id", trainingId)
    .order("ordine");
  if (error) throw error;
  return (data ?? []).map((r) => {
    const ex = catalogo.find((c) => c.id === r.exercise_id);
    return { ...r, nome: ex?.nome ?? "Esercizio", descrizione: ex?.descrizione ?? "" };
  }) as VoceSessione[];
}

export async function avviaSessione(trainingId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("avvia_sessione_allenamento", { p_training_id: trainingId });
  if (error) throw error;
}

export async function avviaEsercizio(trainingExerciseId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("avvia_esercizio", { p_training_exercise_id: trainingExerciseId });
  if (error) throw error;
}

export async function concludiEsercizio(trainingExerciseId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("concludi_esercizio", { p_training_exercise_id: trainingExerciseId });
  if (error) throw error;
}

export async function concludiSessione(trainingId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("concludi_sessione_allenamento", { p_training_id: trainingId });
  if (error) throw error;
}
