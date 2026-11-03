import { Platform } from "react-native";

/**
 * Captcha Cloudflare Turnstile per gli accessi (password e accesso anonimo dello scout).
 *
 * Funziona SOLO se la build ha la variabile pubblica EXPO_PUBLIC_TURNSTILE_SITE_KEY e solo sul web:
 * senza chiave (o su app nativa) non fa nulla e il comportamento resta quello di sempre. Il token si chiede a
 * ogni accesso, perche' vale una volta sola. La verifica vera la fa Supabase (Authentication → Attack
 * Protection → Captcha) con la chiave segreta, che non sta mai nell'app.
 *
 * Il widget e' in modalita' "interaction-only": resta invisibile e compare al centro dello schermo solo
 * se Cloudflare vuole una verifica manuale.
 */

// Va scritta cosi', per intero: Expo sostituisce process.env.EXPO_PUBLIC_* solo con questa forma.
const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const URL_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TEMPO_MASSIMO_MS = 45000;

export const MSG_CAPTCHA_FALLITO = "Verifica di sicurezza non riuscita. Ricarica la pagina e riprova.";

type Turnstile = {
  render: (contenitore: HTMLElement, opzioni: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

export function captchaAttivo(): boolean {
  return Platform.OS === "web" && SITE_KEY !== "";
}

let caricamentoScript: Promise<Turnstile> | null = null;

function caricaScript(): Promise<Turnstile> {
  const giaPronto = (window as unknown as { turnstile?: Turnstile }).turnstile;
  if (giaPronto) return Promise.resolve(giaPronto);
  if (!caricamentoScript) {
    caricamentoScript = new Promise<Turnstile>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = URL_SCRIPT;
      s.async = true;
      s.onload = () => {
        const t = (window as unknown as { turnstile?: Turnstile }).turnstile;
        if (t) resolve(t); else reject(new Error(MSG_CAPTCHA_FALLITO));
      };
      s.onerror = () => { caricamentoScript = null; reject(new Error(MSG_CAPTCHA_FALLITO)); };
      document.head.appendChild(s);
    });
  }
  return caricamentoScript;
}

/**
 * Restituisce un token captcha nuovo, oppure undefined se il captcha non e' attivo in questa build.
 * Se la verifica non riesce lancia un errore con un messaggio pronto da mostrare.
 */
export async function ottieniTokenCaptcha(): Promise<string | undefined> {
  if (!captchaAttivo()) return undefined;
  const turnstile = await caricaScript();

  return new Promise<string>((resolve, reject) => {
    const fascia = document.createElement("div");
    fascia.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483647;pointer-events:none;";
    const interno = document.createElement("div");
    interno.style.pointerEvents = "auto";
    fascia.appendChild(interno);
    document.body.appendChild(fascia);

    let idWidget = "";
    let chiuso = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const chiudi = () => {
      if (chiuso) return;
      chiuso = true;
      if (timer) clearTimeout(timer);
      try { if (idWidget) turnstile.remove(idWidget); } catch { /* gia' rimosso */ }
      fascia.remove();
    };
    const fallisci = () => { chiudi(); reject(new Error(MSG_CAPTCHA_FALLITO)); };

    timer = setTimeout(fallisci, TEMPO_MASSIMO_MS);
    try {
      idWidget = turnstile.render(interno, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        theme: "auto",
        callback: (token: string) => { chiudi(); resolve(token); },
        "error-callback": () => { fallisci(); return true; },
        "timeout-callback": fallisci,
        "expired-callback": fallisci,
      });
    } catch {
      fallisci();
    }
  });
}

/** Vero se l'errore di Supabase viene dal controllo captcha. */
export function erroreDaCaptcha(messaggio: string | undefined): boolean {
  return (messaggio ?? "").toLowerCase().includes("captcha");
}
