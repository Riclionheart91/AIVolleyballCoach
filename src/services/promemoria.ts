import { supabaseClient } from "@/src/lib/supabase";

/** Promemoria che l'allenatore puo' rinviare alla data del ciclo successivo. */
export type TipoPromemoria = "valutazioni" | "piano_annuale";

export interface RinviiPromemoria {
  valutazioni_fino_a: string | null;
  piano_fino_a: string | null;
  giorni_ciclo_valutazione: number;
}

export const GIORNI_CICLO_PIANO = 30;

/** Oggi come AAAA-MM-GG nel fuso del telefono. */
export function oggiLocale(): string {
  return new Date().toLocaleDateString("en-CA");
}

export async function leggiRinvii(teamId: string): Promise<RinviiPromemoria | null> {
  const { data, error } = await supabaseClient.rpc("leggi_rinvii_promemoria", { p_team_id: teamId });
  if (error) throw error;
  return ((data as RinviiPromemoria[] | null) ?? [])[0] ?? null;
}

/** `finoA` null = riattiva subito il promemoria. */
export async function rinviaPromemoria(teamId: string, tipo: TipoPromemoria, finoA: string | null): Promise<void> {
  const { error } = await supabaseClient.rpc("rinvia_promemoria", { p_team_id: teamId, p_tipo: tipo, p_fino_a: finoA });
  if (error) throw error;
}

/** Il promemoria e' rinviato finche' la data non arriva: quel giorno ricompare. */
export function rinvioAttivo(finoA: string | null | undefined): boolean {
  return !!finoA && finoA > oggiLocale();
}

/** La data del ciclo successivo: oggi piu' i giorni di cadenza di quel promemoria. */
export function dataProssimoCiclo(tipo: TipoPromemoria, r: RinviiPromemoria | null): string {
  const giorni = tipo === "valutazioni" ? (r?.giorni_ciclo_valutazione ?? 30) : GIORNI_CICLO_PIANO;
  const d = new Date();
  d.setDate(d.getDate() + giorni);
  return d.toLocaleDateString("en-CA");
}

export function formattaData(iso: string): string {
  const [a, m, g] = iso.split("-");
  return `${g}/${m}/${a}`;
}

export function rinvioDi(tipo: TipoPromemoria, r: RinviiPromemoria | null): string | null {
  return (tipo === "valutazioni" ? r?.valutazioni_fino_a : r?.piano_fino_a) ?? null;
}
