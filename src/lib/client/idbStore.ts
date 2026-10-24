import type { FinalsPayload } from "@/lib/data/rowSchemas";

const databaseName = "pulse-nba";
const finalsStoreName = "finals";
const databaseVersion = 1;

let memoryFallback: Map<string, FinalsPayload> | null = null; // used when IndexedDB is unavailable, rebuilt every load

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const openRequest = indexedDB.open(databaseName, databaseVersion);
      openRequest.onupgradeneeded = () => {
        const database = openRequest.result;
        if (!database.objectStoreNames.contains(finalsStoreName)) database.createObjectStore(finalsStoreName, { keyPath: "date" });
      };
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => resolve(null);
      openRequest.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function memoryStore(): Map<string, FinalsPayload> {
  memoryFallback ??= new Map();
  return memoryFallback;
}

function requestToPromise<ResultType>(request: IDBRequest<ResultType>): Promise<ResultType> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readAllFinals(): Promise<FinalsPayload[]> {
  try {
    const database = await openDatabase();
    if (!database) return [...memoryStore().values()];
    const transaction = database.transaction(finalsStoreName, "readonly");
    const payloads = await requestToPromise(transaction.objectStore(finalsStoreName).getAll() as IDBRequest<FinalsPayload[]>);
    database.close();
    return payloads.filter((payload) => payload && typeof payload.date === "string" && payload.tables);
  } catch {
    await deleteFinalsDatabase(); // corrupt store: drop it and let the top-up rebuild it
    return [];
  }
}

export async function saveFinals(payload: FinalsPayload): Promise<void> {
  try {
    const database = await openDatabase();
    if (!database) {
      memoryStore().set(payload.date, payload);
      return;
    }
    const transaction = database.transaction(finalsStoreName, "readwrite");
    await requestToPromise(transaction.objectStore(finalsStoreName).put(payload));
    database.close();
  } catch {
    memoryStore().set(payload.date, payload);
  }
}

export async function deleteFinalsThrough(lastBaselineDate: string): Promise<number> {
  const payloads = await readAllFinals();
  const obsoleteDates = payloads.filter((payload) => payload.date <= lastBaselineDate).map((payload) => payload.date);
  if (obsoleteDates.length === 0) return 0;
  try {
    const database = await openDatabase();
    if (!database) {
      for (const obsoleteDate of obsoleteDates) memoryStore().delete(obsoleteDate);
      return obsoleteDates.length;
    }
    const transaction = database.transaction(finalsStoreName, "readwrite");
    for (const obsoleteDate of obsoleteDates) transaction.objectStore(finalsStoreName).delete(obsoleteDate); // the baseline now covers these dates
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
    database.close();
  } catch {
    return 0;
  }
  return obsoleteDates.length;
}

export async function deleteFinalsDatabase(): Promise<void> {
  memoryFallback = null;
  try {
    if (typeof indexedDB === "undefined") return;
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(databaseName);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve();
      deleteRequest.onblocked = () => resolve();
    });
  } catch {
    return;
  }
}

export async function estimateFinalsBytes(): Promise<number> {
  const payloads = await readAllFinals();
  return payloads.reduce((runningTotal, payload) => runningTotal + JSON.stringify(payload).length, 0);
}
