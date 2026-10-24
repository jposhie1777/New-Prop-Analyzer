import { appSettings } from "@/config/appSettings";

const easternDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: appSettings.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });

export function easternDateOf(instant: Date): string {
  return easternDateFormatter.format(instant); // en-CA yields YYYY-MM-DD
}

export function todayEastern(nowMs = Date.now()): string {
  return easternDateOf(new Date(nowMs));
}

export function isIsoDate(candidate: string | null | undefined): candidate is string {
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}

export function addDays(isoDate: string, dayCount: number): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + dayCount);
  return parsed.toISOString().slice(0, 10);
}

export function daysBetween(earlierDate: string, laterDate: string): number {
  return Math.round((Date.parse(`${laterDate}T00:00:00Z`) - Date.parse(`${earlierDate}T00:00:00Z`)) / 86_400_000);
}

export function seasonForDate(isoDate: string): number {
  const [yearText, monthText] = isoDate.split("-");
  const monthNumber = Number(monthText);
  return monthNumber >= 8 ? Number(yearText) : Number(yearText) - 1; // BDL season = start year, seasons start in October
}

export function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let cursorDate = startDate; cursorDate <= endDate; cursorDate = addDays(cursorDate, 1)) dates.push(cursorDate);
  return dates;
}

export function parseMinutes(minutesText: string | number | null | undefined): number {
  if (minutesText === null || minutesText === undefined) return 0;
  if (typeof minutesText === "number") return minutesText;
  const trimmed = minutesText.trim();
  if (!trimmed) return 0;
  if (trimmed.includes(":")) {
    const [minutePart, secondPart] = trimmed.split(":");
    return Number(minutePart) + Number(secondPart) / 60; // "34:12" style
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatTipoff(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return "TBD";
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) return "TBD";
  return parsed.toLocaleTimeString("en-US", { timeZone: appSettings.timeZone, hour: "numeric", minute: "2-digit" }) + " ET";
}
