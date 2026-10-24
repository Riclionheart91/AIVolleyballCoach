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
  /** Stesso valore per tutte le copie assegnate insieme; persone_gruppo = quante sono (1 = piano di una sola persona). */
  gruppo_id: string | null;
  persone_gruppo: number;
}

/** Su chi vale una modifica a un piano condiviso: solo sulla persona che si sta guardando o su tutto il gruppo. */
export type Ambito = "singolo" | "gruppo";

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
  /** Stesso valore per lo stesso esercizio nelle copie del gruppo; null = esercizio solo di questa persona. */
  voce_id: string | null;
  /** Era condiviso ed e' stato ritoccato per questa persona: le modifiche di gruppo lo saltano. */
  personalizzato: boolean;
}

/** Identificatore casuale (uuid v4) per collegare le copie: non dipende da crypto, che sul telefono puo' mancare. */
function nuovoId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
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

/** Un esercizio da mettere in un piano: scelto dal catalogo (exercise_id) oppure scritto a mano. */
export interface BozzaEsercizio {
  exercise_id: string | null;
  nome: string;
  indicazioni: string;
  volte_a_settimana: number;
  durata_minuti: number;
  quando: EsercizioPiano["quando"];
  /** Solo per la creazione di piani di gruppo: collega lo stesso esercizio nelle varie copie. */
  voce_id?: string | null;
}

export function bozzaDaEsercizioPiano(e: EsercizioPiano): BozzaEsercizio {
  return {
    exercise_id: e.exercise_id,
    nome: e.nome_libero ?? "Esercizio",
    indicazioni: e.indicazioni,
    volte_a_settimana: e.volte_a_settimana,
    durata_minuti: e.durata_minuti ?? 10,
    quando: e.quando,
    voce_id: e.voce_id,
  };
}

function campiEsercizio(b: BozzaEsercizio) {
  return {
    exercise_id: b.exercise_id,
    nome_libero: b.nome.trim(),
    indicazioni: b.indicazioni.trim(),
    volte_a_settimana: Math.min(7, Math.max(1, b.volte_a_settimana || 2)),
    durata_minuti: b.durata_minuti || null,
    quando: b.quando,
  };
}

function rigaEsercizio(pianoId: string, b: BozzaEsercizio, ordine: number, voceId: string | null) {
  return { piano_id: pianoId, ...campiEsercizio(b), ordine, voce_id: voceId, personalizzato: false };
}

/**
 * Assegna lo stesso piano a piu' persone: ognuna riceve la sua copia, con i suoi svolgimenti da spuntare.
 * Con piu' persone le copie restano collegate (stesso gruppo), cosi' si possono cambiare insieme.
 * `gruppoId` serve per aggiungere copie a un gruppo che esiste gia'. Ritorna quante copie sono state create.
 */
export async function creaPianoPerPersone(
  athleteIds: string[],
  piano: { titolo: string; obiettivo: string; fondamentale_target: string | null; data_fine: string | null },
  esercizi: BozzaEsercizio[],
  gruppoId?: string | null,
): Promise<number> {
  const gruppo = gruppoId ?? (athleteIds.length > 1 ? nuovoId() : null);
  // Lo stesso esercizio ha lo stesso voce_id in tutte le copie; in un piano di una sola persona non serve.
  const voci = esercizi.map((b) => b.voce_id ?? (gruppo ? nuovoId() : null));
  let create = 0;
  for (const athleteId of athleteIds) {
    const { data, error } = await supabaseClient
      .from("piani_individuali")
      .insert({ athlete_id: athleteId, titolo: piano.titolo, obiettivo: piano.obiettivo, fondamentale_target: piano.fondamentale_target, data_fine: piano.data_fine, gruppo_id: gruppo })
      .select("id").single();
    if (error) throw error;
    if (esercizi.length > 0) {
      const { error: e2 } = await supabaseClient.from("piano_individuale_esercizi").insert(esercizi.map((b, i) => rigaEsercizio(data.id, b, i, voci[i])));
      if (e2) throw e2;
    }
    create++;
  }
  return create;
}

/**
 * Copia un piano su altre persone, collegandole al suo gruppo. Se il piano era di una persona sola,
 * nasce il gruppo adesso (anche la persona di partenza ne entra a far parte).
 */
