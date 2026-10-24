import overrides from "@/config/nbaPersonOverrides.json";

let mappingPromise: Promise<Record<string, number>> | null = null;

export function loadPersonIds(): Promise<Record<string, number>> {
  mappingPromise ??= fetch("/data/nba-person-ids.json")
    .then((response) => (response.ok ? response.json() : { ids: {} }))
    .then((payload: { ids?: Record<string, number> }) => ({ ...(payload.ids ?? {}), ...(overrides as Record<string, number>) })) // manual overrides win
    .catch(() => ({ ...(overrides as Record<string, number>) }));
  return mappingPromise;
}

export function headshotUrl(personId: number): string {
  return `https://cdn.nba.com/headshots/nba/latest/260x190/${personId}.png`; // NBA's public headshot CDN
}
