import { useEffect, useState } from "react";
import { api } from "../api";
import type { MusicAction, MusicKind } from "../types";
import { SpotifySearch } from "./SpotifySearch";
import { EntityPicker, Field, NumberInput, useEntities } from "./ui";

export const MUSIC_KINDS: { k: MusicKind; label: string }[] = [
  { k: "spotify_context", label: "Play on Spotify" },
  { k: "volume_fade", label: "Fade volume" },
  { k: "volume_set", label: "Set volume" },
  { k: "mute", label: "Mute" },
  { k: "unmute", label: "Unmute" },
  { k: "source", label: "Select source" },
  { k: "play", label: "Resume" },
  { k: "pause", label: "Pause" },
  { k: "stop", label: "Stop" },
  { k: "play_playlist", label: "Play media URI (generic)" },
  { k: "service", label: "Custom service" },
];

export function musicSummary(m: MusicAction): string {
  const pct = (v: number | null | undefined) => `${Math.round((v ?? 0) * 100)}%`;
  switch (m.kind) {
    case "spotify_context":
      return `▶ ${m.label ?? m.media_content_id ?? "Spotify"}${m.device ? ` on ${m.device}` : ""}`;
    case "volume_fade":
      return `fade ${m.from_zero ? "0 → " : ""}${pct(m.volume)} over ${m.minutes ?? 0} min`;
    case "volume_set":
      return `volume ${pct(m.volume)}`;
    case "source":
      return `source ${m.source ?? "?"}`;
    case "play_playlist":
      return `play ${m.media_content_id ?? ""}`;
    case "service":
      return m.service ?? "service";
    default:
      return m.kind;
  }
}

export function MusicRow({ m, onChange, onRemove }: { m: MusicAction; onChange: (p: Partial<MusicAction>) => void; onRemove: () => void }) {
  const players = useEntities("media_player");
  const player = players.find((p) => p.entity_id === m.entity_id);
  const [search, setSearch] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  const [spotifyEntity, setSpotifyEntity] = useState<string | null>(null);
  useEffect(() => {
    if (m.kind !== "spotify_context") return;
    api
      .get<{ entity: string | null; devices: string[] }>("api/spotify/devices")
      .then((r) => {
        setDevices(r.devices);
        setSpotifyEntity(r.entity);
        if (!m.entity_id && r.entity) onChange({ entity_id: r.entity });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.kind]);
  const isSpotify = m.kind === "spotify_context";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-200/60 p-3">
      <Field label="Action">
        <select className="select select-sm w-48" value={m.kind} onChange={(e) => onChange({ kind: e.target.value as MusicKind })}>
          {MUSIC_KINDS.map((k) => (
            <option key={k.k} value={k.k}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>

      {isSpotify ? (
        <>
          <Field label="What to play" className="w-full max-w-xl flex-1 basis-72">
            <div className="flex w-full items-center gap-2 overflow-hidden">
              {m.image ? <img src={m.image} alt="" className="h-9 w-9 rounded object-cover" /> : <div className="grid h-9 w-9 place-items-center rounded bg-base-300 text-xs">♫</div>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.label ?? (m.media_content_id ? m.media_content_id : "Nothing chosen")}</div>
                <div className="truncate font-mono text-[11px] opacity-60">{m.media_content_id ?? "search a playlist, album or artist"}</div>
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setSearch(true)}>
                Search
              </button>
            </div>
          </Field>
          <Field label="Spotify Connect device">
            <select className="select select-sm w-44" value={m.device ?? ""} onChange={(e) => onChange({ device: e.target.value || null })}>
              <option value="">Active device</option>
              {devices.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Shuffle">
            <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={!!m.shuffle} onChange={(e) => onChange({ shuffle: e.target.checked })} />
          </Field>
          <SpotifySearch open={search} onClose={() => setSearch(false)} initial={m.label ?? ""} onPick={(it) => onChange({ media_content_id: it.uri, label: it.name, image: it.image ?? it.image_large ?? null, media_content_type: it.type, entity_id: m.entity_id || spotifyEntity || "" })} />
        </>
      ) : (
        <Field label="Player" className="min-w-56 flex-1">
          <EntityPicker value={m.entity_id} domain="media_player" allowClear={false} onChange={(v) => v && onChange({ entity_id: v })} />
        </Field>
      )}

      {m.kind === "volume_fade" || m.kind === "volume_set" ? (
        <Field label={`${m.kind === "volume_fade" ? "To" : "Volume"} ${Math.round((m.volume ?? 0) * 100)}%`}>
          <input type="range" className="range range-primary range-xs w-36" min={0} max={1} step={0.01} value={m.volume ?? 0} onChange={(e) => onChange({ volume: Number(e.target.value) })} />
        </Field>
      ) : null}
      {m.kind === "volume_fade" ? (
        <>
          <Field label="Over (min)">
            <NumberInput value={m.minutes} onChange={(v) => onChange({ minutes: v ?? 0 })} step={1} min={0} width={76} />
          </Field>
          <Field label="Start from">
            <div className="join">
              <button type="button" className={"btn btn-xs join-item " + (!m.from_zero ? "btn-neutral" : "btn-outline")} onClick={() => onChange({ from_zero: false })}>
                current level
              </button>
              <button type="button" className={"btn btn-xs join-item " + (m.from_zero ? "btn-neutral" : "btn-outline")} onClick={() => onChange({ from_zero: true })}>
                zero
              </button>
            </div>
          </Field>
        </>
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
          <Field label="Media URI" className="min-w-64 flex-1">
            <input type="text" className="input input-sm w-full font-mono" value={m.media_content_id ?? ""} onChange={(e) => onChange({ media_content_id: e.target.value })} placeholder="spotify:playlist:…" />
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
                  /* keep previous */
                }
              }}
            />
          </Field>
        </>
      ) : null}
      <Field label="Delay (s)">
        <NumberInput value={m.delay_seconds ?? 0} onChange={(v) => onChange({ delay_seconds: v ?? 0 })} step={1} min={0} width={76} />
      </Field>
      <button type="button" className="btn btn-ghost btn-sm text-error" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}
