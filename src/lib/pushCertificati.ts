// src/lib/pushCertificati.ts
//
// Iscrizione/disiscrizione di QUESTO dispositivo alle notifiche push
// reali (arrivano anche ad app chiusa) per i certificati medici in
// scadenza — vedi supabase/functions/notifica-certificati per l'invio
// vero e proprio, schedulato ogni venerdì mattina.
//
// Diverso dalle notifiche dell'avviso esercizio (feedbackEsercizio.ts):
// quelle usano la Notification API dalla pagina e funzionano solo ad
// app aperta; queste passano dalla Web Push API del browser (endpoint
// + chiavi salvate sul server), quindi funzionano anche a scheda/app
// chiusa — è per questo che serve un abbonamento esplicito.

import { supabaseClient } from "@/src/lib/supabase";
import { vapidPublicKey } from "@/src/config";

const BASE_URL_WEB = "/AIVolleyballCoach";

export function pushCertificatiSupportato(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Converte la chiave pubblica VAPID (base64url) nel formato binario richiesto da pushManager.subscribe. */
function chiaveApplicationServer(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** True se l'abbonamento e' stato creato con la chiave VAPID attuale (se la chiave cambia, quelli vecchi non servono piu'). */
function abbonamentoConChiaveAttuale(sub: PushSubscription): boolean {
  const usata = sub.options?.applicationServerKey;
  if (!usata) return true; // non verificabile: si lascia com'e'
  const a = new Uint8Array(usata);
  const b = chiaveApplicationServer(vapidPublicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registrazioneServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushCertificatiSupportato()) return null;
  try {
    await navigator.serviceWorker.register(`${BASE_URL_WEB}/sw.js`);
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** True se questo dispositivo/browser ha già un abbonamento push attivo. */
export async function statoAbbonamentoPushCertificati(): Promise<boolean> {
  if (!pushCertificatiSupportato()) return false;
  const reg = await navigator.serviceWorker.getRegistration(`${BASE_URL_WEB}/`);
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub && abbonamentoConChiaveAttuale(sub);
}

/** Chiede il permesso (se serve), iscrive il dispositivo e salva l'abbonamento sul server. */
export async function attivaNotifichePushCertificati(): Promise<void> {
  if (!pushCertificatiSupportato()) {
    throw new Error("Questo browser non supporta le notifiche push.");
  }

  if (Notification.permission === "denied") {
    throw new Error("Le notifiche sono bloccate per questo sito nelle impostazioni del browser/telefono: vanno riabilitate da lì.");
  }
  if (Notification.permission !== "granted") {
    const esito = await Notification.requestPermission();
    if (esito !== "granted") throw new Error("Permesso di notifica non concesso.");
  }

  const reg = await registrazioneServiceWorker();
  if (!reg) throw new Error("Impossibile registrare il service worker per le notifiche push.");

  let sub = await reg.pushManager.getSubscription();
  if (sub && !abbonamentoConChiaveAttuale(sub)) {
    // Abbonamento creato con una chiave vecchia: il server non puo' piu' usarlo. Si toglie e se ne crea uno nuovo.
    const vecchio = sub.endpoint;
    await sub.unsubscribe().catch(() => undefined);
    await supabaseClient.from("push_subscriptions").delete().eq("endpoint", vecchio);
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chiaveApplicationServer(vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  const chiavi = json.keys;
  if (!json.endpoint || !chiavi?.p256dh || !chiavi?.auth) {
    throw new Error("Abbonamento push incompleto: riprova.");
  }

  const { error } = await supabaseClient.rpc("salva_abbonamento_push", {
    p_endpoint: json.endpoint,
    p_p256dh: chiavi.p256dh,
    p_auth: chiavi.auth,
  });
  if (error) throw error;
}

/** Disiscrive questo dispositivo/browser e rimuove l'abbonamento dal server. */
export async function disattivaNotifichePushCertificati(): Promise<void> {
  if (!pushCertificatiSupportato()) return;
  const reg = await navigator.serviceWorker.getRegistration(`${BASE_URL_WEB}/`);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabaseClient.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** Chiede al server di mandare una notifica di prova ai dispositivi iscritti di questo utente. Restituisce quante ne ha inviate. */
export async function inviaNotificaDiProva(): Promise<number> {
  const { data, error } = await supabaseClient.functions.invoke("notifica-prova", { body: {} });
  if (error) {
    // Il corpo dell'errore contiene il messaggio leggibile restituito dalla funzione.
    let messaggio = "Invio non riuscito. Riprova.";
    try {
      const corpo = await (error as { context?: Response }).context?.json();
      if (corpo?.messaggio) messaggio = corpo.messaggio;
    } catch { /* si usa il messaggio generico */ }
    throw new Error(messaggio);
  }
  const inviate = (data as { inviate?: number } | null)?.inviate ?? 0;
  if (inviate === 0) throw new Error("La notifica non e' stata consegnata: disattiva e riattiva le notifiche su questo dispositivo.");
  return inviate;
}
