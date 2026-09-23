import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  title?: boolean; // non-interactive heading
  children?: MenuItem[]; // rendered inline as a small group
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** daisyUI `menu` rendered at the pointer. Closes on click, Escape, scroll or outside click. */
export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 200;
    setPos({ x: Math.min(menu.x, window.innerWidth - w - 8), y: Math.min(menu.y, window.innerHeight - h - 8) });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const openedAt = Date.now();
    // Ignore the scroll that may accompany the opening click (e.g. scroll-into-view); close on later ones.
    const scroll = () => Date.now() - openedAt > 250 && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [menu, onClose]);
  if (!menu) return null;
  const render = (items: MenuItem[]) =>
    items.map((it, i) => {
      if (it.divider) return <li key={i} className="my-1 h-px bg-base-300" />;
      if (it.title) return <li key={i} className="menu-title px-3 py-1 text-[11px]">{it.label}</li>;
      if (it.children)
        return (
          <li key={i}>
            <span className="menu-title px-3 py-1 text-[11px]">{it.label}</span>
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {it.children.map((c, j) => (
                <button key={j} type="button" className={"btn btn-xs " + (c.disabled ? "btn-disabled" : "btn-outline")} disabled={c.disabled} onClick={() => { c.onClick?.(); onClose(); }}>
                  {c.label}
                </button>
              ))}
            </div>
          </li>
        );
      return (
        <li key={i} className={it.disabled ? "menu-disabled" : ""}>
          <button
            type="button"
            className={"flex justify-between gap-4 " + (it.danger ? "text-error" : "")}
            disabled={it.disabled}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
          >
            <span>{it.label}</span>
            {it.hint ? <span className="font-mono text-[11px] opacity-50">{it.hint}</span> : null}
          </button>
        </li>
      );
    });
  return (
    <ul
      ref={ref}
      className="menu menu-sm fixed z-[200] w-64 rounded-box border border-base-300 bg-base-100 p-1 shadow-xl"
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {render(menu.items)}
    </ul>
  );
}
