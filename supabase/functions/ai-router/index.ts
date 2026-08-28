// supabase/functions/ai-router/index.ts
//
// Equivalente di AI.gs (chiamaProviderAI_ + RateLimiter.gs) nel mondo GAS.
// Gira come Edge Function Deno: le chiavi dei provider sono secret di
// progetto (supabase secrets set GEMINI_API_KEY=... ecc.), MAI esposte al
// client — stessa garanzia di leggiSegreto_() in Config.gs, qui è
// impossibile per costruzione perché il client non ha alcuna via per
// leggere le variabili d'ambiente della function.
//
// Deploy:   supabase functions deploy ai-router
// Secrets:  supabase secrets set GEMINI_API_KEY=xxx GROQ_API_KEY=xxx OPENROUTER_API_KEY=xxx
//
// Contratto: il client manda il proprio JWT (Supabase Auth) + team_id +
// prompt. La function verifica che l'utente sia membro del team (stessa
// verificaPermesso_ di Auth.gs, qui via query a team_members con la
// service_role key), controlla la quota giornaliera, e prova i provider
// in cascata secondo ai_providers_config. Se tutti falliscono, risponde
// con errore chiaro invece di un errore tecnico — il client mostra
// comunque il percorso manuale, che non passa mai da qui.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Provider = "GEMINI" | "GROQ" | "OPENROUTER";

interface ProviderConfig {
  provider_code: Provider;
  enabled: boolean;
  priority: number;
  modello: string | null;
}

interface RichiestaAI {
  team_id: string;
  prompt: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ errore: true, messaggio: "Sessione non valida. Effettua di nuovo l'accesso." }, 401);
    }

    const { team_id, prompt } = (await req.json()) as RichiestaAI;
    if (!team_id || !prompt) {
      return jsonResponse({ errore: true, messaggio: "Richiesta incompleta (team_id/prompt mancanti)." }, 400);
    }

    // service_role: bypassa la RLS solo qui, dopo aver verificato a mano
    // l'appartenenza al team — equivalente esatto di verificaPermesso_().
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: membro } = await admin
      .from("team_members")
      .select("ruolo")
      .eq("team_id", team_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
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
    for (const cfg of configurazioni) {
      try {
        const testo = await chiamaProvider(cfg, prompt);
        await admin.from("ai_call_log").insert({ team_id, provider_usato: cfg.provider_code });
        return jsonResponse({
          errore: false,
          testo,
          providerUsato: cfg.provider_code,
          chiamateResidue: (residue ?? 1) - 1,
          limite: 20,
        });
      } catch (e) {
        erroriPerProvider.push(`${cfg.provider_code}: ${(e as Error).message}`);
      }
    }

    return jsonResponse({
      errore: true,
      messaggio: "AI Disabled Mode: tutti i provider disponibili hanno fallito. Il percorso manuale resta sempre disponibile.",
      dettagli: erroriPerProvider.join(" | "),
    }, 200);
  } catch (e) {
    return jsonResponse({ errore: true, messaggio: "Errore interno del router AI: " + (e as Error).message }, 500);
  }
});

async function chiamaProvider(cfg: ProviderConfig, prompt: string): Promise<string> {
  switch (cfg.provider_code) {
    case "GEMINI":
      return chiamaGemini(prompt, cfg.modello ?? "gemini-2.0-flash");
    case "GROQ":
      return chiamaGroq(prompt, cfg.modello ?? "llama-3.3-70b-versatile");
    case "OPENROUTER":
      return chiamaOpenRouter(prompt, cfg.modello ?? "openrouter/free");
    default:
      throw new Error("provider non implementato");
  }
}

async function chiamaGemini(prompt: string, modello: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("chiave API non configurata");
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status} (${resp.status === 503 ? "modello sovraccarico, riprovare" : "errore"})`);
  const data = await resp.json();
  const testo = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!testo) throw new Error("risposta vuota");
  return testo;
}

async function chiamaGroq(prompt: string, modello: string): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("chiave API non configurata");
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modello, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const testo = data?.choices?.[0]?.message?.content;
  if (!testo) throw new Error("risposta vuota");
  return testo;
}

async function chiamaOpenRouter(prompt: string, modello: string): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("chiave API non configurata");
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modello, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) {
    if (resp.status === 404) throw new Error("modello non più nel free tier, impostare 'openrouter/free' come modello");
    throw new Error(`HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const testo = data?.choices?.[0]?.message?.content;
  if (!testo) throw new Error("risposta vuota");
  return testo;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
