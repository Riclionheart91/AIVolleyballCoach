import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { carenzeAtleta } from "@/src/services/exercises";
import { istruzioniAggiuntive } from "@/src/services/pianoAnnuale";
import type { Exercise } from "@/src/types/database";

export interface PianoIndividuale {
  id: string;
  titolo: string;
  obiettivo: string;
  fondamentale_target: string | null;
  data_inizio: string;
  data_fine: string | null;
  stato: "attivo" | "concluso" | "sospeso";
  numero_esercizi: number;
  svolgimenti_settimana: number;
  attesi_settimana: number;
}

export interface EsercizioPiano {
  id: string;
  piano_id: string;
  exercise_id: string | null;
  nome_libero: string | null;
  indicazioni: string;
  volte_a_settimana: number;
  durata_minuti: number | null;
  ordine: number;
  quando: "riscaldamento" | "tecnico" | "autonomo";
}

export async function elencaPianiIndividuali(athleteId: string): Promise<PianoIndividuale[]> {
  const { data, error } = await supabaseClient.rpc("elenca_piani_individuali", { p_athlete_id: athleteId });
  if (error) throw error;
  return data ?? [];
}

export async function elencaEserciziPiano(pianoId: string): Promise<EsercizioPiano[]> {
  const { data, error } = await supabaseClient
    .from("piano_individuale_esercizi").select("*").eq("piano_id", pianoId).order("ordine");
  if (error) throw error;
  return data ?? [];
}

export async function creaPianoIndividuale(
  athleteId: string,
  titolo: string,
  obiettivo: string,
  fondamentaleTarget: string | null,
  dataFine: string | null,
): Promise<string> {
  const { data, error } = await supabaseClient
    .from("piani_individuali")
    .insert({ athlete_id: athleteId, titolo, obiettivo, fondamentale_target: fondamentaleTarget, data_fine: dataFine })
    .select("id").single();
  if (error) throw error;
  return data.id;
}

export async function aggiungiEsercizioPiano(pianoId: string, voce: Partial<EsercizioPiano>): Promise<void> {
  const { error } = await supabaseClient.from("piano_individuale_esercizi").insert({ piano_id: pianoId, ...voce });
  if (error) throw error;
}

export async function cambiaStatoPiano(pianoId: string, stato: PianoIndividuale["stato"]): Promise<void> {
  const { error } = await supabaseClient.from("piani_individuali").update({ stato }).eq("id", pianoId);
  if (error) throw error;
}

export async function eliminaPianoIndividuale(pianoId: string): Promise<void> {
  const { error } = await supabaseClient.from("piani_individuali").delete().eq("id", pianoId);
  if (error) throw error;
}

/** Segna l'esercizio come svolto oggi. Lo può registrare anche la persona interessata: è lei a sapere se l'ha fatto. */
export async function segnaSvolto(pianoEsercizioId: string, svolto: boolean): Promise<void> {
  if (svolto) {
    const { error } = await supabaseClient.from("piano_individuale_svolgimenti").insert({ piano_esercizio_id: pianoEsercizioId });
    if (error && !String(error.message).includes("duplicate")) throw error;
  } else {
    const oggi = new Date().toISOString().slice(0, 10);
    const { error } = await supabaseClient.from("piano_individuale_svolgimenti")
      .delete().eq("piano_esercizio_id", pianoEsercizioId).eq("data", oggi);
    if (error) throw error;
  }
}

export async function svolgimentiOggi(pianoId: string): Promise<Set<string>> {
  const oggi = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseClient
    .from("piano_individuale_svolgimenti")
    .select("piano_esercizio_id, piano_individuale_esercizi!inner(piano_id)")
    .eq("data", oggi)
    .eq("piano_individuale_esercizi.piano_id", pianoId);
  return new Set((data ?? []).map((r: { piano_esercizio_id: string }) => r.piano_esercizio_id));
}

export interface RisultatoPianoAI {
  errore: boolean;
  messaggio?: string;
  titolo?: string;
  obiettivo?: string;
  esercizi?: { nome: string; indicazioni: string; volte_a_settimana: number; durata_minuti: number; quando: string }[];
}

/**
 * Costruisce un piano individuale partendo dalle CARENZE REALI rilevate
 * dalle valutazioni, non da un'idea generica di "migliorare". Gli
 * esercizi sono pensati per essere svolti in autonomia o nel
 * riscaldamento, quindi con poco spazio e poca attrezzatura.
 */
