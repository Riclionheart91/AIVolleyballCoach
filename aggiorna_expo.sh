#!/usr/bin/env bash
# Aggiornamento Expo SDK, UNA major alla volta.
#
# Perché non tutto in un colpo: Expo raccomanda l'upgrade incrementale,
# perché ogni SDK fissa le versioni compatibili di tutti i pacchetti
# expo-* e react-native. Saltando versioni, se qualcosa si rompe non si
# capisce quale passaggio l'ha rotto.
#
# Uso:  bash aggiorna_expo.sh 55     (poi 56, poi 57)
#
# Dopo OGNI passaggio lo script verifica che la compilazione web
# funzioni ancora: è la stessa cosa che fa GitHub Actions, quindi se
# passa qui passerà anche in pubblicazione.

set -e

# Controllo preliminare: è un errore facile lanciare lo script nella
# cartella estratta dallo zip invece che nel repository. Senza .git il
# punto di ripristino non può essere creato, e senza quello un upgrade
# andato male non è annullabile — quindi ci si ferma subito.
if [ ! -d ".git" ]; then
  echo "ERRORE: questa cartella non è un repository git."
  echo ""
  echo "Probabilmente stai eseguendo lo script nella cartella estratta dallo zip."
  echo "Va lanciato nel repository vero, dove risiede il progetto:"
  echo ""
  echo "  cd /Users/riccardolilliu/Documents/97.webapp/AIVolleyballCoach"
  echo "  bash aggiorna_expo.sh $1"
  echo ""
  echo "Ricordati anche di aver già pubblicato l'ultimo pacchetto lì dentro con:"
  echo "  bash pubblica_aggiornamento.sh ."
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "ERRORE: package.json non trovato: non sembra la cartella del progetto."
  exit 1
fi

VERSIONE="$1"
if [ -z "$VERSIONE" ]; then
  echo "Uso: bash aggiorna_expo.sh <numero-sdk>   (es. 55)"
  echo "Il progetto è su SDK 54: procedi con 55, poi 56, poi 57."
  exit 1
fi

echo "==> Punto di ripristino su git (se qualcosa va storto: git reset --hard PRIMA-SDK-$VERSIONE)"
git add -A && git commit -m "punto di ripristino prima di SDK $VERSIONE" || true
git tag -f "PRIMA-SDK-$VERSIONE"

echo "==> Aggiornamento a Expo SDK $VERSIONE"
npm install "expo@^${VERSIONE}.0.0"

echo "==> Allineamento di tutti i pacchetti alle versioni compatibili con l'SDK"
npx expo install --fix

echo "==> Controllo diagnostico"
npx expo-doctor || echo "(expo-doctor ha segnalato qualcosa: leggi sopra prima di proseguire)"

echo "==> Prova di compilazione web (la stessa che gira su GitHub Actions)"
npx expo export -p web

echo ""
echo "============================================"
echo "SDK $VERSIONE: compilazione riuscita."
echo "Prova l'app in locale con:  npx expo start --web"
echo "Se tutto funziona:          git add -A && git commit -m 'Expo SDK $VERSIONE' && git push"
echo "Se qualcosa si è rotto:     git reset --hard PRIMA-SDK-$VERSIONE"
echo "============================================"
