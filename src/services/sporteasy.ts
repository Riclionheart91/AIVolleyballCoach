import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import type { TeamIntegration } from "@/src/types/database";

export async function leggiIntegrazione(teamId: string): Promise<TeamIntegration | null> {
  const { data, error } = await supabaseClient.from("team_integrations").select("*").eq("team_id", teamId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function impostaLinkSporteasy(teamId: string, url: string): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_integrazione_sporteasy", { p_team_id: teamId, p_ical_url: url });
  if (error) throw error;
}

/** Un titolo di evento mai visto per questa squadra: l'allenatore deve dire se è un allenamento, una partita, oppure va ignorato. */
export interface EventoDaClassificare {
  uid: string;
  summary: string;
  dataInizio: string;
  chiaveTitolo: string;
  /** Ipotesi per parole chiave, solo per preselezionare una scelta nel popup — l'allenatore può sempre cambiarla. */
  suggerito: "allenamento" | "partita" | "evento";
}

export interface RisultatoSincronizzazione {
  errore: boolean;
  messaggio?: string;
  allenamentiCreati?: number;
  allenamentiAggiornati?: number;
  partiteCreate?: number;
  partiteAggiornate?: number;
  eventiIgnorati?: number;
  totaleEventiNelCalendario?: number;
  dettaglioClassificazione?: { titolo: string; tipo: string }[];
  // Titoli mai classificati prima per questa squadra: se non vuoto, il
  // pannello deve aprire il popup di scelta prima che la
  // sincronizzazione possa dirsi conclusa.
  daClassificare?: EventoDaClassificare[];
  erroriScrittura?: string[];
  byteScaricati?: number;
  blocchiVeventTrovati?: number;
}

function messaggioErroreInvocazione(error: { message?: string } | null): string {
  const grezzo = error?.message ?? String(error);
  // "Failed to send a request to the Edge Function" è il messaggio
  // generico della libreria quando la richiesta non parte proprio:
  // funzione non ancora pubblicata su questo progetto, oppure
  // bloccata dal browser per CORS. Il messaggio originale da solo non
  // permette di capire quale dei due, quindi lo arricchiamo.
  if (/failed to send a request/i.test(grezzo)) {
    return (
      "La funzione di sincronizzazione non risponde. Verifica che sia stata pubblicata sul progetto Supabase collegato " +
      `(comando: supabase functions deploy ${cfg.sporteasySyncFunction}) e che il deploy sia andato sullo stesso progetto usato dall'app. ` +
      `Dettaglio tecnico: ${grezzo}`
    );
  }
  return grezzo;
}

export async function sincronizzaSporteasy(teamId: string): Promise<RisultatoSincronizzazione> {
  const { data, error } = await supabaseClient.functions.invoke(cfg.sporteasySyncFunction, { body: { team_id: teamId } });
  if (error) return { errore: true, messaggio: messaggioErroreInvocazione(error) };
  return data as RisultatoSincronizzazione;
}

/**
 * Salva in memoria le scelte di classificazione fatte dall'allenatore
 * nel popup ("chiaveTitolo" → "allenamento"/"partita"/"evento") e
 * riesegue subito la sincronizzazione: gli eventi corrispondenti
 * (comprese tutte le occorrenze ricorrenti con lo stesso titolo)
 * vengono scritti nella stessa chiamata, invece di dover premere di
 * nuovo "Sincronizza".
 */
export async function risolviClassificazioneSporteasy(
  teamId: string,
  scelte: Record<string, "allenamento" | "partita" | "evento">,
): Promise<RisultatoSincronizzazione> {
  const { data, error } = await supabaseClient.functions.invoke(cfg.sporteasySyncFunction, {
    body: { team_id: teamId, azione: "risolvi", scelte },
  });
  if (error) return { errore: true, messaggio: messaggioErroreInvocazione(error) };
  return data as RisultatoSincronizzazione;
}
