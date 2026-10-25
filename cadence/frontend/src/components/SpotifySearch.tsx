import { mdiLoading, mdiMagnify, mdiSpotify } from "@mdi/js";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SpotifyItem } from "../types";
import { Dialog, Icon, Segmented, toast } from "./ui";

/** Modal search over SpotifyPlus: playlists, albums and artists. */
export function SpotifySearch({ open, onClose, onPick, initial }: { open: boolean; onClose: () => void; onPick: (item: SpotifyItem) => void; initial?: string }) {
  const [q, setQ] = useState(initial ?? "");
  const [type, setType] = useState<"playlist" | "album" | "artist">("playlist");
  const [items, setItems] = useState<SpotifyItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    if (!open) return;
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const r = await api.get<{ items: SpotifyItem[] }>(`api/spotify/search?q=${encodeURIComponent(q.trim())}&type=${type}&limit=18`);
        setItems(r.items);
      } catch (e) {
        setErr((e as Error).message);
        setItems([]);
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [q, type, open]);

  return (
    <Dialog open={open} onClose={onClose} title="Find on Spotify" icon={mdiSpotify}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="search min-w-60 flex-1">
          <Icon path={mdiMagnify} />
          <input autoFocus type="search" className="input" placeholder="Search playlists, albums, artists…" value={q} onChange={(e) => setQ(e.target.value)} />
          {busy ? <Icon path={mdiLoading} className="spin clear muted" size="sm" /> : null}
        </div>
        <Segmented
          sm
          fit
          value={type}
          onChange={setType}
          options={[
            { value: "playlist", label: "Playlists" },
            { value: "album", label: "Albums" },
            { value: "artist", label: "Artists" },
          ]}
        />
      </div>
      {err ? (
        <div className="sub" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>
          {err}
        </div>
      ) : null}
      <div className="tile-grid max-h-[55vh] overflow-y-auto">
        {items.map((it) => (
          <button
            key={it.uri}
            type="button"
            className="tile"
            onClick={() => {
              onPick(it);
              toast(`Selected ${it.name}`);
              onClose();
            }}
          >
            {it.image_large ? <img src={it.image_large} alt="" className="art" loading="lazy" /> : <div className="art" />}
            <div className="tt">
              <div className="n" title={it.name}>
                {it.name}
              </div>
              <div className="s">{it.subtitle || it.extra}</div>
            </div>
          </button>
        ))}
        {!busy && !err && q.trim().length >= 2 && items.length === 0 ? <div className="empty col-span-full">No results.</div> : null}
        {q.trim().length < 2 ? <div className="empty col-span-full">Type at least two characters.</div> : null}
      </div>
    </Dialog>
  );
}
