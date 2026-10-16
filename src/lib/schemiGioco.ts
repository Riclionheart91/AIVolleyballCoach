/**
 * Schemi di gioco: in ricezione, in difesa e in copertura d'attacco le
 * giocatrici non stanno nelle posizioni di rotazione (1-6) ma si
 * dispongono secondo uno schema. Uno schema dice, per una fase e una
 * rotazione, in quale ZONA del campo va ciascuna POSIZIONE di rotazione.
 * La rotazione e' identificata da dove si trova la palleggiatrice (1-6).
 */

export type FaseSchema = "ricezione" | "difesa" | "copertura";

export const FASI_SCHEMA: { fase: FaseSchema; etichetta: string; descrizione: string }[] = [
  { fase: "ricezione", etichetta: "Ricezione", descrizione: "Serve l'avversario: come ci disponiamo a ricevere." },
  { fase: "difesa", etichetta: "Difesa", descrizione: "Dopo la nostra battuta: come ci disponiamo in difesa." },
  { fase: "copertura", etichetta: "Copertura", descrizione: "Dopo il nostro attacco: come ci disponiamo in copertura." },
];

/**
 * Per ogni fase si possono tenere due schemi fra cui passare durante la
 * partita (es. in difesa: muro diagonale oppure muro lungo linea).
 */
export const VARIANTI_SCHEMA: Record<FaseSchema, [string, string]> = {
  ricezione: ["Standard", "Alternativa"],
  difesa: ["Muro diagonale", "Muro lungo linea"],
  copertura: ["Standard", "Alternativa"],
};

export type VarianteSchema = 1 | 2;

/** Posizione di rotazione -> zona del campo. */
export type Assegnazioni = Record<string, number>;

export const SCHEMA_BASE: Assegnazioni = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6 };

export function chiaveSchema(fase: FaseSchema, variante: number, rotazione: number): string {
  return `${fase}:${variante}:${rotazione}`;
}

/** Controlla che l'oggetto sia una permutazione completa di 1-6; altrimenti si usa lo schema base. */
export function assegnazioniValide(a: unknown): a is Assegnazioni {
  if (!a || typeof a !== "object") return false;
  const zone = new Set<number>();
  for (let s = 1; s <= 6; s++) {
    const z = Number((a as Record<string, unknown>)[String(s)]);
    if (!Number.isInteger(z) || z < 1 || z > 6) return false;
    zone.add(z);
  }
  return zone.size === 6;
}

/**
 * Rotazione = posizione in cui si trova la palleggiatrice (1-6).
 * Se non c'e' una palleggiatrice in campo, e' sconosciuta (null) e si
 * restano le posizioni di rotazione.
 */
export function rotazioneDaFormazione(
  formazione: { athlete_id: string; posizione: number | null }[],
  ruoloDi: (athleteId: string) => string | null,
): number | null {
  const p = formazione.find((f) => ruoloDi(f.athlete_id) === "Palleggiatore" && f.posizione);
  return p?.posizione ?? null;
}

/**
 * Fase dello scambio in base all'ultima azione di gioco:
 * - inizio scambio e serve l'avversario: ricezione; se serviamo noi: posizioni di rotazione (chi batte e' in 1);
 * - dopo la nostra battuta o un muro: difesa;
 * - dopo un nostro attacco: copertura;
 * - altrimenti (dopo ricezione o difesa, si attacca): posizioni di rotazione.
 */
export function faseDelloScambio(
  ultimaSkill: string | null,
  noiAlServizio: boolean,
): FaseSchema | null {
  if (ultimaSkill === null) return noiAlServizio ? null : "ricezione";
  if (ultimaSkill === "Servizio" || ultimaSkill === "Muro") return "difesa";
  if (ultimaSkill === "Attacco") return "copertura";
  return null;
}

export function zonaDiPosizione(schema: Assegnazioni | undefined, posizione: number): number {
  if (!schema) return posizione;
  const z = Number(schema[String(posizione)]);
  return Number.isInteger(z) && z >= 1 && z <= 6 ? z : posizione;
}
