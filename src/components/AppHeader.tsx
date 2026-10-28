"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SyncStatus } from "./SyncStatus";
import { useSlip, useVisibleMinuteCounter } from "@/lib/client/hooks";

const navGroups = [
  {
    title: "Tonight",
    items: [
      { href: "/", label: "Slate" },
      { href: "/lines", label: "Lines" },
      { href: "/three-quarters", label: "100 in 3" },
      { href: "/live", label: "Live" },
      { href: "/live-bets", label: "Live Bets" },
    ],
  },
  {
    title: "Research",
    items: [
      { href: "/players", label: "Players" },
      { href: "/shots", label: "Shots" },
    ],
  },
  {
    title: "My bets",
    items: [
      { href: "/slip", label: "Slip" },
      { href: "/record", label: "Record" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/players" && pathname.startsWith("/player/")) return true;
  if (href === "/live") return pathname === "/live"; // so Live Bets does not light up Live too
  return pathname.startsWith(href);
}

export function AppHeader() {
  const pathname = usePathname();
  const slip = useSlip();
  useVisibleMinuteCounter();
  return (
    <nav className="app-nav" aria-label="Main">
      <Link href="/" className="brand">
        <span className="brand-mark">P</span>
        <span>Pulse NBA</span>
      </Link>
      {navGroups.map((navGroup) => (
        <div key={navGroup.title} className="nav-group">
          <span className="nav-group-title">{navGroup.title}</span>
          {navGroup.items.map((navItem) => (
            <Link key={navItem.href} href={navItem.href} className={`nav-link${isActive(pathname, navItem.href) ? " active" : ""}`}>
              {navItem.label}
              {navItem.href === "/slip" && slip.length > 0 ? <span className="nav-badge count">{slip.length}</span> : null}
            </Link>
          ))}
        </div>
      ))}
      <div className="nav-group gear">
        <Link href="/settings" className={`nav-link${pathname.startsWith("/settings") || pathname.startsWith("/costs") ? " active" : ""}`} aria-label="Settings">
          <span>⚙ Settings</span>
        </Link>
        <div className="nav-sync">
          <SyncStatus />
        </div>
      </div>
    </nav>
  );
}
