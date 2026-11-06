import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cosa fa lo scorrimento di lato su una riga di elenco (come in Mail/Messaggi di iPhone).
 * E' una preferenza di questo telefono, per ogni elenco; di default e' SPENTO.
 */
export type ListaGesti = "rosa" | "allenamenti" | "partite";
export type AzioneSwipe = "spento" | "whatsapp" | "archivia" | "elimina";

export const LISTE_GESTI: { lista: ListaGesti; titolo: string; opzioni: { id: AzioneSwipe; etichetta: string }[] }[] = [
  { lista: "rosa", titolo: "Rosa (atlete)", opzioni: [{ id: "spento", etichetta: "Spento" }, { id: "whatsapp", etichetta: "WhatsApp" }, { id: "archivia", etichetta: "Archivia" }] },
  { lista: "allenamenti", titolo: "Allenamenti", opzioni: [{ id: "spento", etichetta: "Spento" }, { id: "archivia", etichetta: "Archivia" }, { id: "elimina", etichetta: "Elimina" }] },
  { lista: "partite", titolo: "Partite", opzioni: [{ id: "spento", etichetta: "Spento" }, { id: "elimina", etichetta: "Elimina" }] },
];

const CHIAVE = "pref_gesti_swipe_v1";
let valori: Record<ListaGesti, AzioneSwipe> = { rosa: "spento", allenamenti: "spento", partite: "spento" };
const ascoltatori = new Set<() => void>();
let caricato = false;

function notifica() { ascoltatori.forEach((f) => f()); }

function carica() {
  if (caricato) return;
  caricato = true;
  AsyncStorage.getItem(CHIAVE).then((raw) => {
    if (!raw) return;
    try {
      const letto = JSON.parse(raw) as Partial<Record<ListaGesti, AzioneSwipe>>;
      valori = { ...valori, ...letto };
      notifica();
    } catch { /* preferenza non leggibile: restano i valori di default */ }
  }).catch(() => { /* storage non disponibile */ });
}

export function impostaGesto(lista: ListaGesti, azione: AzioneSwipe) {
  valori = { ...valori, [lista]: azione };
  notifica();
  AsyncStorage.setItem(CHIAVE, JSON.stringify(valori)).catch(() => { /* ignora */ });
}

function iscriviti(f: () => void) { carica(); ascoltatori.add(f); return () => { ascoltatori.delete(f); }; }

/** Azione scelta per lo scorrimento di lato su un elenco ("spento" se non attivato). */
export function useGestoRiga(lista: ListaGesti): AzioneSwipe {
  return useSyncExternalStore(iscriviti, () => valori[lista], () => "spento" as AzioneSwipe);
}
