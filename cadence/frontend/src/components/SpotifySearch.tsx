import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SpotifyItem } from "../types";
import { toast } from "./ui";

/** Modal search over SpotifyPlus: playlists, albums and artists. */
export function SpotifySearch({ open, onClose, onPick, initial }: { open: boolean; onClose: () => void; onPick: (item: SpotifyItem) => void; initial?: string }) {
  const [q, setQ] = useState(initial ?? "");
  const [type, setType] = useState<"playlist" | "album" | "artist">("playlist");
  const [items, setItems] = useState<SpotifyItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number>();
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dlg.current?.showModal();
    else dlg.current?.close();
  }, [open]);

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
    <dialog ref={dlg} className="modal" onClose={onClose}>
      <div className="modal-box max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Find on Spotify</h3>
          <form method="dialog">
            <button className="btn btn-sm btn-circle btn-ghost">✕</button>
          </form>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="input input-sm flex-1 min-w-60">
            <svg className="h-[1em] opacity-50" viewBox="0 0 24 24">
              <g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2.5" fill="none" stroke="currentColor">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </g>
            </svg>
            <input autoFocus type="search" className="grow" placeholder="Search playlists, albums, artists…" value={q} onChange={(e) => setQ(e.target.value)} />
            {busy ? <span className="loading loading-spinner loading-xs" /> : null}
          </label>
          <div role="tablist" className="tabs tabs-box tabs-sm">
            {(["playlist", "album", "artist"] as const).map((t) => (
              <button key={t} role="tab" className={"tab " + (type === t ? "tab-active" : "")} onClick={() => setType(t)}>
                {t === "playlist" ? "Playlists" : t === "album" ? "Albums" : "Artists"}
              </button>
            ))}
          </div>
        </div>
        {err ? (
          <div role="alert" className="alert alert-soft alert-error mt-3 py-2 text-sm">
            {err}
          </div>
        ) : null}
        <div className="mt-3 grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
          {items.map((it) => (
            <button
              key={it.uri}
              type="button"
              className="card card-compact card-border bg-base-200/60 text-left transition hover:bg-base-200"
              onClick={() => {
                onPick(it);
                toast(`Selected ${it.name}`);
                onClose();
              }}
            >
              <figure className="aspect-square bg-base-300">{it.image_large ? <img src={it.image_large} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}</figure>
              <div className="card-body p-2">
                <div className="truncate text-sm font-medium" title={it.name}>
                  {it.name}
                </div>
                <div className="truncate text-xs opacity-60">{it.subtitle || it.extra}</div>
              </div>
            </button>
          ))}
          {!busy && !err && q.trim().length >= 2 && items.length === 0 ? <div className="col-span-full py-8 text-center text-sm opacity-60">No results.</div> : null}
          {q.trim().length < 2 ? <div className="col-span-full py-8 text-center text-sm opacity-60">Type at least two characters.</div> : null}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
