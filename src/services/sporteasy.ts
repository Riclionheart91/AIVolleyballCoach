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

export interface RisultatoSincronizzazione {
  errore: boolean;
  messaggio?: string;
  allenamentiCreati?: number;
  allenamentiAggiornati?: number;
  partiteCreate?: number;
  partiteAggiornate?: number;
  totaleEventiNelCalendario?: number;
  dettaglioClassificazione?: { titolo: string; tipo: string }[];
  erroriScrittura?: string[];
  byteScaricati?: number;
  blocchiVeventTrovati?: number;
}

export async function sincronizzaSporteasy(teamId: string): Promise<RisultatoSincronizzazione> {
  const { data, error } = await supabaseClient.functions.invoke(cfg.sporteasySyncFunction, { body: { team_id: teamId } });
  if (error) {
    // "Failed to send a request to the Edge Function" è il messaggio
    // generico della libreria quando la richiesta non parte proprio:
    // funzione non ancora pubblicata su questo progetto, oppure
    // bloccata dal browser per CORS. Il messaggio originale da solo
    // non permette di capire quale dei due, quindi lo arricchiamo.
    const grezzo = error.message ?? String(error);
    if (/failed to send a request/i.test(grezzo)) {
      return {
        errore: true,
        messaggio:
          "La funzione di sincronizzazione non risponde. Verifica che sia stata pubblicata sul progetto Supabase collegato " +
          `(comando: supabase functions deploy ${cfg.sporteasySyncFunction}) e che il deploy sia andato sullo stesso progetto usato dall'app. ` +
          `Dettaglio tecnico: ${grezzo}`,
      };
    }
    return { errore: true, messaggio: grezzo };
  }
  return data as RisultatoSincronizzazione;
}
