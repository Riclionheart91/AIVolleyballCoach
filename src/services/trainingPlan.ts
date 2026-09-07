import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import type { Exercise, TrainingExercise } from "@/src/types/database";

export interface VoceRiepilogoPiano {
  exerciseId: string;
  nome: string;
  durataMinuti: number;
  note: string;
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
export async function generaPianoAllenamentoAI(teamId: string, argomento: string, durataTotaleMinuti: number, catalogo: Exercise[]): Promise<RisultatoGenerazionePiano> {
  if (catalogo.length === 0) {
    return { errore: true, messaggio: "Il catalogo esercizi è vuoto: aggiungi almeno qualche esercizio nella tab Esercizi prima di generare un piano con l'AI." };
  }

  const elencoCatalogo = catalogo.map((e) => `- ${e.nome}${e.categoria ? ` (${e.categoria})` : ""}`).join("\n");
  const prompt =
    `Sei un assistente per un allenatore di pallavolo. Proponi un piano per una sessione di allenamento sul tema "${argomento}", ` +
    `della durata totale di circa ${durataTotaleMinuti} minuti. USA SOLO esercizi da questo catalogo (mai inventarne altri, scrivi il nome esattamente come qui):\n${elencoCatalogo}\n\n` +
    `Rispondi SOLO in formato JSON: {"esercizi": [{"nome": "nome esatto dal catalogo", "durata_minuti": numero, "note": "breve indicazione"}], "argomento_suggerito": "eventuale titolo più specifico del tema"}. ` +
    `La somma delle durate deve avvicinarsi a ${durataTotaleMinuti} minuti.`;

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt } });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) return { errore: true, messaggio: data.messaggio };

  try {
    const pulito = data.testo.trim().replace(/^```json\s*|```$/g, "");
    const parsed = JSON.parse(pulito);
    const eserciziProposti: VoceRiepilogoPiano[] = [];

    for (const item of parsed.esercizi ?? []) {
      // Abbina per nome (case-insensitive) al catalogo reale: se l'AI ha
      // "inventato" un nome non presente, la voce viene scartata invece
      // di creare un esercizio fantasma — l'allenatore può comunque
      // aggiungerlo a mano dopo, dal catalogo vero.
      const trovato = catalogo.find((e) => e.nome.trim().toLowerCase() === String(item.nome).trim().toLowerCase());
      if (trovato) {
        eserciziProposti.push({ exerciseId: trovato.id, nome: trovato.nome, durataMinuti: Number(item.durata_minuti) || 10, note: String(item.note ?? "") });
      }
    }

    if (eserciziProposti.length === 0) {
      return { errore: true, messaggio: "L'AI non ha proposto nessun esercizio riconoscibile dal catalogo — percorso manuale sempre disponibile qui sopra." };
    }

    return { errore: false, argomentoSuggerito: parsed.argomento_suggerito || argomento, esercizi: eserciziProposti };
  } catch {
    return { errore: true, messaggio: "Risposta AI non nel formato atteso — percorso manuale sempre disponibile qui sopra." };
  }
}
