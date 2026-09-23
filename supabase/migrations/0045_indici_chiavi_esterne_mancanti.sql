-- 0045 — Indici sulle chiavi esterne prive di copertura
--
-- 37 chiavi esterne senza indice: ogni join o vincolo di cancellazione
-- a cascata su quelle colonne fa una scansione completa della tabella
-- collegata.

create index if not exists idx_campionati_team on campionati (team_id);
create index if not exists idx_evaluation_proposals_athlete on evaluation_proposals (athlete_id);
create index if not exists idx_evaluation_proposals_decisa_da on evaluation_proposals (decisa_da);
create index if not exists idx_evaluation_proposals_valutazione on evaluation_proposals (valutazione_id);
create index if not exists idx_evaluations_valutatore on evaluations (valutatore);
create index if not exists idx_globale_eventi_athlete on globale_eventi (athlete_id);
create index if not exists idx_globale_eventi_creato_da on globale_eventi (creato_da);
create index if not exists idx_globale_eventi_rotazione_a on globale_eventi (rotazione_a);
create index if not exists idx_globale_eventi_rotazione_b on globale_eventi (rotazione_b);
create index if not exists idx_globale_formazioni_athlete on globale_formazioni (athlete_id);
create index if not exists idx_globali_training on globali (training_id);
create index if not exists idx_match_convocati_athlete on match_convocati (athlete_id);
create index if not exists idx_match_events_creato_da on match_events (creato_da);
create index if not exists idx_match_events_rotazione_servizio on match_events (rotazione_al_servizio);
create index if not exists idx_match_events_set on match_events (set_id);
create index if not exists idx_match_set_lineups_athlete on match_set_lineups (athlete_id);
create index if not exists idx_matches_campionato on matches (campionato_id);
create index if not exists idx_matches_creato_da on matches (creato_da);
create index if not exists idx_obiettivi_atleta_creato_da on obiettivi_atleta (creato_da);
create index if not exists idx_piani_annuali_season on piani_annuali (season_id);
create index if not exists idx_piani_annuali_team on piani_annuali (team_id);
create index if not exists idx_piani_individuali_creato_da on piani_individuali (creato_da);
create index if not exists idx_piano_esercizi_exercise on piano_individuale_esercizi (exercise_id);
create index if not exists idx_piano_esercizi_piano on piano_individuale_esercizi (piano_id);
create index if not exists idx_svolgimenti_registrato_da on piano_individuale_svolgimenti (registrato_da);
create index if not exists idx_proposte_piano on proposte_aggiornamento_piano (piano_id);
create index if not exists idx_rimpiazzi_libero_libero on rimpiazzi_libero (libero_id);
create index if not exists idx_rimpiazzi_libero_titolare on rimpiazzi_libero (titolare_id);
create index if not exists idx_rpe_athlete on rpe (athlete_id);
create index if not exists idx_season_baselines_creata_da on season_baselines (creata_da);
create index if not exists idx_season_baselines_valutazione_rif on season_baselines (valutazione_id_riferimento);
create index if not exists idx_seasons_creata_da on seasons (creata_da);
create index if not exists idx_team_invites_atleta on team_invites (atleta_id);
create index if not exists idx_team_invites_creato_da on team_invites (creato_da);
create index if not exists idx_team_members_atleta on team_members (atleta_id);
create index if not exists idx_teams_creato_da on teams (creato_da);
create index if not exists idx_training_exercises_exercise on training_exercises (exercise_id);
