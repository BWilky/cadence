import { mdiClose, mdiLightbulbGroupOutline, mdiMusicNote, mdiPaletteOutline, mdiPlay, mdiPlus, mdiSpeakerMultiple, mdiSpotify, mdiTrashCanOutline, mdiTuneVertical } from "@mdi/js";
import { useEffect, useRef, useState } from "react";
import { api, slug } from "../api";
import { MusicRow } from "../components/MusicRow";
import { Btn, COLORS, Chip, ColorDots, Confirm, EntityPicker, Field, Fold, Icon, IconBtn, NumberInput, Page, Section, Slider, loadEntities, toast, useEntities } from "../components/ui";
import type { CadenceScene, HAAction, MusicAction, MusicKind, SceneLink, Settings } from "../types";

export function Scenes() {
  const [list, setList] = useState<CadenceScene[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const reload = async () => {
    const [s, st] = await Promise.all([api.get<CadenceScene[]>("api/scenes"), api.get<Settings>("api/settings")]);
    setList(s);
    setSettings(st);
  };
  useEffect(() => {
    reload().catch((e) => toast(e.message, true));
  }, []);
  const create = async () => {
    const name = window.prompt("Scene name", "New scene");
    if (!name) return;
    let id = slug(name);
    if (list.some((s) => s.id === id)) id += "_" + Date.now().toString(36);
    const s: CadenceScene = { id, name, description: "", color: COLORS[list.length % COLORS.length], ha_scenes: [], music: [], extra_actions: [], zone_levels: {} };
    await api.put(`api/scenes/${id}`, s);
    await reload();
    setSel(id);
  };
  const current = list.find((s) => s.id === sel) ?? null;
  return (
    <Page title="Scenes" icon={mdiPaletteOutline}>
      <div className="cols split">
        <Section icon={mdiPaletteOutline} title="Scenes" count={`${list.length}`} actions={<IconBtn icon={mdiPlus} label="New scene" size="sm" soft onClick={() => create().catch((e) => toast(e.message, true))} />}>
          <p className="help">A Cadence scene is a look for the building: one or more Home Assistant scenes (RA2 phantom buttons, WiZ scenes…) plus what the music should do.</p>
          <div className="list">
            {list.map((s) => (
              <button key={s.id} type="button" className={"list-item" + (s.id === sel ? " on" : "")} onClick={() => setSel(s.id)}>
                <span className="swatch" style={{ background: s.color ?? "#556" }} />
                <span className="lt">
                  <span>{s.name}</span>
                  <small>
                    {s.ha_scenes.length} HA scene{s.ha_scenes.length === 1 ? "" : "s"} · {s.music.length} music
                  </small>
                </span>
              </button>
            ))}
            {list.length === 0 ? <div className="empty">No scenes yet.</div> : null}
          </div>
        </Section>
        {current && settings ? (
          <SceneEditor
            key={current.id}
            scene={current}
            settings={settings}
            onSaved={reload}
            onDeleted={() => {
              setSel(null);
              reload();
            }}
          />
        ) : (
          <Section>
            <div className="empty">Select or create a scene.</div>
          </Section>
        )}
      </div>
    </Page>
  );
}

const BOSE_BULK: [string, (e: string) => MusicAction][] = [
  ["Fade all zones to a level", (e) => ({ kind: "volume_fade" as MusicKind, entity_id: e, volume: 0.1, minutes: 10, from_zero: false, delay_seconds: 0 })],
  ["Fade all zones up from zero", (e) => ({ kind: "volume_fade" as MusicKind, entity_id: e, volume: 0.1, minutes: 10, from_zero: true, delay_seconds: 0 })],
  ["Mute all zones", (e) => ({ kind: "mute" as MusicKind, entity_id: e, delay_seconds: 0 })],
  ["Unmute all zones", (e) => ({ kind: "unmute" as MusicKind, entity_id: e, delay_seconds: 0 })],
  ["Set every zone's source", (e) => ({ kind: "source" as MusicKind, entity_id: e, source: "Sonos", delay_seconds: 0 })],
];

function SceneEditor(props: { scene: CadenceScene; settings: Settings; onSaved: () => Promise<void>; onDeleted: () => void }) {
  const [s, setS] = useState<CadenceScene>(props.scene);
  const [saving, setSaving] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [boseOpen, setBoseOpen] = useState(false);
  const [levels, setLevels] = useState<Record<string, number>>({}); // live slider values while dragging
  const boseRef = useRef<HTMLDivElement>(null);
  const switches = useEntities("switch");
  const dirty = JSON.stringify(s) !== JSON.stringify(props.scene);

  useEffect(() => {
    if (!boseOpen) return;
    const down = (e: MouseEvent) => {
      if (!boseRef.current?.contains(e.target as Node)) setBoseOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setBoseOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [boseOpen]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`api/scenes/${s.id}`, s);
      await props.onSaved();
      toast("Scene saved");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    try {
      if (dirty) await api.put(`api/scenes/${s.id}`, s);
      const r = await api.post<{ dry_run: boolean }>(`api/scenes/${s.id}/test`);
      toast(r.dry_run ? "Dry run: actions logged under Activity" : "Scene fired");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async () => {
    try {
      await api.del(`api/scenes/${s.id}`);
      props.onDeleted();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const setLink = (i: number, patch: Partial<SceneLink>) => setS({ ...s, ha_scenes: s.ha_scenes.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const guessLed = (sceneEntity: string): string | null => {
    const tail = sceneEntity.replace(/^scene\./, "");
    const hit = switches.find((sw) => sw.entity_id === "switch." + tail);
    return hit ? hit.entity_id : null;
  };
  const setMusic = (i: number, patch: Partial<MusicAction>) => setS({ ...s, music: s.music.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const setExtra = (i: number, patch: Partial<HAAction>) => setS({ ...s, extra_actions: s.extra_actions.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const addBose = async (make: (e: string) => MusicAction) => {
    setBoseOpen(false);
    const players = (await loadEntities("media_player")).filter((p) => p.entity_id.includes("bose_csp"));
    if (!players.length) return toast("No Bose CSP players found", true);
    setS({ ...s, music: [...s.music, ...players.map((p) => make(p.entity_id))] });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input type="text" className="input title flex-1" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} aria-label="Scene name" />
          <div className="flex items-center gap-2">
            <Btn variant="on" icon={mdiPlay} onClick={test} title="Fire this scene now (respects dry run)">
              Test now
            </Btn>
            <Confirm text="Delete scene?" onYes={remove} icon={mdiTrashCanOutline}>
              Delete
            </Confirm>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Chip sm className="mono">
            {s.id}
          </Chip>
          <ColorDots value={s.color} onChange={(col) => setS({ ...s, color: col })} />
        </div>
        <textarea className="textarea w-full" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} placeholder="What does this look like, when is it used?" />
      </Section>

      <Section icon={mdiLightbulbGroupOutline} title="Home Assistant scenes" count={`${s.ha_scenes.length}`} intro="Each is activated with scene.turn_on. For RA2 phantom buttons, pick the keypad LED switch that lights when the scene is active — Cadence uses it to see fades finish and to notice when someone changes the lights by hand.">
        {s.ha_scenes.map((l, i) => (
          <div key={i} className="sub">
            <div className="fields">
              <Field label="Scene" className="min-w-56 flex-1">
                <EntityPicker
                  value={l.entity_id}
                  domain="scene"
                  allowClear={false}
                  onChange={(v) => {
                    if (!v) return;
                    setLink(i, { entity_id: v, led_entity: l.led_entity ?? guessLed(v) });
                  }}
                />
              </Field>
              <Field label="Active LED (optional)" className="min-w-56 flex-1">
                <EntityPicker value={l.led_entity} domain="switch" onChange={(v) => setLink(i, { led_entity: v })} filter={(e) => !!e.keypad || e.entity_id.includes("kp_")} placeholder="Keypad LED switch…" />
              </Field>
              <Field label="Transition (s)">
                <NumberInput value={l.transition} onChange={(v) => setLink(i, { transition: v })} step={1} min={0} width={84} placeholder="—" />
              </Field>
              <Confirm text="Remove?" iconOnly icon={mdiClose} sm onYes={() => setS({ ...s, ha_scenes: s.ha_scenes.filter((_, j) => j !== i) })}>
                Remove
              </Confirm>
            </div>
          </div>
        ))}
        <button type="button" className="add-tile" onClick={() => setS({ ...s, ha_scenes: [...s.ha_scenes, { entity_id: "", led_entity: null, transition: null }] })}>
          <Icon path={mdiPlus} /> Add HA scene
        </button>
      </Section>

      <Section icon={mdiMusicNote} title="Music" count={`${s.music.length}`} intro="Runs when the scene is applied. Fades ramp the player's volume level over the given minutes. Playlist starts only run when a chapter is entered (see the chapter's behaviour settings).">
        {s.music.map((m, i) => (
          <MusicRow key={i} m={m} onChange={(p) => setMusic(i, p)} onRemove={() => setS({ ...s, music: s.music.filter((_, j) => j !== i) })} />
        ))}
        <div className="chips">
          <Btn variant="primary" sm icon={mdiSpotify} onClick={() => setS({ ...s, music: [...s.music, { kind: "spotify_context", entity_id: "", media_content_id: null, media_content_type: "playlist", shuffle: true, delay_seconds: 0 }] })}>
            Play on Spotify
          </Btn>
          <Btn sm icon={mdiPlus} onClick={() => setS({ ...s, music: [...s.music, { kind: "volume_fade", entity_id: "", volume: 0.1, minutes: 10, from_zero: false, delay_seconds: 0 }] })}>
            Music action
          </Btn>
          <div className="relative" ref={boseRef}>
            <Btn sm icon={mdiSpeakerMultiple} onClick={() => setBoseOpen((v) => !v)}>
              Bose zones
            </Btn>
            {boseOpen ? (
              <div className="menu absolute left-0 top-full z-30 mt-1 w-64">
                <div className="menu-title">Add for every Bose CSP zone</div>
                {BOSE_BULK.map(([label, make]) => (
                  <button key={label} type="button" className="menu-item" onClick={() => addBose(make)}>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      <Fold
        open={extraOpen}
        onToggle={() => setExtraOpen((v) => !v)}
        head={
          <>
            <Icon path={mdiTuneVertical} className="muted" size="sm" />
            <span className="ft">Extra service calls &amp; tablet glow levels</span>
            <span className="fs">
              {s.extra_actions.length} call{s.extra_actions.length === 1 ? "" : "s"}
            </span>
          </>
        }
      >
        {s.extra_actions.map((a, i) => (
          <div key={i} className="fields">
            <input type="text" className="input sm w-28" placeholder="domain" value={a.domain} onChange={(e) => setExtra(i, { domain: e.target.value })} />
            <input type="text" className="input sm w-36" placeholder="service" value={a.service} onChange={(e) => setExtra(i, { service: e.target.value })} />
            <input type="text" className="input sm min-w-40 flex-1" placeholder="entity_id target" value={(a.target?.entity_id as string) ?? ""} onChange={(e) => setExtra(i, { target: e.target.value ? { entity_id: e.target.value } : null })} />
            <input
              type="text"
              className="input sm mono min-w-40 flex-1"
              placeholder='data JSON {"brightness":120}'
              defaultValue={a.data ? JSON.stringify(a.data) : ""}
              onBlur={(e) => {
                try {
                  setExtra(i, { data: e.target.value ? JSON.parse(e.target.value) : null });
                } catch {
                  toast("Invalid JSON", true);
                }
              }}
            />
            <IconBtn icon={mdiClose} label="Remove" size="sm" danger onClick={() => setS({ ...s, extra_actions: s.extra_actions.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <button type="button" className="add-tile" onClick={() => setS({ ...s, extra_actions: [...s.extra_actions, { domain: "light", service: "turn_on", target: null, data: null, label: "" }] })}>
          <Icon path={mdiPlus} /> Service call
        </button>
        <p className="help">Glow levels are only a fallback for the tablet picture when a zone has no live light entity.</p>
        {props.settings.zones.map((z) => {
          const v = levels[z.id] ?? s.zone_levels[z.id] ?? 0;
          return (
            <div key={z.id} className="slider-row">
              <span className="lbl truncate" style={{ width: "8rem", flexShrink: 0 }}>
                {z.name}
              </span>
              <Slider
                sm
                min={0}
                max={100}
                value={s.zone_levels[z.id] ?? 0}
                label={`${z.name} glow`}
                onInput={(n) => setLevels({ ...levels, [z.id]: n })}
                onChange={(n) => {
                  setLevels(({ [z.id]: _, ...rest }) => rest);
                  setS({ ...s, zone_levels: { ...s.zone_levels, [z.id]: n } });
                }}
              />
              <span className="val w-10 text-right">{v}%</span>
            </div>
          );
        })}
      </Fold>

      <div className="savebar">
        <Btn variant="primary" disabled={!dirty || saving} onClick={save}>
          Save scene
        </Btn>
        {dirty ? (
          <Btn variant="ghost" onClick={() => setS(props.scene)}>
            Discard
          </Btn>
        ) : null}
      </div>
    </div>
  );
}
