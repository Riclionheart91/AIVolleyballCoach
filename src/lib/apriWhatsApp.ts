import { Linking, Platform } from "react-native";

/** Trasforma un link wa.me nel link diretto all'app WhatsApp (whatsapp://send?phone=...&text=...). */
function linkAppWhatsApp(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "wa.me" && u.hostname !== "api.whatsapp.com") return null;
    const numero = u.hostname === "wa.me" ? u.pathname.replace(/\D/g, "") : (u.searchParams.get("phone") ?? "").replace(/\D/g, "");
    const testo = u.searchParams.get("text");
    const parametri = [numero ? `phone=${numero}` : "", testo ? `text=${encodeURIComponent(testo)}` : ""].filter(Boolean).join("&");
    return `whatsapp://send${parametri ? `?${parametri}` : ""}`;
  } catch {
    return null;
  }
}

/**
 * Apre un link WhatsApp (wa.me).
 *  - App nativa: apre il link con il sistema.
 *  - Web su telefono: si apre direttamente l'app WhatsApp (whatsapp://) dalla stessa pagina, senza passare da wa.me:
 *    cosi' non si apre nessuna scheda e quindi non ne resta una bianca. Se l'app non si apre (non installata) si
 *    ripiega sul link wa.me in una nuova scheda.
 *  - Web su computer: la scheda e' WhatsApp Web e resta aperta, e' li' che si preme invia.
 */
export function apriWhatsApp(url: string) {
  if (Platform.OS !== "web") {
    Linking.openURL(url);
    return;
  }
  const ua = navigator.userAgent;
  const telefono = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const diretto = telefono ? linkAppWhatsApp(url) : null;

  if (!diretto) {
    if (!window.open(url, "_blank")) window.location.href = url; // blocco dei popup: si usa la scheda corrente
    return;
  }

  // Se la pagina passa in secondo piano, WhatsApp si e' aperto: niente da fare. Altrimenti, dopo un attimo, ripiego.
  let aperto = false;
  const alCambio = () => { if (document.visibilityState === "hidden") aperto = true; };
  document.addEventListener("visibilitychange", alCambio);
  window.addEventListener("pagehide", alCambio);
  window.location.href = diretto;
  setTimeout(() => {
    document.removeEventListener("visibilitychange", alCambio);
    window.removeEventListener("pagehide", alCambio);
    if (!aperto && document.visibilityState === "visible") window.open(url, "_blank");
  }, 2500);
}
