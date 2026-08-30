# AI Volleyball Coach — Web App (PWA) con Supabase e Google Auth

Migrazione da Google Apps Script/Sheets a Expo + Supabase + GitHub, sul modello architetturale di BandFit. Copre le fasi **F1 (anagrafica base), F2 (stagioni) e F5 (layer AI manual-first)** — F3/F4/F6/F7 (scouting live, match analysis, integrazioni esterne, QA finale) seguiranno a fasi successive, vedi `MIGRAZIONE.md`.

---

## 0. Cosa contiene questo pacchetto

```
app/                              rotte Expo Router
  login.tsx                        Login Google
  crea-squadra.tsx                 Creazione prima squadra (equivalente di install())
  (tabs)/
    index.tsx                      Atlete (F1)
    allenamenti.tsx                 Allenamenti + presenze + RPE (F1)
    valutazioni.tsx                  Valutazioni manuali + AI assist unificate (F1+F5, flagship)
    stagioni.tsx                     Stagioni + baseline (F2)
    _layout.tsx                      Tab bar

src/
  config.ts                        Colori, stringhe, endpoint
  lib/supabase.ts                  Client Supabase condiviso (web+nativo)
  context/AuthContext.tsx          Sessione + team/ruolo corrente (sostituisce Auth.gs)
  services/                        Un file per dominio (athletes, exercises, trainings, seasons, evaluations)
  types/database.ts                Tipi TS che rispecchiano lo schema Postgres

supabase/
  migrations/                      Schema versionato (equivalente di RELEASE_STEPS_/upgrade())
    0001_f1_anagrafica.sql
    0002_f2_stagioni.sql
    0005_f5_ai_layer.sql           (0003/0004 lasciate libere per F3/F4, come i .5 nel vecchio manifest)
  functions/ai-router/             Edge Function: Provider Router AI (equivalente di AI.gs), chiavi solo server-side

MIGRAZIONE.md                      Stato fasi, mappa moduli GAS→Supabase, cosa manca
.github/workflows/deploy.yml       CI: push su main → build → GitHub Pages
```

---

## 1. Prerequisiti

| Tool | Verifica |
|---|---|
| Node.js 18+ | `node -v` |
| npm | `npm -v` |
| Git | `git -v` |
| Supabase CLI | `npm install -g supabase` |
| Account GitHub | — |
| Account Supabase | https://supabase.com |
| Account Google Cloud | https://console.cloud.google.com |

---

## 2. Repository Git + GitHub

```bash
cd AIVolleyballCoach
git init && git add . && git commit -m "chore: scaffold F1/F2/F5"
git branch -M main
gh repo create AIVolleyballCoach --public --source=. --remote=origin --push
```
Repo pubblico per usare GitHub Pages gratis su account personale (a meno di GitHub Pro/Team).

## 3. Installa le dipendenze

```bash
npm install
```

## 4. Crea il progetto Supabase e applica lo schema

1. https://supabase.com/dashboard → **New Project**.
2. **Project Settings → API**: copia **Project URL** e **anon public key**.
3. Applica lo schema con **una delle due strade equivalenti**:

   **A — Senza CLI (più veloce per iniziare):** apri **SQL Editor → New query**, incolla **tutto** il contenuto di `setup_supabase.sql` (nella root del pacchetto — concatenazione già in ordine di `supabase/migrations/0001…0005`) → **Run**. Idempotente: puoi rilanciarlo senza errori.

   **B — Con Supabase CLI (consigliata quando aggiungerete F3/F4/F6):**
   ```bash
   supabase login
   supabase link --project-ref TUO-PROJECT-REF
   supabase db push
   ```
   Applica le migrazioni in `supabase/migrations/` una a una e tiene traccia di quali sono già state eseguite — è l'equivalente diretto di `upgrade()`/`RELEASE_STEPS_`: quando aggiungerete `0003_f3_scouting.sql`, un solo `supabase db push` applicherà solo quella, senza ritoccare 0001/0002/0005.

4. **Rigenera i tipi TypeScript** (il file attuale in `src/types/database.ts` è un mirror scritto a mano, utile finché non hai un progetto collegato):
   ```bash
   supabase gen types typescript --linked > src/types/database.ts
   ```

## 5. Deploy delle Edge Function

