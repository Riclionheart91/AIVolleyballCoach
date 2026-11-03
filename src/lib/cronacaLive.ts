import { chiHaSegnato } from "@/src/lib/andamentoPunti";

export interface RigaCronaca {
  id: string;
  creatoIl: string;
  numeroSet: number;
  /** Punteggio del set DOPO questa azione. */
  noi: number;
  avv: number;
  /** Chi ha segnato con questa azione; null se l'azione non cambia il punteggio. */
  segnato: "noi" | "avversario" | null;
  /** Punti di fila di chi ha segnato, compreso questo (0 se l'azione non e' un punto). */
  serie: number;
  /** La frase della telecronaca: cosa e' successo. */
  frase: string;
  /** Dove e' partita/caduta la palla, se registrato. */
  zone: string;
}

interface EventoBase {
  id: string;
  set_id: string;
  skill: string;
  esito: string | null;
  athlete_id: string | null;
  creato_il: string;
  qualita?: string | null;
  causa?: string | null;
  zona_partenza?: number | null;
  zona_arrivo?: number | null;
}

/** Il punto assegnato senza giocatrice: il motivo, in una frase. */
function fraseDelPuntoDiretto(skill: string, causa: string | null | undefined): string {
  if (skill === "Punto_nostro") {
    if (causa === "punto_diretto_nostro") return "Punto diretto per noi";
    if (causa === "muro_nostro") return "Muro vincente";
    if (causa === "difesa_nostro") return "Punto dopo difesa e contrattacco";
    return "Errore degli avversari";
  }
  if (skill === "Punto_avversario") {
    if (causa === "punto_diretto_loro") return "Punto diretto degli avversari";
    if (causa === "errore_nostro") return "Errore nostro";
    return "Punto degli avversari";
  }
  return "Fallo di rotazione nostro";
}

/** Una azione di gioco raccontata come in una telecronaca scritta. `di` restituisce " di Cognome #n" o stringa vuota. */
function frase(e: EventoBase, di: string): string {
  const q = e.qualita;
  switch (e.skill) {
    case "Servizio":
      if (e.esito === "punto") return `Ace${di ? `: battuta vincente${di}` : ": battuta vincente"}`;
      if (e.esito === "errore") return `Errore in battuta${di}`;
      return `Battuta${di}`;
    case "Ricezione":
      if (e.esito === "errore") return `Ricezione sbagliata${di}`;
      if (e.esito === "punto") return `Ricezione vincente${di}`;
      return q === "ottima" ? `Ricezione ottima${di}` : q === "buona" ? `Ricezione buona${di}` : q === "scarsa" ? `Ricezione scarsa${di}` : `Ricezione${di}`;
    case "Attacco":
      if (e.esito === "punto") return `Attacco vincente${di}`;
      if (e.esito === "errore") return `Attacco sbagliato${di}`;
      return `Attacco${di}, la palla resta in gioco`;
    case "Muro":
      if (e.esito === "punto") return `Muro vincente${di}`;
      if (e.esito === "errore") return `Errore a muro${di}`;
      return `Muro${di}, la palla resta in gioco`;
    case "Difesa":
      if (e.esito === "punto") return `Punto dopo la difesa${di}`;
      if (e.esito === "errore") return `Errore in difesa${di}`;
      return `Difesa${di}`;
    default:
      return `${e.skill}${e.esito ? ` ${e.esito}` : ""}${di}`;
  }
}

/**
 * Cronaca della partita come telecronaca scritta, dalla azione piu' recente alla piu' vecchia.
 * Il punteggio e la serie di ogni riga si ricostruiscono contando i punti set per set, in ordine di tempo.
 * `nome` restituisce il nome da mostrare per un'atleta (es. "Cortese #22").
 */
export function costruisciCronaca(
  eventi: EventoBase[],
  numeroDelSet: (setId: string) => number,
  nome: (athleteId: string) => string,
): RigaCronaca[] {
  const cronologici = [...eventi].sort((a, b) => (a.creato_il < b.creato_il ? -1 : a.creato_il > b.creato_il ? 1 : 0));
  const stato: Record<string, { noi: number; avv: number; ultimo: "noi" | "avversario" | null; serie: number }> = {};
  const righe: RigaCronaca[] = [];
  for (const e of cronologici) {
    const p = stato[e.set_id] ?? (stato[e.set_id] = { noi: 0, avv: 0, ultimo: null, serie: 0 });
    const chi = chiHaSegnato(e.skill, e.esito);
    if (chi) {
      if (chi === "noi") p.noi += 1; else p.avv += 1;
      p.serie = p.ultimo === chi ? p.serie + 1 : 1;
      p.ultimo = chi;
    }
    const direttoSenzaGiocatrice = e.skill === "Punto_avversario" || e.skill === "Punto_nostro" || e.skill === "Fallo_rotazione";
    const di = e.athlete_id ? ` di ${nome(e.athlete_id)}` : "";
    righe.push({
      id: e.id,
      creatoIl: e.creato_il,
      numeroSet: numeroDelSet(e.set_id),
      noi: p.noi,
      avv: p.avv,
      segnato: chi,
      serie: chi ? p.serie : 0,
      frase: direttoSenzaGiocatrice ? fraseDelPuntoDiretto(e.skill, e.causa) : frase(e, di),
      zone: e.zona_partenza || e.zona_arrivo
        ? ` (${e.zona_partenza ? `da zona ${e.zona_partenza}` : ""}${e.zona_partenza && e.zona_arrivo ? " " : ""}${e.zona_arrivo ? `${e.zona_partenza ? "a" : "in"} zona ${e.zona_arrivo}` : ""})`
        : "",
    });
  }
  return righe.reverse();
}
