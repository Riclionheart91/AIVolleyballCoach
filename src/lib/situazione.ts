import type { MatchEvent } from "@/src/types/database";

export interface SegnalazioneSituazione {
  testo: string;
  gravita: "info" | "attenzione";
}

/**
 * Lettura immediata dell'andamento, calcolata in locale: nessuna
 * chiamata di rete, nessun costo, risposta istantanea. La gran parte
 * dei suggerimenti utili a bordo campo sono conti semplici — l'AI
 * serve semmai dopo, per un parere discorsivo su richiesta.
 */
export function analizzaSituazione(
  eventi: MatchEvent[],
  nomePerAtleta: (id: string) => string,
): SegnalazioneSituazione[] {
  const segnalazioni: SegnalazioneSituazione[] = [];
  if (eventi.length < 4) {
    return [{ testo: "Ancora pochi dati: servono qualche scambio in più per una lettura sensata.", gravita: "info" }];
  }

  const errori = eventi.filter((e) => e.esito === "errore" || e.skill === "Punto_avversario");
  const punti = eventi.filter((e) => e.esito === "punto");

  // Dove si concentrano gli errori
  const erroriPerSkill: Record<string, number> = {};
  for (const e of errori) {
    const k = e.skill === "Punto_avversario" ? "Punto avversario" : e.skill;
    erroriPerSkill[k] = (erroriPerSkill[k] ?? 0) + 1;
  }
  const skillPeggiore = Object.entries(erroriPerSkill).sort((a, b) => b[1] - a[1])[0];
  if (skillPeggiore && errori.length >= 3) {
    const quota = Math.round((skillPeggiore[1] / errori.length) * 100);
    if (quota >= 40) {
      segnalazioni.push({
        testo: `${quota}% degli errori arriva da ${skillPeggiore[0].toLowerCase()} (${skillPeggiore[1]} su ${errori.length}).`,
        gravita: "attenzione",
      });
    }
  }

  // Saldo complessivo
  const saldo = punti.length - errori.length;
  segnalazioni.push({
    testo: `Saldo azioni: ${saldo >= 0 ? "+" : ""}${saldo} (${punti.length} punti, ${errori.length} errori).`,
    gravita: saldo < -3 ? "attenzione" : "info",
  });

  // Andamento recente: gli ultimi scambi pesano più della media generale
  const recenti = eventi.slice(0, 6);
  const erroriRecenti = recenti.filter((e) => e.esito === "errore" || e.skill === "Punto_avversario").length;
  if (recenti.length >= 5 && erroriRecenti >= 4) {
    segnalazioni.push({ testo: `${erroriRecenti} errori negli ultimi ${recenti.length} scambi: momento negativo, valuta un time-out.`, gravita: "attenzione" });
  }

  // Chi sta faticando
  const saldoPerAtleta: Record<string, number> = {};
  for (const e of eventi) {
    if (!e.athlete_id) continue;
    const delta = e.esito === "punto" ? 1 : (e.esito === "errore" ? -1 : 0);
    if (delta !== 0) saldoPerAtleta[e.athlete_id] = (saldoPerAtleta[e.athlete_id] ?? 0) + delta;
  }
  const inDifficolta = Object.entries(saldoPerAtleta).filter(([, s]) => s <= -3).sort((a, b) => a[1] - b[1])[0];
  if (inDifficolta) {
    segnalazioni.push({ testo: `${nomePerAtleta(inDifficolta[0])} è a ${inDifficolta[1]} di saldo: valuta un cambio o un time-out.`, gravita: "attenzione" });
  }
  const inSerata = Object.entries(saldoPerAtleta).filter(([, s]) => s >= 3).sort((a, b) => b[1] - a[1])[0];
  if (inSerata) {
    segnalazioni.push({ testo: `${nomePerAtleta(inSerata[0])} è in serata (+${inSerata[1]}): cercala di più.`, gravita: "info" });
  }

  return segnalazioni;
}

/** Riassunto compatto da passare all'AI quando si chiede un parere: poche righe, non l'elenco completo degli eventi. */
export function riassuntoPerAI(eventi: MatchEvent[], nomePerAtleta: (id: string) => string, punteggio: string): string {
  const errori = eventi.filter((e) => e.esito === "errore" || e.skill === "Punto_avversario");
  const punti = eventi.filter((e) => e.esito === "punto");

  const perSkill: Record<string, { punti: number; errori: number }> = {};
  for (const e of eventi) {
    const k = e.skill === "Punto_avversario" ? "Punto avversario" : e.skill;
    perSkill[k] ??= { punti: 0, errori: 0 };
    if (e.esito === "punto") perSkill[k].punti++;
    if (e.esito === "errore" || e.skill === "Punto_avversario") perSkill[k].errori++;
  }

  const perAtleta: Record<string, { punti: number; errori: number }> = {};
  for (const e of eventi) {
    if (!e.athlete_id) continue;
    const nome = nomePerAtleta(e.athlete_id);
    perAtleta[nome] ??= { punti: 0, errori: 0 };
    if (e.esito === "punto") perAtleta[nome].punti++;
    if (e.esito === "errore") perAtleta[nome].errori++;
  }

  return (
    `Punteggio: ${punteggio}. Azioni registrate: ${eventi.length} (${punti.length} punti, ${errori.length} errori).\n` +
    `Per fondamentale: ${Object.entries(perSkill).map(([k, v]) => `${k} ${v.punti}+/${v.errori}-`).join(", ")}.\n` +
    `Per giocatrice: ${Object.entries(perAtleta).map(([k, v]) => `${k} ${v.punti}+/${v.errori}-`).join(", ")}.`
  );
}