export async function copiaPianoSuPersone(piano: PianoIndividuale, athleteIds: string[]): Promise<number> {
  const { data: p, error } = await supabaseClient.from("piani_individuali").select("titolo, obiettivo, fondamentale_target, data_fine, gruppo_id").eq("id", piano.id).single();
  if (error) throw error;
  const gruppo: string = p.gruppo_id ?? nuovoId();
  const esercizi = await elencaEserciziPiano(piano.id);
  if (!p.gruppo_id) {
    const { error: e1 } = await supabaseClient.from("piani_individuali").update({ gruppo_id: gruppo }).eq("id", piano.id);
    if (e1) throw e1;
    for (const e of esercizi) {
      if (e.voce_id) continue;
      e.voce_id = nuovoId();
      const { error: e2 } = await supabaseClient.from("piano_individuale_esercizi").update({ voce_id: e.voce_id }).eq("id", e.id);
      if (e2) throw e2;
    }
  }
  // Un esercizio proprio della persona di partenza (voce_id vuoto) non si collega: le copie ricevono una voce nuova.
  const bozze = esercizi.map((e) => ({ ...bozzaDaEsercizioPiano(e), voce_id: e.voce_id ?? nuovoId() }));
  return creaPianoPerPersone(athleteIds, { titolo: p.titolo, obiettivo: p.obiettivo, fondamentale_target: p.fondamentale_target, data_fine: p.data_fine }, bozze, gruppo);
}

/** Id di tutti i piani del gruppo (compreso questo); un piano senza gruppo e' un gruppo di se' stesso. */
async function pianiDelGruppo(piano: { id: string; gruppo_id: string | null }): Promise<string[]> {
  if (!piano.gruppo_id) return [piano.id];
  const { data, error } = await supabaseClient.from("piani_individuali").select("id").eq("gruppo_id", piano.gruppo_id);
  if (error) throw error;
  return (data ?? []).map((r: { id: string }) => r.id);
}

/** Righe dello stesso esercizio nelle altre copie, escluse le personalizzate (che la modifica di gruppo salta). */
async function righeCollegate(e: EsercizioPiano): Promise<{ da_toccare: EsercizioPiano[]; saltati: number }> {
  if (!e.voce_id) return { da_toccare: [e], saltati: 0 };
  const { data, error } = await supabaseClient.from("piano_individuale_esercizi").select("*").eq("voce_id", e.voce_id);
  if (error) throw error;
  const tutte = (data ?? []) as EsercizioPiano[];
  const da_toccare = tutte.filter((r) => r.id === e.id || !r.personalizzato);
  return { da_toccare, saltati: tutte.length - da_toccare.length };
}

/** Aggiunge un esercizio: a questa persona oppure, con ambito "gruppo", a tutte le copie (stesso esercizio collegato). */
export async function aggiungiEsercizioAlPiano(piano: PianoIndividuale, b: BozzaEsercizio, ambito: Ambito): Promise<void> {
  const soloQuesto = ambito === "singolo" || !piano.gruppo_id;
  const ids = soloQuesto ? [piano.id] : await pianiDelGruppo(piano);
  const voce = soloQuesto ? null : nuovoId();
  for (const id of ids) {
    const { count } = await supabaseClient.from("piano_individuale_esercizi").select("id", { count: "exact", head: true }).eq("piano_id", id);
    const { error } = await supabaseClient.from("piano_individuale_esercizi").insert(rigaEsercizio(id, b, count ?? 0, voce));
    if (error) throw error;
  }
}

/**
 * Modifica un esercizio mantenendo gli svolgimenti gia' spuntati. Per una persona sola l'esercizio, se era
 * condiviso, diventa "personalizzato". Per il gruppo cambia in tutte le copie tranne le personalizzate.
 * Ritorna quante copie personalizzate sono state lasciate com'erano.
 */
export async function aggiornaEsercizioPiano(e: EsercizioPiano, b: BozzaEsercizio, ambito: Ambito): Promise<number> {
  if (ambito === "singolo" || !e.voce_id) {
    const { error } = await supabaseClient.from("piano_individuale_esercizi")
      .update({ ...campiEsercizio(b), personalizzato: e.voce_id != null }).eq("id", e.id);
    if (error) throw error;
    return 0;
  }
  const { da_toccare, saltati } = await righeCollegate(e);
  const { error } = await supabaseClient.from("piano_individuale_esercizi")
    .update({ ...campiEsercizio(b), personalizzato: false }).in("id", da_toccare.map((r) => r.id));
  if (error) throw error;
  return saltati;
}

