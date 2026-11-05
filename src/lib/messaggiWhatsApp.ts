import type { Match, MatchSet } from "@/src/types/database";

export const URL_APP = "https://riclionheart91.github.io/AIVolleyballCoach/";

const data = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });

export function invitoApp(squadra: string): string {
  return `Ciao {nome}! Ti invito nell'app della squadra ${squadra}: ${URL_APP}\nAccedi con Google usando l'email che mi hai dato e troverai partite, allenamenti e i tuoi dati.`;
}

export function invitoStaffLink(squadra: string, ruolo: string, link: string): string {
  return `Ciao! Ti invito come ${ruolo} nella squadra ${squadra} sull'app.\nApri questo link e accedi con il tuo account Google (la tua email Google): ${link}\nIl link vale per una sola persona e scade tra 7 giorni.`;
}

/** Invito a diventare presidente della società, con link personale. */
export function invitoPresidenteLink(societa: string, link: string): string {
  return `Ciao! Ti invito come presidente della società ${societa} sull'app.\nApri questo link e accedi con il tuo account Google (la tua email Google): ${link}\nIl link vale per una sola persona e scade tra 7 giorni.`;
}

const CONSIGLIO_PASSWORD = "Ti consiglio di salvare la password nel gestore password del telefono (Password di iCloud o Gestore password di Google).";

/** Primo invito di un'atleta: con Google basta l'email in anagrafica, con email e password serve il link personale. */
export function invitoAccessoAtleta(p: { squadra: string; metodo: "google" | "password"; email: string; link?: string | null }): string {
  if (p.metodo === "google" || !p.link) {
    return `Ciao {nome}! Ti invito nell'app della squadra ${p.squadra}: ${URL_APP}\nAccedi con Google usando l'email ${p.email}: non serve nessuna password.`;
  }
  return `Ciao {nome}! Ti invito nell'app della squadra ${p.squadra}. Apri questo link e scegli la tua password: ${p.link}\nEntra con l'email ${p.email}. Il link scade tra 7 giorni e vale una sola volta.\n${CONSIGLIO_PASSWORD}`;
}

/** Dopo la conferma di un reset: con Google si ricorda l'account, con password c'e' il nuovo link. */
export function resetAccesso(p: { squadra: string; metodo: "google" | "password"; email: string; link?: string | null }): string {
  if (p.metodo === "google" || !p.link) {
    return `Ciao {nome}, per entrare nell'app della squadra ${p.squadra} accedi con Google usando l'email ${p.email}: non c'è nessuna password da reimpostare. ${URL_APP}`;
  }
  return `Ciao {nome}, ecco il nuovo link per scegliere la password dell'app della squadra ${p.squadra}: ${p.link}\nEntra con l'email ${p.email}. Il link scade tra 7 giorni e vale una sola volta.\n${CONSIGLIO_PASSWORD}`;
}

/** Invito dello staff con email e password: l'email e' facoltativa, se manca la sceglie la persona. */
export function invitoStaffPassword(squadra: string, ruolo: string, link: string, email?: string | null): string {
  const quale = email ? `Entra con l'email ${email}.` : "Quando apri il link scegli tu l'email e la password.";
  return `Ciao! Ti invito come ${ruolo} nella squadra ${squadra} sull'app.\nApri questo link e scegli la tua password: ${link}\n${quale} Il link vale per una sola persona e scade tra 7 giorni.\n${CONSIGLIO_PASSWORD}`;
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

/** Promemoria per tutto il gruppo: aggiornare la propria scheda anagrafica su SportEasy. */
export function promemoriaSporteasy(squadra: string): string {
  return `Ciao {nome}! Ricordo a tutte di controllare e aggiornare la propria scheda anagrafica su SportEasy (dati personali, codice fiscale, telefono, email e certificato medico) per la squadra ${squadra}. Serve a tenere in ordine la squadra: grazie!`;
}

/** Testo di partenza per il gruppo: risultato e set, poi lo spazio per il commento dell'allenatore. */
export function commentoPartita(m: Match, sets: MatchSet[], squadra: string): string {
  const esito = m.set_vinti_noi > m.set_vinti_avversario ? "Vittoria" : m.set_vinti_noi < m.set_vinti_avversario ? "Sconfitta" : "Pareggio";
  const parziali = sets.map((x) => `${x.punti_noi}-${x.punti_avversario}`).join(", ");
  return `🏐 ${squadra} vs ${m.avversario} (${data(m.data)})\n${esito} ${m.set_vinti_noi}-${m.set_vinti_avversario}${parziali ? ` (${parziali})` : ""}\n\n`;
}
