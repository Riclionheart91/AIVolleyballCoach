/** True se l'errore dipende dalla connessione (si riprova più tardi) e non da un rifiuto del server. */
export function erroreDiRete(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String((e as { message?: string } | null)?.message ?? e ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timed? ?out|connection (was )?(lost|reset|closed)|offline|nessuna connessione/i.test(msg);
}

/** Identificativo (UUID v4) di un'operazione: il database la applica una sola volta anche se arriva due volte. */
export function idOperazione(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
