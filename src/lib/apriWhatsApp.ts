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
 *    cosi' non si apre nessuna scheda e quindi non ne resta una bianca. Se WhatsApp non e' installato non succede nulla.
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

  // Nessun ripiego automatico: aprire una scheda dopo l'attesa rischierebbe proprio di lasciare la pagina bianca.
  window.location.href = diretto;
}
