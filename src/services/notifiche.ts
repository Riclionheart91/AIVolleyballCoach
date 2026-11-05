import { elencaAtlete } from "@/src/services/athletes";
import { supabaseClient } from "@/src/lib/supabase";
import type { Athlete } from "@/src/types/database";
import { elencaInvitiPendenti } from "@/src/services/teamInvites";
import { atleteDaValutare, elencaPropostePendenti as elencaPropostePendentiValutazioni } from "@/src/services/evaluations";
import { leggiPianoAnnuale, serveProporreAggiornamento } from "@/src/services/pianoAnnuale";
import { leggiRinvii, rinvioAttivo } from "@/src/services/promemoria";
import { elencaRichiesteReset } from "@/src/services/accessi";

export type TipoNotifica = "certificato_medico" | "invito" | "proposta_valutazione" | "piano_annuale" | "ciclo_valutazione" | "reset_accesso";

export type RichiestaResetNotifica = Awaited<ReturnType<typeof elencaRichiesteReset>>[number];

export interface Notifica {
  id: string;
  tipo: TipoNotifica;
  titolo: string;
  descrizione: string;
  urgente: boolean;
  link?: string;
  /** Solo certificato medico: l'atleta e la scadenza, per il promemoria WhatsApp. */
  atleta?: Athlete;
  scadenza?: string;
  /** Solo reset accesso: la richiesta da confermare o rifiutare. */
  richiesta?: RichiestaResetNotifica;
}

const GIORNI_PREAVVISO_CERTIFICATO = 30;
/** Dopo il WhatsApp la notifica del certificato ricompare questi giorni prima della scadenza. */
const GIORNI_RIAPPARIZIONE_CERTIFICATO = 7;

function dueCifre(n: number): string { return n < 10 ? `0${n}` : String(n); }
function dataLocale(d: Date): string { return `${d.getFullYear()}-${dueCifre(d.getMonth() + 1)}-${dueCifre(d.getDate())}`; }
function piuGiorni(d: Date, giorni: number): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + giorni); }

/** Data (AAAA-MM-GG) da cui la notifica del certificato torna a comparire dopo un avviso su WhatsApp mandato `adesso`. */
export function riappareIlCertificato(scadenzaIso: string, adesso: Date = new Date()): string {
  const [a, m, g] = scadenzaIso.slice(0, 10).split("-").map(Number);
  const scadenza = new Date(a, m - 1, g);
  const oggi = new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate());
  const settimanaPrima = piuGiorni(scadenza, -GIORNI_RIAPPARIZIONE_CERTIFICATO);
  if (settimanaPrima > oggi) return dataLocale(settimanaPrima);       // il caso normale: 7 giorni prima della scadenza
  if (scadenza > oggi) return dataLocale(scadenza);                    // manca meno di una settimana: torna alla scadenza
  return dataLocale(piuGiorni(oggi, 1));                                // gia' scaduto: si ripropone ogni giorno, finche' non lo si rinnova
}

/**
 * Dopo aver mandato il WhatsApp la notifica si nasconde. Si ricorda anche la scadenza a cui si riferisce:
 * se il certificato viene rinnovato (data diversa) l'avviso vecchio non conta piu'. Se la migrazione 0100 non
 * e' ancora applicata l'errore si ignora: l'avviso resta visibile, nulla si rompe.
 */
export async function nascondiAvvisoCertificato(atletaId: string, scadenzaIso: string): Promise<void> {
  const { error } = await supabaseClient.from("athletes").update({
    certificato_avviso_scadenza: scadenzaIso.slice(0, 10),
    certificato_avviso_fino_a: riappareIlCertificato(scadenzaIso),
  }).eq("id", atletaId);
  if (error) console.warn("Avviso certificato non registrato:", error.message);
}

/**
 * Centro notifiche: NON sono notifiche push del sistema operativo (che
 * richiederebbero token Expo Push e un server dedicato a inviarle,
 * infrastruttura non presente in questo stack Expo+GitHub Pages
 * statico) — è un elenco calcolato dal vivo ogni volta che si apre
 * questa schermata, da più fonti già esistenti nell'app.
 */
export async function calcolaNotifiche(teamId: string, puoScrivere: boolean): Promise<Notifica[]> {
  const notifiche: Notifica[] = [];

  // Richieste di reset dell'accesso: l'elenco arriva gia' filtrato dal server (allenatori per le atlete,
  // presidenti e superuser per lo staff), quindi si legge anche per chi non puo' scrivere. Stanno in cima.
  const richiesteReset = await elencaRichiesteReset(teamId).catch(() => []);
  for (const r of richiesteReset) {
    notifiche.push({
      id: `reset-${r.id}`, tipo: "reset_accesso", urgente: true,
      titolo: "Richiesta di reset accesso",
      descrizione: `${r.nome} (${r.email}) — ${r.ambito === "staff" ? "staff" : "atleta"}: chiede un nuovo accesso`,
      richiesta: r,
    });
  }

  if (puoScrivere) {
    const atlete = await elencaAtlete(teamId);
    const oggi = new Date();
    const sogliaPreavviso = new Date(oggi.getTime() + GIORNI_PREAVVISO_CERTIFICATO * 24 * 60 * 60 * 1000);

    for (const a of atlete) {
      if (!a.scadenza_certificato_medico) continue;
      const scadenza = new Date(a.scadenza_certificato_medico);
      // Avviso gia' mandato su WhatsApp per QUESTA scadenza: la notifica resta nascosta fino alla data scelta.
      if (
        a.certificato_avviso_fino_a &&
        a.certificato_avviso_scadenza === a.scadenza_certificato_medico.slice(0, 10) &&
        dataLocale(oggi) < a.certificato_avviso_fino_a.slice(0, 10)
      ) continue;
      if (scadenza < oggi) {
        notifiche.push({
          id: `certmed-${a.id}`, tipo: "certificato_medico", urgente: true,
          titolo: "Certificato medico scaduto",
          descrizione: `${a.nome} ${a.cognome} — scaduto il ${scadenza.toLocaleDateString("it-IT")}`,
          link: `/atleta/${a.id}`, atleta: a, scadenza: a.scadenza_certificato_medico,
        });
      } else if (scadenza <= sogliaPreavviso) {
        notifiche.push({
          id: `certmed-${a.id}`, tipo: "certificato_medico", urgente: false,
          titolo: "Certificato medico in scadenza",
          descrizione: `${a.nome} ${a.cognome} — scade il ${scadenza.toLocaleDateString("it-IT")}`,
          link: `/atleta/${a.id}`, atleta: a, scadenza: a.scadenza_certificato_medico,
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

    // Promemoria rinviati dall'allenatore: non compaiono fino alla data scelta.
    const rinvii = await leggiRinvii(teamId).catch(() => null);

    const daValutare = await atleteDaValutare(teamId).catch(() => []);
    if (daValutare.length > 0 && !rinvioAttivo(rinvii?.valutazioni_fino_a)) {
      const maiValutate = daValutare.filter((a) => a.giorni_dall_ultima === null).length;
      notifiche.push({
        id: "ciclo-valutazione", tipo: "ciclo_valutazione", urgente: false,
        titolo: "Valutazioni da aggiornare",
        descrizione: `${daValutare.length} persone oltre la cadenza${maiValutate > 0 ? ` (${maiValutate} mai valutate)` : ""}`,
        link: "/(tabs)/valutazioni",
      });
    }

    try {
      const piano = await leggiPianoAnnuale(teamId, null);
      if (piano && !rinvioAttivo(rinvii?.piano_fino_a) && await serveProporreAggiornamento(piano, teamId)) {
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
