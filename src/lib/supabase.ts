import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { supabase as cfg } from "@/src/config";
import type { Database } from "@/src/types/database";

// Su web, expo-router esegue il rendering statico (F1: `expo export -p web`)
// in Node.js, dove non esiste `window`. AsyncStorage su web è solo un wrapper
// attorno a window.localStorage, quindi va usato con cautela: durante il
// render server-side restituiamo dei no-op invece di far crashare la build.
const isServer = typeof window === "undefined";

// IMPORTANTE: controlliamo `isServer` PRIMA di `Platform.OS`. Durante il
// rendering statico (node/render.js) il modulo Platform di react-native può
// non risolvere correttamente a "web" (bundle diverso da quello client), per
// cui affidarsi solo a Platform.OS può far scivolare il codice nel ramo
// nativo e chiamare comunque AsyncStorage -> window. Controllando prima
// `isServer`, siamo certi di non toccare mai window/AsyncStorage in Node.
const ssrSafeStorage = {
  getItem: (key: string) => {
    if (isServer) return Promise.resolve(null);
    if (Platform.OS !== "web") return AsyncStorage.getItem(key);
    return Promise.resolve(window.localStorage.getItem(key));
  },
  setItem: (key: string, value: string) => {
    if (isServer) return Promise.resolve();
    if (Platform.OS !== "web") return AsyncStorage.setItem(key, value);
    window.localStorage.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    if (isServer) return Promise.resolve();
    if (Platform.OS !== "web") return AsyncStorage.removeItem(key);
    window.localStorage.removeItem(key);
    return Promise.resolve();
  },
};

// A differenza di BandFit (dove Supabase era un add-on solo-web per il
// cloud sync), qui è l'UNICA fonte dati fin dalla F1: niente split
// .ts/.web.ts, lo stesso client funziona su web/iOS/Android grazie ad
// AsyncStorage come storage di sessione.
export const supabaseClient = createClient<Database>(cfg.url, cfg.anonKey, {
  auth: {
    storage: ssrSafeStorage,
    autoRefreshToken: !isServer,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
