// supabase/functions/attiva-accesso/index.ts
//
// Attivazione dell'accesso con email e password tramite il link personale mandato su WhatsApp
// (tabella link_accesso, migrazione 0093). Serve sia al primo invito di un'atleta o di uno staff
// sia al reset della password confermato dall'allenatore (o dal presidente per lo staff).
//
// FUNZIONE PUBBLICA: va deployata con verify_jwt=false (chi apre il link non ha ancora una sessione).
//   supabase functions deploy attiva-accesso --no-verify-jwt
// La sicurezza sta nel token del link (64 caratteri casuali, monouso, scade in 7 giorni, massimo
// 10 tentativi sbagliati), non nel chiamante.
//
// Secret necessari: nessuno oltre a quelli che Supabase fornisce da solo alle edge function
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).
//
// Richiesta (POST, JSON):  { token: string, password: string, email?: string }
//   - email serve SOLO quando il link non ne contiene una (staff invitato "libero"): negli altri
//     casi l'email viene sempre dal link o dall'account e quella del corpo si ignora.
// Risposta: { ok: true, email, team_id }  oppure  { errore: true, messaggio }.
//
// Mai loggare password o token: i log di questa funzione sono volutamente muti.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_TENTATIVI = 10;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // limite di bcrypt: oltre questa lunghezza i caratteri verrebbero ignorati.
const PAGINE_MAX_RICERCA = 20; // 20 pagine da 1000 utenti: oltre, la ricerca per email si ferma.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MSG_LINK_NON_VALIDO = "Questo link non è valido, è già stato usato oppure è scaduto. Chiedine uno nuovo a chi ti ha invitato.";

interface LinkAccesso {
  id: string;
  team_id: string | null;
  societa_id: string | null;
  ruolo: string;
  atleta_id: string | null;
  user_id: string | null;
  email: string | null;
  tipo: "invito" | "reset";
  token: string;
  scade_il: string;
  usato_il: string | null;
  tentativi: number;
}

