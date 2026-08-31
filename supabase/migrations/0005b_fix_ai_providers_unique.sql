-- ============================================================
-- 0005b — Fix unicità ai_providers_config per righe globali
--
-- Il vincolo "unique (team_id, provider_code)" di 0005_f5_ai_layer.sql
-- non impedisce duplicati quando team_id è NULL (i default globali):
-- in SQL, due valori NULL non sono mai considerati uguali ai fini di un
-- vincolo UNIQUE. Effetto pratico: ogni riesecuzione di
-- setup_supabase.sql duplicava le 3 righe globali seminate all'inizio.
-- Sostituito con due indici parziali, uno per team specifici e uno per
-- i default globali, che coprono correttamente entrambi i casi.
-- ============================================================

alter table ai_providers_config drop constraint if exists ai_providers_config_team_id_provider_code_key;

create unique index if not exists idx_ai_providers_config_team
  on ai_providers_config (team_id, provider_code) where team_id is not null;

create unique index if not exists idx_ai_providers_config_globale
  on ai_providers_config (provider_code) where team_id is null;

-- Rimuove eventuali duplicati globali già creati da riesecuzioni
-- precedenti (tiene solo la riga più vecchia per provider_code).
delete from ai_providers_config a
where a.team_id is null
  and a.id not in (
    select min(b.id) from ai_providers_config b where b.team_id is null group by b.provider_code
  );

-- Riscritto con WHERE NOT EXISTS invece di ON CONFLICT: quest'ultimo
-- non si attiva sulle righe con team_id nullo per lo stesso motivo di
-- cui sopra, quindi il seed originale in 0005 duplicava ad ogni run.
insert into ai_providers_config (team_id, provider_code, enabled, priority, modello)
select null, x.provider_code, true, x.priority, x.modello
from (values
  ('GEMINI', 1, 'gemini-2.0-flash'),
  ('GROQ', 2, 'llama-3.3-70b-versatile'),
  ('OPENROUTER', 3, 'openrouter/free')
) as x(provider_code, priority, modello)
where not exists (
  select 1 from ai_providers_config existenti
  where existenti.team_id is null and existenti.provider_code = x.provider_code
);
