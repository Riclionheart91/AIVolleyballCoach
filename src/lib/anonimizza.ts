/**
 * Toglie i nomi delle persone dai testi che escono verso i servizi AI esterni (Gemini, Groq, OpenRouter).
 * L'AI non ha bisogno di sapere come si chiama un'atleta per proporre un voto o un esercizio correttivo:
 * nei prompt compare solo "l'atleta" e il ruolo. Il nome vero resta nell'app e nel database.
 */

/** Come ci si riferisce a un'atleta nei prompt, al posto del nome. */
export const ATLETA_ANONIMA = "un atleta";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sostituisce con "l'atleta" ogni occorrenza (senza badare alle maiuscole) del nome completo e di ciascun pezzo
 * del nome lungo almeno 3 lettere. Serve per il testo libero scritto dall'allenatore ("Giulia tende a...").
 */
export function togliNomi(testo: string, nomi: string[]): string {
  const pezzi = new Set<string>();
  for (const nome of nomi) {
    const pulito = nome.trim();
    if (!pulito) continue;
    pezzi.add(pulito);
    for (const p of pulito.split(/\s+/)) if (p.length >= 3) pezzi.add(p);
  }
  let risultato = testo;
  // Prima i pezzi piu' lunghi, cosi' "Maria Rossi" viene sostituito intero e non a pezzi.
  for (const p of [...pezzi].sort((a, b) => b.length - a.length)) {
    risultato = risultato.replace(new RegExp(`(?<![\\p{L}])${escapeRegExp(p)}(?![\\p{L}])`, "giu"), "l'atleta");
  }
  return risultato;
}