type Admin = ReturnType<typeof createClient>;
interface UtenteAdmin {
  id: string;
  email?: string | null;
  identities?: { provider: string }[] | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function errore(messaggio: string, status = 400): Response {
  return jsonResponse({ errore: true, messaggio }, status);
}

function normalizzaEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function emailValida(e: string): boolean {
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

/** Vero se l'account ha SOLO l'accesso con Google (nessuna identità email/password). */
function soloGoogle(u: UtenteAdmin): boolean {
  const provider = (u.identities ?? []).map((i) => i.provider);
  return provider.includes("google") && !provider.includes("email");
}

/**
 * L'API admin non ha una ricerca per email: si scorre l'elenco a pagine. Va bene per una società
 * piccola; se gli utenti diventassero molte migliaia conviene una funzione SQL dedicata.
 */
async function trovaUtentePerEmail(admin: Admin, email: string): Promise<UtenteAdmin | null> {
  for (let pagina = 1; pagina <= PAGINE_MAX_RICERCA; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) return null;
    const trovato = (data.users as UtenteAdmin[]).find((u) => (u.email ?? "").toLowerCase() === email);
    if (trovato) return trovato;
    if (data.users.length < 1000) return null;
  }
  return null;
}

/** Ogni errore dopo aver letto il link conta come tentativo: chi indovina a caso si blocca presto. */
async function contaTentativo(admin: Admin, link: LinkAccesso) {
  await admin.from("link_accesso").update({ tentativi: link.tentativi + 1 }).eq("id", link.id);
}

/** Chiude tutte le sessioni di un account la cui password è appena cambiata. Un errore non deve bloccare l'attivazione. */
async function revocaSessioni(admin: Admin, userId: string) {
  try {
    await admin.rpc("revoca_sessioni_utente", { p_user_id: userId });
  } catch {
    /* volutamente muto: nessun dato sensibile nei log */
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errore("Metodo non consentito.", 405);

  let corpo: { token?: unknown; password?: unknown; email?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return errore("Richiesta non valida.");
  }

  const token = typeof corpo.token === "string" ? corpo.token.trim() : "";
  const password = typeof corpo.password === "string" ? corpo.password : "";
  if (token.length < 20 || token.length > 200) return errore(MSG_LINK_NON_VALIDO);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: riga } = await admin.from("link_accesso").select("*").eq("token", token).maybeSingle();
  const link = riga as LinkAccesso | null;
  if (!link) return errore(MSG_LINK_NON_VALIDO);
  if (link.usato_il || new Date(link.scade_il) <= new Date()) return errore(MSG_LINK_NON_VALIDO);
  if (link.tentativi >= MAX_TENTATIVI) return errore("Troppi tentativi con questo link. Chiedine uno nuovo a chi ti ha invitato.", 429);

  async function fallisci(messaggio: string, status = 400): Promise<Response> {
    await contaTentativo(admin, link!);
    return errore(messaggio, status);
  }

  if (password.length < PASSWORD_MIN) return fallisci(`La password deve avere almeno ${PASSWORD_MIN} caratteri.`);
  if (password.length > PASSWORD_MAX) return fallisci(`La password può avere al massimo ${PASSWORD_MAX} caratteri.`);

  // ── Reset di un account che esiste già: l'email è quella dell'account, non si sceglie. ──
  if (link.tipo === "reset" && link.user_id) {
    const { data: esistente, error: errUtente } = await admin.auth.admin.getUserById(link.user_id);
    const utente = esistente?.user as UtenteAdmin | undefined;
    if (errUtente || !utente?.email) return fallisci("Non riesco a trovare il tuo account. Chiedi un nuovo link.");
    if (soloGoogle(utente)) return fallisci("Questo account entra con Google: usa il pulsante «Accedi con Google».");

    // Prima si consuma il link (monouso, atomico nel database), poi si cambia la password: così due usi quasi
    // simultanei dello stesso link non possono cambiare la password due volte.
    const { data: teamId, error: errCollega } = await admin.rpc("collega_accesso_da_link", {
      p_token: token, p_user_id: utente.id, p_email: utente.email.toLowerCase(),
    });
    if (errCollega) return fallisci("Non sono riuscito a completare l'accesso. Chiedi un nuovo link.", 500);
    // NULL = link non valido, già usato o non coincidente: niente password cambiata, niente "ok".
    if (!teamId) return errore(MSG_LINK_NON_VALIDO);

    const { error: errAgg } = await admin.auth.admin.updateUserById(utente.id, { password, email_confirm: true });
    if (errAgg) return errore("Non sono riuscito a salvare la nuova password. Chiedi un nuovo link.", 500);

    await revocaSessioni(admin, utente.id);
    return jsonResponse({ ok: true, email: utente.email.toLowerCase(), team_id: teamId });
  }

  // ── Primo invito (o reset senza account associato): serve un'email. ──
  const emailLink = normalizzaEmail(link.email);
  const emailLibera = emailLink === "";
  const email = emailLibera ? normalizzaEmail(corpo.email) : emailLink; // se il link ha l'email, quella del corpo si ignora.
  if (!email) return fallisci("Scrivi l'email con cui vuoi entrare.");
  if (!emailValida(email)) return fallisci("L'email non sembra corretta: controllala.");

  let utente: UtenteAdmin | null = null;
  let creatoOra = false;

  const { data: creato, error: errCrea } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!errCrea && creato?.user) {
    utente = creato.user as UtenteAdmin;
    creatoOra = true;
  } else {
    // Quasi certamente "già registrata": si recupera l'account esistente. Qualunque altro errore resta generico.
    const esistente = await trovaUtentePerEmail(admin, email);
    if (!esistente) return fallisci("Non sono riuscito a creare l'accesso. Riprova tra poco.", 500);
    // Email scelta liberamente (staff senza email in anagrafica): non si tocca un account altrui.
    if (emailLibera) return fallisci("Questa email è già in uso: scrivine un'altra.");
    if (soloGoogle(esistente)) return fallisci("Per questa email si entra con Google: usa il pulsante «Accedi con Google».");

    // Email di anagrafica con account già presente (password o mai confermato): la password si imposta di
    // nuovo, ma solo dopo aver consumato il link (vedi sotto).
    utente = esistente;
  }

  const { data: teamId, error: errCollega } = await admin.rpc("collega_accesso_da_link", {
    p_token: token, p_user_id: utente.id, p_email: email,
  });
  if (errCollega || !teamId) {
    // Non si lascia un account orfano appena creato.
    if (creatoOra) await admin.auth.admin.deleteUser(utente.id).catch(() => {});
    if (errCollega) return fallisci("Non sono riuscito a completare l'accesso. Chiedi un nuovo link.", 500);
    // NULL = link non valido, già usato o non coincidente: niente "ok" e nessuna password cambiata.
    return errore(MSG_LINK_NON_VALIDO);
  }

  if (!creatoOra) {
    // Account già esistente: la nuova password si imposta dopo aver consumato il link e si chiudono le vecchie sessioni.
    const { error: errAgg } = await admin.auth.admin.updateUserById(utente.id, { password, email_confirm: true });
    if (errAgg) return errore("Non sono riuscito a salvare la password. Chiedi un nuovo link.", 500);
    await revocaSessioni(admin, utente.id);
  }

  return jsonResponse({ ok: true, email, team_id: teamId });
});