```bash
supabase functions deploy ai-router
supabase functions deploy sync-sporteasy
supabase secrets set GEMINI_API_KEY=xxx GROQ_API_KEY=xxx OPENROUTER_API_KEY=xxx
```
`sync-sporteasy` non ha bisogno di secret propri (il link del calendario non è segreto, è configurabile dall'app nella tab Partite). Le chiavi AI non compaiono mai in nessuna tabella né nel bundle client — stessa garanzia di `leggiSegreto_()` in `Config.gs`, qui impossibile da violare per costruzione (il client non può leggere i secret della function).

## 6. Configura Google OAuth

Stessa procedura di BandFit (Google Cloud Console → schermata consenso → credenziali OAuth web → collegale in Supabase Authentication → Providers → Google). Origini autorizzate: `http://localhost:8081` + `https://TUO-USER.github.io`. Redirect URI: `https://TUO-PROJECT-REF.supabase.co/auth/v1/callback`.

A differenza della vecchia app, **qualsiasi account Google va bene**, non serve un dominio Google Workspace: era il vincolo (`access: DOMAIN`) che nella versione GAS causava il blocco di accesso già risolto nella patch V7.1, e qui semplicemente non esiste — Supabase Auth accetta qualunque account Google, l'appartenenza al team è governata dalla tabella `team_members`, non dal dominio email.

## 7. Variabili d'ambiente

```bash
cp .env.example .env
```
Compila con i valori reali di Supabase e il redirect URL scelto.

## 8. Test in locale

```bash
npx expo start --web
```
Checklist:
1. Login Google → se il tuo account non ha ancora un team, compare "Crea la tua prima squadra" → conferma → diventi allenatore.
2. Tab **Atlete**: aggiungine un paio.
3. Tab **Allenamenti**: crea un allenamento di oggi, apri la card, segna presenza (P/A) e RPE con un tap per atleta.
4. Tab **Valutazioni**: seleziona atleta+fondamentale, registra un punteggio manuale. Poi premi **✨ Suggerisci con AI**: il punteggio si pre-compila, modificalo se non sei d'accordo, premi "Registra valutazione" — verifica su Supabase (**Table Editor → evaluations**) che `origine` sia `ai_approvata` o `ai_modificata` di conseguenza.
5. Spegni temporaneamente le chiavi AI (`supabase secrets unset ...`) e ripeti il punto 4: il messaggio di errore deve comparire ma "Registra valutazione" manuale deve continuare a funzionare identico — è la garanzia "manual-first" richiesta.
6. Tab **Stagioni**: crea una stagione, attivala, genera la baseline.

## 9. Build e deploy (equivalente del "push" verso Apps Script)

```bash
npx expo export -p web
npx gh-pages -d dist -b gh-pages
gh api -X PUT repos/TUO-USER/AIVolleyballCoach/pages -f "source[branch]=gh-pages" -f "source[path]=/"
```
`app.json` ha già `experiments.baseUrl: "/AIVolleyballCoach"`: se rinomini il repo, aggiornalo.

## 10. Automazione (GitHub Actions)

Il workflow è già incluso in `.github/workflows/deploy.yml`: ad ogni push su `main`, builda ed esporta su GitHub Pages. Aggiungi i secrets `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_AUTH_REDIRECT_URL` in **Settings → Secrets and variables → Actions**.

Per lo schema DB, l'equivalente CI del vecchio `clasp push` è un secondo job che lancia `supabase db push` (richiede `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF` come secrets) — lasciato manuale per ora finché la squadra non ha familiarità col flusso a migrazioni; si aggiunge in un secondo momento senza toccare nient'altro.

## 11. Aggiornamento schema

Se avevi già eseguito una versione precedente di `setup_supabase.sql`, va rieseguito ad ogni avanzamento — l'ultima aggiunge **F3 (scouting live)**: tabelle `matches`/`match_sets`/`match_events`, punteggio automatico via trigger, tab Partite e schermata di scouting live. È idempotente — nessun dato esistente viene perso, solo lo schema viene esteso.

## 12. Risoluzione problemi comuni

| Problema | Causa | Soluzione |
|---|---|---|
| "Nessuna squadra associata" dopo il login | Prima volta per questo account | Normale: compare "Crea la tua prima squadra" |
| RLS error / righe non visibili | Utente non ancora in `team_members` per quel team | Verifica in Table Editor, o fatti invitare da un allenatore (join manuale finché non c'è uno screen di invito, F6) |
| "AI Disabled Mode" | Provider giù o quota giornaliera esaurita | Il percorso manuale in Valutazioni resta identico — è il comportamento previsto, non un bug |
| 404 sugli asset dopo il deploy | `baseUrl` in `app.json` diverso dal nome repo | Vedi punto 9 |
