-- 0109: pulizia segnalazioni dell'audit (advisor Supabase).
-- (a) search_path fisso su due funzioni; (b) indici sulle 29 chiavi esterne scoperte.
-- Nessun cambio di logica.

-- (a)
alter function public.ai_chiamate_residue_oggi(uuid) set search_path = public, pg_temp;
alter function public.prossimo_nome_stagione(text) set search_path = public, pg_temp;

-- (b)
create index if not exists idx_link_accesso_creato_da on public.link_accesso (creato_da);
create index if not exists idx_link_accesso_richiesta_id on public.link_accesso (richiesta_id);
create index if not exists idx_link_accesso_societa_id on public.link_accesso (societa_id);
create index if not exists idx_link_accesso_usato_da on public.link_accesso (usato_da);
create index if not exists idx_match_libero_regola_libero_id on public.match_libero_regola (libero_id);
create index if not exists idx_match_libero_regola_titolare_1 on public.match_libero_regola (titolare_1);
create index if not exists idx_match_libero_regola_titolare_2 on public.match_libero_regola (titolare_2);
create index if not exists idx_match_set_lineups_sostituisce_id on public.match_set_lineups (sostituisce_id);
create index if not exists idx_notifiche_eventi_coda_match_id on public.notifiche_eventi_coda (match_id);
create index if not exists idx_obiettivi_catalogo_creato_da_team on public.obiettivi_catalogo (creato_da_team);
create index if not exists idx_presidente_visione_analisi_concessa_da on public.presidente_visione_analisi (concessa_da);
create index if not exists idx_presidente_visione_analisi_user_id on public.presidente_visione_analisi (user_id);
create index if not exists idx_push_subscriptions_user_id on public.push_subscriptions (user_id);
create index if not exists idx_richieste_reset_accesso_atleta_id on public.richieste_reset_accesso (atleta_id);
create index if not exists idx_richieste_reset_accesso_gestita_da on public.richieste_reset_accesso (gestita_da);
create index if not exists idx_richieste_reset_accesso_user_id on public.richieste_reset_accesso (user_id);
create index if not exists idx_scout_ospiti_partita_invitato_da on public.scout_ospiti_partita (invitato_da);
create index if not exists idx_societa_creato_da on public.societa (creato_da);
create index if not exists idx_societa_presidenti_nominato_da on public.societa_presidenti (nominato_da);
create index if not exists idx_societa_presidenti_societa_id on public.societa_presidenti (societa_id);
create index if not exists idx_societa_presidenti_inviti_creato_da on public.societa_presidenti_inviti (creato_da);
create index if not exists idx_societa_presidenti_inviti_societa_id on public.societa_presidenti_inviti (societa_id);
create index if not exists idx_societa_presidenti_link_creato_da on public.societa_presidenti_link (creato_da);
create index if not exists idx_societa_presidenti_link_usato_da on public.societa_presidenti_link (usato_da);
create index if not exists idx_team_invite_links_creato_da on public.team_invite_links (creato_da);
create index if not exists idx_team_invite_links_usato_da on public.team_invite_links (usato_da);
create index if not exists idx_team_stagioni_attivazioni_attivata_da on public.team_stagioni_attivazioni (attivata_da);
create index if not exists idx_team_stagioni_attivazioni_season_id on public.team_stagioni_attivazioni (season_id);
create index if not exists idx_teams_societa_id on public.teams (societa_id);