export async function generaPianoIndividualeAI(
  teamId: string,
  athleteId: string,
  nomePersona: string,
  ruolo: string | null,
  catalogo: Exercise[],
  istruzioniExtra?: string,
): Promise<RisultatoPianoAI> {
  const carenze = await carenzeAtleta(athleteId).catch(() => []);
  if (carenze.length === 0) {
    return { errore: true, messaggio: "Nessuna valutazione recente: senza quelle non posso individuare le carenze su cui costruire il piano." };
  }

  const prompt =
    `Sei un allenatore di pallavolo. Costruisci un piano di lavoro INDIVIDUALE per ${nomePersona}` +
    (ruolo ? ` (${ruolo})` : "") + ".\n" +
    `Carenze rilevate dalle valutazioni: ${carenze.map((c) => `${c.fondamentale} media ${c.media}/10`).join(", ")}.\n` +
    `Gli esercizi devono aggredire queste carenze, essere svolgibili da soli o in coppia, richiedere poco spazio e poca attrezzatura, ` +
    `e collocarsi nel riscaldamento della seduta di squadra oppure in autonomia.\n` +
    `Esercizi già in catalogo (preferiscili quando adatti): ${catalogo.slice(0, 60).map((e) => e.nome).join(" | ")}\n\n` +
    `Rispondi SOLO con JSON:\n` +
    `{"titolo":"...","obiettivo":"una frase","esercizi":[{"nome":"...","indicazioni":"come si esegue e cosa curare","volte_a_settimana":2,"durata_minuti":10,"quando":"riscaldamento|autonomo"}]}\n` +
    `Massimo 5 esercizi: un piano individuale troppo lungo non viene seguito.` +
    istruzioniAggiuntive(istruzioniExtra);

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt } });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) return { errore: true, messaggio: [data.messaggio, data.dettagli].filter(Boolean).join("\n\n") };

  try {
    const pulito = String(data.testo).trim().replace(/^```json\s*|```$/g, "");
    const p = JSON.parse(pulito);
    return {
      errore: false,
      titolo: String(p.titolo ?? `Piano individuale — ${nomePersona}`),
      obiettivo: String(p.obiettivo ?? ""),
      esercizi: (p.esercizi ?? []).slice(0, 5).map((e: Record<string, unknown>) => ({
        nome: String(e.nome ?? "Esercizio"),
        indicazioni: String(e.indicazioni ?? ""),
        volte_a_settimana: Math.min(7, Math.max(1, Number(e.volte_a_settimana) || 2)),
        durata_minuti: Number(e.durata_minuti) || 10,
        quando: ["riscaldamento", "tecnico", "autonomo"].includes(String(e.quando)) ? String(e.quando) : "riscaldamento",
      })),
    };
  } catch {
    return { errore: true, messaggio: "Risposta AI non nel formato atteso." };
  }
}

/** Quante sedute risultano svolte questa settimana, per ciascun esercizio del piano. */
export async function svolgimentiDellaSettimana(pianoId: string): Promise<Record<string, number>> {
  const daQuando = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabaseClient
    .from("piano_individuale_svolgimenti")
    .select("piano_esercizio_id, piano_individuale_esercizi!inner(piano_id)")
    .gte("data", daQuando)
    .eq("piano_individuale_esercizi.piano_id", pianoId);
  const conteggio: Record<string, number> = {};
  for (const r of (data ?? []) as { piano_esercizio_id: string }[]) {
    conteggio[r.piano_esercizio_id] = (conteggio[r.piano_esercizio_id] ?? 0) + 1;
  }
  return conteggio;
}

/**
 * Porta a "quante" le sedute svolte nella settimana per un esercizio.
 * Le righe hanno una data (con vincolo di unicità per giorno), quindi
 * aggiungere o togliere significa scrivere su giorni distinti a
 * ritroso: è il modo più semplice per rappresentare "2 sedute su 3"
 * senza inventare un'altra tabella.
 */
export async function impostaSvolgimentiSettimana(pianoEsercizioId: string, quante: number): Promise<void> {
  const daQuando = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: esistenti } = await supabaseClient
    .from("piano_individuale_svolgimenti")
    .select("id, data")
    .eq("piano_esercizio_id", pianoEsercizioId)
    .gte("data", daQuando)
    .order("data");

  const attuali = esistenti ?? [];
  if (quante < attuali.length) {
    const daRimuovere = attuali.slice(quante).map((r) => r.id);
    if (daRimuovere.length > 0) {
      const { error } = await supabaseClient.from("piano_individuale_svolgimenti").delete().in("id", daRimuovere);
      if (error) throw error;
    }
    return;
  }

  const giaUsate = new Set(attuali.map((r) => r.data));
  const nuove: { piano_esercizio_id: string; data: string }[] = [];
  for (let giorno = 0; giorno < 7 && attuali.length + nuove.length < quante; giorno++) {
    const d = new Date(Date.now() - giorno * 86400000).toISOString().slice(0, 10);
    if (!giaUsate.has(d)) nuove.push({ piano_esercizio_id: pianoEsercizioId, data: d });
  }
  if (nuove.length > 0) {
    const { error } = await supabaseClient.from("piano_individuale_svolgimenti").insert(nuove);
    if (error) throw error;
  }
}
