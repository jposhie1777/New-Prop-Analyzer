export function normalizePersonName(fullName: string): string {
  return fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents: Jokić -> Jokic
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

export function initialsFor(firstName: string, lastName: string): string {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || "?";
}
