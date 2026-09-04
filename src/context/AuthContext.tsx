import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { accettaInvitiPendenti } from "@/src/services/teamInvites";
import type { Ruolo, Season, Team } from "@/src/types/database";

const CHIAVE_ULTIMO_TEAM = "aivolleyballcoach:ultimo_team_id";

interface RigaContesto {
  team_id: string;
  team_nome: string;
  team_creato_il: string;
  ruolo: Ruolo;
  atleta_id: string | null;
  stagione_id: string | null;
  stagione_nome: string | null;
  stagione_stato: string | null;
  stagione_aperta: boolean;
}

interface SquadraDisponibile {
  team: Team;
  ruolo: Ruolo;
  atletaId: string | null;
}

interface AuthState {
  session: Session | null;
  caricamento: boolean;
  team: Team | null;
  ruolo: Ruolo | null;
  /** Popolato solo se ruolo === "atleta": l'id della SUA scheda anagrafica. */
  atletaId: string | null;
  puoScrivere: boolean;
  soloLettura: boolean;
  isSuperuser: boolean;
  squadreDisponibili: SquadraDisponibile[];
  cambiaSquadra: (teamId: string) => Promise<void>;
  /**
   * UNICO flag di caricamento per squadra+stagione insieme (prima erano
   * due flag separati con due effetti React indipendenti — la causa
   * della race condition descritta in 0001f_contesto_team.sql). Finché
   * questo è true, nessuna schermata deve decidere se mostrare "crea
   * squadra" o "apri stagione": lo stato è ancora incerto.
   */
  caricamentoContesto: boolean;
  erroreTeam: string | null;
  stagioneAttiva: Season | null;
  accediConGoogle: () => Promise<void>;
  esci: () => Promise<void>;
  creaPrimaSquadra: (nome: string) => Promise<void>;
  ricaricaContesto: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [ruolo, setRuolo] = useState<Ruolo | null>(null);
  const [atletaId, setAtletaId] = useState<string | null>(null);
  const [squadreDisponibili, setSquadreDisponibili] = useState<SquadraDisponibile[]>([]);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [caricamentoContesto, setCaricamentoContesto] = useState(true);
  const [erroreTeam, setErroreTeam] = useState<string | null>(null);
  const [stagioneAttiva, setStagioneAttiva] = useState<Season | null>(null);

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

  useEffect(() => {
    if (!session) { setIsSuperuser(false); return; }
    supabaseClient.rpc("sono_superuser").then(({ data, error }) => {
      if (!error) setIsSuperuser(Boolean(data));
    });
  }, [session?.user.id]);

  /**
   * Unico punto di caricamento per squadra+stagione. Una sola chiamata
   * RPC (mio_contesto_team), un solo giro di setState — non ci sono più
   * due effetti indipendenti che possono disallinearsi a metà strada.
   */
  async function ricaricaContesto() {
    if (!session) {
      setTeam(null); setRuolo(null); setAtletaId(null);
      setSquadreDisponibili([]); setStagioneAttiva(null);
      setCaricamentoContesto(false);
      return;
    }

    setCaricamentoContesto(true);
    await accettaInvitiPendenti();

    const { data, error } = await supabaseClient.rpc("mio_contesto_team");

    if (error) {
      console.warn("Errore nel caricamento del contesto squadra:", error.message);
      setErroreTeam(error.message);
      setTeam(null); setRuolo(null); setAtletaId(null);
      setSquadreDisponibili([]); setStagioneAttiva(null);
      setCaricamentoContesto(false);
      return;
    }

    const righe = (data ?? []) as RigaContesto[];
    setErroreTeam(null);

    if (righe.length === 0) {
      setTeam(null); setRuolo(null); setAtletaId(null);
      setSquadreDisponibili([]); setStagioneAttiva(null);
      setCaricamentoContesto(false);
      return;
    }

    // Una riga per squadra (già ordinate per data di creazione dalla
    // RPC stessa: niente più dipendenza dall'ordine, non garantito, con
    // cui il database potrebbe restituire i risultati).
    const opzioni: SquadraDisponibile[] = righe.map((r) => ({
      team: { id: r.team_id, nome: r.team_nome, creato_il: r.team_creato_il, creato_da: null },
      ruolo: r.ruolo,
      atletaId: r.atleta_id,
    }));
    setSquadreDisponibili(opzioni);

    const ultimoId = await AsyncStorage.getItem(CHIAVE_ULTIMO_TEAM);
    const rigaScelta = righe.find((r) => r.team_id === ultimoId) ?? righe[0];

    setTeam(opzioni.find((o) => o.team.id === rigaScelta.team_id)!.team);
    setRuolo(rigaScelta.ruolo);
    setAtletaId(rigaScelta.atleta_id);
    setStagioneAttiva(
      rigaScelta.stagione_aperta && rigaScelta.stagione_id
        ? { id: rigaScelta.stagione_id, team_id: rigaScelta.team_id, nome: rigaScelta.stagione_nome!, stato: "attiva", data_apertura: "", data_chiusura: null, creata_il: "", creata_da: null }
        : null,
    );
    setCaricamentoContesto(false);
  }

  useEffect(() => {
    ricaricaContesto();
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
    const { data, error } = await supabaseClient.rpc("crea_team_e_diventa_allenatore", { p_nome: nome });
    if (error) throw error;
    if (data) await AsyncStorage.setItem(CHIAVE_ULTIMO_TEAM, data as string);
    await ricaricaContesto();
  }

  async function cambiaSquadra(teamId: string) {
    await AsyncStorage.setItem(CHIAVE_ULTIMO_TEAM, teamId);
    await ricaricaContesto();
  }

  const puoScrivere = ruolo === "allenatore" || ruolo === "vice_allenatore";
  const soloLettura = ruolo === "presidente";

  const value = useMemo<AuthState>(
    () => ({
      session, caricamento, team, ruolo, atletaId, puoScrivere, soloLettura, isSuperuser,
      squadreDisponibili, cambiaSquadra, caricamentoContesto, erroreTeam, stagioneAttiva,
      accediConGoogle, esci, creaPrimaSquadra, ricaricaContesto,
    }),
    [session, caricamento, team, ruolo, atletaId, isSuperuser, squadreDisponibili, caricamentoContesto, erroreTeam, stagioneAttiva],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro <AuthProvider>");
  return ctx;
}
