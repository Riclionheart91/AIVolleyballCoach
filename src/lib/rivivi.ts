import { chiHaSegnato } from "@/src/lib/andamentoPunti";

export interface EventoRivivi {
  set_id: string;
  skill: string;
  esito: string | null;
  athlete_id: string | null;
  causa?: string | null;
}

export interface PuntoRivivi {
  numero: number;
  noi: number;
  avv: number;
  chi: "noi" | "avversario";
  testo: string;
  /** Punti di fila della squadra che ha segnato, compreso questo (si evidenzia da 3 in su). */
  serie: number;
}

const NOMI_SKILL: Record<string, string> = { Servizio: "battuta", Ricezione: "ricezione", Attacco: "attacco", Muro: "muro", Difesa: "difesa" };

/** Etichette dei punti diretti (senza giocatrice) quando e' stato indicato il motivo. */
export const TESTO_CAUSA: Record<string, string> = {
  punto_diretto_loro: "Punto diretto loro",
  errore_nostro: "Errore nostro (non attribuito)",
  errore_loro: "Errore avversario",
  punto_diretto_nostro: "Punto diretto nostro",
  muro_nostro: "Muro vincente (non attribuito)",
  difesa_nostro: "Punto dopo difesa/contrattacco (non attribuito)",
};

/** Come e' arrivato il punto, in poche parole. */
export function descriviPunto(e: EventoRivivi, nome: (id: string) => string): string {
  const chi = e.athlete_id ? nome(e.athlete_id) : null;
  if (e.skill === "Punto_nostro") return TESTO_CAUSA[e.causa ?? ""] ?? "Errore avversario";
  if (e.skill === "Punto_avversario") return TESTO_CAUSA[e.causa ?? ""] ?? "Errore nostro (non attribuito)";
  if (e.skill === "Fallo_rotazione") return "Fallo di rotazione nostro";
  const fond = NOMI_SKILL[e.skill] ?? e.skill.toLowerCase();
  if (e.esito === "punto") return e.skill === "Servizio" ? `Ace${chi ? ` — ${chi}` : ""}` : `Punto di ${fond}${chi ? ` — ${chi}` : ""}`;
  return `Errore in ${fond}${chi ? ` — ${chi}` : ""}`;
}

/** Punto per punto, per ciascun set, con punteggio, autore e serie. */
export function costruisciRivivi(eventi: EventoRivivi[], nome: (id: string) => string): Record<string, PuntoRivivi[]> {
  const perSet: Record<string, PuntoRivivi[]> = {};
  for (const e of eventi) {
    const chi = chiHaSegnato(e.skill, e.esito);
    if (!chi) continue;
    const lista = perSet[e.set_id] ?? (perSet[e.set_id] = []);
    const prec = lista[lista.length - 1];
    const serie = prec && prec.chi === chi ? prec.serie + 1 : 1;
    lista.push({
      numero: lista.length + 1,
      noi: (prec?.noi ?? 0) + (chi === "noi" ? 1 : 0),
      avv: (prec?.avv ?? 0) + (chi === "avversario" ? 1 : 0),
      chi,
      testo: descriviPunto(e, nome),
      serie,
    });
  }
  return perSet;
}
