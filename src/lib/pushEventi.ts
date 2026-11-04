// src/lib/pushEventi.ts
//
// Preferenze delle notifiche push per eventi (migrazione 0098): "Partita in diretta" e "Convocazioni".
// L'invio vero e proprio lo fa l'edge function notifica-eventi, innescata dal database. Qui si gestiscono solo
// le scelte dell'utente (tabella preferenze_notifiche) e si fa in modo che il dispositivo abbia un abbonamento
// push, riusando quello dei certificati (src/lib/pushCertificati.ts: un solo abbonamento per dispositivo).
//
// Se la migrazione non è ancora applicata, tutte le funzioni di lettura degradano in silenzio
// (disponibile = false) e la sezione nelle impostazioni resta nascosta.

import { supabaseClient } from "@/src/lib/supabase";
import {
  pushCertificatiSupportato,
  statoAbbonamentoPushCertificati,
  attivaNotifichePushCertificati,
} from "@/src/lib/pushCertificati";

export type TipoNotificaEvento = "partita_live" | "convocazioni";

export interface PreferenzeNotificheEventi {
  /** False se la migrazione 0098 non è applicata o la lettura non è riuscita: nascondere la sezione. */
  disponibile: boolean;
  partita_live: boolean;
  convocazioni: boolean;
}

const PREFERENZE_VUOTE: PreferenzeNotificheEventi = { disponibile: false, partita_live: false, convocazioni: false };

export function pushEventiSupportato(): boolean {
  return pushCertificatiSupportato();
}

/** Legge le preferenze dell'utente corrente. Non lancia mai: in caso di errore restituisce disponibile = false. */
export async function leggiPreferenzeNotificheEventi(): Promise<PreferenzeNotificheEventi> {
  try {
    const { data, error } = await supabaseClient.from("preferenze_notifiche").select("tipo, attiva");
    if (error) return PREFERENZE_VUOTE;
    const righe = (data ?? []) as { tipo: string; attiva: boolean }[];
    const attiva = (tipo: TipoNotificaEvento) => righe.some((r) => r.tipo === tipo && r.attiva);
    return { disponibile: true, partita_live: attiva("partita_live"), convocazioni: attiva("convocazioni") };
  } catch {
    return PREFERENZE_VUOTE;
  }
}

/**
 * Accende o spegne un tipo di notifica per l'utente. Accendendo, se questo dispositivo non ha ancora un
 * abbonamento push chiede il permesso e lo crea. Spegnendo non tocca l'abbonamento (serve anche ai certificati).
 * Lancia un Error con un messaggio leggibile se qualcosa non va.
 */
export async function impostaNotificaEvento(tipo: TipoNotificaEvento, attiva: boolean): Promise<void> {
  if (attiva) {
    if (!pushEventiSupportato()) throw new Error("Questo browser non supporta le notifiche push.");
    const abbonato = await statoAbbonamentoPushCertificati().catch(() => false);
    if (!abbonato) await attivaNotifichePushCertificati();
  }
  const { error } = await supabaseClient.rpc("imposta_preferenza_notifica", { p_tipo: tipo, p_attiva: attiva });
  if (error) {
    throw new Error("Impossibile salvare la preferenza: la funzione non è ancora disponibile. Riprova più tardi.");
  }
}
