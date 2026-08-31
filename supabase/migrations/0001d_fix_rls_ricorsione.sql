-- ============================================================
-- 0001d — Fix ricorsione RLS sulle funzioni helper
--
-- is_team_member/is_team_coach/is_team_presidente/mio_atleta_id
-- interrogano "team_members" per decidere la visibilità di righe che
-- possono trovarsi proprio dentro "team_members" (o, tramite
-- l'embedding automatico di PostgREST, dentro "teams" quando lo si
-- legge "annidato" da una query su team_members, come fa
-- AuthContext.ricaricaTeam()). Senza SECURITY DEFINER, Postgres valuta
-- questa autoreferenza sotto le stesse policy RLS che sta cercando di
-- decidere — un pattern che Supabase stesso segnala come causa di
-- risultati incoerenti (righe che esistono ma non vengono restituite).
-- Rendendole SECURITY DEFINER, queste funzioni leggono team_members
-- "ai margini" della RLS (bypassandola solo per il proprio controllo di
-- appartenenza, che è tutto ciò che devono fare), eliminando
-- l'autoriferimento alla radice. `set search_path = public` è
-- l'accorgimento di sicurezza standard per ogni funzione
-- SECURITY DEFINER, per evitare che qualcuno le "dirotti" verso
-- tabelle omonime in altri schema.
-- ============================================================

create or replace function is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function is_team_coach(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
      and ruolo in ('allenatore', 'vice_allenatore')
  );
$$;

create or replace function is_team_presidente(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members where team_id = p_team_id and user_id = auth.uid() and ruolo = 'presidente'
  );
$$;

create or replace function is_team_staff_visione_piena(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_team_coach(p_team_id) or is_team_presidente(p_team_id);
$$;

create or replace function mio_atleta_id(p_team_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select atleta_id from team_members
  where team_id = p_team_id and user_id = auth.uid() and ruolo = 'atleta';
$$;
