import { useEffect, useState } from "react";
import { api, boot, type useLive } from "../api";
import { WindowsEditor } from "../components/StartEditor";
import { Confirm, EntityPicker, Field, NumberInput, Toggle, toast } from "../components/ui";
import type { Settings, Template, ZoneGlow } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Section({ title, children, intro }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3">
        <h3 className="card-title text-base">{title}</h3>
        {intro ? <p className="-mt-1 text-xs opacity-60">{intro}</p> : null}
        {children}
      </div>
    </div>
  );
}

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
  if (!s)
    return (
      <div className="flex h-40 items-center justify-center">
        <span className="loading loading-ring" />
      </div>
    );
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
  const isBool = (e: { entity_id: string }) => e.entity_id.startsWith("binary_sensor.") || e.entity_id.startsWith("input_boolean.");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 bg-base-200/95 px-1 py-2 backdrop-blur">
        <h2 className="display text-2xl">Settings</h2>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
            Save settings
          </button>
          {dirty ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setS(orig)}>
              Discard
            </button>
          ) : null}
        </div>
      </div>

      <Section title="Safety">
        <Toggle checked={s.dry_run} onChange={(v) => setS({ ...s, dry_run: v })} label="Dry run (log actions, don't send them)" help="The add-on's own Dry run option is a second guard: while it is on in the add-on configuration, nothing is sent even if this is off." color="toggle-warning" />
        {addonDry ? (
          <div role="alert" className="alert alert-soft alert-warning py-2 text-xs">
            The add-on option is currently forcing dry run. Turn it off under Settings → Add-ons → Cadence → Configuration to go live.
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Manual hold behaviour">
            <select className="select select-sm w-56" value={s.hold_mode} onChange={(e) => setS({ ...s, hold_mode: e.target.value as Settings["hold_mode"] })}>
              <option value="next_chapter">Hold until the next chapter</option>
              <option value="timeout">Hold for a fixed time</option>
            </select>
          </Field>
          {s.hold_mode === "timeout" ? (
            <Field label="Hold minutes">
              <NumberInput value={s.hold_timeout_minutes} onChange={(v) => setS({ ...s, hold_timeout_minutes: v ?? 60 })} min={1} />
            </Field>
          ) : null}
          <Field label="LED grace (s)">
            <NumberInput value={s.override_grace_seconds} onChange={(v) => setS({ ...s, override_grace_seconds: v ?? 120 })} min={10} />
          </Field>
          <Field label="Tick (s)">
            <NumberInput value={s.tick_seconds} onChange={(v) => setS({ ...s, tick_seconds: v ?? 15 })} min={5} max={120} />
          </Field>
        </div>
        <p className="text-xs opacity-60">LED grace: keypad LED changes this soon after Cadence fires a scene are treated as Cadence's own (extended automatically by each chapter's fade time).</p>
      </Section>

      <Section title="Story">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Site name (tablet title)">
            <input type="text" className="input input-sm w-full" value={s.site_name} onChange={(e) => setS({ ...s, site_name: e.target.value })} />
          </Field>
          <Field label="Default template">
            <select className="select select-sm w-full" value={s.default_template_id ?? ""} onChange={(e) => setS({ ...s, default_template_id: e.target.value || null })}>
              <option value="">— none —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Auto mode" intro='Cadence only drives the building while auto mode is active. Combine the weekly schedule with an external Home Assistant entity (for example a template binary_sensor for "building occupied").'>
        <div className="grid gap-3 md:grid-cols-[auto_1fr]">
          <Field label="Auto is active when">
            <select className="select select-sm w-64" value={s.auto_source} onChange={(e) => setS({ ...s, auto_source: e.target.value as Settings["auto_source"] })}>
              <option value="either">schedule OR entity says so</option>
              <option value="schedule">the weekly schedule says so</option>
              <option value="entity">the entity is on</option>
              <option value="always">always</option>
            </select>
          </Field>
          <Field label="External auto entity">
            <EntityPicker value={s.auto_entity} onChange={(v) => setS({ ...s, auto_entity: v })} filter={(e) => isBool(e) || e.entity_id.startsWith("switch.")} placeholder="binary_sensor / input_boolean…" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {DAYS.map((d, i) => (
            <Field key={d} label={d}>
              <WindowsEditor value={s.auto_schedule.windows[String(i)] ?? []} onChange={(w) => setS({ ...s, auto_schedule: { windows: { ...s.auto_schedule.windows, [String(i)]: w } } })} />
            </Field>
          ))}
        </div>
        <button
          className="btn btn-xs btn-ghost self-start"
          onClick={() => {
            const mon = s.auto_schedule.windows["0"] ?? [];
            setS({ ...s, auto_schedule: { windows: Object.fromEntries(DAYS.map((_, i) => [String(i), mon])) } });
          }}
        >
          Copy Monday to every day
        </button>
      </Section>

      <Section title="Sky" intro="Dark when the sun is below the dark elevation or lux is under the dark threshold. Above the sunny threshold is sunny; between is cloudy. Hysteresis and dwell stop it flapping.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Lux sensor">
            <EntityPicker value={s.sky.lux_entity} onChange={(v) => setS({ ...s, sky: { ...s.sky, lux_entity: v } })} domain="sensor" filter={(e) => e.device_class === "illuminance" || /lux|illum/i.test(e.entity_id + e.name)} />
          </Field>
          <Field label="Weather (shown on tablet)">
            <EntityPicker value={s.sky.weather_entity} onChange={(v) => setS({ ...s, sky: { ...s.sky, weather_entity: v } })} domain="weather" />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Dark below sun °">
            <NumberInput value={s.sky.dark_elevation} onChange={(v) => setS({ ...s, sky: { ...s.sky, dark_elevation: v ?? -3 } })} step={0.5} />
          </Field>
          <Field label="Dark below lux">
            <NumberInput value={s.sky.dark_lux} onChange={(v) => setS({ ...s, sky: { ...s.sky, dark_lux: v ?? 30 } })} />
          </Field>
          <Field label="Sunny above lux">
            <NumberInput value={s.sky.sunny_lux} onChange={(v) => setS({ ...s, sky: { ...s.sky, sunny_lux: v ?? 400 } })} />
          </Field>
          <Field label="Hysteresis %">
            <NumberInput value={s.sky.hysteresis_pct} onChange={(v) => setS({ ...s, sky: { ...s.sky, hysteresis_pct: v ?? 15 } })} />
          </Field>
          <Field label="Dwell min">
            <NumberInput value={s.sky.min_dwell_minutes} onChange={(v) => setS({ ...s, sky: { ...s.sky, min_dwell_minutes: v ?? 10 } })} />
          </Field>
          <Field label="Stale after min">
            <NumberInput value={s.sky.stale_minutes} onChange={(v) => setS({ ...s, sky: { ...s.sky, stale_minutes: v ?? 30 } })} />
          </Field>
        </div>
        {live.status ? (
          <p className="text-xs opacity-70">
            Right now: <b>{live.status.sky.state}</b> — {live.status.sky.reason}
          </p>
        ) : null}
      </Section>

      <Section title="Building senses">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Motion (default for motion variants)">
            <EntityPicker value={s.motion_entity} onChange={(v) => setS({ ...s, motion_entity: v })} domain="binary_sensor" />
          </Field>
          <Field label="Building asleep">
            <EntityPicker value={s.asleep_entity} onChange={(v) => setS({ ...s, asleep_entity: v })} filter={isBool} />
          </Field>
          <Field label="Property occupied (today fallback)">
            <EntityPicker value={s.occupied_entity} onChange={(v) => setS({ ...s, occupied_entity: v })} filter={isBool} />
          </Field>
        </div>
        <p className="text-xs opacity-60">"Asleep" is usually a template binary_sensor you define in Home Assistant (e.g. no motion anywhere for 30 minutes after 21:00). See DOCS for a ready-made example.</p>
      </Section>

      <Section title="Music" intro="Spotify search and playback go through the SpotifyPlus integration. Pick its media_player; Cadence auto-detects it when left empty.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="SpotifyPlus player">
            <EntityPicker value={s.spotify_entity} onChange={(v) => setS({ ...s, spotify_entity: v })} domain="media_player" filter={(e) => e.entity_id.includes("spotify")} placeholder="media_player.spotifyplus_…" />
          </Field>
        </div>
      </Section>

      <Section title="Calendar" intro="Add the Google Calendar integration in Home Assistant first; its calendar.* entities appear here.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Calendars">
            <div className="flex flex-col gap-1.5">
              {s.calendars.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="badge badge-ghost font-mono text-xs">{c}</span>
                  <button className="btn btn-ghost btn-xs" onClick={() => setS({ ...s, calendars: s.calendars.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              <EntityPicker value={null} domain="calendar" placeholder="Add a calendar…" onChange={(v) => v && !s.calendars.includes(v) && setS({ ...s, calendars: [...s.calendars, v] })} />
            </div>
          </Field>
          <Field label="Occupied when an event title contains (comma separated; empty = any event)">
            <input type="text" className="input input-sm w-full" value={s.calendar_keywords.join(", ")} onChange={(e) => setS({ ...s, calendar_keywords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </Field>
        </div>
      </Section>

      <Section title="Tablet zones" intro="Each glow on the tablet's building photo follows a light or light group. Zone ids match the picture: cupola, clerestory, dormer, greatroom, porch, eastwing, lamps, path.">
        <div className="flex flex-col gap-2">
          {s.zones.map((z, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input type="text" className="input input-sm w-28 font-mono" value={z.id} onChange={(e) => setZone(i, { id: e.target.value })} />
              <input type="text" className="input input-sm w-40" value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} />
              <div className="min-w-56 flex-1">
                <EntityPicker value={z.entity_id} onChange={(v) => setZone(i, { entity_id: v })} filter={(e) => e.entity_id.startsWith("light.") || e.entity_id.startsWith("group.") || e.entity_id.startsWith("switch.")} />
              </div>
              <span className="w-12 text-right font-mono text-xs opacity-70">{live.zones[z.id] != null ? Math.round(live.zones[z.id]) + "%" : "—"}</span>
              <button className="btn btn-ghost btn-xs text-error" onClick={() => setS({ ...s, zones: s.zones.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-sm btn-outline self-start" onClick={() => setS({ ...s, zones: [...s.zones, { id: "zone" + (s.zones.length + 1), name: "New zone", entity_id: null }] })}>
            + Zone
          </button>
        </div>
      </Section>

      <Section title="Starter configurations" intro='Import a ready-made set of scenes and a template. "Add missing" only creates what is absent; "Replace" overwrites scenes/templates with the same ids and resets settings to the seed.'>
        <div className="flex flex-col divide-y divide-base-300">
          {seeds.map((sd) => (
            <div key={sd.name} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div>
                <div className="text-sm">{sd.title}</div>
                <div className="text-xs opacity-60">{sd.description}</div>
              </div>
              <div className="join">
                <button className="btn btn-sm btn-outline join-item" onClick={() => importSeed(sd.name, false)}>
                  Add missing
                </button>
                <Confirm text="Replace existing?" onYes={() => importSeed(sd.name, true)} className="btn btn-sm btn-outline btn-error join-item">
                  Replace
                </Confirm>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Access">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <span className="opacity-50">Signed in via</span>
          <span>{boot.user?.via ?? "—"}</span>
          <span className="opacity-50">Google login</span>
          <span>{boot.googleLogin ? "configured (external URL)" : "not configured — set External URL, client id/secret and allowed emails in the add-on configuration"}</span>
          <span className="opacity-50">Tablet URL</span>
          <span className="font-mono text-xs break-all">{location.origin + location.pathname + "#/tablet"}</span>
        </div>
        <p className="text-xs opacity-60">For the wall tablets, add a Webpage card to their dashboard pointing at the Cadence ingress URL with #/tablet, or open the Tablet view in Fully Kiosk.</p>
      </Section>
    </div>
  );
}
