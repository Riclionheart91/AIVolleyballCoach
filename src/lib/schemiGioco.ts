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
  { fase: "difesa", etichetta: "Difesa", descrizione: "Dopo la nostra battuta: come ci disponiamo in difesa, in base alla zona da cui attacca l'avversario." },
  { fase: "copertura", etichetta: "Copertura", descrizione: "Dopo il nostro attacco: come ci disponiamo in copertura, in base alla zona da cui attacchiamo." },
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

/**
 * Ruoli nelle sei posizioni, in ordine di posizione a partire dalla
 * palleggiatrice: P, poi S1 (schiacciatrice), C2 (centrale), O (opposto),
 * S2 (schiacciatrice), C1 (centrale). Con la palleggiatrice in posizione 1
 * (rotazione A): 1=P, 2=S1, 3=C2, 4=O, 5=S2, 6=C1. Quando si ruota
 * tutte si spostano insieme, quindi in ogni rotazione l'ordine resta lo stesso.
 */
export const RUOLI_SCHEMA = ["P", "S1", "C2", "O", "S2", "C1"] as const;

export const NOMI_RUOLI_SCHEMA: Record<string, string> = {
  P: "Palleggiatrice", S1: "Schiacciatrice 1", C2: "Centrale 2", O: "Opposto", S2: "Schiacciatrice 2", C1: "Centrale 1",
};

/** Ruolo che sta nella posizione di rotazione indicata, quando la palleggiatrice e' nella posizione "rotazione". */
export function ruoloInPosizione(posizione: number, rotazione: number): string {
  return RUOLI_SCHEMA[(((posizione - rotazione) % 6) + 6) % 6];
}

/** Rotazioni nell'ordine in cui si susseguono: A = palleggiatrice in 1, B = in 6, C = in 5, D = in 4, E = in 3, F = in 2. */
export const ORDINE_ROTAZIONI = [1, 6, 5, 4, 3, 2] as const;

export function letteraRotazione(rotazione: number): string {
  return "ABCDEF"[ORDINE_ROTAZIONI.indexOf(rotazione as 1 | 2 | 3 | 4 | 5 | 6)] ?? String(rotazione);
}

/**
 * Difesa e copertura non dipendono dalla rotazione ma dalla ZONA da cui
 * si attacca (l'avversario in difesa, noi in copertura), e le giocatrici
 * si dispongono per RUOLO e LINEA: P/O (palleggiatrice e opposto stanno
 * nello stesso punto), S (schiacciatrice), C (centrale), ognuno in prima e
 * in seconda linea. In ogni rotazione di ciascun ruolo una e' davanti e
 * una dietro, quindi i sei punti sono sempre quelli. Il libero prende il
 * punto del centrale che sostituisce (C in seconda linea).
 * Nel database lo schema usa le stesse chiavi 1-6 della rotazione 1 (P in 1)
 * e il numero di zona al posto della rotazione.
 */
export function faseConZona(fase: FaseSchema | null): boolean {
  return fase === "difesa" || fase === "copertura";
}

export const ZONE_ATTACCO = [1, 2, 3, 4, 6] as const;
export const ZONA_PREDEFINITA = 3;

/** Sigla e linea dei sei punti degli schemi per ruolo (chiavi = posizioni della rotazione 1). */
export const PUNTI_RUOLO_LINEA: Record<number, { sigla: string; linea: string }> = {
  1: { sigla: "P/O", linea: "2ª linea" },
  2: { sigla: "S", linea: "1ª linea" },
  3: { sigla: "C", linea: "1ª linea" },
  4: { sigla: "P/O", linea: "1ª linea" },
  5: { sigla: "S", linea: "2ª linea" },
  6: { sigla: "C", linea: "2ª linea (libero)" },
};

/** Punto dello schema per ruolo che spetta a chi sta nella posizione indicata quando la palleggiatrice e' in "rotazione". */
export function puntoRuoloLinea(posizione: number, rotazione: number): number {
  const ruolo = (((posizione - rotazione) % 6) + 6) % 6; // 0 P, 1 S1, 2 C2, 3 O, 4 S2, 5 C1
  const tipo = ruolo % 3; // 0 P/O, 1 S, 2 C
  const davanti = posizione >= 2 && posizione <= 4;
  if (tipo === 0) return davanti ? 4 : 1;
  if (tipo === 1) return davanti ? 2 : 5;
  return davanti ? 3 : 6;
}

/** Numero che identifica lo schema nella fase: la zona per difesa e copertura, la rotazione per la ricezione. */
export function indiceSchema(fase: FaseSchema, rotazione: number | null, zona: number): number | null {
  return faseConZona(fase) ? zona : rotazione;
}

/** Zona d'attacco a partire dalla posizione di rotazione di chi attacca (la 5 conta come 6). */
export function zonaDaPosizione(posizione: number | null | undefined): number {
  if (!posizione) return ZONA_PREDEFINITA;
  return posizione === 5 ? 6 : posizione;
}

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
