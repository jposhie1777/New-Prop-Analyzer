export function readLocalJson<ValueType>(storageKey: string, fallbackValue: ValueType): ValueType {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? (JSON.parse(stored) as ValueType) : fallbackValue;
  } catch {
    return fallbackValue; // private mode, blocked storage or corrupt JSON
  }
}

export function writeLocalJson(storageKey: string, value: unknown): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    return; // storage full or blocked, the page keeps working without it
  }
}
