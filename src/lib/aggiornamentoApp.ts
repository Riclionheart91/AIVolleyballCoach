import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

/**
 * Aggiornamento automatico dell'app (versione web): a ogni pubblicazione il sito scrive un file `versione.json` con
 * l'identificativo della versione. L'app lo confronta con la propria: se è cambiato, ricarica la pagina per prendere
 * quella nuova, senza che nessuno debba ricordarsi di farlo.
 *
 * Regole di sicurezza:
 *  - si ricarica solo se il file nuovo è stato appena letto (quindi c'è rete): senza rete non si ricarica mai,
 *    perché la pagina non si riaprirebbe;
 *  - durante una partita in corso, o con azioni ancora da inviare, non si ricarica da soli: compare solo un avviso;
 *  - negli altri casi c'è un conto alla rovescia di pochi secondi con il pulsante "Aggiorna ora".
 */
const BASE = "/AIVolleyballCoach";
export const ID_VERSIONE_APP = process.env.EXPO_PUBLIC_BUILD_ID ?? "";
const INTERVALLO_MS = 2 * 60 * 1000;
export const SECONDI_ATTESA = 20;

interface Stato { disponibile: boolean; partitaInCorso: boolean; azioniInAttesa: number }
let stato: Stato = { disponibile: false, partitaInCorso: false, azioniInAttesa: 0 };
let versioneNuova = "";
let avviato = false;
let controlloAzioniInAttesa: () => number = () => 0;
const ascoltatori = new Set<() => void>();

function aggiorna(parziale: Partial<Stato>) {
  stato = { ...stato, ...parziale };
  ascoltatori.forEach((f) => f());
}

/** La schermata della partita dice se si sta registrando (in corso): in quel caso non si ricarica da soli. */
export function impostaPartitaInCorso(inCorso: boolean): void { aggiorna({ partitaInCorso: inCorso }); }
/** Chi conosce la coda delle azioni da inviare (src/lib/codaOffline.ts) si registra qui. */
export function impostaControlloAzioniInAttesa(f: () => number): void { controlloAzioniInAttesa = f; }
export function azioniInAttesaOra(): number { return controlloAzioniInAttesa(); }

function ricarica(): void {
  try {
    // Un solo tentativo per versione in questa sessione: se la pagina riarriva ancora vecchia (cache) non si entra in un ciclo.
    window.sessionStorage.setItem("aggiornamento_tentato", versioneNuova);
  } catch { /* senza sessionStorage si ricarica comunque */ }
  window.location.reload();
}

export function aggiornaOra(): void { if (Platform.OS === "web" && typeof window !== "undefined") ricarica(); }

async function controlla(): Promise<void> {
  if (!ID_VERSIONE_APP || Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    const r = await fetch(`${BASE}/versione.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const { id } = (await r.json()) as { id?: string };
    if (!id || id === ID_VERSIONE_APP) { if (stato.disponibile) aggiorna({ disponibile: false }); return; }
    let giaTentato = false;
    try { giaTentato = window.sessionStorage.getItem("aggiornamento_tentato") === id; } catch { /* ignora */ }
    versioneNuova = id;
    aggiorna({ disponibile: true, azioniInAttesa: controlloAzioniInAttesa() });
    // Appena aperta l'app (o tornati sull'app) e niente da proteggere: si aggiorna subito.
    if (!giaTentato && !stato.partitaInCorso && controlloAzioniInAttesa() === 0 && document.visibilityState === "visible" && inizioSessioneRecente) ricarica();
  } catch { /* senza rete o file illeggibile: si riprova */ }
}

let inizioSessioneRecente = true;

/** Da chiamare una volta all'avvio dell'app. */
export function avviaControlloAggiornamenti(): void {
  if (avviato || Platform.OS !== "web" || typeof window === "undefined" || !ID_VERSIONE_APP) return;
  avviato = true;
  controlla();
  // I primi secondi dopo l'apertura sono il momento giusto per ricaricare in silenzio.
  setTimeout(() => { inizioSessioneRecente = false; }, 15000);
  setInterval(controlla, INTERVALLO_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { inizioSessioneRecente = true; setTimeout(() => { inizioSessioneRecente = false; }, 15000); controlla(); }
  });
  window.addEventListener("online", () => { controlla(); });
}

export function useAggiornamentoApp(): Stato {
  return useSyncExternalStore(
    (cb) => { ascoltatori.add(cb); return () => { ascoltatori.delete(cb); }; },
    () => stato,
    () => stato,
  );
}
