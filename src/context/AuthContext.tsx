import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { accettaInvitiPendenti } from "@/src/services/teamInvites";
import type { Ruolo, Team } from "@/src/types/database";

interface AuthState {
  session: Session | null;
  caricamento: boolean;
  team: Team | null;
  ruolo: Ruolo | null;
  // true finché non sappiamo ancora se l'utente ha un team — evita di
  // mostrare per un istante "nessuna squadra" mentre la query è in corso
  // (lo stesso tipo di falso allarme di "non riesco a caricare la
  // stagione" che nasceva, in GAS, da un errore di auth mascherato).
  caricamentoTeam: boolean;
  accediConGoogle: () => Promise<void>;
  esci: () => Promise<void>;
  creaPrimaSquadra: (nome: string) => Promise<void>;
  ricaricaTeam: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [ruolo, setRuolo] = useState<Ruolo | null>(null);
  const [caricamentoTeam, setCaricamentoTeam] = useState(true);

  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCaricamento(false);
    });
    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, nuovaSessione) => {
      setSession(nuovaSessione);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function ricaricaTeam() {
    if (!session) {
      setTeam(null);
      setRuolo(null);
      setCaricamentoTeam(false);
      return;
    }
    setCaricamentoTeam(true);
    // Se l'utente è stato invitato da un altro allenatore, questo lo fa
    // entrare automaticamente nel team invitante — senza questo passo,
    // finirebbe nella schermata "crea la tua prima squadra" e si
    // ritroverebbe con un secondo team vuoto invece di unirsi a quello
    // giusto.
    await accettaInvitiPendenti();

    // Un utente potrebbe in futuro appartenere a più team: per la F1/F2/F5
    // prendiamo il primo, come singola squadra gestita — coerente con
    // l'ipotesi "uno spreadsheet = una squadra" della versione GAS.
    const { data, error } = await supabaseClient
      .from("team_members")
      .select("ruolo, teams(*)")
      .eq("user_id", session.user.id)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Errore nel caricamento del team:", error.message);
      setTeam(null);
      setRuolo(null);
    } else if (data) {
      setTeam((data.teams as unknown as Team) ?? null);
      setRuolo(data.ruolo as Ruolo);
    } else {
      setTeam(null);
      setRuolo(null);
    }
    setCaricamentoTeam(false);
  }

  useEffect(() => {
    ricaricaTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  async function accediConGoogle() {
    await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: cfg.authRedirectUrl },
    });
  }

  async function esci() {
    await supabaseClient.auth.signOut();
  }

  async function creaPrimaSquadra(nome: string) {
    const { error } = await supabaseClient.rpc("crea_team_e_diventa_allenatore", { p_nome: nome });
    if (error) throw error;
    await ricaricaTeam();
  }

  const value = useMemo<AuthState>(
    () => ({ session, caricamento, team, ruolo, caricamentoTeam, accediConGoogle, esci, creaPrimaSquadra, ricaricaTeam }),
    [session, caricamento, team, ruolo, caricamentoTeam],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro <AuthProvider>");
  return ctx;
}
