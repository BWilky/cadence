import { useEffect, useState } from "react";
import { api, boot, type useLive } from "../api";
import { WindowsEditor } from "../components/StartEditor";
import { Confirm, EntityPicker, NumberInput, Toggle, toast } from "../components/ui";
import type { Settings, Template, ZoneGlow } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SettingsPage({ live }: { live: ReturnType<typeof useLive> }) {
  const [s, setS] = useState<Settings | null>(null);
  const [orig, setOrig] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [seeds, setSeeds] = useState<{ name: string; title: string; description: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [st, t, sd] = await Promise.all([api.get<Settings>("api/settings"), api.get<Template[]>("api/templates"), api.get<typeof seeds>("api/seeds")]);
    setS(st);
    setOrig(st);
    setTemplates(t);
    setSeeds(sd);
  };
  useEffect(() => {
    load().catch((e) => toast(e.message, true));
  }, []);
  if (!s) return <div className="empty">Loading…</div>;
  const dirty = JSON.stringify(s) !== JSON.stringify(orig);
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<Settings>("api/settings", s);
      setS(r);
      setOrig(r);
      toast("Settings saved");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const importSeed = async (name: string, replace: boolean) => {
    try {
      const r = await api.post<{ scenes: number; templates: number }>("api/seeds/import", { name, replace });
      toast(`Imported ${r.scenes} scenes, ${r.templates} templates`);
      await load();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const setZone = (i: number, patch: Partial<ZoneGlow>) => setS({ ...s, zones: s.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  const addonDry = live.status?.dry_run && !s.dry_run;

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="row between">
        <h2 className="serif" style={{ fontStyle: "italic", margin: 0, fontWeight: 400 }}>
          Settings
        </h2>
        <div className="row">
          <button className="btn primary" disabled={!dirty || saving} onClick={save}>
            Save settings
          </button>
          {dirty ? (
            <button className="btn ghost" onClick={() => setS(orig)}>
              Discard
            </button>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h3>Safety</h3>
        <Toggle checked={s.dry_run} onChange={(v) => setS({ ...s, dry_run: v })} label="Dry run (log actions, don't send them)" help="The add-on's own Dry run option is a second guard: while it is on in the add-on configuration, nothing is sent even if this is off." />
        {addonDry ? <div className="help lamp">The add-on option is currently forcing dry run. Turn it off under Settings → Add-ons → Cadence → Configuration to go live.</div> : null}
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Manual hold behaviour</label>
            <select value={s.hold_mode} onChange={(e) => setS({ ...s, hold_mode: e.target.value as Settings["hold_mode"] })}>
              <option value="next_chapter">Hold until the next chapter</option>
              <option value="timeout">Hold for a fixed time</option>
            </select>
          </div>
          {s.hold_mode === "timeout" ? (
            <div className="field">
              <label>Hold minutes</label>
              <NumberInput value={s.hold_timeout_minutes} onChange={(v) => setS({ ...s, hold_timeout_minutes: v ?? 60 })} min={1} />
            </div>
          ) : null}
          <div className="field">
            <label>LED grace (s)</label>
            <NumberInput value={s.override_grace_seconds} onChange={(v) => setS({ ...s, override_grace_seconds: v ?? 120 })} min={10} />
          </div>
          <div className="field">
            <label>Tick (s)</label>
            <NumberInput value={s.tick_seconds} onChange={(v) => setS({ ...s, tick_seconds: v ?? 15 })} min={5} max={120} />
          </div>
        </div>
        <div className="help">LED grace: keypad LED changes this soon after Cadence fires a scene are treated as Cadence's own (extended automatically by each chapter's fade time).</div>
      </div>

      <div className="card">
        <h3>Story</h3>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Site name (tablet title)</label>
            <input type="text" value={s.site_name} onChange={(e) => setS({ ...s, site_name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Default template</label>
            <select value={s.default_template_id ?? ""} onChange={(e) => setS({ ...s, default_template_id: e.target.value || null })}>
              <option value="">— none —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Auto mode</h3>
        <div className="help" style={{ marginBottom: 8 }}>
          Cadence only drives the building while auto mode is active. Combine the weekly schedule with an external Home Assistant entity (for example a template binary_sensor for "building occupied").
        </div>
        <div className="row">
          <div className="field">
            <label>Auto is active when</label>
            <select value={s.auto_source} onChange={(e) => setS({ ...s, auto_source: e.target.value as Settings["auto_source"] })}>
              <option value="either">schedule OR entity says so</option>
              <option value="schedule">the weekly schedule says so</option>
              <option value="entity">the entity is on</option>
              <option value="always">always</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 260 }}>
            <label>External auto entity</label>
            <EntityPicker value={s.auto_entity} onChange={(v) => setS({ ...s, auto_entity: v })} filter={(e) => e.entity_id.startsWith("binary_sensor.") || e.entity_id.startsWith("input_boolean.") || e.entity_id.startsWith("switch.")} placeholder="binary_sensor / input_boolean…" />
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 10 }}>
          {DAYS.map((d, i) => (
            <div key={d} className="field">
              <label>{d}</label>
              <WindowsEditor value={s.auto_schedule.windows[String(i)] ?? []} onChange={(w) => setS({ ...s, auto_schedule: { windows: { ...s.auto_schedule.windows, [String(i)]: w } } })} />
            </div>
          ))}
        </div>
        <button
          className="btn sm ghost"
          onClick={() => {
            const mon = s.auto_schedule.windows["0"] ?? [];
            setS({ ...s, auto_schedule: { windows: Object.fromEntries(DAYS.map((_, i) => [String(i), mon])) } });
          }}
        >
          Copy Monday to every day
        </button>
      </div>

      <div className="card">
        <h3>Sky</h3>
        <div className="help" style={{ marginBottom: 8 }}>
          Dark when the sun is below the dark elevation or lux is under the dark threshold. Above the sunny threshold is sunny; between is cloudy. Hysteresis and dwell stop it flapping.
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Lux sensor</label>
            <EntityPicker value={s.sky.lux_entity} onChange={(v) => setS({ ...s, sky: { ...s.sky, lux_entity: v } })} domain="sensor" filter={(e) => e.device_class === "illuminance" || /lux|illum/i.test(e.entity_id + e.name)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Weather (shown on tablet)</label>
            <EntityPicker value={s.sky.weather_entity} onChange={(v) => setS({ ...s, sky: { ...s.sky, weather_entity: v } })} domain="weather" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Dark below sun °</label>
            <NumberInput value={s.sky.dark_elevation} onChange={(v) => setS({ ...s, sky: { ...s.sky, dark_elevation: v ?? -3 } })} step={0.5} />
          </div>
          <div className="field">
            <label>Dark below lux</label>
            <NumberInput value={s.sky.dark_lux} onChange={(v) => setS({ ...s, sky: { ...s.sky, dark_lux: v ?? 30 } })} />
          </div>
          <div className="field">
            <label>Sunny above lux</label>
            <NumberInput value={s.sky.sunny_lux} onChange={(v) => setS({ ...s, sky: { ...s.sky, sunny_lux: v ?? 400 } })} />
          </div>
          <div className="field">
            <label>Hysteresis %</label>
            <NumberInput value={s.sky.hysteresis_pct} onChange={(v) => setS({ ...s, sky: { ...s.sky, hysteresis_pct: v ?? 15 } })} />
          </div>
          <div className="field">
            <label>Dwell min</label>
            <NumberInput value={s.sky.min_dwell_minutes} onChange={(v) => setS({ ...s, sky: { ...s.sky, min_dwell_minutes: v ?? 10 } })} />
          </div>
          <div className="field">
            <label>Stale after min</label>
            <NumberInput value={s.sky.stale_minutes} onChange={(v) => setS({ ...s, sky: { ...s.sky, stale_minutes: v ?? 30 } })} />
          </div>
        </div>
        {live.status ? (
          <div className="help" style={{ marginTop: 6 }}>
            Right now: <b>{live.status.sky.state}</b> — {live.status.sky.reason}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>Building senses</h3>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Motion (default for motion variants)</label>
            <EntityPicker value={s.motion_entity} onChange={(v) => setS({ ...s, motion_entity: v })} domain="binary_sensor" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Building asleep</label>
            <EntityPicker value={s.asleep_entity} onChange={(v) => setS({ ...s, asleep_entity: v })} filter={(e) => e.entity_id.startsWith("binary_sensor.") || e.entity_id.startsWith("input_boolean.")} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Property occupied (today fallback)</label>
            <EntityPicker value={s.occupied_entity} onChange={(v) => setS({ ...s, occupied_entity: v })} filter={(e) => e.entity_id.startsWith("binary_sensor.") || e.entity_id.startsWith("input_boolean.")} />
          </div>
        </div>
        <div className="help" style={{ marginTop: 6 }}>
          "Asleep" is usually a template binary_sensor you define in Home Assistant (e.g. no motion anywhere for 30 minutes after 21:00). See DOCS for a ready-made example.
        </div>
      </div>

      <div className="card">
        <h3>Calendar</h3>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="field" style={{ flex: 1, minWidth: 260 }}>
            <label>Calendars</label>
            <div className="stack" style={{ gap: 4 }}>
              {s.calendars.map((c, i) => (
                <div key={i} className="row">
                  <span className="mono small" style={{ flex: 1 }}>
                    {c}
                  </span>
                  <button className="btn sm ghost" onClick={() => setS({ ...s, calendars: s.calendars.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              ))}
              <EntityPicker value={null} domain="calendar" placeholder="Add a calendar…" onChange={(v) => v && !s.calendars.includes(v) && setS({ ...s, calendars: [...s.calendars, v] })} />
            </div>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 260 }}>
            <label>Occupied when an event title contains (comma separated; empty = any event)</label>
            <input type="text" value={s.calendar_keywords.join(", ")} onChange={(e) => setS({ ...s, calendar_keywords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </div>
        </div>
        <div className="help" style={{ marginTop: 6 }}>Add the Google Calendar integration in Home Assistant first; its calendar.* entities appear here.</div>
      </div>

      <div className="card">
        <h3>Tablet zones</h3>
        <div className="help" style={{ marginBottom: 8 }}>
          Each glow on the tablet's building photo follows a light or light group. Zone ids match the picture: cupola, clerestory, dormer, greatroom, porch, eastwing, lamps, path.
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {s.zones.map((z, i) => (
            <div key={i} className="row">
              <input type="text" value={z.id} onChange={(e) => setZone(i, { id: e.target.value })} style={{ width: 110 }} />
              <input type="text" value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} style={{ width: 150 }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <EntityPicker value={z.entity_id} onChange={(v) => setZone(i, { entity_id: v })} filter={(e) => e.entity_id.startsWith("light.") || e.entity_id.startsWith("group.") || e.entity_id.startsWith("switch.")} />
              </div>
              <span className="mono small text-2" style={{ width: 44, textAlign: "right" }}>
                {live.zones[z.id] != null ? Math.round(live.zones[z.id]) + "%" : "—"}
              </span>
              <button className="btn sm ghost danger" onClick={() => setS({ ...s, zones: s.zones.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setS({ ...s, zones: [...s.zones, { id: "zone" + (s.zones.length + 1), name: "New zone", entity_id: null }] })}>
            + Zone
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Starter configurations</h3>
        <div className="help" style={{ marginBottom: 8 }}>
          Import a ready-made set of scenes and a template. "Add" only creates what is missing; "Replace" overwrites scenes/templates with the same ids and resets settings to the seed's.
        </div>
        <div className="stack">
          {seeds.map((sd) => (
            <div key={sd.name} className="row between" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div>
                <div>{sd.title}</div>
                <div className="help">{sd.description}</div>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => importSeed(sd.name, false)}>
                  Add missing
                </button>
                <Confirm text="Replace existing?" onYes={() => importSeed(sd.name, true)}>
                  Replace
                </Confirm>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Access</h3>
        <div className="kv">
          <span className="k">Signed in via</span>
          <span>{boot.user?.via ?? "—"}</span>
          <span className="k">Google login</span>
          <span>{boot.googleLogin ? "configured (external URL)" : "not configured — set External URL, client id/secret and allowed emails in the add-on configuration"}</span>
          <span className="k">Tablet URL</span>
          <span className="mono small">{location.origin + location.pathname + "#/tablet"}</span>
        </div>
        <div className="help" style={{ marginTop: 6 }}>For the wall tablets, add a Webpage card to their dashboard pointing at the Cadence ingress URL with #/tablet, or open the Tablet tab in Fully Kiosk.</div>
      </div>
    </div>
  );
}
