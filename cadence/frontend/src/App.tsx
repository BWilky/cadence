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
  const isPlanner = route === "planner";

  return (
    <div className="flex h-full flex-col">
      <header className="navbar sticky top-0 z-30 min-h-14 gap-3 border-b border-base-300 bg-base-200 px-4">
        <div className="flex items-baseline gap-2">
          <span className="display text-2xl">Cadence</span>
          <span className="font-mono text-[11px] opacity-50">v{boot.version}</span>
        </div>
        <div role="tablist" className="tabs tabs-box tabs-sm ml-2 hidden bg-base-300/40 md:flex">
          {NAV.map(([r, label]) => (
            <a key={r} role="tab" href={"#/" + r} className={"tab " + (route === r ? "tab-active" : "")}>
              {label}
            </a>
          ))}
        </div>
        <div className="dropdown md:hidden">
          <div tabIndex={0} role="button" className="btn btn-ghost btn-sm">
            Menu ▾
          </div>
          <ul tabIndex={0} className="menu dropdown-content z-40 mt-2 w-44 rounded-box bg-base-200 p-2 shadow">
            {NAV.map(([r, label]) => (
              <li key={r}>
                <a href={"#/" + r} className={route === r ? "menu-active" : ""}>
                  {label}
                </a>
              </li>
            ))}
            <li>
              <a href="#/tablet" target="_blank" rel="noreferrer">
                Tablet view ↗
              </a>
            </li>
          </ul>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          {st ? (
            <>
              <span className={"badge badge-sm badge-soft " + (st.ha_connected ? "badge-accent" : "badge-error")}>{st.ha_connected ? "HA linked" : "HA offline"}</span>
              {st.dry_run ? <span className="badge badge-sm badge-soft badge-warning">Dry run</span> : <span className="badge badge-sm badge-accent">Live control</span>}
              <span className={"badge badge-sm " + (st.auto_active ? "badge-accent badge-soft" : "badge-ghost")}>{st.auto_active ? "Auto" : "Manual"}</span>
              {st.hold.active ? <span className="badge badge-sm badge-error badge-soft">Holding</span> : null}
            </>
          ) : (
            <span className={"badge badge-sm " + (live.connected ? "badge-accent badge-soft" : "badge-ghost")}>{live.connected ? "connecting…" : "offline"}</span>
          )}
          <a href="#/tablet" target="_blank" rel="noreferrer" className="btn btn-ghost btn-xs hidden md:inline-flex">
            Tablet ↗
          </a>
          {boot.user ? <span className="hidden text-xs opacity-60 lg:inline">{boot.user.name}</span> : null}
        </div>
      </header>
      <main className={isPlanner ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto p-4 md:p-5"}>
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
