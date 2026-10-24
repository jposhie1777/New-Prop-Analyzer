"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSlip } from "@/lib/client/hooks";

export function SlipFab() {
  const slip = useSlip();
  const pathname = usePathname();
  if (slip.length === 0 || pathname.startsWith("/slip")) return null;
  return (
    <Link href="/slip" className="slip-fab" aria-label={`Open bet slip with ${slip.length} picks`}>
      <span>Slip</span>
      <span className="slip-fab-count">{slip.length}</span>
      <span aria-hidden>→</span>
    </Link>
  );
}
