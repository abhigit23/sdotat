/**
 * Delete tokens for pastes created in this browser, kept in localStorage so
 * the creator can delete a paste later even after closing the tab. Entries
 * are dropped when their paste is deleted, and expired ones whenever a new
 * token is saved.
 */

const STORAGE_KEY = "delete-tokens";
const CHANGE_EVENT = "delete-tokens-change";

type Entry = { token: string; expiresAt: number | null };
type Store = Record<string, Entry>;

function read(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    if (Object.keys(store).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or disabled (e.g. some private modes); the delete link
    // still works.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Removes entries whose paste has expired. */
function pruned(store: Store): Store {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(store).filter(
      ([, e]) => e.expiresAt === null || e.expiresAt > now
    )
  );
}

export function saveDeleteToken(
  code: string,
  token: string,
  expiresAt: string | null
): void {
  const store = pruned(read());
  store[code] = {
    token,
    expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
  };
  write(store);
}

/**
 * The saved token for `code`, or null if none or its paste has expired. Pure
 * (no writes) so it can serve as a useSyncExternalStore snapshot; expired
 * entries are cleared on the next save.
 */
export function getDeleteToken(code: string): string | null {
  const entry = read()[code];
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) return null;
  return entry.token;
}

export function removeDeleteToken(code: string): void {
  const store = read();
  if (!(code in store)) return;
  delete store[code];
  write(store);
}

/**
 * Subscribes to token changes in this tab and others (for
 * useSyncExternalStore).
 */
export function subscribeDeleteTokens(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
