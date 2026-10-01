import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";

// Tre toni brevi generati localmente (nessun asset esterno, nessuna
// richiesta di rete): un "tick" leggero per il promemoria periodico, un
// beep quando mancano 30 secondi alla fine dell'esercizio, un motivo più
// lungo e distinguibile a orecchio quando l'esercizio finisce.
const SUONO_PERIODICA = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAAB/f4CBgoF/fHl3d3l+g4iLi4eAeHFtbXN8h5CVlY6DdWljY2t5iZefn5aGdGNZWWJ0ip2pqp+Lc15QTllviaKytaiRdVtLSFRqhqCxtaqUeF5MSFJng52wtayXfGFOSFBkf5qutq6af2RQSE5hfJestbCdg2dSSExeeJSqtbGghmpUSEtbdZGotbOjim5WSUpZco6mtLSljXFYSklWboqks7SokHRbS0hUa4ehsrWqlHhdTEhSaISesLWsl3tgTUhQZYCbr7Wumn9jT0hOYn2YrbWwnYJmUUhNX3mVq7WxoIVpU0hLXHaSqbWyooltVUlKWXOPp7SzpYxwWElJV2+LpLO0p49zWkpIVWyIorK1qZN3XUxIU2mFn7G1q5Z6YE1IUWaBnK+1rZl+Y09IT2N+ma21r5yBZlFITWB6lqu1sZ+FaVNITF13k6m1sqKIbFVISlpzj6e0s6SLb1dJSVhwjKWztKePc1lKSVVtiaKytamSdlxLSFNphaCxtauVeV9NSFFmgp2wta2YfWJOSE9jfpquta+bgGVQSE1ge5estbCehGhSSExdeJSqtbKhh2tUSEtbdJCotLOkim5WSUpYcY2ltLSmjnJZSklWboqjs7WokXVbS0hUaoagsbWqlHheTEhSZ4OdsLWsl3xhTkhQZH+arraumn9kUEhOYXyXrLWwnYNnUkhMXniUqrWxoIZqVEhLW3WRqLWzo4puVklKWXKOprS0pY1xWEpJVm6KpLO0qJB0W0tIVGuHobK1qpR4XUxIUmiEnrC1rJd7YE1IUGWAm6+1rpp/Y09ITmJ9mK21sJ2CZlFITV95lau1saCFaVNIS1x2kqm1sqKJbVVJSllzj6e0s6WMcFhJSVdvi6SztKePc1pKSFVsiKKytamTd11MSFNphZ+xtauWemBNSFFmgZyvta2ZfmNPSE9jfpmtta+cgWZRSE1gepartbGfhWlTSExdd5OptbKiiGxVSEtbdI6kr62finJeU1Rgc4mbpKSaiXdnXl5mdISSmpqUiHpvaGhtdoGKkJCMhX12cnJ1en+EhoaEgX58e3x9fg==";
const SUONO_AVVISO_30S = "data:audio/wav;base64,UklGRtQEAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YbAEAAB/gIGCgX15d3h+hoyMhntwbHB8i5aWjHppYWd5j5+hk3piVl10kqism3xdTFNuk7C3pH9YQkdnk7jDroNVODxfkr3Lt4lWNjhajbrMuo1aODZWibfLvZJeOjVShLPLwJdjPDROf7DKwptnPjNLeqzJxKBsQTNHdajIxqRxRDNEcaTGyKh1RzNBbKDEyax6SzM+Z5vCyrB/TjQ8Y5fAy7OEUjU6XpK9y7eJVjY4Wo26zLqNWjg2Vom3y72SXjo1UoSzy8CXYzw0Tn+wysKbZz4zS3qsycSgbEEzR3WoyMakcUQzRHGkxsiodUczQWygxMmsekszPmebwsqwf040PGOXwMuzhFI1Ol6Svcu3iVY2OFqNusy6jVo4NlaJt8u9kl46NVKEs8vAl2M8NE5/sMrCm2c+M0t6rMnEoGxBM0d1qMjGpHFEM0RxpMbIqHVHM0FsoMTJrHpLMz5nm8LKsH9ONDxjl8DLs4RSNTpekr3Lt4lWNjhajbrMuo1aODZWibfLvZJeOjVShLPLwJdjPDROf7DKwptnPjNLeqzJxKBsQTNHdajIxqRxRDNEcaTGyKh1RzNBbKDEyax6SzM+Z5vCyrB/TjQ8Y5fAy7OEUjU6XpK9y7eJVjY4Wo26zLqNWjg2Vom3y72SXjo1UoSzy8CXYzw0Tn+wysKbZz4zS3qsycSgbEEzR3WoyMakcUQzRHGkxsiodUczQWygxMmsekszPmebwsqwf040PGOXwMuzhFI1Ol6Svcu3iVY2OFqNusy6jVo4NlaJt8u9kl46NVKEs8vAl2M8NE5/sMrCm2c+M0t6rMnEoGxBM0d1qMjGpHFEM0RxpMbIqHVHM0FsoMTJrHpLMz5nm8LKsH9ONDxjl8DLs4RSNTpekr3Lt4lWNjhajbrMuo1aODZWibfLvZJeOjVShLPLwJdjPDROf7DKwptnPjNLeqzJxKBsQTNHdajIxqRxRDNEcaTGyKh1RzNBbKDEyax6SzM+Z5vCyrB/TjQ8Y5fAy7OEUjU6XpK9y7eJVjY4Wo26zLqNWjg2Vom3y72SXjo1UoSzy8CXYzw0Tn+wysKbZz4zS3qsycSgbEEzR3WoyMakcUQzRHGkxsiodUczQWyfwsape1A7RmuXt7ymf1pHTmuQq7KhgmNSVmyKoaichGtdX2+Fl52VhHJoaHOCjpKOg3hycniAhoeFgX18fX4=";
const SUONO_FINE = "data:audio/wav;base64,UklGRqQMAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YYAMAAB/gIGDhIJ/e3Zzc3d+ho6SkoyBdWpkZW17i5qioZaFcV9VVmJ2j6SwsKOLb1VGRlVwkK2/wLCTbk04NkZnj7TM0L6bcUoxLT5gi7LM0cGgdk4zLDtchq7J0sSle1M2LDhXgKnH0sepgFc4LDZTe6XE0smuhlw7LDNOdqDB0cyyi2A+LTFKcZu+0M22kGVCLjBGbJa7z8+6lWpFLy5DZ5G3ztC9mm9JMS0/YoyzzNHAn3VNMy08XYevytLEo3pRNSw5WIKqyNLGqH9WOCw2VHymxdLJrYRbOiw0T3ehwtHLsYlfPi0yS3Kcv9HNtY9kQS4wR22Xu9DPuZRpRC8vQ2iSuM7QvJluSDEuQGONtM3RwJ5zTDItPV6IsMvSw6J4UDUsOlmDq8jSxqd+VTcsN1V+p8bSyKuDWTosNVB4osPSy7CIXj0tMkxznsDRzbSNY0AuMUhumbzQzriSaEMvL0RplLnP0LuXbUcwLkFkj7XN0b+ccksyLT5fibHL0cKhd080LDpbhK3J0sWmfFQ2LDhWf6jG0siqglg5LDVReqPE0sqvh108LTNNdZ/A0cyzjGI/LTFJb5q90M63kWdDLi9FapW6z8+7lmxGMC5CZZC2zdC+m3FKMS0+YIuyzNHBoHZOMyw7XIauydLEpXtTNiw4V4Cpx9LHqYBXOCw2U3ulxNLJroZcOywzTnagwdHMsotgPi0xSnGbvtDNtpBlQi4wRmyWu8/PupVqRS8uQ2eRt87QvZpvSTEtP2KMs8zRwJ91TTMtPF2Hr8rSxKN6UTUsOViCqsjSxqh/VjgsNlR8psXSya2EWzosNE93ocLRy7GJXz4tMktynL/RzbWPZEEuMEdtl7vQz7mUaUQvL0NokrjO0LyZbkgxLkBjjbTN0cCec0wyLT1eiLDL0sOieFA1LDpZg6vI0sanflU3LDdVfqfG0sirg1k6LDVQeKLD0suwiF49LTJMc57A0c20jWNALjFIbpm80M64kmhDLy9EaZS5z9C7l21HMC5BZI+1zdG/nHJLMi0+X4mxy9HCoXdPNCw6W4StydLFpnxUNiw4Vn+oxtLIqoJYOSw1UXqjxNLKr4ddPC0zTXWfwNHMs4xiPy0xSW+avdDOt5FnQy4vRWqVus/Pu5ZsRjAuQmWQts3QvptxSjEtPmCLsszRwaB2TjMsO1yGrsnSxKV7UzYsOFeAqcfSx6mAVzgsNlN7pcTSya6GXDssM052oMHRzLKLYD4tMUpxm77QzbaQZUIuMEZslrvPz7qVakUvLkNnkbfO0L2ab0kxLT9ijLPM0cCfdU0zLTxdh6/K0sSjelE1LDlYgqrI0saof1Y4LDZUfKbF0smthFs6LDRPd6HC0cuxiV8+LTJLcpy/0c21j2RBLjBHbZe70M+5lGlELy9DaJK4zc25l3BNOThJZ4uqvb+xlnZaSUZSaYWdrbCmk3tmWVZdbYGSnqGbjn9wZ2Vqc3+JkJGOh4B5dXV3e36BgoKAf39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/gIKCf3p3eH6HjYuBdGxvfI2YlINuYWV5kqOfiGpWWnSWraqNZkxPbpm2tZRlQ0Nmmr/BnGQ6N16ZyM2lZTMrVJfN1axpMyhPksrXsW82J0uMxte2dTkmRofD2Lp6PSZCgb/YvoBBJj57u9jChUUmOna32MaLSSc3cLLXyZBOKDRrrtbMllMpMWWp1M+cWCsuX6PS0aFdLSxbn9DTpmIvKlaZztWrZzIpUZTL1q9tNSdMjsjXtHI4JkiJxNi5eTwmQ4PA2L1+QCY/fbzYwYREJjt3uNjFiUgnOHKz18iPTSc0bK/Wy5VSKTFnqtXOmlYqL2Gl09CfXCwtXKDR0qRhLytXm87UqWYxKVKVy9aubDQoTZDI17NxNydJisXYt3c7JkWFwdi8fD4mQH++2MCCQiY9ebnYw4dHJjl0tdfHjUsnNm6x1sqSUCgzaazVzZhVKjBjp9PPnVosLV6i0dKiXy4rWZ3P1KhkMClUl83VrGkzKE+SytexbzYnS4zG17Z1OSZGh8PYuno9JkKBv9i+gEEmPnu72MKFRSY6drfYxotJJzdwstfJkE4oNGuu1syWUykxZanUz5tYKy5gpNLRoV0tLFuf0NOmYi8qVpnO1atnMilRlMvWr201J0yOyNe0cjgmSInE2Lh4PCZDg8HYvX4/Jj9+vdjBg0MmPHi42MSJSCY4crTXyI5MJzVtr9bLlFEpMmer1c6ZViovYqbT0J9bLC1dodHSpGAuK1ibz9SpZTEpU5bM1q5rNChOkMnXsnA3J0mLxti3djomRYXC2Lt7PiZBgL7Yv4FCJj16utjDh0YmOXW218aMSyc2b7HXypJPKDNprNXNl1QpMGSo1M+dWSsuX6LS0aJeLSxanc/Tp2MwKlWYzdWsaTMoUJLK1rFuNidLjcfXtXQ5JkeHw9i5eT0mQoLA2L5/QCY+fLzYwYVFJjt3t9jFikknN3Gz18iQTSg0bK7Wy5VSKTFmqdTOm1crL2Gk0tGgXC0sXJ/Q06VhLypWms7VqmcxKVKVy9avbDQnTY/I17NyOCdIicXYuHc7JkSEwdi8fT8mQH692MCDQyY8ebnYxIhHJjhztdfHjkwnNW6w1sqTUCgyaKvVzZlVKi9jptPQnlosLV2h0dKjXy4rWJzP1KhlMClTl8zVrWozKE+RydeycDYnSozG2LZ1OiZGhsLYu3s9JkGAv9i/gEEmPXu72MKGRiY6dbbYxoxKJzZwstfJkU8oM2qt1cyXUykwZajUz5xYKy5fo9LRoV0tLFqe0NOmYy8qVZnN1atoMihQk8rWsG41J0yOx9e1czgmR4jE2Ll5PCZDg8DYvX5AJj99vNjBhEQmO3e42MWJSCc4crPXyI9NJzRsr9bLlVIpMWeq1c6aViovYaXT0J9cLC1coNHSpGEvK1ebztSpZjEpUpXL1q5sNChNkMjXs3E3J0mKxdi3dzsmRYXB2Lx8PiZAf77YwIJCJj15udjDh0cmOXS118eNSyc2brHWypJQKDNprNXNmFUqMGOn08+dWiwtXqLR0qJfLitZnc/UqGQwKVSXzdWsaTMoT5LK17FvNidLjMbXtnU5JkaHw9i6ej0mQoG91LqARzBGfLLJtYRSO0t4p72vh1xGUnadsqmJZVJZdZWmoYltXWJ2jZuYh3Rpa3iHkI6FenN1e4KFhIF+fg==";

