import { chiHaSegnato } from "@/src/lib/andamentoPunti";
import { TESTO_CAUSA } from "@/src/lib/rivivi";

export interface RigaCronaca {
  id: string;
  creatoIl: string;
  numeroSet: number;
  /** Punteggio del set DOPO questa azione. */
  noi: number;
  avv: number;
  /** Chi ha segnato con questa azione; null se l'azione non cambia il punteggio. */
  segnato: "noi" | "avversario" | null;
  athleteId: string | null;
  testo: string;
  zone: string;
}

interface EventoBase {
  id: string;
  set_id: string;
  skill: string;
  esito: string | null;
  athlete_id: string | null;
  creato_il: string;
  causa?: string | null;
  zona_partenza?: number | null;
  zona_arrivo?: number | null;
}

/**
 * Cronaca della partita punto per punto, dalla azione piu' recente alla piu' vecchia.
 * Il punteggio di ogni riga si ricostruisce contando i punti set per set, in ordine di tempo.
 */
export function costruisciCronaca(eventi: EventoBase[], numeroDelSet: (setId: string) => number): RigaCronaca[] {
  const cronologici = [...eventi].sort((a, b) => (a.creato_il < b.creato_il ? -1 : a.creato_il > b.creato_il ? 1 : 0));
  const punti: Record<string, { noi: number; avv: number }> = {};
  const righe: RigaCronaca[] = [];
  for (const e of cronologici) {
    const p = punti[e.set_id] ?? (punti[e.set_id] = { noi: 0, avv: 0 });
    const chi = chiHaSegnato(e.skill, e.esito);
    if (chi === "noi") p.noi += 1;
    else if (chi === "avversario") p.avv += 1;
    const eUnPunto = e.skill === "Punto_avversario" || e.skill === "Punto_nostro";
    const testo = eUnPunto
      ? (TESTO_CAUSA[e.causa ?? ""] ?? (e.skill === "Punto_avversario" ? "Punto avversario" : "Punto nostro"))
      : `${e.skill}${e.esito ? ` ${e.esito}` : ""}`;
    righe.push({
      id: e.id,
      creatoIl: e.creato_il,
      numeroSet: numeroDelSet(e.set_id),
      noi: p.noi,
      avv: p.avv,
      segnato: chi,
      athleteId: e.athlete_id,
      testo,
      zone: `${e.zona_partenza ? ` · da z${e.zona_partenza}` : ""}${e.zona_arrivo ? ` → z${e.zona_arrivo}` : ""}`,
    });
  }
  return righe.reverse();
}
