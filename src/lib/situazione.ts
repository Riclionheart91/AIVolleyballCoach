import type { MatchEvent } from "@/src/types/database";

export interface SegnalazioneSituazione {
  testo: string;
  gravita: "info" | "attenzione";
  /** Il saldo complessivo si mostra a parte, come numero grande. */
  saldo?: number;
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
    return [{ testo: "Pochi dati ancora.", gravita: "info" }];
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
        testo: `Errori: ${quota}% da ${skillPeggiore[0].toLowerCase()} (${skillPeggiore[1]}/${errori.length})`,
        gravita: "attenzione",
      });
    }
  }

  // Saldo complessivo
  const saldo = punti.length - errori.length;
  segnalazioni.push({
    testo: `Saldo ${saldo >= 0 ? "+" : ""}${saldo} (${punti.length} pt, ${errori.length} err)`,
    gravita: saldo < -3 ? "attenzione" : "info",
    saldo,
  });

  // Andamento recente: gli ultimi scambi pesano più della media generale
  const recenti = eventi.slice(0, 6);
  const erroriRecenti = recenti.filter((e) => e.esito === "errore" || e.skill === "Punto_avversario").length;
  if (recenti.length >= 5 && erroriRecenti >= 4) {
    segnalazioni.push({ testo: `${erroriRecenti} errori su ${recenti.length} azioni: time-out?`, gravita: "attenzione" });
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
    segnalazioni.push({ testo: `${nomePerAtleta(inDifficolta[0])} ${inDifficolta[1]}: cambio o time-out?`, gravita: "attenzione" });
  }
  const inSerata = Object.entries(saldoPerAtleta).filter(([, s]) => s >= 3).sort((a, b) => b[1] - a[1])[0];
  if (inSerata) {
    segnalazioni.push({ testo: `${nomePerAtleta(inSerata[0])} +${inSerata[1]}: cercala`, gravita: "info" });
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

export interface RotazioneDebole {
  /** Chi e' al servizio in quella rotazione. */
  alServizio: string;
  saldo: number;
  /** In cosa siamo deboli: es. "ricezione 3 err · attacco 2 err · Rossi 2 err". */
  motivo: string;
}

/**
 * Rotazione (identificata da chi serve) col saldo peggiore, e in cosa pesa:
 * i fondamentali con piu' errori che punti e la giocatrice con piu' errori.
 * Serve almeno qualche azione nella rotazione e un saldo negativo.
 */
export function rotazionePiuDebole(
  eventi: { skill: string; esito: string | null; athlete_id: string | null; rotazione_al_servizio: string | null }[],
  nomePerAtleta: (id: string) => string,
): RotazioneDebole | null {
  const perRotazione = new Map<string, typeof eventi>();
  for (const e of eventi) {
    if (!e.rotazione_al_servizio) continue;
    const l = perRotazione.get(e.rotazione_al_servizio) ?? [];
    l.push(e);
    perRotazione.set(e.rotazione_al_servizio, l);
  }
  let peggiore: { id: string; saldo: number; lista: typeof eventi } | null = null;
  for (const [id, lista] of perRotazione) {
    if (lista.length < 4) continue;
    const punti = lista.filter((e) => e.esito === "punto" || e.skill === "Punto_nostro").length;
    const errori = lista.filter((e) => e.esito === "errore" || e.skill === "Punto_avversario").length;
    const saldo = punti - errori;
    if (!peggiore || saldo < peggiore.saldo) peggiore = { id, saldo, lista };
  }
  if (!peggiore || peggiore.saldo >= 0) return null;

  const perSkill: Record<string, number> = {};
  const perAtleta: Record<string, number> = {};
  for (const e of peggiore.lista) {
    const errore = e.esito === "errore" || e.skill === "Punto_avversario";
    const punto = e.esito === "punto" || e.skill === "Punto_nostro";
    if (!errore && !punto) continue;
    const nome = e.skill === "Punto_avversario" ? "punti diretti avversari" : e.skill === "Punto_nostro" ? null : e.skill.toLowerCase();
    if (nome) perSkill[nome] = (perSkill[nome] ?? 0) + (errore ? 1 : -1);
    if (errore && e.athlete_id) perAtleta[e.athlete_id] = (perAtleta[e.athlete_id] ?? 0) + 1;
  }
  const parti = Object.entries(perSkill)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k} ${v} err`);
  const peggioreAtleta = Object.entries(perAtleta).sort((a, b) => b[1] - a[1])[0];
  if (peggioreAtleta && peggioreAtleta[1] >= 2) parti.push(`${nomePerAtleta(peggioreAtleta[0])} ${peggioreAtleta[1]} err`);
  return { alServizio: nomePerAtleta(peggiore.id), saldo: peggiore.saldo, motivo: parti.join(" · ") };
}
