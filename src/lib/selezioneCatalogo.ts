// Sceglie quali esercizi del catalogo mostrare all'AI quando genera una seduta.
//
// Mandare l'intero catalogo (170 esercizi = ~11.000 caratteri) allunga il prompt, rallenta la risposta e dilata il rischio
// che il modello si perda nell'elenco. Qui si tengono gli esercizi pertinenti all'argomento e, in piu', alcuni esercizi
// per ciascuna fase della seduta, cosi' riscaldamento e defaticamento sono sempre disponibili anche se l'argomento
// parla solo di tecnica. Un catalogo piccolo non viene toccato.
//
// Funzione pura: nessun accesso a rete o database, l'unica casualita' (la scelta fra esercizi di pari punteggio, perche'
// la proposta non sia sempre la stessa) si puo' sostituire passando `casuale`.

import type { Exercise } from "@/src/types/database";

/** Sotto questa dimensione il catalogo va intero: filtrare un elenco corto toglierebbe scelta senza far risparmiare nulla. */
export const SOGLIA_CATALOGO_COMPLETO = 50;
/** Esercizi pertinenti all'argomento, al massimo. */
export const MAX_PERTINENTI = 50;
/** Esercizi di riempimento per ogni fase (riscaldamento, tecnico, situazionale, defaticamento), al massimo. */
export const PER_FASE = 12;
/** Se l'argomento non corrisponde a nulla, l'elenco viene comunque portato a questa dimensione con esercizi vari. */
export const MINIMO_ELENCO = 30;

const FASI = ["riscaldamento", "tecnico", "situazionale", "defaticamento"] as const;

// Parole che compaiono in quasi ogni argomento o in ogni esercizio e non dicono nulla sul tema.
const PAROLE_VUOTE = new Set([
  "allenamento", "sessione", "seduta", "esercizio", "esercizi", "alternativo", "alternativa", "solo", "uno", "una",
  "tecnica", "tecnico", "tecniche", "sviluppo", "generale", "generico", "preparazione", "lavoro", "della", "delle",
  "dello", "degli", "dell", "nella", "nelle", "sulla", "sulle", "come", "dopo", "prima", "durante", "stessa",
  "categoria", "simile", "squadra", "gioco", "partita",
]);

function senzaAccenti(testo: string): string {
  return testo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Radici delle parole dell'argomento: le prime 5 lettere, cosi' "difesa" e "difensivo" o "battuta" e "battere" si incontrano. */
export function radiciArgomento(argomento: string): string[] {
  const radici = senzaAccenti(argomento)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4 && !PAROLE_VUOTE.has(p))
    .map((p) => p.slice(0, 5));
  return Array.from(new Set(radici));
}

function punteggio(e: Exercise & { tag?: string | null }, radici: string[]): number {
  if (radici.length === 0) return 0;
  const nome = senzaAccenti(e.nome ?? "");
  const categoria = senzaAccenti(e.categoria ?? "");
  const tag = senzaAccenti(e.tag ?? "");
  const descrizione = senzaAccenti(e.descrizione ?? "");
  let totale = 0;
  for (const r of radici) {
    if (categoria.includes(r)) totale += 3;
    if (nome.includes(r)) totale += 3;
    if (tag.includes(r)) totale += 2;
    if (descrizione.includes(r)) totale += 1;
  }
  return totale;
}

/** Mescola una copia dell'elenco (Fisher-Yates). */
function mescola<T>(elenco: T[], casuale: () => number): T[] {
  const copia = elenco.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(casuale() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export function selezionaCatalogoPerArgomento(catalogo: Exercise[], argomento: string, casuale: () => number = Math.random): Exercise[] {
  if (catalogo.length <= SOGLIA_CATALOGO_COMPLETO) return catalogo;

  const radici = radiciArgomento(argomento);
  // Si mescola prima di ordinare: l'ordinamento e' stabile, quindi a pari punteggio l'ordine resta quello casuale.
  const valutati = mescola(catalogo, casuale)
    .map((e) => ({ e, p: punteggio(e, radici) }))
    .sort((a, b) => b.p - a.p);

  const scelti = new Map<string, Exercise>();
  for (const { e, p } of valutati) {
    if (p <= 0 || scelti.size >= MAX_PERTINENTI) break;
    scelti.set(e.id, e);
  }

  // Alcuni esercizi per ogni fase, i piu' pertinenti per primi: la seduta ha sempre riscaldamento e defaticamento da scegliere.
  for (const fase of FASI) {
    let aggiunti = 0;
    for (const { e } of valutati) {
      if (aggiunti >= PER_FASE) break;
      if (e.fase_consigliata !== fase || scelti.has(e.id)) continue;
      scelti.set(e.id, e);
      aggiunti++;
    }
  }

  // Argomento senza corrispondenze (o catalogo senza fasi indicate): si completa con esercizi vari.
  if (scelti.size < MINIMO_ELENCO) {
    for (const { e } of valutati) {
      if (scelti.size >= MINIMO_ELENCO) break;
      if (!scelti.has(e.id)) scelti.set(e.id, e);
    }
  }

  // Si restituisce nell'ordine originale del catalogo (per nome): il prompt non cambia ordine da una chiamata all'altra.
  const ordine = new Map(catalogo.map((e, i) => [e.id, i]));
  return Array.from(scelti.values()).sort((a, b) => (ordine.get(a.id) ?? 0) - (ordine.get(b.id) ?? 0));
}
