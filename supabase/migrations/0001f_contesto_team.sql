-- ============================================================
-- 0001f — mio_contesto_team(): caricamento atomico squadra+stagione
--
-- Causa reale del bug "l'atleta vede 'nessuna stagione aperta' anche
-- se ce n'è una attiva" (e sospetta concausa del bug "l'allenatore
-- vede sempre 'crea squadra'"): il client caricava squadra e stagione
-- attiva con DUE effetti React separati. Quello della stagione partiva
-- subito con team ancora nullo, impostando "nessuna stagione" come
-- stato iniziale — e per una manciata di millisecondi, tra il momento
-- in cui la squadra veniva risolta e il momento in cui l'effetto della
-- stagione si ri-eseguiva con il team corretto, l'app poteva leggere
-- quello stato iniziale "nessuna stagione" come se fosse definitivo e
-- reindirizzare l'utente alla schermata sbagliata.
--
-- Questa funzione elimina la possibilità stessa della race: un'unica
-- query atomica, SECURITY DEFINER (bypassa la RLS per il proprio
-- controllo di appartenenza, stesso principio già applicato a
-- is_team_member e affini), che il client chiama una volta sola e da
-- cui deriva SIA la squadra SIA la stagione attiva nello stesso
-- istante — non possono più disallinearsi tra loro perché non sono
-- più due richieste separate.
--
-- Multi-squadra: una riga per ogni squadra a cui l'utente appartiene,
-- ciascuna con la propria (eventuale) stagione attiva — il client
-- sceglie quale usare come "corrente" allo stesso modo di prima
-- (preferenza salvata, altrimenti la squadra più vecchia).
-- ============================================================

create or replace function mio_contesto_team()
returns table(
  team_id uuid,
  team_nome text,
  team_creato_il timestamptz,
  ruolo text,
  atleta_id uuid,
  stagione_id uuid,
  stagione_nome text,
  stagione_stato text,
  stagione_aperta boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select
      tm.team_id,
      t.nome,
      t.creato_il,
      tm.ruolo,
      tm.atleta_id,
      s.id,
      s.nome,
      s.stato,
      (s.stato = 'attiva')
    from team_members tm
    join teams t on t.id = tm.team_id
    left join seasons s on s.team_id = tm.team_id and s.stato = 'attiva'
    where tm.user_id = auth.uid()
    order by t.creato_il asc;
end;
$$;
