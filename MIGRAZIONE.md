# Stato migrazione — AI Volleyball Coach

## Fatto in questo pacchetto

| Fase | Contenuto | Stato |
|---|---|---|
| F0 | Scaffold Expo/Metro/Supabase/GitHub (da template BandFit) | ✅ |
| F1 | Atlete, esercizi, allenamenti, presenze, RPE, valutazioni manuali | ✅ (screen: Atlete, Allenamenti, Valutazioni) |
| F1 (addendum) | Inviti multi-coach: un allenatore invita un'email, chi riceve l'invito entra automaticamente nel team al primo login | ✅ (`0001b_inviti_team.sql`, sezione "Invita allenatore/vice-allenatore" nella tab Atlete) |
| F2 | Stagioni, attivazione, baseline | ✅ (screen: Stagioni) |
| F5 | Layer AI manual-first: proposte di valutazione, Provider Router (Gemini→Groq→OpenRouter), rate limit, badge di stato | ✅ (integrato nello screen Valutazioni, nessuno screen separato — per design, vedi patch V7.1) |

**Non incluso ora, come da priorità concordate:** F3 (scouting live), F4 (match analysis), F6 (infortuni, piani individuali, integrazioni esterne), F7 (QA, migrazione dati storici, CI/CD schema). Restano nella roadmap originale, da riprendere quando deciderai di procedere.

## Mappa moduli GAS → Supabase/Expo

| Modulo GAS (V7.1) | Dove va a finire |
|---|---|
| `Auth.gs`, foglio `Utenti` | `team_members` + Supabase Auth (`src/context/AuthContext.tsx`) |
| `Storage.gs` (lock/cache su Sheets) | Non serve più: Postgres gestisce concorrenza e transazioni nativamente |
| Foglio `Atlete` | tabella `athletes` |
| Foglio `Esercizi` | tabella `exercises` |
| `Trainings.gs` + foglio `Allenamenti` | tabella `trainings` + `training_exercises` |
| Foglio `Presenze` | tabella `attendance` |
| `RPE.gs` + foglio `RPE` | tabella `rpe` |
| `Evaluations.gs` + foglio `Valutazioni` | tabella `evaluations` (colonna `origine` sostituisce la distinzione implicita manuale/AI) |
| `EvaluationsAI.gs` + foglio `PropostaValutazioni` | tabella `evaluation_proposals` + RPC `decidi_proposta_valutazione`/`rigetta_proposta_valutazione` |
| `Seasons.gs` (incl. `attivaStagione`, `generaBaselineStagione`) | tabella `seasons` + `season_baselines`, stessa logica come funzioni RPC Postgres |
| `AI.gs` + `RateLimiter.gs` + foglio `AiProviders` | Edge Function `ai-router` + tabelle `ai_providers_config`/`ai_call_log` |
| `Config.gs` (chiavi AI) | Secret dell'Edge Function (`supabase secrets set`), mai in una tabella |
| `ReleaseManager.gs` / `Steps.gs` / `upgrade()` | `supabase/migrations/*.sql` + `supabase db push` (versionamento nativo di Supabase) |
| `Scouting.gs`, `ScoutingAtleta.gs`, `ScoutingAdvanced.gs` | **F3, non ancora migrati** — motivo: richiedono il nuovo modello unificato `match_events` discusso nel piano di migrazione, non una tabella-per-modulo |
| `MatchAnalysis.gs` | **F4, non ancora migrato** (dipende da `match_events`) |
| `Convocations.gs`, `IndividualPlans.gs`, `Periodization.gs`, `Injuries.gs` | **F6, non ancora migrati** |
| `GoogleAutomations.gs`, `SportEasySync.gs` | **F6, non ancora migrati** (da accorpare in un unico modulo "Integrazioni") |
| `Setup.gs`, `install.gs` | `app/crea-squadra.tsx` + RPC `crea_team_e_diventa_allenatore` |
| `ImportWizard.gs` | Da rifare in F6/F7 come importer verso le nuove tabelle |

## Decisioni prese (28/08/2026)

- **Storico valutazioni**: non importato. Si parte da valutazioni nuove da qui in avanti; le baseline di stagione si genereranno quindi solo a partire dalle prime valutazioni inserite nella nuova app, non da dati storici GAS.
- **Multi-coach**: sì — implementato il sistema di inviti (`0001b_inviti_team.sql`). Un allenatore invita un'email dalla tab Atlete → chi riceve l'invito entra automaticamente nel team al primo login con quell'account Google, senza altre azioni manuali.
- **Esercizi**: sì, da importare da un catalogo esistente. **In attesa del file**: carica in chat l'export CSV/Excel del foglio "Esercizi" del vecchio spreadsheet (Google Sheets → File → Scarica → Valori separati da virgola) e verrà generato uno script SQL di seed con `insert into exercises (...)` pronto da incollare dopo `setup_supabase.sql`, senza reinserimento manuale nell'app.



Questo pacchetto è codice pronto, ma nessun comando è stato lanciato contro servizi reali — serve fare, nell'ordine (dettagli in `README.md`):
1. Creare il progetto Supabase e lanciare `supabase db push`.
2. Configurare Google OAuth (Cloud Console + Supabase).
3. Deployare `ai-router` e impostare i secret delle chiavi AI.
4. `npm install` e test in locale.
5. Push su GitHub + primo deploy su Pages.

## Prossimi passi consigliati (quando deciderai di procedere)

- **F3 — Scouting live**: nuova migrazione `0003_f3_scouting.sql` con la tabella `match_events` unica (vedi piano di migrazione originale) + schermata a tap, scrittura locale-first con coda di sync.
- **F4 — Match analysis**: query aggregate su `match_events`, nessuna tabella nuova.
- **F6 — Resto moduli + integrazioni**: `0004_f6_resto.sql`.
- **F7 — Migrazione dati storici**: script una tantum di export da Google Sheets (via API) + import nelle tabelle Supabase, da scrivere quando le squadre reali saranno pronte a passare.

Nessuna di queste fasi richiede di toccare F1/F2/F5: lo schema è additivo esattamente come il vecchio `RELEASE_STEPS_`.
