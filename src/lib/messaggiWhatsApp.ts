import type { ModelloMessaggio } from "@/src/components/MessaggioWhatsApp";
import type { Match, Training } from "@/src/types/database";

export const URL_APP = "https://riclionheart91.github.io/AIVolleyballCoach/";

const quando = (iso: string) =>
  new Date(iso).toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const invitoApp = (squadra: string): ModelloMessaggio => ({
  etichetta: "Invito all'app",
  testo: `Ciao {nome}! Ti invito nell'app della squadra ${squadra}: ${URL_APP}\nAccedi con Google usando l'email che mi hai dato e troverai partite, allenamenti e i tuoi dati.`,
});

export function modelliPartita(m: Match, squadra: string): ModelloMessaggio[] {
  const dove = m.luogo === "trasferta" ? "in trasferta" : "in casa";
  const tipo = m.tipo_gara === "campionato" ? "campionato" : "amichevole";
  return [
    { etichetta: "Promemoria", testo: `Ciao {nome}! Ti ricordo la partita (${tipo}) contro ${m.avversario}: ${quando(m.data)}, ${dove}. Ci vediamo lì! — ${squadra}` },
    { etichetta: "Chiedi conferma", testo: `Ciao {nome}, partita contro ${m.avversario}: ${quando(m.data)}, ${dove}. Mi confermi se ci sei? Rispondi a questo messaggio. — ${squadra}` },
    invitoApp(squadra),
  ];
}

export function modelliAllenamento(t: Training, squadra: string): ModelloMessaggio[] {
  return [
    { etichetta: "Promemoria", testo: `Ciao {nome}! Ti ricordo l'allenamento "${t.titolo}": ${quando(t.data)}. A presto! — ${squadra}` },
    { etichetta: "Chiedi conferma", testo: `Ciao {nome}, allenamento ${quando(t.data)}. Mi confermi se ci sei? Rispondi a questo messaggio. — ${squadra}` },
    invitoApp(squadra),
  ];
}
