"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { rememberSport, useSport, type Sport } from "@/lib/client/sport";
import { SyncStatus } from "./SyncStatus";
import { useSlip, useVisibleMinuteCounter } from "@/lib/client/hooks";

const nbaNavGroups = [
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

const ncaabNavGroups = [
  {
    title: "College",
    items: [
      { href: "/ncaab", label: "Lines" },
      { href: "/ncaab/teams", label: "Teams" },
    ],
  },
  {
    title: "My bets",
    items: [
      { href: "/slip", label: "Slip" },
      { href: "/ncaab/record", label: "Record" },
    ],
  },
];

const sportOptions: Array<{ value: Sport; label: string }> = [
  { value: "nba", label: "NBA" },
  { value: "ncaab", label: "NCAAB" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/ncaab") return pathname === href;
  if (href === "/ncaab/teams" && pathname.startsWith("/ncaab/team/")) return true;
  if (href === "/players" && pathname.startsWith("/player/")) return true;
  if (href === "/live") return pathname === "/live"; // so Live Bets does not light up Live too
  return pathname.startsWith(href);
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const sport = useSport(pathname);
  const navGroups = sport === "ncaab" ? ncaabNavGroups : nbaNavGroups;
  const slip = useSlip();
  useVisibleMinuteCounter();
  return (
    <nav className="app-nav" aria-label="Main">
      <Link href={sport === "ncaab" ? "/ncaab" : "/"} className="brand">
        <span className="brand-mark">P</span>
        <span>Pulse</span>
      </Link>
      <div className="sport-switch" role="tablist" aria-label="Sport">
        {sportOptions.map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={sport === option.value}
            className={sport === option.value ? "active" : ""}
            onClick={() => {
              rememberSport(option.value);
              router.push(option.value === "ncaab" ? "/ncaab" : "/");
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
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
          {sport === "nba" ? <SyncStatus /> : null}
        </div>
      </div>
    </nav>
  );
}
