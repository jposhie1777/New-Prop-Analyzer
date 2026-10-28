"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { availableBooks } from "@/lib/client/bookFilter";
import { Segmented } from "@/components/Segmented";
import { vendorLabel } from "@/lib/odds/deeplinks";
import { useSettings } from "@/lib/client/hooks";
import { saveSettings, defaultSettings } from "@/lib/client/settings";
import { appSettings } from "@/config/appSettings";
import { deleteFinalsDatabase } from "@/lib/client/idbStore";
import { resetDeviceUsage } from "@/lib/client/deviceUsage";

const stateCodes = ["az", "co", "ct", "dc", "ia", "il", "in", "ks", "ky", "la", "ma", "md", "mi", "nc", "nh", "nj", "ny", "oh", "pa", "tn", "va", "vt", "wv", "wy"];

export default function SettingsPage() {
  const settings = useSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [bookOptions, setBookOptions] = useState<string[]>([]);
  useEffect(() => setBookOptions(availableBooks()), []); // known books plus any BDL has returned on this device
  const toggleBook = (vendor: string) => {
    const current = settings.enabledBooks;
    saveSettings({ enabledBooks: current.includes(vendor) ? current.filter((enabled) => enabled !== vendor) : [...current, vendor] });
  };
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Settings</h1>
          <p>Saved on this device only.</p>
        </div>
      </div>
      <section className="card flush settings-list">
        <div className="setting-row">
          <div>
            <span className="strong">Appearance</span>
            <p>System follows your phone or computer.</p>
          </div>
          <Segmented
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
            value={settings.appearance}
            onChange={(nextAppearance) => saveSettings({ appearance: nextAppearance })}
            label="Appearance"
          />
        </div>
        <div className="setting-row">
          <div>
            <span className="strong">Live player props layout</span>
            <p>Grid shows a stat table; Rows shows one line per player that opens his markets.</p>
          </div>
          <Segmented
            options={[
              { value: "grid", label: "Grid" },
              { value: "rows", label: "Rows" },
            ]}
            value={settings.liveLayout}
            onChange={(nextLayout) => saveSettings({ liveLayout: nextLayout === "rows" ? "rows" : "grid" })}
            label="Live props layout"
          />
        </div>
        <Link href="/costs" className="setting-row">
          <div>
            <span className="strong">Costs</span>
            <p>BALLDONTLIE calls, Vercel usage and storage on this device.</p>
          </div>
          <span className="expand-hint">Details →</span>
        </Link>
      </section>
      <section className="card">
        <div className="card-header wrap">
          <div>
            <h2>My sportsbooks</h2>
            <div className="faint small">Lines, props, best prices, EV, parlays and consensus lines use only these books. None selected = all books.</div>
          </div>
          {settings.enabledBooks.length > 0 ? (
            <button className="button small ghost" onClick={() => saveSettings({ enabledBooks: [] })}>
              Show all books
            </button>
          ) : (
            <span className="pill">All books</span>
          )}
        </div>
        <div className="chip-row">
          {bookOptions.map((vendor) => {
            const enabled = settings.enabledBooks.includes(vendor);
            return (
              <button key={vendor} className={`button small${enabled ? " added" : " ghost"}`} onClick={() => toggleBook(vendor)} aria-pressed={enabled}>
                {enabled ? "✓ " : ""}
                {vendorLabel(vendor)}
              </button>
            );
          })}
        </div>
        <p className="faint small">⚡ One-tap player props: only BetMGM, BetRivers and Caesars send prop bet-slip links. FanDuel and DraftKings open the game page with the pick copied.</p>
        <p className="faint small">Pregame lines from every book still anchor live projections, so the model stays accurate even with one book selected.</p>
        <label className="stack">
          <span className="strong">Default sportsbook for the slip</span>
          <span className="faint small">Each slip pick starts on this book (when it offers the pick). Best price picks the highest payout.</span>
          <select className="input" value={settings.defaultBook} onChange={(changeEvent) => saveSettings({ defaultBook: changeEvent.target.value })}>
            <option value="">Best price</option>
            {bookOptions.map((vendor) => (
              <option key={vendor} value={vendor}>
                {vendorLabel(vendor)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="card">
        <div className="stack" style={{ gap: 14 }}>
          <label className="stack">
            <span className="strong">Sportsbook state</span>
            <span className="faint small">Fills {"{state}"} in BALLDONTLIE deeplinks (FanDuel, DraftKings, BetRivers and others).</span>
            <select className="input" value={settings.sportsbookState} onChange={(changeEvent) => saveSettings({ sportsbookState: changeEvent.target.value })}>
              {stateCodes.map((stateCode) => (
                <option key={stateCode} value={stateCode}>
                  {stateCode.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span className="strong">Halftime EV threshold (%)</span>
            <span className="faint small">Halftime picks at or above this expected value are flagged.</span>
            <input className="input" type="number" step={0.5} min={0} value={settings.evThresholdPercent} onChange={(changeEvent) => saveSettings({ evThresholdPercent: Math.max(0, Number(changeEvent.target.value)) })} />
          </label>
          <label className="stack">
            <span className="strong">100 in 3: minimum learned chance (%)</span>
            <span className="faint small">Teams rated at or above this are recommended and graded on the Record page. The league-wide rate is about {Math.round(appSettings.hundredThroughThreeBaseRate * 100)}%.</span>
            <input className="input" type="number" step={1} min={1} max={90} value={settings.threeQuarterMinimumPercent} onChange={(changeEvent) => saveSettings({ threeQuarterMinimumPercent: Math.min(90, Math.max(1, Number(changeEvent.target.value))) })} />
          </label>
          <label className="stack">
            <span className="strong">100 in 3: most picks per day</span>
            <input className="input" type="number" step={1} min={1} max={10} value={settings.threeQuarterMaxPicks} onChange={(changeEvent) => saveSettings({ threeQuarterMaxPicks: Math.min(10, Math.max(1, Math.round(Number(changeEvent.target.value)))) })} />
          </label>
          <label className="stack">
            <span className="strong">Default wager for coupon links ($)</span>
            <span className="faint small">BetRivers coupon links take a wager amount.</span>
            <input className="input" type="number" min={1} value={settings.wagerAmount} onChange={(changeEvent) => saveSettings({ wagerAmount: Math.max(1, Number(changeEvent.target.value)) })} />
          </label>
          <div className="row wrap">
            <button className="button ghost" onClick={() => saveSettings(defaultSettings())}>
              Reset to defaults
            </button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <h2>Local data</h2>
        </div>
        <div className="row wrap">
          <button
            className="button ghost"
            onClick={async () => {
              await deleteFinalsDatabase();
              setMessage("Local game data cleared. Reload to rebuild it from the baseline and the cached /api/finals dates.");
            }}
          >
            Rebuild local game data
          </button>
          <button
            className="button ghost"
            onClick={() => {
              resetDeviceUsage();
              setMessage("This device's usage counters were reset.");
            }}
          >
            Reset usage counters
          </button>
        </div>
        {message ? <p className="small muted">{message}</p> : null}
      </section>
    </main>
  );
}
