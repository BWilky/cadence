import { useEffect, useState } from "react";
import { api, slug } from "../api";
import { Confirm, EntityPicker, NumberInput, Toggle, loadEntities, toast, useEntities } from "../components/ui";
import type { CadenceScene, HAAction, MusicAction, MusicKind, SceneLink, Settings } from "../types";

const COLORS = ["#3a4a7a", "#e8b45a", "#f0c86a", "#7fb1d6", "#9cc9a0", "#e89a5a", "#c4706e", "#9a6ab8", "#6ed3c6", "#8a9bb0", "#2a3350"];

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
    <div className="split">
      <div className="stack">
        <div className="row between">
          <h2 className="serif" style={{ fontStyle: "italic", margin: 0, fontWeight: 400 }}>
            Scenes
          </h2>
          <button className="btn sm" onClick={() => create().catch((e) => toast(e.message, true))}>
            + New
          </button>
        </div>
        <div className="help">A Cadence scene is a look for the building: one or more Home Assistant scenes (RA2 phantom buttons, WiZ scenes…) plus what the music should do.</div>
        <div className="list">
          {list.map((s) => (
            <div key={s.id} className={"item" + (s.id === sel ? " active" : "")} onClick={() => setSel(s.id)}>
              <span className="swatch" style={{ background: s.color ?? "#556" }} />
              <div style={{ flex: 1 }}>
                <div>{s.name}</div>
                <div className="help">
                  {s.ha_scenes.length} HA scene{s.ha_scenes.length === 1 ? "" : "s"} · {s.music.length} music
                </div>
              </div>
            </div>
          ))}
        </div>
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
        <div className="empty">Select or create a scene.</div>
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
    // Lutron: scene.kp_x_y  <->  switch.kp_x_y
    const tail = sceneEntity.replace(/^scene\./, "");
    const hit = switches.find((sw) => sw.entity_id === "switch." + tail);
    return hit ? hit.entity_id : null;
  };
  const setMusic = (i: number, patch: Partial<MusicAction>) => setS({ ...s, music: s.music.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const setExtra = (i: number, patch: Partial<HAAction>) => setS({ ...s, extra_actions: s.extra_actions.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <input type="text" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, flex: 1 }} />
          <div className="row">
            <button className="btn sm live" onClick={test} title="Fire this scene now (respects dry run)">
              Test now
            </button>
            <Confirm text="Delete scene?" onYes={remove}>
              Delete
            </Confirm>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="tag">{s.id}</span>
          {COLORS.map((col) => (
            <button key={col} className="swatch" style={{ background: col, width: 18, height: 18, outline: s.color === col ? "2px solid var(--lamp)" : undefined, border: 0, cursor: "pointer" }} onClick={() => setS({ ...s, color: col })} />
          ))}
        </div>
        <textarea value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} placeholder="What does this look like, when is it used?" style={{ marginTop: 8, width: "100%" }} />
      </div>

      <div className="card">
        <h3>Home Assistant scenes</h3>
        <div className="help" style={{ marginBottom: 8 }}>
          Each is activated with scene.turn_on. For RA2 phantom buttons, pick the keypad LED switch that lights when the scene is active — Cadence uses it to see fades finish and to notice when someone changes the lights by hand.
        </div>
        <div className="stack">
          {s.ha_scenes.map((l, i) => (
            <div key={i} className="card" style={{ background: "var(--surface-2)" }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label>Scene</label>
                  <EntityPicker
                    value={l.entity_id}
                    domain="scene"
                    allowClear={false}
                    onChange={(v) => {
                      if (!v) return;
                      setLink(i, { entity_id: v, led_entity: l.led_entity ?? guessLed(v) });
                    }}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label>Active LED (optional)</label>
                  <EntityPicker value={l.led_entity} domain="switch" onChange={(v) => setLink(i, { led_entity: v })} filter={(e) => !!e.keypad || e.entity_id.includes("kp_")} placeholder="Keypad LED switch…" />
                </div>
                <div className="field">
                  <label>Transition (s)</label>
                  <NumberInput value={l.transition} onChange={(v) => setLink(i, { transition: v })} step={1} min={0} width={80} placeholder="—" />
                </div>
                <button className="btn sm ghost danger" style={{ marginTop: 18 }} onClick={() => setS({ ...s, ha_scenes: s.ha_scenes.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            </div>
          ))}
          <button className="btn sm" onClick={() => setS({ ...s, ha_scenes: [...s.ha_scenes, { entity_id: "", led_entity: null, transition: null }] })}>
            + Add HA scene
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Music</h3>
        <div className="help" style={{ marginBottom: 8 }}>
          Runs when the scene is applied. Fades ramp the player's volume level over the given minutes. Playlist starts only run when a chapter is entered (see the chapter's behaviour settings).
        </div>
        <div className="stack">
          {s.music.map((m, i) => (
            <MusicRow key={i} m={m} onChange={(p) => setMusic(i, p)} onRemove={() => setS({ ...s, music: s.music.filter((_, j) => j !== i) })} />
          ))}
          <div className="row">
            <button className="btn sm" onClick={() => setS({ ...s, music: [...s.music, { kind: "volume_fade", entity_id: "", volume: 0.1, minutes: 10, delay_seconds: 0 }] })}>
              + Music action
            </button>
            <button
              className="btn sm ghost"
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

      <details className="adv">
        <summary>Extra service calls & tablet glow levels</summary>
        <div className="stack" style={{ paddingTop: 8 }}>
          {s.extra_actions.map((a, i) => (
            <div key={i} className="row">
              <input type="text" placeholder="domain" value={a.domain} onChange={(e) => setExtra(i, { domain: e.target.value })} style={{ width: 110 }} />
              <input type="text" placeholder="service" value={a.service} onChange={(e) => setExtra(i, { service: e.target.value })} style={{ width: 140 }} />
              <input type="text" placeholder="entity_id target" value={(a.target?.entity_id as string) ?? ""} onChange={(e) => setExtra(i, { target: e.target.value ? { entity_id: e.target.value } : null })} style={{ flex: 1 }} />
              <input
                type="text"
                placeholder='data JSON {"brightness":120}'
                defaultValue={a.data ? JSON.stringify(a.data) : ""}
                onBlur={(e) => {
                  try {
                    setExtra(i, { data: e.target.value ? JSON.parse(e.target.value) : null });
                  } catch {
                    toast("Invalid JSON", true);
                  }
                }}
                style={{ flex: 1 }}
              />
              <button className="btn sm ghost danger" onClick={() => setS({ ...s, extra_actions: s.extra_actions.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setS({ ...s, extra_actions: [...s.extra_actions, { domain: "light", service: "turn_on", target: null, data: null, label: "" }] })}>
            + Service call
          </button>
          <div className="help">Glow levels are only a fallback for the tablet picture when a zone has no live light entity.</div>
          {props.settings.zones.map((z) => (
            <div key={z.id} className="row">
              <span className="small text-2" style={{ width: 120 }}>
                {z.name}
              </span>
              <input type="range" min={0} max={100} value={s.zone_levels[z.id] ?? 0} onChange={(e) => setS({ ...s, zone_levels: { ...s.zone_levels, [z.id]: Number(e.target.value) } })} style={{ flex: 1 }} />
              <span className="mono small" style={{ width: 36, textAlign: "right" }}>
                {s.zone_levels[z.id] ?? 0}%
              </span>
            </div>
          ))}
        </div>
      </details>

      <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--ground)", padding: "10px 0" }}>
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>
          Save scene
        </button>
        {dirty ? (
          <button className="btn ghost" onClick={() => setS(props.scene)}>
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
    <div className="card" style={{ background: "var(--surface-2)" }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="field">
          <label>Action</label>
          <select value={m.kind} onChange={(e) => onChange({ kind: e.target.value as MusicKind })}>
            {KINDS.map((k) => (
              <option key={k.k} value={k.k}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label>Player</label>
          <EntityPicker value={m.entity_id} domain="media_player" allowClear={false} onChange={(v) => v && onChange({ entity_id: v })} />
        </div>
        {m.kind === "volume_fade" || m.kind === "volume_set" ? (
          <div className="field">
            <label>Volume {Math.round((m.volume ?? 0) * 100)}%</label>
            <input type="range" min={0} max={1} step={0.01} value={m.volume ?? 0} onChange={(e) => onChange({ volume: Number(e.target.value) })} style={{ width: 130 }} />
          </div>
        ) : null}
        {m.kind === "volume_fade" ? (
          <div className="field">
            <label>Over (min)</label>
            <NumberInput value={m.minutes} onChange={(v) => onChange({ minutes: v ?? 0 })} step={1} min={0} width={70} />
          </div>
        ) : null}
        {m.kind === "source" ? (
          <div className="field">
            <label>Source</label>
            {player?.source_list?.length ? (
              <select value={m.source ?? ""} onChange={(e) => onChange({ source: e.target.value })}>
                <option value="">—</option>
                {player.source_list.map((src) => (
                  <option key={src}>{src}</option>
                ))}
              </select>
            ) : (
              <input type="text" value={m.source ?? ""} onChange={(e) => onChange({ source: e.target.value })} />
            )}
          </div>
        ) : null}
        {m.kind === "play_playlist" ? (
          <>
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label>URI (spotify:playlist:…)</label>
              <input type="text" value={m.media_content_id ?? ""} onChange={(e) => onChange({ media_content_id: e.target.value })} placeholder="spotify:playlist:37i9dQZF1DX…" />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={m.media_content_type ?? "playlist"} onChange={(e) => onChange({ media_content_type: e.target.value })}>
                <option>playlist</option>
                <option>album</option>
                <option>artist</option>
                <option>track</option>
                <option>music</option>
              </select>
            </div>
            <div className="field">
              <label>Shuffle</label>
              <Toggle checked={!!m.shuffle} onChange={(v) => onChange({ shuffle: v })} label="" />
            </div>
          </>
        ) : null}
        {m.kind === "service" ? (
          <>
            <div className="field">
              <label>Service</label>
              <input type="text" value={m.service ?? ""} onChange={(e) => onChange({ service: e.target.value })} placeholder="spotifyplus.player_media_play_context" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Data JSON</label>
              <input
                type="text"
                defaultValue={m.data ? JSON.stringify(m.data) : ""}
                onBlur={(e) => {
                  try {
                    onChange({ data: e.target.value ? JSON.parse(e.target.value) : null });
                  } catch {
                    toast("Invalid JSON", true);
                  }
                }}
              />
            </div>
          </>
        ) : null}
        <div className="field">
          <label>Delay (s)</label>
          <NumberInput value={m.delay_seconds ?? 0} onChange={(v) => onChange({ delay_seconds: v ?? 0 })} step={1} min={0} width={70} />
        </div>
        <button className="btn sm ghost danger" style={{ marginTop: 18 }} onClick={onRemove}>
          ×
        </button>
      </div>
    </div>
  );
}
