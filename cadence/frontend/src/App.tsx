import { useEffect, useState } from "react";
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

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("cadence.theme") || "light");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cadence.theme", theme);
  }, [theme]);
  return [theme, () => setTheme(theme === "light" ? "dark" : "light")];
}

export default function App() {
  const { route, query } = useHashRoute();
  const live = useLive();
  const st = live.status;
  const [theme, toggleTheme] = useTheme();

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
      <header className="navbar sticky top-0 z-30 min-h-14 gap-3 border-b border-base-300 bg-base-100 px-4 shadow-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight">Cadence</span>
          <span className="font-mono text-[11px] opacity-50">v{boot.version}</span>
        </div>
        <div role="tablist" className="tabs tabs-box tabs-sm ml-2 hidden md:flex">
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
          <label className="swap swap-rotate btn btn-ghost btn-sm btn-circle" title="Toggle light / dark">
            <input type="checkbox" checked={theme === "dark"} onChange={toggleTheme} />
            <svg className="swap-off h-5 w-5 fill-current" viewBox="0 0 24 24">
              <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z" />
            </svg>
            <svg className="swap-on h-5 w-5 fill-current" viewBox="0 0 24 24">
              <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z" />
            </svg>
          </label>
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
