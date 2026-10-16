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

/** Punto del campo in frazioni (0-1): x da sinistra a destra, y dalla rete (0) al fondo (1). */
export interface Punto { x: number; y: number }

/** Posizione di rotazione (1-6) -> punto del campo in cui sta la giocatrice. */
export type Assegnazioni = Record<string, Punto>;

/** Centro di ciascuna zona del campo: rete in alto, fila avanti 4-3-2, fila dietro 5-6-1. */
const CENTRO_ZONA: Record<number, Punto> = {
  4: { x: 0.17, y: 0.27 }, 3: { x: 0.5, y: 0.27 }, 2: { x: 0.83, y: 0.27 },
  5: { x: 0.17, y: 0.75 }, 6: { x: 0.5, y: 0.75 }, 1: { x: 0.83, y: 0.75 },
};

/** Senza schema le giocatrici stanno nelle posizioni di rotazione. */
export const SCHEMA_BASE: Assegnazioni = Object.fromEntries([1, 2, 3, 4, 5, 6].map((s) => [String(s), { ...CENTRO_ZONA[s] }]));

export function chiaveSchema(fase: FaseSchema, variante: number, rotazione: number): string {
  return `${fase}:${variante}:${rotazione}`;
}

function puntoValido(v: unknown): v is Punto {
  const p = v as Punto | null;
  return !!p && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

/**
 * Legge uno schema salvato. Accetta il formato con i punti del campo e
 * anche quello vecchio (posizione -> numero di zona), convertito nel
 * centro della zona. Se non e' leggibile ritorna null (si usa lo schema base).
 */
export function normalizzaAssegnazioni(raw: unknown): Assegnazioni | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const risultato: Assegnazioni = {};
  for (let s = 1; s <= 6; s++) {
    const v = r[String(s)];
    if (puntoValido(v)) risultato[String(s)] = { x: v.x, y: v.y };
    else if (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 6 && typeof v !== "object") risultato[String(s)] = { ...CENTRO_ZONA[Number(v)] };
    else return null;
  }
  return risultato;
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

/** Dove disegnare la giocatrice che in rotazione sta nella posizione indicata. */
export function puntoDiPosizione(schema: Assegnazioni | undefined, posizione: number): Punto {
  return schema?.[String(posizione)] ?? SCHEMA_BASE[String(posizione)] ?? { x: 0.5, y: 0.5 };
}
