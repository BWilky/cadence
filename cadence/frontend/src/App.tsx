import { mdiBookOpenPageVariantOutline, mdiCalendarMonthOutline, mdiCogOutline, mdiHistory, mdiHomeAssistant, mdiLightningBoltOutline, mdiOpenInNew, mdiPaletteOutline, mdiPlayCircleOutline, mdiThemeLightDark } from "@mdi/js";
import { useEffect, useState } from "react";
import { boot, useHashRoute, useLive } from "./api";
import { Chip, Icon, Toaster } from "./components/ui";
import { Log } from "./pages/Log";
import { Now } from "./pages/Now";
import { Planner } from "./pages/Planner";
import { Scenes } from "./pages/Scenes";
import { SettingsPage } from "./pages/Settings";
import { Tablet } from "./pages/Tablet";
import { Templates } from "./pages/Templates";

const NAV: { route: string; label: string; icon: string }[] = [
  { route: "now", label: "Now", icon: mdiPlayCircleOutline },
  { route: "planner", label: "Planner", icon: mdiCalendarMonthOutline },
  { route: "templates", label: "Templates", icon: mdiBookOpenPageVariantOutline },
  { route: "scenes", label: "Scenes", icon: mdiPaletteOutline },
  { route: "settings", label: "Settings", icon: mdiCogOutline },
  { route: "log", label: "Activity", icon: mdiHistory },
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
  const current = NAV.some((n) => n.route === route) ? route : "now";

  // One chip summarising the engine, like "1 offline" / "Paused" on the sheets.
  const chip = !st ? (
    <Chip tone={live.connected ? undefined : "warn"}>{live.connected ? "connecting…" : "offline"}</Chip>
  ) : st.hold.active ? (
    <Chip tone="warn">Holding</Chip>
  ) : st.auto_active ? (
    <Chip tone="on">{st.dry_run ? "Auto · dry run" : "Auto"}</Chip>
  ) : (
    <Chip>Manual</Chip>
  );

  const link = (n: (typeof NAV)[number], cls: string) => (
    <a key={n.route} href={"#/" + n.route} className={cls + (current === n.route ? " on" : "")} aria-current={current === n.route ? "page" : undefined}>
      <Icon path={n.icon} />
      <span className="nav-name">{n.label}</span>
    </a>
  );

  return (
    <div className="app">
      <aside className="side">
        <div className="side-head">
          <span className="side-title">Cadence</span>
          {chip}
        </div>
        <nav>{NAV.map((n) => link(n, "nav-item"))}</nav>
        <div className="side-spacer" />
        <nav>
          <a href="#/tablet" target="_blank" rel="noreferrer" className="nav-item">
            <Icon path={mdiOpenInNew} />
            <span className="nav-name">Tablet view</span>
          </a>
          <button type="button" className="nav-item" onClick={toggleTheme}>
            <Icon path={mdiThemeLightDark} />
            <span className="nav-name">{theme === "dark" ? "Dark" : "Light"} theme</span>
          </button>
        </nav>
        <div className="mini" title={st ? (st.ha_connected ? "Connected to Home Assistant" : "Home Assistant is not reachable") : "Waiting for the engine"}>
          <span className={"mini-ic " + (st ? (st.ha_connected ? (st.dry_run ? "warn" : "ok") : "bad") : "")}>
            <Icon path={st?.dry_run ? mdiLightningBoltOutline : mdiHomeAssistant} />
          </span>
          <span className="mini-text">
            <span>{st ? (st.ha_connected ? (st.dry_run ? "Dry run" : "Live control") : "HA offline") : "Connecting"}</span>
            <small>
              v{boot.version}
              {boot.user ? ` · ${boot.user.name}` : ""}
            </small>
          </span>
        </div>
      </aside>

      <main className="content">
        <div className="topbar">
          <span className="side-title">Cadence</span>
          {chip}
          <button type="button" className="icon-btn sm" onClick={toggleTheme} aria-label="Toggle light / dark">
            <Icon path={mdiThemeLightDark} />
          </button>
        </div>
        {current === "now" && <Now live={live} />}
        {isPlanner && <Planner live={live} />}
        {current === "templates" && <Templates />}
        {current === "scenes" && <Scenes />}
        {current === "settings" && <SettingsPage live={live} />}
        {current === "log" && <Log live={live} />}
        <nav className="tabbar">{NAV.map((n) => link(n, ""))}</nav>
      </main>
      <Toaster />
    </div>
  );
}
