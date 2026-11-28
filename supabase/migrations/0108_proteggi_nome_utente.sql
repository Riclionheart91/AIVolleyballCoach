-- ============================================================
-- 0108 — nome_utente(uuid) non deve esporre nome/email di chiunque.
-- Prima: eseguibile anche da anon, restituiva nome o email di qualsiasi utente
-- conoscendone l'UUID. Ora:
--   - EXECUTE revocato a PUBLIC e anon (resta authenticated, postgres, service_role);
--   - restituisce il nome solo a: l'utente stesso, un superuser (app_admins), chi condivide
--     una squadra, un presidente in carica della società proprietaria di una squadra di cui
--     l'utente è membro, un co-presidente della stessa società, un membro di una squadra della
--     società di cui l'utente è presidente. Altrimenti NULL (nessun errore: le liste non si rompono).
-- Chiamanti esistenti: elenca_presidenti_societa e elenca_squadre_societa (security definer,
-- auth.uid() è comunque quello del chiamante, che è presidente della società).
-- ============================================================

create or replace function nome_utente(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email)
  from auth.users u
  where u.id = p_user_id
    and auth.uid() is not null
    and (
      u.id = auth.uid()
      or exists (select 1 from app_admins a where a.user_id = auth.uid())
      -- stessa squadra
      or exists (
        select 1 from team_members me join team_members altro on altro.team_id = me.team_id
        where me.user_id = auth.uid() and altro.user_id = u.id
      )
      -- io presidente in carica, l'altro membro di una squadra della mia società
      or exists (
        select 1 from societa_presidenti sp
        join teams t on t.societa_id = sp.societa_id
        join team_members tm on tm.team_id = t.id
        where sp.user_id = auth.uid() and sp.fine_mandato is null and tm.user_id = u.id
      )
      -- io membro di una squadra, l'altro presidente in carica della sua società
      or exists (
        select 1 from team_members me
        join teams t on t.id = me.team_id
        join societa_presidenti sp on sp.societa_id = t.societa_id
        where me.user_id = auth.uid() and sp.user_id = u.id and sp.fine_mandato is null
      )
      -- co-presidenti della stessa società
      or exists (
        select 1 from societa_presidenti mio
        join societa_presidenti altro on altro.societa_id = mio.societa_id
        where mio.user_id = auth.uid() and mio.fine_mandato is null
          and altro.user_id = u.id and altro.fine_mandato is null
      )
    );
$$;

revoke all on function nome_utente(uuid) from public;
revoke all on function nome_utente(uuid) from anon;
grant execute on function nome_utente(uuid) to authenticated, service_role;
