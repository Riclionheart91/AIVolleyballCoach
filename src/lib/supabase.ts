import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { supabase as cfg } from "@/src/config";
import type { Database } from "@/src/types/database";

// A differenza di BandFit (dove Supabase era un add-on solo-web per il
// cloud sync), qui è l'UNICA fonte dati fin dalla F1: niente split
// .ts/.web.ts, lo stesso client funziona su web/iOS/Android grazie ad
// AsyncStorage come storage di sessione.
export const supabaseClient = createClient<Database>(cfg.url, cfg.anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
