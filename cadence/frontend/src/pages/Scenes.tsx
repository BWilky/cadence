import { useEffect, useState } from "react";
import { api, slug } from "../api";
import { COLORS, ColorDots, Confirm, EntityPicker, Field, NumberInput, loadEntities, toast, useEntities } from "../components/ui";
import type { CadenceScene, HAAction, MusicAction, MusicKind, SceneLink, Settings } from "../types";

const KINDS: { k: MusicKind; label: string }[] = [
  { k: "volume_fade", label: "Fade volume" },
  { k: "volume_set", label: "Set volume" },
  { k: "mute", label: "Mute" },
  { k: "unmute", label: "Unmute" },
  { k: "source", label: "Select source" },
  { k: "play_playlist", label: "Play playlist / URI" },
  { k: "play", label: "Play" },
  { k: "pause", label: "Pause" },
  { k: "stop", label: "Stop" },
  { k: "service", label: "Custom service" },
];

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
    <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="display text-2xl">Scenes</h2>
          <button className="btn btn-sm btn-primary" onClick={() => create().catch((e) => toast(e.message, true))}>
            + New
          </button>
        </div>
        <p className="text-xs opacity-60">A Cadence scene is a look for the building: one or more Home Assistant scenes (RA2 phantom buttons, WiZ scenes…) plus what the music should do.</p>
        <ul className="menu w-full rounded-box border border-base-300 bg-base-100 p-1">
          {list.map((s) => (
            <li key={s.id}>
              <button className={"items-center gap-3 " + (s.id === sel ? "menu-active" : "")} onClick={() => setSel(s.id)}>
                <span className="swatch" style={{ background: s.color ?? "#556" }} />
                <span className="flex flex-col items-start gap-0">
                  <span>{s.name}</span>
                  <span className="text-[11px] opacity-60">
                    {s.ha_scenes.length} HA scene{s.ha_scenes.length === 1 ? "" : "s"} · {s.music.length} music
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
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
        <div className="flex h-40 items-center justify-center rounded-box border border-dashed border-base-300 opacity-60">Select or create a scene.</div>
      )}
    </div>
  );
}

