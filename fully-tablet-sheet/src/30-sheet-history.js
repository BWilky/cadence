
    /* ================================================================ */
    /* History page                                                      */
    /* ================================================================ */
    _historyBody(t) {
      const h = this._hist;
      const d = h?.data;
      const loading = !!h?.loading;
      return html`<div class="tab-body hist ${this._dialog ? "cols" : ""}">
        <div class="section full range-row">
          <div class="seg ranges" role="tablist">
            ${RANGES.map(([label, hours]) => html`
              <button class="seg-btn ${this._range === hours ? "on" : ""}" role="tab" aria-selected=${this._range === hours ? "true" : "false"}
                @click=${() => this._setRange(hours)}>${label}</button>`)}
          </div>
          <span class="count">${d ? `Updated ${ago(d.at)}` : ""}</span>
          <button class="icon-btn sm soft" ?disabled=${loading} @click=${() => { haptic("light"); this._maybeLoadHistory(true); }} aria-label="Refresh history">
            <ha-icon class=${loading ? "spin" : ""} icon="mdi:refresh"></ha-icon></button>
        </div>
        ${!d && loading ? html`<div class="section full center"><ha-icon class="spin" icon="mdi:loading"></ha-icon><span class="row-sub">Loading history…</span></div>` : ""}
        ${!d && h?.error ? html`<div class="section offline-box full"><ha-icon icon="mdi:alert-circle-outline"></ha-icon>
          <div class="row-text"><span class="row-title">Couldn't load history</span><span class="row-sub">${h.error}</span></div></div>` : ""}
        ${d ? html`
          ${this._statsSection(t, d)}
          <div class="col">${this._timelineSection(t, d)}${this._batterySection(t, d)}</div>
          <div class="col">${this._logSection(t, d)}</div>` : ""}
      </div>`;
    }

    _statsSection(t, d) {
      const s = d.stats;
      const span = Math.max(1, d.end - d.start);
      const known = span - s.deadMs;
      const onPct = known > 0 ? Math.round((s.onMs / known) * 100) : 0;
      const tiles = [
        ["mdi:monitor", "Screen on", fmtDur(s.onMs), `${onPct}% of the time`, "on"],
        ["mdi:gesture-tap", "Woke up", `${s.onCount}×`, s.onCount ? `every ${fmtDur(span / s.onCount)} on average` : "not once", ""],
        ["mdi:power-plug", "On charger", fmtDur(s.chargeMs), s.unplugCount ? `unplugged ${s.unplugCount}×` : "never unplugged", s.chargeMs > known * 0.9 ? "ok" : s.unplugCount ? "warn" : ""],
        ["mdi:battery-medium", "Battery", s.batMin != null ? `${Math.round(s.batMin)}–${Math.round(s.batMax)}%` : "—", s.batMin != null && s.batMin < 20 ? "dipped below 20%" : "range", s.batMin != null && s.batMin < 20 ? "warn" : ""],
      ];
      if (s.dropCount) tiles.push(["mdi:lan-disconnect", "Lost contact", `${s.dropCount}×`, `offline ${fmtDur(s.deadMs)} in total`, "bad"]);
      return html`
        <div class="section full stats">
          ${tiles.map(([icon, label, value, sub, tone]) => html`
            <div class="stat">
              <div class="row-icon sm tone-${tone} ${tone === "on" ? "on" : ""}"><ha-icon .icon=${icon}></ha-icon></div>
              <div class="stat-text">
                <span class="stat-label">${label}</span>
                <span class="stat-value">${value}</span>
                <span class="stat-sub">${sub}</span>
              </div>
            </div>`)}
        </div>`;
    }

    _ticks(d) {
      const span = d.end - d.start;
      const stepH = span <= 6 * 3600e3 ? 1 : span <= 24 * 3600e3 ? 4 : span <= 48 * 3600e3 ? 8 : 24;
      const out = [];
      const first = new Date(d.start);
      first.setMinutes(0, 0, 0);
      first.setHours(Math.ceil(first.getHours() / stepH) * stepH);
      for (let ts = first.getTime(); ts <= d.end; ts += stepH * 3600e3) {
        const dt = new Date(ts);
        const label = stepH >= 24 ? dt.toLocaleDateString([], { weekday: "short" })
          : dt.toLocaleTimeString([], { hour: "numeric" }).replace(":00", "").replace(/\s/g, "");
        out.push({ x: ((ts - d.start) / span) * 100, label });
      }
      return out;
    }
    _axis(d) {
      return html`<div class="axis">${this._ticks(d).map((k) => html`<span style="left:${k.x}%">${k.label}</span>`)}</div>`;
    }

    /* One <path> per state so nothing needs a nested template inside the <svg> (Lit would parse it as HTML). */
    _rects(segs, start, end, kinds) {
      const span = Math.max(1, end - start);
      const d = {};
      for (const k of kinds) d[k] = "";
      for (const g of segs) {
        const kind = kinds.includes(g.s) ? g.s : g.s === "on" ? "on" : g.s === "off" ? "off" : "dead";
        if (!(kind in d)) continue;
        const x = (((g.from - start) / span) * 1000).toFixed(2);
        const w = Math.max(0.5, ((g.to - g.from) / span) * 1000).toFixed(2);
        d[kind] += `M${x} 0h${w}v24h-${w}Z`;
      }
      return d;
    }
    _strip(segs, start, end, cls) {
      const d = this._rects(segs, start, end, ["on", "off", "dead"]);
      return html`
        <svg class="strip ${cls}" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="p-${cls}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="8" fill="currentColor" opacity=".35"></rect>
            </pattern>
          </defs>
          <path class="on" d=${d.on}></path>
          <path class="off" d=${d.off}></path>
          <path class="dead" fill="url(#p-${cls})" d=${d.dead}></path>
        </svg>`;
    }

    _timelineSection(t, d) {
      const apps = d.fg.map((g) => ({ ...g, s: g.s && !DEAD.includes(g.s) ? (/fully/i.test(g.s) ? "on" : "attn") : "dead" }));
      const appD = this._rects(apps, d.start, d.end, ["on", "attn"]);
      const span = Math.max(1, d.end - d.start);
      return html`
        <div class="section">
          <div class="sec-head"><ha-icon icon="mdi:monitor"></ha-icon><span>Screen</span>
            <span class="count">${fmtTime(d.start, span > 26 * 3600e3)} → now</span></div>
          <div class="chart" @pointermove=${(e) => this._hoverAt(e, d)} @pointerleave=${() => (this._hover = null)}>
            <div class="strip-label">Screen</div>
            ${this._strip(d.screen, d.start, d.end, "scr")}
            <div class="strip-label">Charger</div>
            ${this._strip(d.plugged, d.start, d.end, "plug")}
            <div class="strip-label">In front</div>
            <svg class="strip app" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">
              <path class="on" d=${appD.on}></path>
              <path class="attn" d=${appD.attn}></path>
            </svg>
            ${this._axis(d)}
            ${this._hoverLine(d)}
          </div>
          <div class="legend">
            <span><i class="sw on"></i>On / charging / Fully</span>
            <span><i class="sw off"></i>Off / on battery</span>
            <span><i class="sw attn"></i>Other app in front</span>
            <span><i class="sw dead"></i>No contact</span>
          </div>
        </div>`;
    }

    _batterySection(t, d) {
      const W = 1000, H = 220, span = Math.max(1, d.end - d.start);
      const pts = d.battery;
      const X = (ts) => ((ts - d.start) / span) * W;
      const Y = (v) => H - (v / 100) * H;
      let path = "", area = "";
      if (pts.length) {
        const first = pts[0];
        const startV = first.t > d.start ? first.v : null;
        const seq = [];
        if (first.t > d.start && startV != null) seq.push({ t: d.start, v: startV });
        seq.push(...pts);
        seq.push({ t: d.end, v: seq[seq.length - 1].v });
        path = seq.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
        area = `${path} L${W},${H} L${X(seq[0].t).toFixed(1)},${H} Z`;
      }
      let bands = "";
      for (const g of d.plugged) if (g.s === "on") { const x = X(g.from).toFixed(1), w = Math.max(0.5, X(g.to) - X(g.from)).toFixed(1); bands += `M${x} 0h${w}v${H}h-${w}Z`; }
      const last = pts.length ? pts[pts.length - 1].v : null;
      return html`
        <div class="section">
          <div class="sec-head"><ha-icon icon="mdi:battery-charging"></ha-icon><span>Battery</span>
            <span class="count">${last != null ? `${Math.round(last)}% now` : ""}</span></div>
          <div class="chart bat" @pointermove=${(e) => this._hoverAt(e, d)} @pointerleave=${() => (this._hover = null)}>
            <div class="ylab"><span>100%</span><span>50%</span><span>0%</span></div>
            <div class="plot">
              <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
                <line class="grid" x1="0" x2=${W} y1=${H / 2} y2=${H / 2}></line>
                <line class="grid" x1="0" x2=${W} y1=${H * 0.8} y2=${H * 0.8}></line>
                <path class="band" d=${bands}></path>
                <path class="area" d=${area}></path>
                <path class="line" d=${path}></path>
              </svg>
              ${pts.length ? "" : html`<div class="ov soft"><span class="row-sub">No battery readings in this range</span></div>`}
            </div>
            ${this._axis(d)}
            ${this._hoverLine(d)}
          </div>
        </div>`;
    }

    _hoverAt(e, d) {
      const box = e.currentTarget.querySelector(".plot") || e.currentTarget.querySelector(".strip");
      if (!box) return;
      const r = box.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const ts = d.start + f * (d.end - d.start);
      const at = (segs) => segs.find((g) => ts >= g.from && ts < g.to)?.s;
      const bat = [...d.battery].reverse().find((p) => p.t <= ts)?.v;
      const scr = at(d.screen), plug = at(d.plugged), app = appInfo(at(d.fg));
      this._hover = { f, ts, bat, scr, plug, app };
    }
    _hoverLine(d) {
      const h = this._hover;
      if (!h) return "";
      const bits = [];
      if (h.bat != null) bits.push(`${Math.round(h.bat)}%`);
      if (h.scr) bits.push(DEAD.includes(h.scr) ? "no contact" : `screen ${h.scr}`);
      if (h.plug === "on") bits.push("charging");
      if (h.app && !h.app.fully) bits.push(h.app.name);
      const span = d.end - d.start;
      return html`
        <div class="xline" style="--f:${h.f}"></div>
        <div class="tip ${h.f > 0.6 ? "left" : ""}" style="--f:${h.f}">
          <b>${fmtTime(h.ts, span > 26 * 3600e3)}</b>${bits.length ? html`<span>${bits.join(" · ")}</span>` : ""}
        </div>`;
    }

    _logSection(t, d) {
      const all = d.log;
      const max = this._logMax || 40;
      const rows = all.slice(0, max);
      return html`
        <div class="section log">
          <div class="sec-head"><ha-icon icon="mdi:format-list-bulleted"></ha-icon><span>Activity</span>
            <span class="count">${all.length} event${all.length === 1 ? "" : "s"}</span></div>
          ${rows.length ? html`
            <ul class="log-list">
              ${rows.map((r) => html`
                <li>
                  <span class="log-ic tone-${r.tone}"><ha-icon .icon=${r.icon}></ha-icon></span>
                  <span class="log-text"><span class="log-title">${r.text}</span><span class="log-sub">${r.sub}</span></span>
                </li>`)}
            </ul>
            ${all.length > max ? html`<button class="pill-btn wide" @click=${() => { this._logMax = max + 60; this.requestUpdate(); }}>Show ${Math.min(60, all.length - max)} more</button>` : ""}`
          : html`<div class="row-sub">Nothing recorded in this range. Screen, charger, app and restart events show up here, plus actions taken from this sheet.</div>`}
        </div>`;
    }
