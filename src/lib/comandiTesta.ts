import { useEffect, useState } from "react";
import { useAuth } from "@/src/context/AuthContext";
import { calcolaNotifiche } from "@/src/services/notifiche";
import { elencaPartiteLive } from "@/src/services/live";

/** Numero di partite in corso (aggiornato ogni 20 secondi). Usato dal pulsante LIVE sia in header (telefono) sia nella barra laterale (schermi larghi). */
export function usePartiteLiveInCorso(): number {
  const [inCorso, setInCorso] = useState(0);
  useEffect(() => {
    let attivo = true;
    const aggiorna = () => { elencaPartiteLive().then((l) => { if (attivo) setInCorso(l.length); }).catch(() => { /* in caso di errore resta lo stato precedente: al prossimo giro si riprova */ }); };
    aggiorna();
    const t = setInterval(aggiorna, 20000);
    return () => { attivo = false; clearInterval(t); };
  }, []);
  return inCorso;
}

/** Numero di notifiche da mostrare nel badge della campanella. */
export function useConteggioNotifiche(): number {
  const { team, puoScrivere } = useAuth();
  const [conteggio, setConteggio] = useState(0);
  useEffect(() => {
    // Anche chi non puo' scrivere (presidente, superuser) puo' avere richieste di reset da gestire.
    if (!team) return;
    calcolaNotifiche(team.id, puoScrivere).then((n) => setConteggio(n.length)).catch(() => setConteggio(0));
  }, [team, puoScrivere]);
  return conteggio;
}
