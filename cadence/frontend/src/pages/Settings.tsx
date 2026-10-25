import {
  mdiAccountOutline,
  mdiAlertCircleOutline,
  mdiBookOpenPageVariantOutline,
  mdiCalendarMonthOutline,
  mdiClose,
  mdiCogOutline,
  mdiContentCopy,
  mdiContentSave,
  mdiGoogle,
  mdiGroup,
  mdiKeyOutline,
  mdiLightningBoltOutline,
  mdiMotionSensor,
  mdiPackageVariantClosed,
  mdiPlus,
  mdiRobotOutline,
  mdiShieldCheckOutline,
  mdiSpotify,
  mdiTabletDashboard,
  mdiWeatherSunny,
} from "@mdi/js";
import { useEffect, useState } from "react";
import { api, boot, slug, type useLive } from "../api";
import { invalidateSensorGroups } from "../components/SensorRef";
import { WindowsEditor } from "../components/StartEditor";
import { Btn, Chip, Confirm, EntityPicker, Field, Icon, IconBtn, Loading, NumberInput, Page, Row, Section, Toggle, toast, useEntities } from "../components/ui";
import type { SensorGroup, Settings, Template, ZoneGlow } from "../types";

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

  const dirty = !!s && JSON.stringify(s) !== JSON.stringify(orig);
  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const r = await api.put<Settings>("api/settings", s);
      setS(r);
      setOrig(r);
      invalidateSensorGroups(r.sensor_groups ?? []);
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

  const actions = (
    <>
      {dirty ? (
        <Btn variant="ghost" sm onClick={() => setS(orig)}>
          Discard
        </Btn>
      ) : null}
      <Btn variant="primary" disabled={!dirty || saving} icon={mdiContentSave} onClick={save}>
        Save settings
      </Btn>
    </>
  );

  if (!s)
    return (
      <Page narrow title="Settings" icon={mdiCogOutline} actions={actions}>
        <Loading />
      </Page>
    );

  const setZone = (i: number, patch: Partial<ZoneGlow>) => setS({ ...s, zones: s.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  const addonDry = live.status?.dry_run && !s.dry_run;
  const isBool = (e: { entity_id: string }) => e.entity_id.startsWith("binary_sensor.") || e.entity_id.startsWith("input_boolean.");

  return (
    <Page narrow title="Settings" icon={mdiCogOutline} actions={actions}>
      <Section icon={mdiShieldCheckOutline} title="Safety">
        <Toggle
          checked={s.dry_run}
          onChange={(v) => setS({ ...s, dry_run: v })}
          label="Dry run (log actions, don't send them)"
          help="The add-on's own Dry run option is a second guard: while it is on in the add-on configuration, nothing is sent even if this is off."
          color="warn"
          icon={mdiLightningBoltOutline}
          tone={s.dry_run ? "warn" : undefined}
        />
        {addonDry ? (
          <div className="sub" style={{ background: "color-mix(in srgb, var(--warn) 18%, transparent)" }}>
            <div className="row">
              <Icon path={mdiAlertCircleOutline} className="muted" />
              <span className="text-xs">The add-on option is currently forcing dry run. Turn it off under Settings → Add-ons → Cadence → Configuration to go live.</span>
            </div>
          </div>
        ) : null}
        <div className="fields">
          <Field label="Manual hold behaviour">
            <select className="select sm w-56" value={s.hold_mode} onChange={(e) => setS({ ...s, hold_mode: e.target.value as Settings["hold_mode"] })}>
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
        <p className="help">LED grace: keypad LED changes this soon after Cadence fires a scene are treated as Cadence's own (extended automatically by each chapter's fade time).</p>
      </Section>

      <Section
        icon={mdiBookOpenPageVariantOutline}
        title="Story"
        intro="Every day runs one template. A template chosen by hand in the planner wins; otherwise the first matching rule (Templates → Rules) takes the day; otherwise the default below. Rules that read a sensor keep checking on the day itself until the cut-off, so a quiet morning can still become a camp day when the building fills up."
      >
        <div className="form-grid">
          <Field label="Default template" help="Runs on any day no rule or manual choice takes. Leave empty and Cadence does nothing on those days.">
            <select className="select sm w-full" value={s.default_template_id ?? ""} onChange={(e) => setS({ ...s, default_template_id: e.target.value || null })}>
              <option value="">Nothing</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rules may take today until" help="After this time today's template is settled. Calendar and date rules are decided at the first check of the day; sensor rules can take over until this cut-off.">
            <input type="time" className="input sm w-40" value={s.rule_scan_until} onChange={(e) => setS({ ...s, rule_scan_until: e.target.value || "12:00" })} />
          </Field>
        </div>
        <p className="help">
          {s.rules.length} rule{s.rules.length === 1 ? "" : "s"} defined. Edit them under{" "}
          <a className="link" href="#/templates">
            Templates
          </a>
          . A day counts as occupied (for variant conditions) when a template runs on it, unless a rule or the planner says otherwise.
        </p>
      </Section>

      <Section icon={mdiRobotOutline} title="Auto mode" intro='Cadence only drives the building while auto mode is active. Combine the weekly schedule with an external Home Assistant entity (for example a template binary_sensor for "building occupied").'>
        <div className="form-grid">
          <Field label="Auto is active when">
            <select className="select sm w-full" value={s.auto_source} onChange={(e) => setS({ ...s, auto_source: e.target.value as Settings["auto_source"] })}>
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
        <div className="form-grid">
          {DAYS.map((d, i) => (
            <Field key={d} label={d}>
              <WindowsEditor value={s.auto_schedule.windows[String(i)] ?? []} onChange={(w) => setS({ ...s, auto_schedule: { windows: { ...s.auto_schedule.windows, [String(i)]: w } } })} />
            </Field>
          ))}
        </div>
        <div>
          <Btn
            sm
            variant="ghost"
            icon={mdiContentCopy}
            onClick={() => {
              const mon = s.auto_schedule.windows["0"] ?? [];
              setS({ ...s, auto_schedule: { windows: Object.fromEntries(DAYS.map((_, i) => [String(i), mon])) } });
            }}
          >
            Copy Monday to every day
          </Btn>
        </div>
      </Section>

      <Section icon={mdiWeatherSunny} title="Sky" intro="Dark when the sun is below the dark elevation or lux is under the dark threshold. Above the sunny threshold is sunny; between is cloudy. Hysteresis and dwell stop it flapping.">
        <div className="form-grid">
          <Field label="Lux sensor">
            <EntityPicker value={s.sky.lux_entity} onChange={(v) => setS({ ...s, sky: { ...s.sky, lux_entity: v } })} domain="sensor" filter={(e) => e.device_class === "illuminance" || /lux|illum/i.test(e.entity_id + e.name)} />
          </Field>
          <Field label="Weather (shown on tablet)">
            <EntityPicker value={s.sky.weather_entity} onChange={(v) => setS({ ...s, sky: { ...s.sky, weather_entity: v } })} domain="weather" />
          </Field>
        </div>
        <div className="fields">
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
          <p className="help">
            Right now: <b>{live.status.sky.state}</b> — {live.status.sky.reason}
          </p>
        ) : null}
      </Section>

      <Section icon={mdiMotionSensor} title="Building senses">
        <div className="form-grid">
          <Field label="Motion (default for motion variants)">
            <EntityPicker value={s.motion_entity} onChange={(v) => setS({ ...s, motion_entity: v })} domain="binary_sensor" />
          </Field>
          <Field label="Building asleep">
            <EntityPicker value={s.asleep_entity} onChange={(v) => setS({ ...s, asleep_entity: v })} filter={isBool} />
          </Field>
        </div>
        <p className="help">"Asleep" is usually a template binary_sensor you define in Home Assistant (e.g. no motion anywhere for 30 minutes after 21:00). See DOCS for a ready-made example.</p>
      </Section>

      <Section icon={mdiSpotify} title="Music" intro="Spotify search and playback go through the SpotifyPlus integration. Pick its media_player; Cadence auto-detects it when left empty.">
        <div className="form-grid">
          <Field label="SpotifyPlus player">
            <EntityPicker value={s.spotify_entity} onChange={(v) => setS({ ...s, spotify_entity: v })} domain="media_player" filter={(e) => e.entity_id.includes("spotify")} placeholder="media_player.spotifyplus_…" />
          </Field>
        </div>
      </Section>

      <Section icon={mdiGroup} title="Sensor groups" intro="Named sets of binary sensors that chapter starts and holds can reference (e.g. 'Lounge & dining occupied'). Edit them here, not in the planner. A group is on when any member is on, or when all are, as you choose.">
        <SensorGroupsEditor groups={s.sensor_groups ?? []} onChange={(g) => setS({ ...s, sensor_groups: g })} />
      </Section>

      <Section icon={mdiCalendarMonthOutline} title="Calendar" intro="Add the Google Calendar integration in Home Assistant first; its calendar.* entities appear here.">
        <div className="form-grid">
          <Field label="Calendars">
            <div className="flex flex-col gap-2">
              {s.calendars.length ? (
                <div className="chips">
                  {s.calendars.map((c, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <Chip className="mono">{c}</Chip>
                      <IconBtn icon={mdiClose} size="xs" label={`Remove ${c}`} onClick={() => setS({ ...s, calendars: s.calendars.filter((_, j) => j !== i) })} />
                    </span>
                  ))}
                </div>
              ) : null}
              <EntityPicker value={null} domain="calendar" placeholder="Add a calendar…" onChange={(v) => v && !s.calendars.includes(v) && setS({ ...s, calendars: [...s.calendars, v] })} />
            </div>
          </Field>
          <p className="help self-end">Events appear in the planner. To make a template follow them, add a rule under Templates → Rules with a calendar condition.</p>
        </div>
      </Section>

      <Section icon={mdiTabletDashboard} title="Tablet zones" intro="Each glow on the tablet's building photo follows a light or light group. Zone ids match the picture: cupola, clerestory, dormer, greatroom, porch, eastwing, lamps, path.">
        <div className="flex flex-col gap-2">
          {s.zones.map((z, i) => (
            <div key={i} className="fields">
              <input type="text" className="input sm mono w-28" value={z.id} onChange={(e) => setZone(i, { id: e.target.value })} aria-label="Zone id" />
              <input type="text" className="input sm w-40" value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} aria-label="Zone name" />
              <div className="min-w-56 flex-1">
                <EntityPicker value={z.entity_id} onChange={(v) => setZone(i, { entity_id: v })} filter={(e) => e.entity_id.startsWith("light.") || e.entity_id.startsWith("group.") || e.entity_id.startsWith("switch.")} />
              </div>
              <span className="tnum muted w-12 text-right text-xs">{live.zones[z.id] != null ? Math.round(live.zones[z.id]) + "%" : "—"}</span>
              <IconBtn icon={mdiClose} size="xs" danger label={`Remove ${z.name}`} onClick={() => setS({ ...s, zones: s.zones.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <button type="button" className="add-tile" onClick={() => setS({ ...s, zones: [...s.zones, { id: "zone" + (s.zones.length + 1), name: "New zone", entity_id: null }] })}>
            <Icon path={mdiPlus} /> Zone
          </button>
        </div>
      </Section>

      <Section icon={mdiPackageVariantClosed} title="Starter configurations" intro='Import a ready-made set of scenes and a template. "Add missing" only creates what is absent; "Replace" overwrites scenes/templates with the same ids and resets settings to the seed.'>
        <div className="rows">
          {seeds.map((sd) => (
            <Row
              key={sd.name}
              icon={mdiPackageVariantClosed}
              title={sd.title}
              sub={sd.description}
              right={
                <span className="join">
                  <Btn sm onClick={() => importSeed(sd.name, false)}>
                    Add missing
                  </Btn>
                  <Confirm sm text="Replace existing?" onYes={() => importSeed(sd.name, true)}>
                    Replace
                  </Confirm>
                </span>
              }
            />
          ))}
          {seeds.length === 0 ? <div className="empty">No starter configurations available.</div> : null}
        </div>
      </Section>

      <Section icon={mdiKeyOutline} title="Access">
        <div className="rows">
          <Row compact icon={mdiAccountOutline} title="Signed in via" sub={boot.user?.via ?? "—"} />
          <Row compact icon={mdiGoogle} title="Google login" sub={boot.googleLogin ? "configured (external URL)" : "not configured — set External URL, client id/secret and allowed emails in the add-on configuration"} />
          <Row compact icon={mdiTabletDashboard} title="Tablet URL" sub={<span className="mono break-all">{location.origin + location.pathname + "#/tablet"}</span>} />
        </div>
        <p className="help">For the wall tablets, add a Webpage card to their dashboard pointing at the Cadence ingress URL with #/tablet, or open the Tablet view in Fully Kiosk.</p>
      </Section>
    </Page>
  );
}

function SensorGroupsEditor({ groups, onChange }: { groups: SensorGroup[]; onChange: (g: SensorGroup[]) => void }) {
  const all = useEntities("binary_sensor");
  const nameOf = (eid: string) => all.find((e) => e.entity_id === eid)?.name ?? eid;
  const setG = (i: number, patch: Partial<SensorGroup>) => onChange(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, i) => (
        <div key={g.id} className="sub">
          <div className="fields">
            <Field label="Name" className="min-w-48 flex-1">
              <input type="text" className="input sm w-full" value={g.name} onChange={(e) => setG(i, { name: e.target.value })} />
            </Field>
            <Field label="On when">
              <select className="select sm w-44" value={g.mode} onChange={(e) => setG(i, { mode: e.target.value as "any" | "all" })}>
                <option value="any">any member is on</option>
                <option value="all">all members are on</option>
              </select>
            </Field>
            <Field label="Description" className="min-w-56 flex-1">
              <input type="text" className="input sm w-full" value={g.description} onChange={(e) => setG(i, { description: e.target.value })} placeholder="What this group means" />
            </Field>
            <Chip sm className="mono">
              group:{g.id}
            </Chip>
            <Confirm iconOnly icon={mdiClose} sm text="Remove group?" onYes={() => onChange(groups.filter((_, j) => j !== i))}>
              Remove group
            </Confirm>
          </div>
          <div className="chips">
            {g.entities.map((eid) => (
              <Chip key={eid} title={eid}>
                {nameOf(eid)}
                <button type="button" className="ml-1 inline-flex opacity-60 hover:opacity-100" onClick={() => setG(i, { entities: g.entities.filter((x) => x !== eid) })} aria-label={`Remove ${eid}`}>
                  <Icon path={mdiClose} size="xs" />
                </button>
              </Chip>
            ))}
            <div className="min-w-64 flex-1">
              <EntityPicker value={null} placeholder="Add a binary sensor, group or input_boolean…" filter={(e) => /^(binary_sensor|input_boolean|group)\./.test(e.entity_id) && !g.entities.includes(e.entity_id)} onChange={(v) => v && setG(i, { entities: [...g.entities, v] })} />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="add-tile"
        onClick={() => {
          const name = window.prompt("Group name", "Lounge occupied");
          if (!name) return;
          let id = slug(name);
          if (groups.some((g) => g.id === id)) id += "_" + Date.now().toString(36);
          onChange([...groups, { id, name, entities: [], mode: "any", description: "" }]);
        }}
      >
        <Icon path={mdiPlus} /> Sensor group
      </button>
    </div>
  );
}
