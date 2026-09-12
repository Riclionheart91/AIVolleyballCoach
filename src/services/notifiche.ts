import { elencaAtlete } from "@/src/services/athletes";
import { elencaInvitiPendenti } from "@/src/services/teamInvites";
import { atleteDaValutare, elencaPropostePendenti as elencaPropostePendentiValutazioni } from "@/src/services/evaluations";
import { leggiPianoAnnuale, serveProporreAggiornamento } from "@/src/services/pianoAnnuale";

export type TipoNotifica = "certificato_medico" | "invito" | "proposta_valutazione" | "piano_annuale" | "ciclo_valutazione";

export interface Notifica {
  id: string;
  tipo: TipoNotifica;
  titolo: string;
  descrizione: string;
  urgente: boolean;
  link?: string;
}

const GIORNI_PREAVVISO_CERTIFICATO = 30;

/**
 * Centro notifiche: NON sono notifiche push del sistema operativo (che
 * richiederebbero token Expo Push e un server dedicato a inviarle,
 * infrastruttura non presente in questo stack Expo+GitHub Pages
 * statico) — è un elenco calcolato dal vivo ogni volta che si apre
 * questa schermata, da più fonti già esistenti nell'app.
 */
export async function calcolaNotifiche(teamId: string, puoScrivere: boolean): Promise<Notifica[]> {
  const notifiche: Notifica[] = [];

  if (puoScrivere) {
    const atlete = await elencaAtlete(teamId);
    const oggi = new Date();
    const sogliaPreavviso = new Date(oggi.getTime() + GIORNI_PREAVVISO_CERTIFICATO * 24 * 60 * 60 * 1000);

    for (const a of atlete) {
      if (!a.scadenza_certificato_medico) continue;
      const scadenza = new Date(a.scadenza_certificato_medico);
      if (scadenza < oggi) {
        notifiche.push({
          id: `certmed-${a.id}`, tipo: "certificato_medico", urgente: true,
          titolo: "Certificato medico scaduto",
          descrizione: `${a.nome} ${a.cognome} — scaduto il ${scadenza.toLocaleDateString("it-IT")}`,
          link: `/atleta/${a.id}`,
        });
      } else if (scadenza <= sogliaPreavviso) {
        notifiche.push({
          id: `certmed-${a.id}`, tipo: "certificato_medico", urgente: false,
          titolo: "Certificato medico in scadenza",
          descrizione: `${a.nome} ${a.cognome} — scade il ${scadenza.toLocaleDateString("it-IT")}`,
          link: `/atleta/${a.id}`,
        });
      }
    }

    const inviti = await elencaInvitiPendenti(teamId).catch(() => []);
    for (const i of inviti) {
      notifiche.push({
        id: `invito-${i.id}`, tipo: "invito", urgente: false,
        titolo: "Invito in attesa",
        descrizione: `${i.email} non ha ancora accettato l'invito`,
      });
    }

    const proposteValutazioni = await elencaPropostePendentiValutazioni(teamId).catch(() => []);
    if (proposteValutazioni.length > 0) {
      notifiche.push({
        id: "proposte-valutazioni", tipo: "proposta_valutazione", urgente: false,
        titolo: "Proposte di valutazione AI da rivedere",
        descrizione: `${proposteValutazioni.length} proposta/e in attesa di conferma`,
        link: "/(tabs)/valutazioni",
      });
    }

    const daValutare = await atleteDaValutare(teamId).catch(() => []);
    if (daValutare.length > 0) {
      const maiValutate = daValutare.filter((a) => a.giorni_dall_ultima === null).length;
      notifiche.push({
        id: "ciclo-valutazione", tipo: "ciclo_valutazione", urgente: false,
        titolo: "Valutazioni da aggiornare",
        descrizione: `${daValutare.length} atleta/e oltre la cadenza${maiValutate > 0 ? ` (${maiValutate} mai valutata/e)` : ""}`,
        link: "/(tabs)/valutazioni",
      });
    }

    try {
      const piano = await leggiPianoAnnuale(teamId, null);
      if (piano && await serveProporreAggiornamento(piano, teamId)) {
        notifiche.push({
          id: "piano-annuale", tipo: "piano_annuale", urgente: false,
          titolo: "Piano annuale da rivedere",
          descrizione: "Conviene generare una proposta di aggiornamento (30+ giorni o nuove valutazioni)",
          link: "/pianificazione-annuale",
        });
      }
    } catch {
      // Il piano annuale è una funzionalità facoltativa: se non c'è
      // ancora nessun piano o la chiamata fallisce, semplicemente non
      // si mostra questa notifica, senza far fallire le altre.
    }
  }

  return notifiche;
}