export type MomentoAvviso = "periodica" | "avviso30" | "fine";

// Tiene la notifica di fine-esercizio ancora aperta, così può essere
// chiusa esplicitamente quando parte un nuovo esercizio invece di
// sparire da sola dopo pochi secondi come le altre.
let notificaFineAttiva: { close: () => void } | null = null;
// Se le notifiche passano dal service worker (vedi registraServiceWorker),
// la chiusura richiede la registrazione invece dell'oggetto Notification.
let notificaFineReg: ServiceWorkerRegistration | null = null;

const BASE_URL_WEB = "/AIVolleyballCoach";

/**
 * Elementi audio creati UNA SOLA VOLTA e riusati, invece di un
 * `new Audio()` a ogni avviso: su iPhone Safari blocca la riproduzione
 * di un elemento mai "sbloccato" da un vero tocco dell'utente, e lo
 * sblocco (vedi sbloccaAudioNotifiche) vale solo per QUELL'elemento —
 * crearne uno nuovo a ogni avviso vanificava lo sblocco ed era la causa
 * più probabile del "non sento nessun suono" su iPhone.
 */
type ElementiAudio = Record<MomentoAvviso, HTMLAudioElement>;
let elementiAudio: ElementiAudio | null = null;

function creaElementiAudio(): ElementiAudio | null {
  if (elementiAudio) return elementiAudio;
  if (typeof window === "undefined" || !("Audio" in window)) return null;
  try {
    elementiAudio = {
      periodica: new window.Audio(SUONO_PERIODICA),
      avviso30: new window.Audio(SUONO_AVVISO_30S),
      fine: new window.Audio(SUONO_FINE),
    };
    return elementiAudio;
  } catch {
    return null;
  }
}

