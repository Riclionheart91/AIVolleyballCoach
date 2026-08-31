import { ScrollViewStyleReset } from "expo-router/html";

/**
 * Personalizza l'involucro HTML generato dall'export statico web di
 * Expo Router. Senza questo file, Expo usa un default che NON include
 * i meta tag "apple-mobile-web-app-*" — su iOS, senza questi, l'app
 * "salvata sulla home" si apre sì come icona a parte, ma DENTRO Safari
 * con le barre del browser visibili, mai davvero a schermo intero: è
 * la causa più probabile di "la salvo come app nativa ma non la vedo a
 * schermo intero". Aggiunge anche un reset di larghezza/overflow per
 * evitare lo scroll orizzontale involontario.
 */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no"
        />
        {/* Attiva la modalità "standalone" reale su iOS quando l'app è
            salvata sulla home — senza questi 3 meta tag, iOS la apre
            sempre dentro Safari con le barre visibili. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="AI Volleyball Coach" />
        {/* Equivalente per Android/Chrome (il manifest.json generato da
            app.json copre già "display": "standalone", questo è un
            rinforzo per browser che leggono anche il meta diretto). */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0B1220" />

        {/* Reset di ScrollView di Expo: impedisce che il contenuto
            "spinga" la larghezza della pagina oltre il viewport,
            causa tipica dello scroll orizzontale indesiderato su
            mobile. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: RESET_RESPONSIVO }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const RESET_RESPONSIVO = `
html, body, #root {
  height: 100%;
  width: 100%;
  max-width: 100vw;
  overflow-x: hidden;
}
* {
  -webkit-text-size-adjust: 100%;
}
`;
