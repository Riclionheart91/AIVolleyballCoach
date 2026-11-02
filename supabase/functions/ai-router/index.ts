// supabase/functions/ai-router/index.ts
//
// Router provider AI. Le chiavi sono secret di progetto, mai esposte al client.
// Secret attesi: GEMINI_API_KEY, GEMINI_API_KEY_2, GROQ_API_KEY, OPENROUTER_API_KEY.
//
// Ogni chiamata viene tracciata in ai_call_log: esito, durata, funzione dell'app che l'ha chiesta, provider provati
// ed eventuale errore. Del prompt si salva solo la lunghezza, mai il testo (puo' contenere dati delle atlete).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region, accept, accept-profile, content-profile, prefer",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function rispostaPreflight(req: Request): Response {
  const richieste = req.headers.get("Access-Control-Request-Headers");
  return new Response("ok", {
    headers: { ...CORS_HEADERS, ...(richieste ? { "Access-Control-Allow-Headers": richieste } : {}) },
  });
}

type Provider = "GEMINI" | "GEMINI2" | "GROQ" | "OPENROUTER";

/** Ogni provider dichiara da quale secret legge la chiave: GEMINI2 è lo stesso servizio di GEMINI ma con una seconda chiave, usata come
 *  riserva quando la prima esaurisce la quota giornaliera del piano gratuito. */
const SECRET_PER_PROVIDER: Record<Provider, string> = {
  GEMINI: "GEMINI_API_KEY",
  GEMINI2: "GEMINI_API_KEY_2",
  GROQ: "GROQ_API_KEY",
  OPENROUTER: "OPENROUTER_API_KEY",
};

interface ProviderConfig {
  provider_code: Provider;
  enabled: boolean;
  priority: number;
  modello: string | null;
}

interface RichiestaAI {
  team_id: string;
  prompt: string;
  /** Etichetta della funzione dell'app che chiede (es. "esercizi", "voti"): serve solo alle tracce. */
  funzione?: string;
}

/** Oltre questa lunghezza il prompt viene rifiutato: i prompt veri dell'app restano molto sotto. */
const MAX_PROMPT_CARATTERI = 12000;

interface TracciaChiamata {
  team_id: string;
  provider_usato: string | null;
  esito: "ok" | "errore";
  durata_ms: number;
  funzione: string | null;
  tentativi: number;
  errore: string | null;
  prompt_caratteri: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return rispostaPreflight(req);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ errore: true, messaggio: "Sessione non valida. Effettua di nuovo l'accesso." }, 401);
    }

    const inizio = Date.now();
    const { team_id, prompt, funzione } = (await req.json()) as RichiestaAI;
    if (!team_id || !prompt) {
      return jsonResponse({ errore: true, messaggio: "Richiesta incompleta (team_id/prompt mancanti)." }, 400);
    }
    if (prompt.length > MAX_PROMPT_CARATTERI) {
      return jsonResponse({ errore: true, messaggio: `La richiesta è troppo lunga (${prompt.length} caratteri, massimo ${MAX_PROMPT_CARATTERI}). Accorcia le istruzioni aggiuntive.` }, 400);
    }
    const etichetta = typeof funzione === "string" ? funzione.slice(0, 40) : null;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: membro } = await admin.from("team_members").select("ruolo").eq("team_id", team_id).eq("user_id", userData.user.id).maybeSingle();
    if (!membro || !["allenatore", "vice_allenatore"].includes(membro.ruolo)) {
      return jsonResponse({ errore: true, messaggio: "Utente non autorizzato su questo team." }, 403);
    }

    const { data: residue } = await admin.rpc("ai_chiamate_residue_oggi", { p_team_id: team_id });
    if ((residue ?? 0) <= 0) {
      return jsonResponse({ errore: true, messaggio: "Limite giornaliero di chiamate AI raggiunto per questo team. Il percorso manuale resta sempre disponibile." }, 429);
    }

    const { data: configTeam } = await admin.from("ai_providers_config").select("*").eq("team_id", team_id);
    const { data: configDefault } = await admin.from("ai_providers_config").select("*").is("team_id", null);
    const configurazioni: ProviderConfig[] = (configTeam && configTeam.length > 0 ? configTeam : configDefault ?? [])
      .filter((c: ProviderConfig) => c.enabled)
      .sort((a: ProviderConfig, b: ProviderConfig) => a.priority - b.priority);

    const erroriPerProvider: string[] = [];
    let tentativi = 0;
    for (const cfg of configurazioni) {
      tentativi++;
      try {
        const testo = await chiamaProvider(cfg, prompt);
        await registraTraccia(admin, {
          team_id, provider_usato: cfg.provider_code, esito: "ok", durata_ms: Date.now() - inizio,
          funzione: etichetta, tentativi,
          errore: erroriPerProvider.length ? erroriPerProvider.join(" | ").slice(0, 500) : null,
          prompt_caratteri: prompt.length,
        });
        return jsonResponse({ errore: false, testo, providerUsato: cfg.provider_code, chiamateResidue: (residue ?? 1) - 1, limite: 20 });
      } catch (e) {
        const dettaglio = `${cfg.provider_code} (modello ${cfg.modello ?? "default"}): ${(e as Error).message}`;
        console.error("Provider AI fallito:", dettaglio);
        erroriPerProvider.push(dettaglio);
      }
    }

    await registraTraccia(admin, {
      team_id, provider_usato: null, esito: "errore", durata_ms: Date.now() - inizio,
      funzione: etichetta, tentativi,
      errore: (erroriPerProvider.join(" | ") || "nessun provider abilitato").slice(0, 500),
      prompt_caratteri: prompt.length,
    });

    const chiaviMancanti = configurazioni
      .map((c) => SECRET_PER_PROVIDER[c.provider_code])
      .filter((nome) => nome && !Deno.env.get(nome));

    return jsonResponse({
      errore: true,
      messaggio: "Tutti i provider AI disponibili hanno fallito. Il percorso manuale resta sempre disponibile.",
      dettagli: erroriPerProvider.join(" | "),
      chiaviMancanti,
    }, 200);
  } catch (e) {
    console.error("Errore interno router AI:", (e as Error).message);
    return jsonResponse({ errore: true, messaggio: "Errore interno del router AI: " + (e as Error).message }, 500);
  }
});