function SceneEditor(props: { scene: CadenceScene; settings: Settings; onSaved: () => Promise<void>; onDeleted: () => void }) {
  const [s, setS] = useState<CadenceScene>(props.scene);
  const [saving, setSaving] = useState(false);
  const switches = useEntities("switch");
  const dirty = JSON.stringify(s) !== JSON.stringify(props.scene);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input type="text" className="input display flex-1 text-2xl" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
            <div className="flex items-center gap-2">
              <button className="btn btn-sm btn-outline btn-accent" onClick={test} title="Fire this scene now (respects dry run)">
                ▶ Test now
              </button>
              <Confirm text="Delete scene?" onYes={remove}>
                Delete
              </Confirm>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="badge badge-ghost badge-sm font-mono">{s.id}</span>
            <ColorDots value={s.color} onChange={(col) => setS({ ...s, color: col })} />
          </div>
          <textarea className="textarea textarea-sm w-full" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} placeholder="What does this look like, when is it used?" />
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-3">
          <h3 className="card-title text-base">Home Assistant scenes</h3>
          <p className="text-xs opacity-60">Each is activated with scene.turn_on. For RA2 phantom buttons, pick the keypad LED switch that lights when the scene is active — Cadence uses it to see fades finish and to notice when someone changes the lights by hand.</p>
          {s.ha_scenes.map((l, i) => (
            <div key={i} className="grid items-end gap-3 rounded-box border border-base-300 bg-base-200/60 p-3 md:grid-cols-[1fr_1fr_auto_auto]">
              <Field label="Scene">
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
              <Field label="Active LED (optional)">
                <EntityPicker value={l.led_entity} domain="switch" onChange={(v) => setLink(i, { led_entity: v })} filter={(e) => !!e.keypad || e.entity_id.includes("kp_")} placeholder="Keypad LED switch…" />
              </Field>
              <Field label="Transition (s)">
                <NumberInput value={l.transition} onChange={(v) => setLink(i, { transition: v })} step={1} min={0} width={84} placeholder="—" />
              </Field>
              <button className="btn btn-ghost btn-sm text-error" onClick={() => setS({ ...s, ha_scenes: s.ha_scenes.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-sm btn-outline self-start" onClick={() => setS({ ...s, ha_scenes: [...s.ha_scenes, { entity_id: "", led_entity: null, transition: null }] })}>
            + Add HA scene
          </button>
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-3">
          <h3 className="card-title text-base">Music</h3>
          <p className="text-xs opacity-60">Runs when the scene is applied. Fades ramp the player's volume level over the given minutes. Playlist starts only run when a chapter is entered (see the chapter's behaviour settings).</p>
          {s.music.map((m, i) => (
            <MusicRow key={i} m={m} onChange={(p) => setMusic(i, p)} onRemove={() => setS({ ...s, music: s.music.filter((_, j) => j !== i) })} />
          ))}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm btn-outline" onClick={() => setS({ ...s, music: [...s.music, { kind: "volume_fade", entity_id: "", volume: 0.1, minutes: 10, delay_seconds: 0 }] })}>
              + Music action
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                const players = (await loadEntities("media_player")).filter((p) => p.entity_id.includes("bose_csp"));
                if (!players.length) return toast("No Bose CSP players found", true);
                setS({ ...s, music: [...s.music, ...players.map((p) => ({ kind: "volume_fade" as MusicKind, entity_id: p.entity_id, volume: 0.1, minutes: 10, delay_seconds: 0 }))] });
              }}
            >
              + Fade all Bose zones
            </button>
          </div>
        </div>
      </div>

      <div className="collapse-arrow collapse rounded-box border border-base-300 bg-base-100 shadow-sm">
        <input type="checkbox" />
        <div className="collapse-title text-sm font-medium">Extra service calls & tablet glow levels</div>
        <div className="collapse-content flex flex-col gap-3">
          {s.extra_actions.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input type="text" className="input input-sm w-28" placeholder="domain" value={a.domain} onChange={(e) => setExtra(i, { domain: e.target.value })} />
              <input type="text" className="input input-sm w-36" placeholder="service" value={a.service} onChange={(e) => setExtra(i, { service: e.target.value })} />
              <input type="text" className="input input-sm flex-1" placeholder="entity_id target" value={(a.target?.entity_id as string) ?? ""} onChange={(e) => setExtra(i, { target: e.target.value ? { entity_id: e.target.value } : null })} />
              <input
                type="text"
                className="input input-sm flex-1 font-mono"
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
              <button className="btn btn-ghost btn-sm text-error" onClick={() => setS({ ...s, extra_actions: s.extra_actions.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-sm btn-outline self-start" onClick={() => setS({ ...s, extra_actions: [...s.extra_actions, { domain: "light", service: "turn_on", target: null, data: null, label: "" }] })}>
            + Service call
          </button>
          <p className="text-xs opacity-60">Glow levels are only a fallback for the tablet picture when a zone has no live light entity.</p>
          {props.settings.zones.map((z) => (
            <div key={z.id} className="flex items-center gap-3">
              <span className="w-32 text-xs opacity-70">{z.name}</span>
              <input type="range" className="range range-primary range-xs flex-1" min={0} max={100} value={s.zone_levels[z.id] ?? 0} onChange={(e) => setS({ ...s, zone_levels: { ...s.zone_levels, [z.id]: Number(e.target.value) } })} />
              <span className="w-10 text-right font-mono text-xs">{s.zone_levels[z.id] ?? 0}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-base-300 bg-base-200 py-3">
        <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
          Save scene
        </button>
        {dirty ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setS(props.scene)}>
            Discard
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MusicRow({ m, onChange, onRemove }: { m: MusicAction; onChange: (p: Partial<MusicAction>) => void; onRemove: () => void }) {
  const players = useEntities("media_player");
  const player = players.find((p) => p.entity_id === m.entity_id);
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-200/60 p-3">
      <Field label="Action">
        <select className="select select-sm w-44" value={m.kind} onChange={(e) => onChange({ kind: e.target.value as MusicKind })}>
          {KINDS.map((k) => (
            <option key={k.k} value={k.k}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Player" className="min-w-56 flex-1">
        <EntityPicker value={m.entity_id} domain="media_player" allowClear={false} onChange={(v) => v && onChange({ entity_id: v })} />
      </Field>
      {m.kind === "volume_fade" || m.kind === "volume_set" ? (
        <Field label={`Volume ${Math.round((m.volume ?? 0) * 100)}%`}>
          <input type="range" className="range range-primary range-xs w-36" min={0} max={1} step={0.01} value={m.volume ?? 0} onChange={(e) => onChange({ volume: Number(e.target.value) })} />
        </Field>
      ) : null}
      {m.kind === "volume_fade" ? (
        <Field label="Over (min)">
          <NumberInput value={m.minutes} onChange={(v) => onChange({ minutes: v ?? 0 })} step={1} min={0} width={76} />
        </Field>
      ) : null}
      {m.kind === "source" ? (
        <Field label="Source">
          {player?.source_list?.length ? (
            <select className="select select-sm w-40" value={m.source ?? ""} onChange={(e) => onChange({ source: e.target.value })}>
              <option value="">—</option>
              {player.source_list.map((src) => (
                <option key={src}>{src}</option>
              ))}
            </select>
          ) : (
            <input type="text" className="input input-sm w-40" value={m.source ?? ""} onChange={(e) => onChange({ source: e.target.value })} />
          )}
        </Field>
      ) : null}
      {m.kind === "play_playlist" ? (
        <>
          <Field label="URI (spotify:playlist:…)" className="min-w-64 flex-1">
            <input type="text" className="input input-sm w-full font-mono" value={m.media_content_id ?? ""} onChange={(e) => onChange({ media_content_id: e.target.value })} placeholder="spotify:playlist:37i9dQZF1DX…" />
          </Field>
          <Field label="Type">
            <select className="select select-sm w-28" value={m.media_content_type ?? "playlist"} onChange={(e) => onChange({ media_content_type: e.target.value })}>
              <option>playlist</option>
              <option>album</option>
              <option>artist</option>
              <option>track</option>
              <option>music</option>
            </select>
          </Field>
          <Field label="Shuffle">
            <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={!!m.shuffle} onChange={(e) => onChange({ shuffle: e.target.checked })} />
          </Field>
        </>
      ) : null}
      {m.kind === "service" ? (
        <>
          <Field label="Service">
            <input type="text" className="input input-sm w-64 font-mono" value={m.service ?? ""} onChange={(e) => onChange({ service: e.target.value })} placeholder="spotifyplus.player_media_play_context" />
          </Field>
          <Field label="Data JSON" className="flex-1">
            <input
              type="text"
              className="input input-sm w-full font-mono"
              defaultValue={m.data ? JSON.stringify(m.data) : ""}
              onBlur={(e) => {
                try {
                  onChange({ data: e.target.value ? JSON.parse(e.target.value) : null });
                } catch {
                  toast("Invalid JSON", true);
                }
              }}
            />
          </Field>
        </>
      ) : null}
      <Field label="Delay (s)">
        <NumberInput value={m.delay_seconds ?? 0} onChange={(v) => onChange({ delay_seconds: v ?? 0 })} step={1} min={0} width={76} />
      </Field>
      <button className="btn btn-ghost btn-sm text-error" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}
