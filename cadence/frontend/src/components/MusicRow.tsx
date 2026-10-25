import { mdiClose, mdiMagnify, mdiMusicNote } from "@mdi/js";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { MusicAction, MusicKind } from "../types";
import { SpotifySearch } from "./SpotifySearch";
import { Btn, EntityPicker, Field, Icon, IconBtn, NumberInput, Segmented, Slider, Switch, useEntities } from "./ui";

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
  const [vol, setVol] = useState<number | null>(null); // live value while dragging
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
  const shownVol = vol ?? m.volume ?? 0;

  return (
    <div className="sub">
      <div className="fields">
        <Field label="Action">
          <select className="select sm w-48" value={m.kind} onChange={(e) => onChange({ kind: e.target.value as MusicKind })}>
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
                {m.image ? (
                  <img src={m.image} alt="" className="art-sm" />
                ) : (
                  <span className="art-sm">
                    <Icon path={mdiMusicNote} size="sm" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.label ?? (m.media_content_id ? m.media_content_id : "Nothing chosen")}</div>
                  <div className="mono muted truncate text-[11px]">{m.media_content_id ?? "search a playlist, album or artist"}</div>
                </div>
                <Btn variant="primary" sm icon={mdiMagnify} onClick={() => setSearch(true)}>
                  Search
                </Btn>
              </div>
            </Field>
            <Field label="Spotify Connect device">
              <select className="select sm w-44" value={m.device ?? ""} onChange={(e) => onChange({ device: e.target.value || null })}>
                <option value="">Active device</option>
                {devices.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Shuffle">
              <div className="flex h-[34px] items-center">
                <Switch sm checked={!!m.shuffle} onChange={(v) => onChange({ shuffle: v })} label="Shuffle" />
              </div>
            </Field>
            <SpotifySearch open={search} onClose={() => setSearch(false)} initial={m.label ?? ""} onPick={(it) => onChange({ media_content_id: it.uri, label: it.name, image: it.image ?? it.image_large ?? null, media_content_type: it.type, entity_id: m.entity_id || spotifyEntity || "" })} />
          </>
        ) : (
          <Field label="Player" className="min-w-56 flex-1">
            <EntityPicker value={m.entity_id} domain="media_player" allowClear={false} onChange={(v) => v && onChange({ entity_id: v })} />
          </Field>
        )}

        {m.kind === "volume_fade" || m.kind === "volume_set" ? (
          <Field label={`${m.kind === "volume_fade" ? "To" : "Volume"} ${Math.round(shownVol * 100)}%`} className="w-40">
            <Slider sm min={0} max={1} step={0.01} value={m.volume ?? 0} label="Volume" onInput={setVol} onChange={(v) => { setVol(null); onChange({ volume: v }); }} />
          </Field>
        ) : null}
        {m.kind === "volume_fade" ? (
          <>
            <Field label="Over (min)">
              <NumberInput value={m.minutes} onChange={(v) => onChange({ minutes: v ?? 0 })} step={1} min={0} width={76} />
            </Field>
            <Field label="Start from">
              <Segmented
                sm
                fit
                value={m.from_zero ? "zero" : "current"}
                onChange={(v) => onChange({ from_zero: v === "zero" })}
                options={[
                  { value: "current", label: "current level" },
                  { value: "zero", label: "zero" },
                ]}
              />
            </Field>
          </>
        ) : null}
        {m.kind === "source" ? (
          <Field label="Source">
            {player?.source_list?.length ? (
              <select className="select sm w-40" value={m.source ?? ""} onChange={(e) => onChange({ source: e.target.value })}>
                <option value="">—</option>
                {player.source_list.map((src) => (
                  <option key={src}>{src}</option>
                ))}
              </select>
            ) : (
              <input type="text" className="input sm w-40" value={m.source ?? ""} onChange={(e) => onChange({ source: e.target.value })} />
            )}
          </Field>
        ) : null}
        {m.kind === "play_playlist" ? (
          <>
            <Field label="Media URI" className="min-w-64 flex-1">
              <input type="text" className="input sm mono w-full" value={m.media_content_id ?? ""} onChange={(e) => onChange({ media_content_id: e.target.value })} placeholder="spotify:playlist:…" />
            </Field>
            <Field label="Type">
              <select className="select sm w-28" value={m.media_content_type ?? "playlist"} onChange={(e) => onChange({ media_content_type: e.target.value })}>
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
              <input type="text" className="input sm mono w-64" value={m.service ?? ""} onChange={(e) => onChange({ service: e.target.value })} placeholder="spotifyplus.player_media_play_context" />
            </Field>
            <Field label="Data JSON" className="flex-1">
              <input
                type="text"
                className="input sm mono w-full"
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
        <IconBtn icon={mdiClose} label="Remove" size="sm" danger onClick={onRemove} />
      </div>
    </div>
  );
}