/**
 * Scrive la traccia della chiamata. Un errore qui non deve mai rompere la risposta all'utente:
 * al massimo la traccia manca. Del prompt si salva solo la lunghezza, mai il testo.
 */
async function registraTraccia(admin: ReturnType<typeof createClient>, traccia: TracciaChiamata): Promise<void> {
  try {
    const { error } = await admin.from("ai_call_log").insert(traccia);
    if (error) console.error("ai_call_log:", error.message);
  } catch (e) {
    console.error("ai_call_log:", (e as Error).message);
  }
}

async function chiamaProvider(cfg: ProviderConfig, prompt: string): Promise<string> {
  const nomeSecret = SECRET_PER_PROVIDER[cfg.provider_code];
  const apiKey = nomeSecret ? Deno.env.get(nomeSecret) : undefined;
  if (!apiKey) throw new Error(`chiave ${nomeSecret} non configurata nei secret del progetto`);

  switch (cfg.provider_code) {
    case "GEMINI":
    case "GEMINI2":
      return chiamaGemini(prompt, cfg.modello ?? "gemini-3.6-flash", apiKey);
    case "GROQ":
      return chiamaGroq(prompt, cfg.modello ?? "llama-3.3-70b-versatile", apiKey);
    case "OPENROUTER":
      return chiamaOpenRouter(prompt, cfg.modello ?? "openrouter/free", apiKey);
    default:
      throw new Error("provider non implementato");
  }
}

/** Include sempre un estratto del corpo della risposta: senza, un 400/404 non dice se il problema è il modello, la chiave o la quota. */
async function erroreDettagliato(resp: Response): Promise<string> {
  const corpo = await resp.text().catch(() => "");
  return `HTTP ${resp.status}${corpo ? ` — ${corpo.slice(0, 300)}` : ""}`;
}

async function chiamaGemini(prompt: string, modello: string, apiKey: string): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) },
  );
  if (!resp.ok) throw new Error(await erroreDettagliato(resp));
  const data = await resp.json();
  const testo = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!testo) throw new Error("risposta vuota o bloccata dai filtri di sicurezza");
  return testo;
}

async function chiamaGroq(prompt: string, modello: string, apiKey: string): Promise<string> {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modello, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) throw new Error(await erroreDettagliato(resp));
  const data = await resp.json();
  const testo = data?.choices?.[0]?.message?.content;
  if (!testo) throw new Error("risposta vuota");
  return testo;
}

async function chiamaOpenRouter(prompt: string, modello: string, apiKey: string): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modello, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) throw new Error(await erroreDettagliato(resp));
  const data = await resp.json();
  const testo = data?.choices?.[0]?.message?.content;
  if (!testo) throw new Error("risposta vuota");
  return testo;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}
