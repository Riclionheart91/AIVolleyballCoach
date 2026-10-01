// Service worker minimo, usato SOLO per mostrare le notifiche
// dell'avviso esercizio via registration.showNotification(): su iPhone,
// per il sito aggiunto alla schermata Home, questo è il modo che Safari
// considera "vero" per una notifica — la chiamata diretta a
// `new Notification()` dalla pagina è meno affidabile lì e non sempre
// viene presa in considerazione per lo specchio sull'Apple Watch.
// Nessuna cache, nessun offline: solo il minimo per attivarsi subito.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Notifica push reale (server -> browser), usata per i promemoria dei
// certificati in scadenza (vedi supabase/functions/notifica-certificati):
// a differenza delle notifiche dell'avviso esercizio, questa arriva
// anche ad app completamente chiusa, perché è il sistema operativo a
// risvegliare il service worker quando arriva il push, non la pagina.
self.addEventListener("push", (event) => {
  let dati = {};
  try {
    dati = event.data ? event.data.json() : {};
  } catch {
    dati = { title: "AI Volleyball Coach", body: event.data ? event.data.text() : "" };
  }
  const titolo = dati.title || "AI Volleyball Coach";
  event.waitUntil(
    self.registration.showNotification(titolo, {
      body: dati.body || "",
      icon: "/AIVolleyballCoach/icon.png",
      badge: "/AIVolleyballCoach/icon.png",
      data: { url: dati.url || "/AIVolleyballCoach/" },
    }),
  );
});

// Tocco su una notifica: porta in primo piano la scheda dell'app già
// aperta invece di aprirne una nuova, se possibile, e prova a
// navigarla verso il link indicato dalla notifica (event.notification.data.url,
// presente solo per le notifiche push server->browser, non per quelle
// dell'avviso esercizio).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/AIVolleyballCoach/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((elenco) => {
      for (const client of elenco) {
        if ("focus" in client) {
          if ("navigate" in client) {
            try {
              client.navigate(url);
            } catch {
              // Alcuni browser non permettono la navigazione programmatica di
              // una scheda esistente: va comunque bene, la mettiamo solo a fuoco.
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
