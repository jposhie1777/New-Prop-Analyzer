"use client";

import Link from "next/link";
import { useSettings } from "@/lib/client/hooks";
import { vendorLabel } from "@/lib/odds/deeplinks";

export function BooksIndicator() {
  const { enabledBooks } = useSettings();
  if (enabledBooks.length === 0) return null;
  return (
    <Link href="/settings" className="pill accent" title="Change your sportsbooks in Settings">
      Showing: {enabledBooks.map(vendorLabel).join(", ")} · change
    </Link>
  );
}
