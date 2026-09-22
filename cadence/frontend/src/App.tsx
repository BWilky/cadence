import { boot, useHashRoute, useLive } from "./api";
import { Toaster } from "./components/ui";
import { Log } from "./pages/Log";
import { Now } from "./pages/Now";
import { Planner } from "./pages/Planner";
import { Scenes } from "./pages/Scenes";
import { SettingsPage } from "./pages/Settings";
import { Tablet } from "./pages/Tablet";
import { Templates } from "./pages/Templates";

const NAV: [string, string][] = [
  ["now", "Now"],
  ["planner", "Planner"],
  ["templates", "Templates"],
  ["scenes", "Scenes"],
  ["settings", "Settings"],
  ["log", "Activity"],
  ["tablet", "Tablet"],
];

export default function App() {
  const { route, query } = useHashRoute();
  const live = useLive();
  const st = live.status;

  if (route === "tablet") {
    return (
      <>
        <Tablet live={live} query={query} />
        <Toaster />
      </>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          Cadence <small>v{boot.version}</small>
        </div>
        <nav className="nav">
          {NAV.map(([r, label]) => (
            <a key={r} href={"#/" + r} className={route === r ? "active" : ""} target={r === "tablet" ? "_blank" : undefined} rel="noreferrer">
              {label}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <div className="statusbits">
          {st ? (
            <>
              <span className={"chip " + (st.ha_connected ? "live" : "warn")}>{st.ha_connected ? "HA linked" : "HA offline"}</span>
              {st.dry_run ? <span className="chip">Dry run</span> : <span className="chip live">Live control</span>}
              <span className={"chip " + (st.auto_active ? "live" : "off")}>{st.auto_active ? "Auto" : "Manual"}</span>
              {st.hold.active ? <span className="chip warn">Holding</span> : null}
            </>
          ) : (
            <span className={"chip " + (live.connected ? "live" : "off")}>{live.connected ? "connecting…" : "offline"}</span>
          )}
          {boot.user ? <span className="small muted">{boot.user.name}</span> : null}
        </div>
      </header>
      <main className={"page" + (route === "planner" ? " wide" : "")}>
        {route === "now" && <Now live={live} />}
        {route === "planner" && <Planner live={live} />}
        {route === "templates" && <Templates />}
        {route === "scenes" && <Scenes />}
        {route === "settings" && <SettingsPage live={live} />}
        {route === "log" && <Log live={live} />}
        {!NAV.some(([r]) => r === route) && <Now live={live} />}
      </main>
      <Toaster />
    </div>
  );
}
