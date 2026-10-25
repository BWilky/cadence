import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Chip } from "./ui";

export interface MenuItem {
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  title?: boolean; // non-interactive heading
  children?: MenuItem[]; // rendered inline as a small group of chips
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Sheet-style menu rendered at the pointer. Closes on click, Escape, scroll or outside click. */
export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
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
      if (it.divider) return <div key={i} className="menu-sep" />;
      if (it.title)
        return (
          <div key={i} className="menu-title">
            {it.label}
          </div>
        );
      if (it.children)
        return (
          <div key={i}>
            <div className="menu-title">{it.label}</div>
            <div className="chips px-3 pb-2">
              {it.children.map((c, j) => (
                <Chip
                  key={j}
                  sm
                  disabled={c.disabled}
                  onClick={() => {
                    c.onClick?.();
                    onClose();
                  }}
                >
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
        );
      return (
        <button
          key={i}
          type="button"
          className={"menu-item" + (it.danger ? " danger" : "")}
          disabled={it.disabled}
          onClick={() => {
            it.onClick?.();
            onClose();
          }}
        >
          <span className="truncate">{it.label}</span>
          {it.hint ? <span className="hint">{it.hint}</span> : null}
        </button>
      );
    });
  return (
    <div ref={ref} className="menu fixed z-[200] w-64" role="menu" style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? "visible" : "hidden" }} onContextMenu={(e) => e.preventDefault()}>
      {render(menu.items)}
    </div>
  );
}
