"use client";

import { useState } from "react";
import { useSettings } from "@/lib/client/hooks";
import { saveSettings, defaultSettings } from "@/lib/client/settings";
import { deleteFinalsDatabase } from "@/lib/client/idbStore";
import { resetDeviceUsage } from "@/lib/client/deviceUsage";

const stateCodes = ["az", "co", "ct", "dc", "ia", "il", "in", "ks", "ky", "la", "ma", "md", "mi", "nc", "nh", "nj", "ny", "oh", "pa", "tn", "va", "vt", "wv", "wy"];

export default function SettingsPage() {
  const settings = useSettings();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Settings</h1>
          <p>Stored on this device only.</p>
        </div>
      </div>
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
