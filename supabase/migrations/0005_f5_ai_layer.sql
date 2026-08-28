-- ============================================================
-- F5 — Layer AI, manual-first (equivalente di V2+V7 in AIVolleyballCoach
-- GAS, qui riprogettato fin da subito come nella patch V7.1: un solo
-- flusso Valutazioni con AI come assist opzionale, mai un gate).
-- Numerata "0005" per lasciare 0003/0004 a Scouting live e Match
-- Analysis (fasi F3/F4, deliberatamente rimandate).
--
-- Le chiavi dei provider (Gemini/OpenRouter/Groq) NON vivono in nessuna
-- tabella qui: stanno solo come secret dell'Edge Function ai-router
-- (supabase/functions/ai-router), esattamente come leggiSegreto_() in
-- GAS non le metteva mai nel foglio Config. Qui sotto c'è solo la
-- configurazione "quali provider, in che ordine, con quale modello".
-- ============================================================

create table if not exists evaluation_proposals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  fondamentale text not null check (fondamentale in ('Battuta', 'Ricezione', 'Attacco', 'Muro', 'Difesa')),
  valore_attuale numeric(3,1),
  valore_proposto numeric(3,1) not null,
  confidenza text not null default 'media' check (confidenza in ('bassa', 'media', 'alta')),
  motivazione text default '',
  provider_usato text,
  stato text not null default 'proposta' check (stato in ('proposta', 'approvata', 'modificata', 'rigettata')),
  valutazione_id uuid references evaluations on delete set null,
  creata_il timestamptz not null default now(),
  decisa_il timestamptz,
  decisa_da uuid references auth.users on delete set null
);

create index if not exists idx_evaluation_proposals_pendenti
  on evaluation_proposals (team_id, athlete_id, fondamentale) where (stato = 'proposta');

alter table evaluation_proposals enable row level security;
drop policy if exists "evaluation_proposals_select_member" on evaluation_proposals;
create policy "evaluation_proposals_select_member" on evaluation_proposals for select using (is_team_member(team_id));
drop policy if exists "evaluation_proposals_write_coach" on evaluation_proposals;
create policy "evaluation_proposals_write_coach" on evaluation_proposals for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

-- 2. AI_PROVIDERS_CONFIG --------------------------------------------------
-- Sostituisce il foglio "AiProviders", ma con un vincolo che nella
-- versione GAS non c'era: provider_code è vincolato a un CHECK, quindi
-- non può più esistere una riga fantasma "GEMINI2" (il problema risolto
-- a runtime con l'allow-list nella patch V7.1 qui è impedito a monte,
-- direttamente dal database).
create table if not exists ai_providers_config (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams on delete cascade, -- null = default globale
  provider_code text not null check (provider_code in ('GEMINI', 'OPENROUTER', 'GROQ')),
  enabled boolean not null default true,
  priority integer not null default 1,
  modello text,
  unique (team_id, provider_code)
);

insert into ai_providers_config (team_id, provider_code, enabled, priority, modello) values
  (null, 'GEMINI', true, 1, 'gemini-2.0-flash'),
  (null, 'GROQ', true, 2, 'llama-3.3-70b-versatile'),
  (null, 'OPENROUTER', true, 3, 'openrouter/free')
on conflict (team_id, provider_code) do nothing;

alter table ai_providers_config enable row level security;
drop policy if exists "ai_providers_config_select_member" on ai_providers_config;
create policy "ai_providers_config_select_member" on ai_providers_config for select using (
  team_id is null or is_team_member(team_id)
);
drop policy if exists "ai_providers_config_write_coach" on ai_providers_config;
create policy "ai_providers_config_write_coach" on ai_providers_config for all using (
  team_id is not null and is_team_coach(team_id)
) with check (
  team_id is not null and is_team_coach(team_id)
);

-- 3. AI_CALL_LOG (rate limiting) -------------------------------------------
-- Sostituisce RateLimiter.gs (che contava le chiamate in una Script
-- Property al giorno). Qui è una riga per chiamata riuscita: più
-- verboso ma auditabile, e la quota si calcola con una query invece di
-- un contatore a parte che può disallinearsi.
create table if not exists ai_call_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  provider_usato text not null,
  creato_il timestamptz not null default now()
);

create index if not exists idx_ai_call_log_team_giorno on ai_call_log (team_id, creato_il desc);

alter table ai_call_log enable row level security;
drop policy if exists "ai_call_log_select_member" on ai_call_log;
create policy "ai_call_log_select_member" on ai_call_log for select using (is_team_member(team_id));
-- Nessuna policy di insert per i client: solo l'Edge Function (con la
-- service_role key, che salta la RLS) scrive qui, per evitare che un
-- client possa falsificare il proprio conteggio di chiamate residue.

-- 4. RPC di supporto per il client -----------------------------------------

-- Quota giornaliera residua per team (default 20/giorno, configurabile
-- in futuro per team se servirà — oggi è un valore fisso condiviso).
create or replace function ai_chiamate_residue_oggi(p_team_id uuid)
returns integer
language sql stable
as $$
  select greatest(0, 20 - count(*)::integer)
  from ai_call_log
  where team_id = p_team_id and creato_il >= date_trunc('day', now());
$$;

-- Applica la decisione dell'allenatore su una proposta: approvata così
-- com'è, o modificata con un valore diverso. In entrambi i casi crea la
-- valutazione reale e collega la proposta ad essa — dopo questa funzione,
-- una valutazione "nata dall'AI" è indistinguibile in query da una
-- manuale se non per la colonna origine (stesso principio di
-- EvaluationsAI.gs originale: approvaProposta/modificaProposta).
create or replace function decidi_proposta_valutazione(p_proposta_id uuid, p_valore_finale numeric, p_note text default '')
returns uuid
language plpgsql
security definer
as $$
declare
  v_proposta record;
  v_valutazione_id uuid;
  v_origine text;
begin
  select * into v_proposta from evaluation_proposals where id = p_proposta_id and stato = 'proposta';
  if v_proposta is null then
    raise exception 'Proposta non trovata o già decisa: %', p_proposta_id;
  end if;
  if not is_team_coach(v_proposta.team_id) then
    raise exception 'Permesso negato';
  end if;

  v_origine := case when p_valore_finale = v_proposta.valore_proposto then 'ai_approvata' else 'ai_modificata' end;

  insert into evaluations (team_id, athlete_id, fondamentale, punteggio, note, valutatore, origine)
  values (v_proposta.team_id, v_proposta.athlete_id, v_proposta.fondamentale, p_valore_finale, p_note, auth.uid(), v_origine)
  returning id into v_valutazione_id;

  update evaluation_proposals
  set stato = case when v_origine = 'ai_approvata' then 'approvata' else 'modificata' end,
      decisa_il = now(), decisa_da = auth.uid(), valutazione_id = v_valutazione_id
  where id = p_proposta_id;

  return v_valutazione_id;
end;
$$;

create or replace function rigetta_proposta_valutazione(p_proposta_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from evaluation_proposals where id = p_proposta_id and stato = 'proposta';
  if v_team_id is null then raise exception 'Proposta non trovata o già decisa: %', p_proposta_id; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update evaluation_proposals set stato = 'rigettata', decisa_il = now(), decisa_da = auth.uid() where id = p_proposta_id;
end;
$$;