/**
 * Da chiamare dentro un vero tocco dell'utente (es. il primo pulsante
 * premuto nella schermata di sessione): Safari su iPhone impedisce a un
 * suono avviato da un timer di partire se non è mai stato "sbloccato" da
 * un gesto reale. Lo sblocco (riproduzione mutata e subito fermata) vale
 * per tutta la sessione della pagina, quindi basta farlo una volta sola
 * al primo tocco perché i suoni durante il conto alla rovescia
 * funzionino da lì in avanti.
 */
export function sbloccaAudioNotifiche(): void {
  if (Platform.OS !== "web") return;
  const el = creaElementiAudio();
  if (!el) return;
  for (const audio of Object.values(el)) {
    try {
      const volumeOriginale = audio.volume;
      audio.volume = 0;
      const promessa = audio.play();
      if (promessa && typeof promessa.then === "function") {
        promessa
          .then(() => { audio.pause(); audio.currentTime = 0; audio.volume = volumeOriginale; })
          .catch(() => { audio.volume = volumeOriginale; });
      } else {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = volumeOriginale;
      }
    } catch {
      // Se anche lo sblocco fallisce, suona() proverà comunque: non deve
      // mai interrompere l'allenamento.
    }
  }
}

/**
 * Registra il service worker usato SOLO per mostrare notifiche via
 * registration.showNotification(): su iPhone, per un sito aggiunto alla
 * schermata Home, è il modo che Apple considera "vero" per le notifiche
 * (a differenza della chiamata diretta a `new Notification()`, meno
 * affidabile lì) — è anche il presupposto perché iOS le prenda in
 * considerazione per lo specchio sull'Apple Watch. Va richiamata prima
 * del primo avviso; le chiamate successive sono no-op economici.
 */
