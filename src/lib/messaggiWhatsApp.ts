import type { Match, MatchSet } from "@/src/types/database";

export const URL_APP = "https://riclionheart91.github.io/AIVolleyballCoach/";

const data = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });

export function invitoApp(squadra: string): string {
  return `Ciao {nome}! Ti invito nell'app della squadra ${squadra}: ${URL_APP}\nAccedi con Google usando l'email che mi hai dato e troverai partite, allenamenti e i tuoi dati.`;
}

export function invitoStaffLink(squadra: string, ruolo: string, link: string): string {
  return `Ciao! Ti invito come ${ruolo} nella squadra ${squadra} sull'app.\nApri questo link e accedi con il tuo account Google (la tua email Google): ${link}\nIl link vale per una sola persona e scade tra 7 giorni.`;
}

export function inviaLinkScout(squadra: string, avversario: string, link: string): string {
  return `Ciao! Sei scout per la partita ${squadra} vs ${avversario}. Apri questo link, scrivi il tuo nome e inizia a registrare (non serve nessun account): ${link}`;
}

export function promemoriaCertificato(squadra: string, scadenzaIso: string): string {
  const scaduto = new Date(scadenzaIso) < new Date();
  return scaduto
    ? `Ciao {nome}, il tuo certificato medico agonistico è scaduto il ${data(scadenzaIso)}. Senza certificato valido non puoi allenarti né giocare: appena puoi fissa la visita e portami il nuovo certificato. Grazie!`
    : `Ciao {nome}, ti ricordo che il tuo certificato medico agonistico scade il ${data(scadenzaIso)}. Fissa per tempo la visita e portami il nuovo certificato. Grazie!`;
}

/** Testo di partenza per il gruppo: risultato e set, poi lo spazio per il commento dell'allenatore. */
export function commentoPartita(m: Match, sets: MatchSet[], squadra: string): string {
  const esito = m.set_vinti_noi > m.set_vinti_avversario ? "Vittoria" : m.set_vinti_noi < m.set_vinti_avversario ? "Sconfitta" : "Pareggio";
  const parziali = sets.map((x) => `${x.punti_noi}-${x.punti_avversario}`).join(", ");
  return `🏐 ${squadra} vs ${m.avversario} (${data(m.data)})\n${esito} ${m.set_vinti_noi}-${m.set_vinti_avversario}${parziali ? ` (${parziali})` : ""}\n\n`;
}
