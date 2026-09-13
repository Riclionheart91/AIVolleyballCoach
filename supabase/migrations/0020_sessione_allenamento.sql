-- 0020 — Sessione di allenamento dal vivo (avvio/chiusura esercizi, tempi reali)
alter table trainings add column if not exists iniziato_il timestamptz;
alter table trainings add column if not exists concluso_il timestamptz;
alter table training_exercises add column if not exists iniziato_il timestamptz;
alter table training_exercises add column if not exists concluso_il timestamptz;
alter table training_exercises add column if not exists durata_effettiva_secondi integer;
-- Le funzioni avvia_sessione_allenamento, avvia_esercizio,
-- concludi_esercizio e concludi_sessione_allenamento sono applicate
-- nella migrazione omonima sul progetto (vedi cronologia Supabase).
