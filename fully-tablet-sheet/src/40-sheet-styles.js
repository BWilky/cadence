
    static get styles() {
      return css`
        :host {
          position: fixed; inset: 0; z-index: 10000; display: block;
          color: var(--primary-text-color, #e1e1e1);
          --bg: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          --soft: rgba(var(--rgb-primary-text-color, 225, 225, 225), 0.07);
          --soft2: rgba(var(--rgb-primary-text-color, 225, 225, 225), 0.12);
          --accent: var(--primary-color, #03a9f4);
          --danger: var(--error-color, #db4437);
          --ok: var(--success-color, #43a047);
          --warn: var(--warning-color, #ffa600);
          -webkit-tap-highlight-color: transparent;
        }
        * { box-sizing: border-box; }
        button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
        button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        code { font-size: 12px; background: var(--soft2); padding: 1px 5px; border-radius: 4px; }
        .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); animation: fade-in .24s ease; }
        .backdrop.closing { animation: fade-out .24s ease forwards; }
        .sheet {
          position: fixed; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 520px;
          max-height: 90vh; max-height: 90dvh; display: flex; flex-direction: column; background: var(--bg);
          border-radius: 18px 18px 0 0; box-shadow: 0 -8px 32px rgba(0,0,0,.35);
          animation: slide-up .28s cubic-bezier(.25,1,.4,1); transition: transform .2s ease;
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
        .sheet.closing { animation: slide-down .24s ease forwards; }
        @keyframes slide-up { from { transform: translateY(100%); } to { transform: none; } }
        @keyframes slide-down { from { transform: none; } to { transform: translateY(110%); } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .sheet, .dialog, .backdrop, .cf, .cf-scrim { animation-duration: .01s !important; }
          .spin, .act.busy ha-icon { animation: none !important; }
        }

        .header { padding: 6px 16px 12px; cursor: grab; touch-action: none; flex-shrink: 0; }
        .grabber { width: 40px; height: 4px; border-radius: 2px; background: var(--divider-color, rgba(120,120,120,.4)); margin: 6px auto 12px; }
        .title-row { display: flex; align-items: center; gap: 8px; }
        .title-row > ha-icon { color: var(--secondary-text-color); }
        .title { flex: 1; min-width: 0; font-size: 18px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .close { width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer; display: flex;
          align-items: center; justify-content: center; background: var(--soft2); color: var(--secondary-text-color); flex-shrink: 0; }
        .close:active { transform: scale(.94); }

        /* tabs (phone) + segmented page switch */
        .tabs, .seg { display: flex; background: var(--soft); border-radius: 12px; padding: 3px; gap: 3px; margin-top: 12px; cursor: default; }
        .tab, .seg-btn { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; background: transparent;
          padding: 9px 4px; border-radius: 10px; color: var(--secondary-text-color); font-weight: 500; cursor: pointer;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
        .tab.on, .seg-btn.on { background: var(--bg); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,.25); }
        .seg-btn ha-icon { --mdc-icon-size: 18px; }
        .seg-btn.on ha-icon { color: var(--accent); }
        .content-head .seg { margin: 0; width: 240px; flex-shrink: 0; }
        .content-head .seg-btn { padding: 7px 4px; font-size: 13px; }
        .tab .here { --mdc-icon-size: 15px; color: var(--accent); flex-shrink: 0; }
        .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--disabled-color, #8a8a8a); }
        .dot.on { background: var(--ok); }
        .dot.offline { background: var(--danger); }

        /* ---- tablet / desktop: centred dialog with sidebar ---- */
        .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(1060px, 94vw); height: min(86vh, 880px);
          display: flex; background: var(--bg); border-radius: 22px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.4);
          animation: dlg-in .22s cubic-bezier(.25,1,.4,1); }
        .dialog.closing { animation: dlg-out .2s ease forwards; }
        @keyframes dlg-in { from { opacity: 0; transform: translate(-50%, -48%) scale(.97); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes dlg-out { to { opacity: 0; transform: translate(-50%, -48%) scale(.97); } }
        .side { width: 236px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 22px 14px 16px;
          background: var(--secondary-background-color, rgba(120,120,120,.08)); }
        .side-head { display: flex; align-items: center; gap: 8px; padding: 0 8px 14px; }
        .side-title { flex: 1; font-size: 22px; font-weight: 600; }
        nav { display: flex; flex-direction: column; gap: 4px; }
        .nav-sep { height: 1px; background: var(--divider-color, rgba(120,120,120,.3)); margin: 8px 10px; }
        .nav-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: none; border-radius: 12px; background: transparent;
          text-align: left; font-weight: 500; font-size: 15px; color: var(--secondary-text-color); cursor: pointer; min-width: 0; }
        .nav-item ha-icon { --mdc-icon-size: 20px; flex-shrink: 0; }
        .nav-item.on { background: var(--bg); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
        .nav-item.on > ha-icon { color: var(--accent); }
        .nav-dot { width: 20px; display: flex; justify-content: center; flex-shrink: 0; }
        .nav-dot .dot { width: 9px; height: 9px; }
        .nav-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nav-item .here { --mdc-icon-size: 15px; color: var(--accent); margin-left: -6px; }
        .nav-bat { display: inline-flex; align-items: center; gap: 1px; font-size: 12px; font-weight: 500; color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .nav-bat ha-icon { --mdc-icon-size: 13px; }
        .nav-bat.ok ha-icon { color: var(--ok); }
        .nav-bat.warn { color: var(--danger); }
        .side-spacer { flex: 1; }
        .mini { display: flex; align-items: center; gap: 10px; padding: 8px; border: none; border-radius: 14px; background: var(--bg);
          cursor: pointer; text-align: left; width: 100%; }
        .mini:active { transform: scale(.98); }
        .mini-ic { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          background: var(--soft2); color: var(--secondary-text-color); }
        .mini-ic ha-icon { --mdc-icon-size: 22px; }
        .mini-ic.tone-ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 15%, transparent); }
        .mini-ic.tone-warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .mini-ic.tone-bad { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
        .mini-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .mini-text > span, .mini-text > small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mini-text > span { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .mini-text .mini-tag { font-size: 11px; font-weight: 500; color: var(--secondary-text-color); }
        .mini-text > small { font-size: 11px; color: var(--secondary-text-color); }
        .content { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
        .content-head { display: flex; align-items: center; gap: 10px; padding: 20px 20px 10px; flex-shrink: 0; }
        .content-head h2 { flex: 1; margin: 0; font-size: 21px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .content-head .count { margin-left: 0; }
        :host([layout="dialog"]) .body { padding: 4px 20px 24px; }
        :host([layout="dialog"]) .tab-body { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
        :host([layout="dialog"]) .tab-body > .full { grid-column: 1 / -1; }
        :host([layout="dialog"]) .tab-body > .s-shot { grid-row: span 2; }
        :host([layout="dialog"]) .tab-body.cols { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: stretch; }
        :host([layout="dialog"]) .tab-body.cols > .col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        :host([layout="dialog"]) .tab-body.cols > .col > .section:last-child { flex: 1; }
        :host([layout="dialog"]) .tab-body.cols .power > .act.danger { margin-top: auto; }
        :host([layout="dialog"]) .tab-body.cols .act-grid > .act:last-child:nth-child(odd) { grid-column: auto; }
        :host([layout="dialog"]) .tab-body.hist { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
        .act-grid.one { grid-template-columns: minmax(0, 1fr); }
        :host([layout="dialog"]) .cf-scrim { border-radius: 22px; }
        :host([layout="dialog"]) .cf { top: 50%; bottom: auto; left: 50%; right: auto; width: min(440px, 90%); transform: translate(-50%, -50%);
          animation: fade-in .18s ease; }

        /* overview */
        .ov-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .ovc { gap: 10px; padding: 10px; }
        .ovc.off .ov-shot { opacity: .6; }
        .ov-shot { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; padding: 0; border: none; border-radius: 10px;
          overflow: hidden; background: #000; cursor: pointer; }
        .ov-shot img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .ov-shot:active img { opacity: .85; }
        .ovc .row { padding: 0 4px 2px; gap: 10px; }
        .ovc .dot { width: 9px; height: 9px; }
        .ovc .row-title { display: flex; align-items: center; gap: 4px; }
        .here-sm { --mdc-icon-size: 15px; color: var(--accent); }
        .warn-t { color: var(--danger); }

        .body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 16px 24px;
          display: flex; flex-direction: column; gap: 14px; }
        .tab-body { display: contents; }
        :host([layout="sheet"]) .tab-body.hist > .col { display: contents; }
        .section { background: var(--secondary-background-color, rgba(120,120,120,.08)); border-radius: 14px;
          padding: 14px; display: flex; flex-direction: column; gap: 12px; }
        .section.center { align-items: center; justify-content: center; padding: 28px; gap: 8px; }
        .section.center ha-icon { --mdc-icon-size: 28px; color: var(--secondary-text-color); }

        .chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; border: none;
          font-size: 12px; background: var(--soft); color: var(--secondary-text-color); white-space: nowrap; min-width: 0; }
        .chip ha-icon { --mdc-icon-size: 15px; flex-shrink: 0; }
        .chip.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
        .chip.warn { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
        .chip.page { max-width: 100%; }
        .chip.attn { color: color-mix(in srgb, var(--warn) 60%, var(--primary-text-color)); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .attn-t { color: color-mix(in srgb, var(--warn) 65%, var(--primary-text-color)); font-weight: 600; }
        .chip .ell { overflow: hidden; text-overflow: ellipsis; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chips:empty { display: none; }

        .sec-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
        .sec-head > ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        .count { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; }

        .icon-btn { width: 42px; height: 42px; border: none; border-radius: 50%; background: transparent; cursor: pointer;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .icon-btn:active { background: var(--soft2); }
        .icon-btn.soft { background: var(--soft); }
        .icon-btn.sm { width: 34px; height: 34px; }
        .icon-btn.sm ha-icon { --mdc-icon-size: 20px; }
        .icon-btn:disabled { opacity: .4; cursor: default; }
        .spin { animation: spin 1s linear infinite; }
        .plug-row { display: flex; align-items: center; gap: 12px; }
        .pill-btn { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; border: none; border-radius: 999px; padding: 8px 14px;
          font-size: 13px; font-weight: 500; background: var(--soft2); cursor: pointer; white-space: nowrap; }
        .pill-btn ha-icon { --mdc-icon-size: 16px; }
        .pill-btn:disabled { opacity: .45; cursor: default; }
        .pill-btn:active { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
        .pill-btn.wide { justify-content: center; }

        /* screenshot */
        .shot { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; padding: 0; border: none;
          border-radius: 12px; overflow: hidden; background: #000; cursor: pointer; }
        .shot.portrait { aspect-ratio: 10 / 16; width: auto; max-width: 100%; height: min(55vh, 520px); margin: 0 auto; }
        .shot:disabled { cursor: default; }
        .shot img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .shot:not(:disabled):active img { opacity: .85; }
        .ov { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 6px; padding: 16px; text-align: center; font-size: 13px; color: rgba(255,255,255,.88); background: rgba(0,0,0,.6); }
        .ov.soft { background: transparent; color: inherit; }
        .ov ha-icon { --mdc-icon-size: 30px; }
        .ov small { font-size: 12px; color: rgba(255,255,255,.65); max-width: 280px; line-height: 1.35; }
        .badge { position: absolute; left: 8px; top: 8px; display: flex; align-items: center; gap: 4px; padding: 3px 9px;
          border-radius: 999px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; }
        .badge ha-icon { --mdc-icon-size: 14px; }

        /* rows + toggle */
        .row { display: flex; align-items: center; gap: 12px; }
        .row-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
          background: var(--soft2); color: var(--secondary-text-color); flex-shrink: 0; transition: background .2s, color .2s; }
        .row-icon.sm { width: 36px; height: 36px; border-radius: 10px; }
        .row-icon.on { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
        .row-icon.tone-ok { background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); }
        .row-icon.tone-warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
        .row-icon.tone-bad { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
        .row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .row-title { font-weight: 600; font-size: 15px; }
        .row-sub { font-size: 13px; color: var(--secondary-text-color); }
        .ovc .row-title, .ovc .row-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .toggle { position: relative; width: 52px; height: 32px; border-radius: 16px; border: none; padding: 0; flex-shrink: 0;
          background: var(--soft2); cursor: pointer; transition: background .2s ease; }
        .toggle .knob { position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .22s cubic-bezier(.25,1,.4,1); }
        .toggle.on { background: var(--accent); }
        .toggle.on .knob { transform: translateX(20px); }
        .toggle:disabled { opacity: .4; cursor: default; }

        .vol-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: -6px; }
        .lbl { font-size: 14px; }
        .val { font-size: 13px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
        .vol-row { display: flex; align-items: center; gap: 10px; }
        .sun { color: var(--secondary-text-color); --mdc-icon-size: 20px; flex-shrink: 0; }

        /* slider — matches the tile card brightness feature */
        .slider { position: relative; flex: 1 1 auto; min-width: 0; height: 42px; border-radius: 12px; overflow: hidden;
          isolation: isolate; cursor: pointer; touch-action: pan-y; user-select: none; --c: var(--accent); }
        .slider::before { content: ""; position: absolute; inset: 0; background: var(--c); opacity: .2; }
        .slider .fill { --h: 4px; --m: calc(42px / 8); --min: calc(var(--h) + var(--m) * 2);
          position: absolute; top: 0; bottom: 0; left: 0;
          width: calc(var(--min) + (100% - var(--min)) * var(--v, 0));
          background: var(--c); border-radius: 0 12px 12px 0; transition: width 180ms ease-in-out; }
        .slider.dragging .fill { transition: none; }
        .slider .fill::after { content: ""; position: absolute; top: 0; bottom: 0; margin: auto 0; right: var(--m);
          width: var(--h); height: 50%; border-radius: 4px; background: #fff; }
        .slider .fill.empty { display: none; }
        .slider.disabled { opacity: .4; cursor: default; }

        /* actions */
        .act-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .act-grid > .act:last-child:nth-child(odd) { grid-column: 1 / -1; }
        .act { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 12px;
          border: none; border-radius: 12px; background: var(--soft); cursor: pointer; text-align: left;
          transition: transform .1s ease, background .15s ease; }
        .act > ha-icon { color: var(--accent); margin-bottom: 6px; }
        .act-title { font-weight: 600; font-size: 14px; }
        .act-sub { font-size: 12px; color: var(--secondary-text-color); line-height: 1.3; }
        .act:not(:disabled):active { background: var(--soft2); transform: scale(.98); }
        .act:disabled { opacity: .4; cursor: default; }
        .act.busy > ha-icon { animation: spin 1s linear infinite; }
        .act.danger { flex-direction: row; align-items: center; justify-content: center; gap: 8px; padding: 13px;
          color: var(--danger); font-weight: 600; background: color-mix(in srgb, var(--danger) 12%, transparent); }
        .act.danger > ha-icon { color: inherit; margin: 0; }

        .offline-box { flex-direction: row; align-items: center; gap: 12px;
          background: color-mix(in srgb, var(--danger) 10%, var(--secondary-background-color, transparent)); }
        .offline-box > ha-icon { color: var(--danger); flex-shrink: 0; }

        /* tablet details */
        details.info { gap: 0; }
        details.info summary { display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; list-style: none; }
        details.info summary::-webkit-details-marker { display: none; }
        details.info summary > ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        details.info summary .chev { margin-left: auto; transition: transform .2s ease; }
        details.info[open] summary .chev { transform: rotate(180deg); }
        .info-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 16px; font-size: 13px; padding-top: 12px; }
        .info-grid .k { color: var(--secondary-text-color); }
        .info-grid .v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* ---- history ---- */
        .range-row { flex-direction: row; align-items: center; gap: 10px; padding: 8px 10px; }
        .range-row .seg { margin: 0; flex: 1; max-width: 320px; }
        .range-row .seg-btn { padding: 7px 4px; font-size: 13px; }
        .stats { flex-direction: row; flex-wrap: wrap; gap: 10px; padding: 12px; }
        .stat { display: flex; align-items: center; gap: 10px; flex: 1 1 150px; min-width: 0; }
        .stat-text { display: flex; flex-direction: column; min-width: 0; }
        .stat-label { font-size: 11px; font-weight: 500; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
        .stat-value { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; }
        .stat-sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chart { position: relative; display: flex; flex-direction: column; gap: 4px; touch-action: pan-y; }
        .strip-label { font-size: 11px; color: var(--secondary-text-color); margin-top: 4px; }
        .strip { display: block; width: 100%; height: 22px; border-radius: 6px; overflow: hidden; background: var(--soft); color: var(--danger); }
        .strip path.on { fill: var(--accent); }
        .strip path.off { fill: transparent; }
        .strip.plug path.on { fill: var(--ok); }
        .strip.app path.on { fill: var(--accent); opacity: .55; }
        .strip.app path.attn { fill: var(--warn); }
        .axis { position: relative; height: 16px; font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
        .axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
        .axis span:first-child { transform: none; }
        .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--secondary-text-color); }
        .legend span { display: inline-flex; align-items: center; gap: 5px; }
        .sw { width: 12px; height: 8px; border-radius: 2px; display: inline-block; background: var(--soft2); }
        .sw.on { background: var(--accent); }
        .sw.off { background: var(--soft2); }
        .sw.attn { background: var(--warn); }
        .sw.dead { background: repeating-linear-gradient(45deg, var(--danger) 0 2px, transparent 2px 5px); }
        .chart.bat { flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: 0 6px; }
        .chart.bat .ylab { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color);
          height: 150px; text-align: right; width: 34px; }
        .chart.bat .plot { position: relative; flex: 1; min-width: 0; height: 150px; border-radius: 8px; overflow: hidden; background: var(--soft); }
        .chart.bat .plot svg { display: block; width: 100%; height: 100%; }
        .chart.bat .axis { flex-basis: 100%; margin-left: 40px; }
        .chart.bat .grid { stroke: var(--divider-color, rgba(120,120,120,.35)); stroke-width: 1; vector-effect: non-scaling-stroke; }
        .chart.bat .band { fill: var(--ok); opacity: .14; }
        .chart.bat .area { fill: var(--accent); opacity: .12; }
        .chart.bat .line { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
        .chart.bat .ov { position: absolute; inset: 0; }
        .xline { position: absolute; top: 0; bottom: 16px; width: 1px; background: var(--primary-text-color); opacity: .5; pointer-events: none;
          left: calc(100% * var(--f, 0)); }
        .chart.bat .xline { left: calc(40px + (100% - 40px) * var(--f, 0)); }
        .tip { position: absolute; top: 4px; left: calc(100% * var(--f, 0)); transform: translateX(8px); padding: 6px 9px; border-radius: 8px; background: var(--bg);
          box-shadow: 0 4px 16px rgba(0,0,0,.3); font-size: 12px; display: flex; flex-direction: column; gap: 2px; pointer-events: none; z-index: 2;
          white-space: nowrap; }
        .chart.bat .tip { left: calc(40px + (100% - 40px) * var(--f, 0)); }
        .tip.left { transform: translateX(calc(-100% - 8px)); }
        .tip span { color: var(--secondary-text-color); }
        .log { gap: 8px; }
        .log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
        .log-list li { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 10px; }
        .log-ic { width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          background: var(--soft); color: var(--secondary-text-color); }
        .log-ic ha-icon { --mdc-icon-size: 18px; }
        .log-ic.tone-on { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
        .log-ic.tone-ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 15%, transparent); }
        .log-ic.tone-warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .log-ic.tone-bad { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
        .log-ic.tone-attn { color: color-mix(in srgb, var(--warn) 60%, var(--primary-text-color)); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .log-text { display: flex; flex-direction: column; min-width: 0; }
        .log-title { font-size: 14px; font-weight: 500; }
        .log-sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* confirmation / progress */
        .cf-scrim { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,.45);
          border-radius: 18px 18px 0 0; animation: fade-in .18s ease; }
        .cf { position: absolute; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 21;
          max-width: 480px; margin: 0 auto;
          display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 16px 16px; text-align: center;
          background: var(--bg); border-radius: 18px; box-shadow: 0 12px 36px rgba(0,0,0,.4);
          animation: cf-up .22s cubic-bezier(.25,1,.4,1); }
        @keyframes cf-up { from { opacity: 0; transform: translateY(20px) scale(.97); } to { opacity: 1; transform: none; } }
        .cf-icon { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
        .cf-icon.calm { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
        .cf-icon ha-icon { --mdc-icon-size: 28px; }
        .cf-title { margin-top: 4px; font-size: 17px; font-weight: 600; }
        .cf-text { max-width: 340px; font-size: 13px; line-height: 1.4; color: var(--secondary-text-color); }
        .cf-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-top: 8px; }
        .cf-btns button { border: none; border-radius: 12px; padding: 13px; font-weight: 600; cursor: pointer; }
        .cf-btns button:active { filter: brightness(.92); }
        .cf-cancel { background: var(--soft2); }
        .cf-go { background: var(--danger); color: #fff !important; }

        .toast { position: absolute; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
          z-index: 30; max-width: calc(100% - 32px); padding: 10px 16px; border-radius: 12px; background: rgba(30,30,30,.92); color: #fff;
          font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: fade-in .2s ease; pointer-events: none;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        @media (max-width: 360px) {
          .tab { font-size: 13px; gap: 4px; }
          .act-sub { display: none; }
        }
      `;
    }
  }
  if (!customElements.get("fully-tablet-sheet")) customElements.define("fully-tablet-sheet", TabletSheet);
