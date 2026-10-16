const DATABASE_NAME = "easy-pattern-studio";
const DATABASE_VERSION = 1;
const STORE_NAME = "recovery";
const LAST_PATTERN_KEY = "last-pattern-halloween-demo-v2";

function openRecoveryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Recovery storage is unavailable"));
  });
}

async function runRecoveryTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openRecoveryDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Recovery storage failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Recovery storage was interrupted"));
    });
  } finally {
    database.close();
  }
}

export async function readLastPattern<T>(): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const value = await runRecoveryTransaction<T | undefined>("readonly", (store) => store.get(LAST_PATTERN_KEY));
  return value ?? null;
}

export async function saveLastPattern<T>(pattern: T): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await runRecoveryTransaction<IDBValidKey>("readwrite", (store) => store.put(pattern, LAST_PATTERN_KEY));
}

export async function clearLastPattern(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await runRecoveryTransaction<undefined>("readwrite", (store) => store.delete(LAST_PATTERN_KEY));
}
