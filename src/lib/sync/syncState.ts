export interface SyncSection<ValueType> {
  value: ValueType;
  updatedAt: string; // when it last changed on any device
}

export interface SyncState {
  slip: SyncSection<unknown[]> | null;
  settings: SyncSection<Record<string, unknown>> | null;
}

export type SyncSectionName = keyof SyncState;

export const syncSectionNames: SyncSectionName[] = ["slip", "settings"];

export function emptySyncState(): SyncState {
  return { slip: null, settings: null };
}

export function mergeSyncState(stored: SyncState, incoming: Partial<SyncState>): SyncState {
  const merged: SyncState = { ...stored };
  for (const sectionName of syncSectionNames) {
    const incomingSection = incoming[sectionName];
    if (!incomingSection || typeof incomingSection.updatedAt !== "string") continue;
    const storedSection = stored[sectionName];
    if (!storedSection || incomingSection.updatedAt >= storedSection.updatedAt) merged[sectionName] = incomingSection as never; // the newest change wins, section by section
  }
  return merged;
}