/** Toglie un esercizio da questa persona o da tutte le copie (tranne le personalizzate). Ritorna quante ne ha lasciate. */
export async function eliminaEsercizioPiano(e: EsercizioPiano, ambito: Ambito): Promise<number> {
  const { da_toccare, saltati } = ambito === "singolo" ? { da_toccare: [e], saltati: 0 } : await righeCollegate(e);
  const { error } = await supabaseClient.from("piano_individuale_esercizi").delete().in("id", da_toccare.map((r) => r.id));
  if (error) throw error;
  return saltati;
}

/**
 * Sostituisce un esercizio con un altro nella stessa posizione: i vecchi svolgimenti non si portano dietro, e' un altro esercizio.
 * Per il gruppo il nuovo esercizio e' lo stesso in tutte le copie coinvolte (tranne le personalizzate).
 */
export async function sostituisciEsercizioPiano(e: EsercizioPiano, b: BozzaEsercizio, ambito: Ambito): Promise<number> {
  const soloQuesto = ambito === "singolo" || !e.voce_id;
  const { da_toccare, saltati } = soloQuesto ? { da_toccare: [e], saltati: 0 } : await righeCollegate(e);
  const voce = soloQuesto ? null : nuovoId();
  for (const r of da_toccare) {
    const { error } = await supabaseClient.from("piano_individuale_esercizi").insert(rigaEsercizio(r.piano_id, b, r.ordine, voce));
    if (error) throw error;
    const { error: e2 } = await supabaseClient.from("piano_individuale_esercizi").delete().eq("id", r.id);
    if (e2) throw e2;
  }
  return saltati;
}

/** Riporta un esercizio personalizzato alla versione del gruppo (quella delle altre copie, se ce n'e' una). */
export async function riallineaEsercizio(e: EsercizioPiano): Promise<void> {
  if (!e.voce_id) return;
  const { data } = await supabaseClient.from("piano_individuale_esercizi").select("*")
    .eq("voce_id", e.voce_id).eq("personalizzato", false).neq("id", e.id).limit(1);
  const riferimento = (data ?? [])[0] as EsercizioPiano | undefined;
  const campi = riferimento ? campiEsercizio(bozzaDaEsercizioPiano(riferimento)) : {};
  const { error } = await supabaseClient.from("piano_individuale_esercizi").update({ ...campi, personalizzato: false }).eq("id", e.id);
  if (error) throw error;
}

/** Conclude, riattiva o elimina il piano di una persona oppure di tutto il gruppo. */
export async function cambiaStatoPianoGruppo(piano: PianoIndividuale, stato: PianoIndividuale["stato"], ambito: Ambito): Promise<void> {
  const ids = ambito === "gruppo" ? await pianiDelGruppo(piano) : [piano.id];
  const { error } = await supabaseClient.from("piani_individuali").update({ stato }).in("id", ids);
  if (error) throw error;
}

export async function eliminaPianoGruppo(piano: PianoIndividuale, ambito: Ambito): Promise<void> {
  const ids = ambito === "gruppo" ? await pianiDelGruppo(piano) : [piano.id];
  const { error } = await supabaseClient.from("piani_individuali").delete().in("id", ids);
  if (error) throw error;
}

export interface MembroGruppo {
  piano_id: string; athlete_id: string; nome: string; cognome: string; stato: PianoIndividuale["stato"]; svolti: number; attesi: number;
}

/** Chi e' nel gruppo del piano e a che punto e' questa settimana (solo staff). */
export async function avanzamentoGruppo(pianoId: string): Promise<MembroGruppo[]> {
  const { data, error } = await supabaseClient.rpc("avanzamento_gruppo_piano", { p_piano_id: pianoId });
  if (error) throw error;
  return (data ?? []) as MembroGruppo[];
}

/** Toglie una persona dal gruppo: tiene il suo piano com'e', ma non cambia piu' con gli altri. */
export async function togliDalGruppo(pianoId: string): Promise<void> {
  const { error } = await supabaseClient.from("piani_individuali").update({ gruppo_id: null }).eq("id", pianoId);
  if (error) throw error;
  const { error: e2 } = await supabaseClient.from("piano_individuale_esercizi").update({ voce_id: null, personalizzato: false }).eq("piano_id", pianoId);
  if (e2) throw e2;
}
