"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SyncStatus } from "./SyncStatus";
import { useSlip, useVisibleMinuteCounter } from "@/lib/client/hooks";

const navItems = [
  { href: "/", label: "Slate" },
  { href: "/three-quarters", label: "100 in 3" },
  { href: "/live", label: "Live" },
  { href: "/players", label: "Players" },
  { href: "/slip", label: "Slip" },
  { href: "/record", label: "Record" },
  { href: "/costs", label: "Costs" },
  { href: "/settings", label: "Settings" },
];

export function AppHeader() {
  const pathname = usePathname();
  const slip = useSlip();
  useVisibleMinuteCounter();
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">P</span>
          <span>Pulse NBA</span>
        </Link>
        <nav className="nav-links">
          {navItems.map((navItem) => {
            const active = navItem.href === "/" ? pathname === "/" : pathname.startsWith(navItem.href) || (navItem.href === "/players" && pathname.startsWith("/player/"));
            return (
              <Link key={navItem.href} href={navItem.href} className={`nav-link${active ? " active" : ""}`}>
                {navItem.label}
                {navItem.href === "/slip" && slip.length > 0 ? <span className="nav-badge">{slip.length}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="desktop-only">
          <SyncStatus />
        </div>
      </div>
    </header>
  );
}
