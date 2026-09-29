import AsyncStorage from "@react-native-async-storage/async-storage";

const CHIAVE = "impostazioni_notifiche_esercizio_v1";

export interface ImpostazioniNotificheEsercizio {
  /** Se attiva, oltre all'avviso dei 30 secondi e a quello di fine, manda un promemoria a intervalli regolari mentre l'esercizio è in corso. */
  notificaPeriodicaAttiva: boolean;
  /** Ogni quanti minuti manda il promemoria periodico (solo se notificaPeriodicaAttiva). */
  intervalloMinuti: number;
}

export const IMPOSTAZIONI_NOTIFICHE_DEFAULT: ImpostazioniNotificheEsercizio = {
  notificaPeriodicaAttiva: true,
  intervalloMinuti: 1,
};

/**
 * Preferenza personale del dispositivo (non della squadra): quanto spesso
 * ricevere il promemoria durante un esercizio. Salvata in locale con
 * AsyncStorage così ogni telefono/allenatore può regolarla per conto suo,
 * senza bisogno di una tabella condivisa sul database.
 */
export async function leggiImpostazioniNotifiche(): Promise<ImpostazioniNotificheEsercizio> {
  try {
    const raw = await AsyncStorage.getItem(CHIAVE);
    if (!raw) return IMPOSTAZIONI_NOTIFICHE_DEFAULT;
    const p = JSON.parse(raw);
    return {
      notificaPeriodicaAttiva: typeof p.notificaPeriodicaAttiva === "boolean" ? p.notificaPeriodicaAttiva : IMPOSTAZIONI_NOTIFICHE_DEFAULT.notificaPeriodicaAttiva,
      intervalloMinuti: Number.isFinite(Number(p.intervalloMinuti)) && Number(p.intervalloMinuti) > 0 ? Number(p.intervalloMinuti) : IMPOSTAZIONI_NOTIFICHE_DEFAULT.intervalloMinuti,
    };
  } catch {
    return IMPOSTAZIONI_NOTIFICHE_DEFAULT;
  }
}

export async function salvaImpostazioniNotifiche(nuove: ImpostazioniNotificheEsercizio): Promise<void> {
  try {
    await AsyncStorage.setItem(CHIAVE, JSON.stringify(nuove));
  } catch {
    // Se il salvataggio fallisce si resta con l'ultimo valore in memoria per questa sessione: non blocca l'uso dell'app.
  }
}
