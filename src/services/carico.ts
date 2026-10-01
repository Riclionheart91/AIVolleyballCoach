// src/services/carico.ts
//
// Monitoraggio del carico di allenamento, dalla discussione sul
// confronto con TeamBuildr/CoachMePlus: niente GPS, niente questionari
// nuovi da compilare — si calcola da due dati che l'app raccoglie già,
// durata della seduta (trainings.durata_totale_minuti) e percezione
// dello sforzo (rpe.valore, scala 1-10 compilata dall'atleta).
//
// Metodo "session-RPE" di Foster: carico di una seduta = minuti × RPE.
// Rapporto acuto:cronico (ACWR) = carico dell'ultima settimana diviso
// la media settimanale delle ultime 4 — un rapporto fuori dalla
// "sweet spot" 0.8-1.3 segnala un aumento di carico troppo rapido
// (rischio infortunio) o troppo lento (probabile detraining).
// Soglie standard in letteratura S&C, non inventate qui.

import { supabaseClient } from "@/src/lib/supabase";

export type LivelloCarico = "insufficiente" | "basso" | "normale" | "da_monitorare" | "alto";

export interface CaricoAtleta {
  /** null finché non c'è storico sufficiente per un rapporto affidabile. */
  rapporto: number | null;
  /** Somma minuti×RPE delle sedute negli ultimi 7 giorni. */
  caricoAcuto: number;
  /** Media settimanale di minuti×RPE sulle ultime 4 settimane. */
  caricoCronicoSettimanale: number;
  livello: LivelloCarico;
  /** Giorni tra la prima seduta con RPE trovata (negli ultimi 28gg) e oggi. */
  giorniStorico: number;
}

interface RigaRpe {
  valore: number;
  trainings: { data: string; durata_totale_minuti: number | null } | null;
}

const GIORNI_ACUTO = 7;
const GIORNI_CRONICO = 28;
/** Sotto queste due settimane di storico il rapporto è troppo rumoroso per dire qualcosa. */
const GIORNI_STORICO_MINIMO = 14;

export async function leggiCaricoAtleta(athleteId: string): Promise<CaricoAtleta> {
  const oggi = new Date();
  const dalCronico = new Date(oggi);
  dalCronico.setDate(dalCronico.getDate() - GIORNI_CRONICO);

  const { data, error } = await supabaseClient
    .from("rpe")
    .select("valore, trainings!inner(data, durata_totale_minuti)")
    .eq("athlete_id", athleteId)
    .gte("trainings.data", dalCronico.toISOString());
  if (error) throw error;

  const righe = (data ?? []) as unknown as RigaRpe[];
  const dalAcuto = new Date(oggi);
  dalAcuto.setDate(dalAcuto.getDate() - GIORNI_ACUTO);

  let caricoAcuto = 0;
  let caricoCronicoTotale = 0;
  let primaData: Date | null = null;

  for (const r of righe) {
    if (!r.trainings?.durata_totale_minuti) continue;
    const dataSeduta = new Date(r.trainings.data);
    const carico = r.trainings.durata_totale_minuti * r.valore;
    caricoCronicoTotale += carico;
    if (dataSeduta >= dalAcuto) caricoAcuto += carico;
    if (!primaData || dataSeduta < primaData) primaData = dataSeduta;
  }

  const giorniStorico = primaData ? Math.round((oggi.getTime() - primaData.getTime()) / (24 * 60 * 60 * 1000)) : 0;
  const caricoCronicoSettimanale = caricoCronicoTotale / (GIORNI_CRONICO / 7);

  let rapporto: number | null = null;
  let livello: LivelloCarico = "insufficiente";

  if (giorniStorico >= GIORNI_STORICO_MINIMO && caricoCronicoSettimanale > 0) {
    rapporto = caricoAcuto / caricoCronicoSettimanale;
    if (rapporto < 0.8) livello = "basso";
    else if (rapporto <= 1.3) livello = "normale";
    else if (rapporto <= 1.5) livello = "da_monitorare";
    else livello = "alto";
  }

  return { rapporto, caricoAcuto, caricoCronicoSettimanale, livello, giorniStorico };
}