let swPronto: Promise<ServiceWorkerRegistration | null> | null = null;
export function registraServiceWorker(): void {
  try {
    if (Platform.OS !== "web") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (swPronto) return;
    swPronto = navigator.serviceWorker
      .register(`${BASE_URL_WEB}/sw.js`)
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  } catch {
    // Senza service worker le notifiche restano comunque possibili con
    // l'API diretta (ripiego in notifica()), solo meno affidabili su iPhone.
  }
}

/**
 * Vibrazione + suono + notifica di sistema per chi allena in piedi, spesso
 * senza guardare lo schermo: un promemoria periodico (facoltativo), un
 * avviso quando mancano 30 secondi alla fine dell'esercizio e uno quando
 * l'esercizio finisce, diversi tra loro per riconoscerli senza guardare il
 * telefono. Non deve MAI interrompere l'allenamento: ogni mancanza di
 * supporto (piattaforma, permessi, audio bloccato dal browser) viene
 * ignorata in silenzio, il conto alla rovescia a schermo resta comunque
 * affidabile anche senza suono, vibrazione o notifica.
 */
export function avvisaTempo(momento: MomentoAvviso, nomeEsercizio: string, corpo: string): void {
  vibra(momento);
  suona(momento);
  notifica(momento, nomeEsercizio, corpo);
}

/**
 * Da chiamare quando parte un nuovo esercizio: chiude la notifica di fine
 * dell'esercizio precedente, se era rimasta aperta in attesa che si
 * iniziasse qualcos'altro.
 */
