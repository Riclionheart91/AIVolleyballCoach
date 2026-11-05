import { Linking, Platform } from "react-native";

/**
 * Apre un link WhatsApp (wa.me).
 *  - App nativa: apre il link con il sistema.
 *  - Web su telefono: wa.me passa il testimone all'app WhatsApp e lascia dietro una scheda bianca. La scheda e'
 *    aperta da noi, quindi la chiudiamo da soli appena si torna all'app.
 *  - Web su computer: la scheda e' WhatsApp Web e resta aperta, e' li' che si preme invia.
 */
export function apriWhatsApp(url: string) {
  if (Platform.OS !== "web") {
    Linking.openURL(url);
    return;
  }
  const finestra = window.open(url, "_blank");
  if (!finestra) {
    // Blocco dei popup: si usa la scheda corrente, meglio che non aprire nulla.
    window.location.href = url;
    return;
  }
  // Senza "noopener" la scheda si puo' chiudere da qui; si taglia comunque il legame con questa pagina.
  try { finestra.opener = null; } catch { /* alcuni browser non lo permettono */ }

  const ua = navigator.userAgent;
  const telefono = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!telefono) return;

  let scaduto: ReturnType<typeof setTimeout> | null = null;
  const chiudi = () => {
    document.removeEventListener("visibilitychange", alRitorno);
    if (scaduto) clearTimeout(scaduto);
    try { if (!finestra.closed) finestra.close(); } catch { /* gia' chiusa */ }
  };
  const alRitorno = () => {
    if (document.visibilityState === "visible") setTimeout(chiudi, 400);
  };
  document.addEventListener("visibilitychange", alRitorno);
  // Se non si torna mai, non si lascia l'ascoltatore appeso per sempre.
  scaduto = setTimeout(() => document.removeEventListener("visibilitychange", alRitorno), 30 * 60 * 1000);
}
