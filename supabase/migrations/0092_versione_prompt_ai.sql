-- 0092 — Versione del prompt nelle tracce delle chiamate AI.
-- Il router ora compone un prompt di sistema (parte comune, regole di gioco, istruzioni della funzione) e ne registra
-- la versione, per confrontare la qualita' delle risposte prima e dopo una modifica ai testi.
alter table ai_call_log add column if not exists prompt_versione text;