export function chiudiNotificaFine(): void {
  try { notificaFineAttiva?.close(); } catch { /* ignorato */ }
  notificaFineAttiva = null;
  if (notificaFineReg) {
    const reg = notificaFineReg;
    notificaFineReg = null;
    reg.getNotifications({ tag: "avviso-esercizio-fine" }).then((ns) => ns.forEach((n) => n.close())).catch(() => {});
  }
}

/** Da chiamare all'apertura della schermata di sessione, prima che serva il primo avviso: chiede il permesso di mostrare notifiche e registra il service worker che le mostra (solo web; su nativo richiederebbe expo-notifications). */
export function richiediPermessoNotifiche(): void {
  try {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
  } catch {
    // Notifiche non disponibili su questo browser: si ignora.
  }
  registraServiceWorker();
}

function vibra(momento: MomentoAvviso): void {
  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(momento === "fine" ? [120, 80, 120, 80, 220] : momento === "avviso30" ? 90 : 40);
      }
      return;
    }
    // Nativo (iOS/Android): richiede il pacchetto expo-haptics
    // (`npx expo install expo-haptics`).
    Haptics.notificationAsync(
      momento === "fine"
        ? Haptics.NotificationFeedbackType.Success
        : momento === "avviso30"
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
    );
  } catch {
    // Nessun supporto aptico su questa piattaforma: si ignora.
  }
}

async function suona(momento: MomentoAvviso): Promise<void> {
  const sorgente = momento === "fine" ? SUONO_FINE : momento === "avviso30" ? SUONO_AVVISO_30S : SUONO_PERIODICA;
  try {
    if (Platform.OS === "web") {
      // Riusa l'elemento creato (ed eventualmente sbloccato) una sola
      // volta, invece di un `new Audio()` a ogni avviso — vedi il
      // commento su creaElementiAudio più sopra.
      const el = creaElementiAudio();
      const audio = el?.[momento];
      if (audio) {
        try { audio.currentTime = 0; } catch { /* alcuni browser rifiutano il reset prima del primo play: non blocca */ }
        audio.play().catch(() => {});
      }
      return;
    }
    // Nativo (iOS/Android): richiede il pacchetto expo-av
    // (`npx expo install expo-av`).
    const { sound } = await Audio.Sound.createAsync({ uri: sorgente });
    sound.setOnPlaybackStatusUpdate((stato) => {
      if (stato.isLoaded && stato.didJustFinish) sound.unloadAsync();
    });
    await sound.playAsync();
  } catch {
    // Nessun supporto audio su questa piattaforma: si ignora.
  }
}

async function notifica(momento: MomentoAvviso, nomeEsercizio: string, corpo: string): Promise<void> {
  try {
    // Le notifiche di sistema vere (quelle che iPhone/Android possono
    // rispecchiare sul watch abbinato) esistono solo sul web in questo
    // progetto: su iPhone funzionano solo se il sito è stato aggiunto
    // alla schermata Home (limite di Safari, non nostro). Su nativo
    // richiederebbero expo-notifications, non incluso qui.
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const tag = `avviso-esercizio-${momento}`;
    // silent: true perché vibrazione e suono li gestiamo già noi sopra,
    // con pattern diversi per ogni momento.
    const opzioni: NotificationOptions = { body: corpo, silent: true, tag };

    // Passare dal service worker (quando registrato) è il modo che
    // Safari su iPhone considera "vero" per una PWA installata sulla
    // Home — la chiamata diretta a `new Notification()` qui sotto resta
    // come ripiego per i browser dove il service worker non è pronto.
    const reg = swPronto ? await swPronto : null;
    if (reg) {
      await reg.showNotification(nomeEsercizio, opzioni);
      if (momento === "fine") {
        notificaFineReg = reg;
      } else {
        setTimeout(() => {
          reg.getNotifications({ tag }).then((ns) => ns.forEach((n) => n.close())).catch(() => {});
        }, 4000);
      }
      return;
    }

    const n = new Notification(nomeEsercizio, opzioni);
    if (momento === "fine") {
      // Resta visibile finché non parte un nuovo esercizio.
      notificaFineAttiva = n;
    } else {
      // Le notifiche "in mezzo" (periodica, 30 secondi) si autodistruggono
      // dopo pochi secondi per non affollare il centro notifiche.
      setTimeout(() => { try { n.close(); } catch { /* ignorato */ } }, 4000);
    }
  } catch {
    // Notifiche non disponibili: si ignora, vibrazione e suono restano comunque attivi.
  }
}
