import { useEffect, useRef } from "react";
import { supabaseClient } from "@/src/lib/supabase";

/**
 * Tiene una schermata di scouting sincronizzata quando un'altra persona
 * (un vice, uno scout) registra eventi da un altro dispositivo.
 *
 * La trasmissione in tempo reale era già attivata sul database (le
 * tabelle sono nella pubblicazione `supabase_realtime`), ma nessuna
 * schermata si era mai messa in ascolto: l'infrastruttura era pronta,
 * mancava il lato che si collega. Qui si chiude quel cerchio.
 *
 * Il canale ascolta i cambiamenti sulle tabelle indicate filtrati per
 * l'identificativo della partita o del globale, e richiama `ricarica`
 * ogni volta — le regole di sicurezza (RLS) restano quelle di sempre,
 * quindi chi riceve l'aggiornamento vede solo ciò che potrebbe leggere
 * comunque con una interrogazione normale.
 */
export function useSincronizzazioneLive(
  tabelle: { nome: string; colonnaFiltro: string; valoreFiltro: string | null | undefined }[],
  ricarica: () => void,
) {
  const ricaricaRef = useRef(ricarica);
  ricaricaRef.current = ricarica;

  const chiaveFiltri = tabelle.map((t) => t.valoreFiltro).join("|");

  useEffect(() => {
    const valide = tabelle.filter((t) => !!t.valoreFiltro);
    if (valide.length === 0) return;

    // Difensivo: la sincronizzazione live è un miglioramento, non deve
    // MAI poter interrompere la registrazione dei punti. Se il canale
    // non si apre (rete assente, WebSocket non disponibile in questo
    // browser, sessione scaduta), la schermata deve continuare a
    // funzionare esattamente come senza — al peggio non si aggiorna da
    // sola e serve un ricaricamento manuale, cosa già presente.
    let canale: ReturnType<typeof supabaseClient.channel> | null = null;
    try {
      const nomeCanale = `live-${valide.map((t) => `${t.nome}-${t.valoreFiltro}`).join("-")}`;
      canale = supabaseClient.channel(nomeCanale);
      for (const t of valide) {
        canale = canale.on(
          "postgres_changes",
          { event: "*", schema: "public", table: t.nome, filter: `${t.colonnaFiltro}=eq.${t.valoreFiltro}` },
          () => { try { ricaricaRef.current(); } catch { /* un fallimento nel ricaricare non deve propagarsi */ } },
        );
      }
      canale.subscribe((stato) => {
        if (stato === "CHANNEL_ERROR" || stato === "TIMED_OUT") {
          console.error("Sincronizzazione live non disponibile per questa schermata:", stato);
        }
      });
    } catch (e) {
      console.error("Impossibile attivare la sincronizzazione live:", e);
    }

    return () => {
      if (canale) {
        try { supabaseClient.removeChannel(canale); } catch { /* niente da fare se il canale è già chiuso */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiaveFiltri]);
}
