import { readLocalJson, writeLocalJson } from "./safeStorage";
import { vendorLabels } from "@/lib/odds/deeplinks";

const seenBooksStorageKey = "pulse-nba-seen-books";

export function isBookEnabled(vendor: string, enabledBooks: string[]): boolean {
  return enabledBooks.length === 0 || enabledBooks.includes(vendor); // an empty choice means every book
}

export function filterByBooks<ItemType extends { vendor: string }>(items: ItemType[], enabledBooks: string[]): ItemType[] {
  return enabledBooks.length === 0 ? items : items.filter((item) => enabledBooks.includes(item.vendor));
}

export function rememberSeenBooks(vendors: string[]): void {
  if (vendors.length === 0) return;
  const known = new Set(readLocalJson<string[]>(seenBooksStorageKey, []));
  const before = known.size;
  for (const vendor of vendors) if (vendor) known.add(vendor);
  if (known.size !== before) writeLocalJson(seenBooksStorageKey, [...known].sort()); // so Settings can list books BDL actually returns
}

export function availableBooks(): string[] {
  const seen = readLocalJson<string[]>(seenBooksStorageKey, []);
  return [...new Set([...Object.keys(vendorLabels), ...seen])].sort();
}

export function booksKey(enabledBooks: string[]): string {
  return enabledBooks.length === 0 ? "all" : [...enabledBooks].sort().join("+");
}
