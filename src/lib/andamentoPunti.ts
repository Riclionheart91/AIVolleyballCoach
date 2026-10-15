import type { Esito, Skill } from "@/src/types/database";

/**
 * Chi ha segnato il punto con questo evento. Stessa regola del database
 * (trigger aggiorna_punteggio_da_evento): un errore nostro e' punto loro,
 * un punto nostro e' punto nostro, tutto il resto non cambia il punteggio.
 */
export function chiHaSegnato(skill: Skill | string, esito: Esito | string | null): "noi" | "avversario" | null {
  if (skill === "Punto_avversario" || skill === "Fallo_rotazione" || esito === "errore") return "avversario";
  if (skill === "Punto_nostro" || esito === "punto") return "noi";
  return null;
}

export interface PuntoAndamento {
  /** Punteggio DOPO questo punto. */
  noi: number;
  avv: number;
  chi: "noi" | "avversario";
}

/** Ricostruisce il punteggio punto dopo punto, per ciascun set, dagli eventi in ordine cronologico. */
export function costruisciAndamentoPerSet(
  eventi: { set_id: string; skill: Skill | string; esito: Esito | string | null }[],
): Record<string, PuntoAndamento[]> {
  const perSet: Record<string, PuntoAndamento[]> = {};
  for (const e of eventi) {
    const chi = chiHaSegnato(e.skill, e.esito);
    if (!chi) continue;
    const lista = perSet[e.set_id] ?? (perSet[e.set_id] = []);
    const prec = lista.length > 0 ? lista[lista.length - 1] : { noi: 0, avv: 0 };
    lista.push({ noi: prec.noi + (chi === "noi" ? 1 : 0), avv: prec.avv + (chi === "avversario" ? 1 : 0), chi });
  }
  return perSet;
}

/** Serie piu' lunga di punti consecutivi, per ciascuna squadra. */
export function seriePiuLunghe(punti: PuntoAndamento[]): { noi: number; avversario: number } {
  let noi = 0, avversario = 0, corrente = 0;
  let chiCorrente: "noi" | "avversario" | null = null;
  for (const p of punti) {
    corrente = p.chi === chiCorrente ? corrente + 1 : 1;
    chiCorrente = p.chi;
    if (p.chi === "noi") noi = Math.max(noi, corrente);
    else avversario = Math.max(avversario, corrente);
  }
  return { noi, avversario };
}

/**
 * Quanti punti di fila ha fatto l'avversario fino ad ora nel set indicato.
 * `eventiRecentiPrimaIPiuNuovi`: dal piu' recente al piu' vecchio. Gli eventi
 * che non cambiano il punteggio (es. una ricezione buona) non spezzano la serie.
 */
export function serieAvversariaInCorso(
  eventiRecentiPrimaIPiuNuovi: { set_id: string; skill: Skill | string; esito: Esito | string | null }[],
  setId: string,
): number {
  let serie = 0;
  for (const e of eventiRecentiPrimaIPiuNuovi) {
    if (e.set_id !== setId) continue;
    const chi = chiHaSegnato(e.skill, e.esito);
    if (chi === null) continue;
    if (chi === "avversario") serie += 1;
    else break;
  }
  return serie;
}

/** Da quanti punti di fila avversari conviene avvisare di valutare un time-out. */
export const SOGLIA_SERIE_AVVERSARIA = 3;
