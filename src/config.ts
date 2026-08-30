export const brand = {
  colors: {
    surface: "#0B1220",
    onSurface: "#FFFFFF",
    surfaceSecondary: "#141C2E",
    onSurfaceSecondary: "#C9D2E3",
    surfaceTertiary: "#1E2A44",
    brand: "#FF7A00", // arancio pallavolo, distinto dal verde BandFit
    brandSecondary: "#32ADE6",
    success: "#34C759",
    warning: "#FFD700",
    error: "#FF3B30",
    border: "#26314A",
    muted: "#8E99B3",
  },
  breakpoints: { mobile: 0, tablet: 768, desktop: 1024 },
};

export const supabase = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  authRedirectUrl: process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL ?? "https://your-user.github.io/AIVolleyballCoach/",
  aiRouterFunction: "ai-router",
};

export const fondamentali = ["Battuta", "Ricezione", "Attacco", "Muro", "Difesa"] as const;

export const ruoliCampo = ["Palleggiatore", "Schiacciatore", "Opposto", "Centrale", "Libero"] as const;

export const skillsScouting: { skill: "Servizio" | "Ricezione" | "Attacco" | "Muro" | "Difesa"; etichetta: string }[] = [
  { skill: "Servizio", etichetta: "Servizio" },
  { skill: "Ricezione", etichetta: "Ricezione" },
  { skill: "Attacco", etichetta: "Attacco" },
  { skill: "Muro", etichetta: "Muro" },
  { skill: "Difesa", etichetta: "Difesa" },
];

/** Modalità essenziale (senza un secondo scout dedicato): solo i 3 fondamentali più diagnostici. */
export const skillsScoutingEssenziali: typeof skillsScouting = [
  { skill: "Servizio", etichetta: "Servizio" },
  { skill: "Attacco", etichetta: "Attacco" },
  { skill: "Ricezione", etichetta: "Ricezione" },
];

export const etichetteRuolo: Record<string, string> = {
  allenatore: "Allenatore",
  vice_allenatore: "Vice-allenatore",
  presidente: "Presidente",
  atleta: "Atleta",
};

export const uiStrings = {
  common: { save: "Salva", cancel: "Annulla", close: "Chiudi", loading: "Caricamento…" },
  auth: {
    loginTitle: "AI Volleyball Coach",
    loginGoogle: "Accedi con Google",
    logout: "Esci",
    noTeam: "Nessuna squadra associata a questo account.",
    createTeam: "Crea la tua prima squadra",
  },
  valutazioni: {
    title: "Valutazioni tecniche",
    aiButton: "✨ Suggerisci con AI",
    aiGenerating: "Generazione in corso…",
    aiFallback: "percorso manuale sempre disponibile qui sopra",
    pendingSection: "Proposte AI in attesa di decisione",
  },
};
