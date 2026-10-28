
    /* ================================================================ */
    /* Render                                                            */
    /* ================================================================ */
    render() {
      if (!this.hass || this._tab === null) return html``;
      const order = this._order();
      if (!order.length) return this._renderEmpty();
      const stats = order.map((x) => this._status(x));
      const offline = stats.filter((s) => s === "offline").length;
      const onCount = stats.filter((s) => s === "on").length;
      const chip = this.single
        ? html`<span class="chip ${stats[0] === "on" ? "on" : stats[0] === "offline" ? "warn" : ""}">${stats[0] === "offline" ? "Offline" : `Screen ${stats[0]}`}</span>`
        : offline
          ? html`<span class="chip warn">${offline} offline</span>`
          : html`<span class="chip ${onCount ? "on" : ""}">${onCount} of ${order.length} on</span>`;
      return this._dialog ? this._renderDialog(order, stats, chip) : this._renderSheet(order, stats, chip);
    }

    _renderEmpty() {
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="${this._dialog ? "dialog" : "sheet"} ${this._closing ? "closing" : ""}" role="dialog" aria-label="Tablets">
          <div class="content" style="padding:24px">
            <header class="content-head" style="padding:0 0 10px"><h2>Tablets</h2>
              <button class="close" @click=${() => this.close()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></header>
            <div class="section offline-box">
              <ha-icon icon="mdi:tablet-off"></ha-icon>
              <div class="row-text">
                <span class="row-title">No Fully Kiosk tablets found</span>
                <span class="row-sub">Add the Fully Kiosk Browser integration, or list your tablets under <code>tablets:</code> in the card config.</span>
              </div>
            </div>
          </div>
        </div>`;
    }

    _pageSwitch() {
      return html`
        <div class="seg" role="tablist">
          <button class="seg-btn ${this._page === "controls" ? "on" : ""}" role="tab" aria-selected=${this._page === "controls" ? "true" : "false"}
            @click=${() => this._setPage("controls")}><ha-icon icon="mdi:tune-variant"></ha-icon>Controls</button>
          <button class="seg-btn ${this._page === "history" ? "on" : ""}" role="tab" aria-selected=${this._page === "history" ? "true" : "false"}
            @click=${() => this._setPage("history")}><ha-icon icon="mdi:chart-timeline-variant"></ha-icon>History</button>
        </div>`;
    }

    _tabletPage(t, status) {
      if (this._page === "history") return this._historyBody(t);
      return t.key === resolveLocal(this.hass) ? this._localBody(t) : this._tabBody(t, status);
    }

    /* ---------- phone: bottom sheet with tabs ---------- */
    _renderSheet(order, stats, chip) {
      const t = order.find((x) => x.key === this._tab) || order[0];
      const style = this._sheetY > 0 ? `transform:translateY(${this._sheetY}px);transition:none;` : "";
      const lk = resolveLocal(this.hass);
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="sheet ${this._closing ? "closing" : ""}" style=${style} role="dialog" aria-label="Tablets">
          <div class="header" @pointerdown=${this._hDown} @pointermove=${this._hMove}
               @pointerup=${this._hUp} @pointercancel=${this._hUp}>
            <div class="grabber"></div>
            <div class="title-row">
              <ha-icon .icon=${this.single ? (t.icon || "mdi:tablet") : "mdi:tablet-dashboard"}></ha-icon>
              <span class="title">${this.single ? t.name : "Tablets"}</span>
              ${this.single && t.key === lk ? html`<span class="chip"><ha-icon icon="mdi:map-marker"></ha-icon>This tablet</span>` : chip}
              <button class="close" @pointerdown=${(e) => e.stopPropagation()}
                @click=${() => this.close()} aria-label="Close">
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </div>
            ${this.single ? "" : html`
            <div class="tabs" role="tablist" @pointerdown=${(e) => e.stopPropagation()}>
              ${order.map((x, i) => {
                const me = x.key === lk;
                return html`
                  <button class="tab ${x.key === t.key ? "on" : ""}" role="tab"
                    aria-selected=${x.key === t.key ? "true" : "false"}
                    title=${me ? `${x.name} · this tablet` : `${x.name} · ${stats[i] === "offline" ? "offline" : `screen ${stats[i]}`}`}
                    @click=${() => this._setTab(x.key)}>
                    ${me ? html`<ha-icon class="here" icon="mdi:map-marker"></ha-icon>` : html`<span class="dot ${stats[i]}"></span>`}${x.short}</button>`;
              })}
            </div>`}
            <div @pointerdown=${(e) => e.stopPropagation()}>${this._pageSwitch()}</div>
          </div>
          <div class="body">${this._tabletPage(t, stats[order.indexOf(t)])}</div>
          ${this._confirm && (this._confirm.tab === t.key || this._confirm.tab === this._tab) ? this._confirmDialog() : ""}
          ${this._toastMsg ? html`<div class="toast">${this._toastMsg}</div>` : ""}
        </div>
      `;
    }

    /* ---------- tablet / desktop: centred dialog with a sidebar ---------- */
    _renderDialog(order, stats, chip) {
      const ov = this._tab === OVERVIEW && !this.single;
      const t = ov ? null : order.find((x) => x.key === this._tab) || order[0];
      const lk = resolveLocal(this.hass);
      const isLocal = !!t && t.key === lk;
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="dialog ${this._closing ? "closing" : ""}" role="dialog" aria-label="Tablets">
          <aside class="side">
            <div class="side-head">
              <span class="side-title">${this.single ? "Tablet" : "Tablets"}</span>
              ${chip}
            </div>
            <nav role="tablist">
              ${this.single ? "" : html`
              <button class="nav-item ${ov ? "on" : ""}" role="tab" aria-selected=${ov ? "true" : "false"}
                @click=${() => this._setTab(OVERVIEW)}>
                <ha-icon icon="mdi:view-grid-outline"></ha-icon><span class="nav-name">Overview</span></button>`}
              ${order.map((x, i) => {
                const sel = !ov && x.key === t.key;
                const me = x.key === lk;
                const bat = this._battery(x);
                const low = bat && bat.level < 20 && !bat.charging;
                return html`
                  <button class="nav-item ${sel ? "on" : ""}" role="tab" aria-selected=${sel ? "true" : "false"}
                    aria-label="${x.name}${me ? ", this tablet" : ""}, ${stats[i] === "offline" ? "offline" : `screen ${stats[i]}`}${bat ? `, battery ${Math.round(bat.level)}%` : ""}"
                    @click=${() => this._setTab(x.key)}>
                    <span class="nav-dot"><span class="dot ${stats[i]}"></span></span>
                    <span class="nav-name">${x.name}</span>
                    ${me ? html`<ha-icon class="here" icon="mdi:map-marker" title="This tablet"></ha-icon>` : ""}
                    ${bat ? html`<span class="nav-bat ${low ? "warn" : bat.charging ? "ok" : ""}">
                      ${bat.charging ? html`<ha-icon icon="mdi:lightning-bolt"></ha-icon>` : ""}${Math.round(bat.level)}%</span>` : ""}
                  </button>`;
              })}
              ${this.single ? html`
                <div class="nav-sep"></div>
                <button class="nav-item ${this._page === "controls" ? "on" : ""}" role="tab" @click=${() => this._setPage("controls")}>
                  <ha-icon icon="mdi:tune-variant"></ha-icon><span class="nav-name">Controls</span></button>
                <button class="nav-item ${this._page === "history" ? "on" : ""}" role="tab" @click=${() => this._setPage("history")}>
                  <ha-icon icon="mdi:chart-timeline-variant"></ha-icon><span class="nav-name">History</span></button>` : ""}
            </nav>
            ${this._sideBattery()}
          </aside>
          <main class="content">
            <header class="content-head">
              <h2>${ov ? "Overview" : t.name}</h2>
              ${isLocal ? html`<span class="chip"><ha-icon icon="mdi:map-marker"></ha-icon>This tablet</span>` : ""}
              ${ov ? html`<span class="count">Updated ${ago(this._ovAt)}</span>
                <button class="icon-btn sm soft" @click=${() => this._refreshOverview()} aria-label="Refresh screenshots">
                  <ha-icon icon="mdi:refresh"></ha-icon></button>` : this.single ? "" : this._pageSwitch()}
              <button class="close" @click=${() => this.close()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button>
            </header>
            <div class="body">
              ${ov ? this._overview(order, stats) : this._tabletPage(t, stats[order.indexOf(t)])}
            </div>
          </main>
          ${this._confirm && this._confirm.tab === this._tab ? this._confirmDialog() : ""}
          ${this._toastMsg ? html`<div class="toast">${this._toastMsg}</div>` : ""}
        </div>
      `;
    }

    /* Bottom of the sidebar: this tablet's battery (only inside Fully) */
    _sideBattery() {
      const lk = resolveLocal(this.hass);
      if (!lk) return html`<div class="side-spacer"></div>`;
      const s = this._snap || {};
      const level = Number(s.battery);
      const known = s.battery != null && Number.isFinite(level);
      const charging = !!s.plugged;
      const b = bmsState();
      const d = bmsDisplay(b);
      const tone = known && level < 20 && !charging ? "bad" : b && d.tone !== "ok" ? d.tone : charging ? "ok" : "";
      return html`
        <div class="side-spacer"></div>
        <button class="mini" @click=${() => { this._setTab(lk); this._setPage("controls"); }} aria-label="This tablet's battery: ${known ? `${Math.round(level)}%` : "unknown"}">
          <span class="mini-ic tone-${tone}"><ha-icon .icon=${batteryIcon(known ? level : null, charging)}></ha-icon></span>
          <div class="mini-text">
            <span>${known ? `${Math.round(level)}%` : "Battery"}<small class="mini-tag"> · this tablet</small></span>
            <small>${charging ? "Charging" : "On battery"}${b !== undefined ? ` · ${d.text}` : ""}</small>
          </div>
        </button>`;
    }

    /* ---------- overview ---------- */
    _overview(order, stats) {
      return html`<div class="ov-grid">${order.map((t, i) => this._ovCard(t, stats[i]))}</div>`;
    }
    _ovCard(t, status) {
      const I = ids(t.prefix);
      const online = status !== "offline";
      const on = status === "on";
      const me = t.key === resolveLocal(this.hass);
      const url = online ? this._shotUrl(I, this._ovTs) : null;
      const bat = this._battery(t);
      const low = bat && bat.level < 20 && !bat.charging;
      const app = online && !me ? appInfo(this._st(I.fg)?.state) : null;
      const away = app && !app.fully;
      const toggle = me && this._snap
        ? this._toggle(this._localOn(), !(local.has("turnScreenOff") || local.has("turnScreenOn")), () => this._localScreen(t))
        : this._toggle(on, !online || !this._st(I.screen), () => this._toggleScreen(t, I));
      return html`
        <div class="section ovc ${online ? "" : "off"}">
          <button class="ov-shot" @click=${() => this._setTab(t.key)} aria-label="Open ${t.name}">
            ${url ? html`<img src=${url} alt="Screenshot of the ${t.name} tablet" loading="lazy" decoding="async"
                @error=${(e) => (e.target.style.visibility = "hidden")} @load=${(e) => (e.target.style.visibility = "visible")} />`
              : html`<div class="ov"><ha-icon .icon=${online ? "mdi:image-off-outline" : "mdi:tablet-off"}></ha-icon>${online ? "No screenshot" : "Offline"}</div>`}
            ${online && !on ? html`<span class="badge"><ha-icon icon="mdi:monitor-off"></ha-icon>Screen off</span>` : ""}
          </button>
          <div class="row">
            <span class="dot ${status}"></span>
            <div class="row-text">
              <span class="row-title">${t.name}${me ? html`<ha-icon class="here-sm" icon="mdi:map-marker"></ha-icon>` : ""}</span>
              <span class="row-sub">${!online ? "Offline" : on ? "Screen on" : "Screen off"}${away
                ? html` · <span class="attn-t" title=${app.pkg}>${app.name} in front</span>` : ""}${bat
                ? html` · <span class=${low ? "warn-t" : ""}>${Math.round(bat.level)}%${bat.charging ? ", charging" : ""}</span>` : ""}</span>
            </div>
            <button class="icon-btn sm soft" @click=${() => { this._setTab(t.key); this._setPage("history"); }} aria-label="History for ${t.name}">
              <ha-icon icon="mdi:chart-timeline-variant"></ha-icon></button>
            ${toggle}
          </div>
        </div>`;
    }

    /* ---------- remote tablet: controls ---------- */
    _tabBody(t, status) {
      const I = ids(t.prefix);
      const online = status !== "offline";
      const on = status === "on";
      return html`<div class="tab-body ${this._dialog ? "cols" : ""}">
        ${online ? "" : html`
          <div class="section offline-box full">
            <ha-icon icon="mdi:tablet-off"></ha-icon>
            <div class="row-text">
              <span class="row-title">${t.name} tablet is offline</span>
              <span class="row-sub">Home Assistant can't reach Fully on it. Check that it has power and Wi-Fi.</span>
            </div>
          </div>`}
        ${this._dialog ? html`
          <div class="col">${this._shotSection(t, I, online, on)}${this._screenSection(t, I, online, on)}</div>
          <div class="col">${this._browserSection(t, I, online)}${this._powerSection(t, I, online)}</div>`
        : html`
          ${this._shotSection(t, I, online, on)}
          ${this._screenSection(t, I, online, on)}
          ${this._actions(t, I, online)}`}
      </div>`;
    }

    _shotSection(t, I, online, on) {
      const url = online ? this._shotUrl(I) : null;
      const orient = Number(this._st(I.orient)?.state);
      const portrait = orient === 0 || orient === 180;
      const loading = online && this._shotState === "loading";
      let overlay = "";
      if (!online) overlay = html`<div class="ov"><ha-icon icon="mdi:tablet-off"></ha-icon>No screenshot while offline</div>`;
      else if (!url) overlay = html`<div class="ov"><ha-icon icon="mdi:image-off-outline"></ha-icon>No screenshot entity for this tablet</div>`;
      else if (this._shotState === "error") overlay = html`<div class="ov"><ha-icon icon="mdi:image-off-outline"></ha-icon>
          Couldn't get a screenshot<small>Check that screenshots are allowed in Fully's Remote Administration settings. Tap to try again.</small></div>`;
      else if (loading && !this._shotAt) overlay = html`<div class="ov soft"><ha-icon class="spin" icon="mdi:loading"></ha-icon></div>`;
      return html`
        <div class="section s-shot">
          <div class="sec-head">
            <ha-icon icon="mdi:cellphone-screenshot"></ha-icon><span>Screen view</span>
            <span class="count">${online && this._shotAt ? `Updated ${ago(this._shotAt)}` : ""}</span>
            <button class="icon-btn sm soft" ?disabled=${!online || !url}
              @click=${() => this._refreshShot(true)} aria-label="Refresh screenshot">
              <ha-icon class=${loading ? "spin" : ""} icon="mdi:refresh"></ha-icon></button>
          </div>
          <button class="shot ${portrait ? "portrait" : ""}" ?disabled=${!online || !url}
            @click=${() => this._refreshShot(true)} aria-label="Refresh screenshot">
            ${url ? html`<img src=${url} alt="Screenshot of the ${t.name} tablet"
              @load=${this._onShotLoad} @error=${this._onShotError} />` : ""}
            ${online && !on && url ? html`<span class="badge"><ha-icon icon="mdi:monitor-off"></ha-icon>Screen off</span>` : ""}
            ${overlay}
          </button>
        </div>
      `;
    }

    _screenSection(t, I, online, on) {
      const scr = this._st(I.screen);
      const bst = this._st(I.bright);
      const level = parseFloat(this._st(I.battery)?.state);
      const charging = this._st(I.plugged)?.state === "on";
      const page = this._st(I.page)?.state;
      const app = online ? appInfo(this._st(I.fg)?.state) : null;
      let bright = "";
      if (bst) {
        const max = Number(bst.attributes?.max) || 255;
        const min = Number(bst.attributes?.min) || 0;
        const raw = parseFloat(bst.state);
        const pct = isNaN(raw) ? null : Math.round(((raw - min) / (max - min)) * 100);
        const key = `bright:${t.key}`;
        const shown = this._shown(key, pct);
        bright = this._sliderRow("Brightness", shown != null ? `${shown}%` : "Not set", "mdi:brightness-5", "mdi:brightness-7",
          this._slider({
            key, label: "Brightness", value: pct, disabled: !online || bst.state === "unavailable",
            onCommit: (v) => this._call("number", "set_value", { entity_id: I.bright, value: Math.round(min + (v / 100) * (max - min)) })
              .then((ok) => ok && logAction(this.hass, t, `brightness set to ${v}%`)),
          }));
      }
      return html`
        <div class="section">
          <div class="row">
            <div class="row-icon ${on ? "on" : ""}"><ha-icon .icon=${on ? "mdi:monitor" : "mdi:monitor-off"}></ha-icon></div>
            <div class="row-text">
              <span class="row-title">Screen</span>
              <span class="row-sub">${!online ? "Unavailable" : on ? "On" : "Off"}</span>
            </div>
            ${this._toggle(on, !online || !scr, () => this._toggleScreen(t, I))}
          </div>
          ${bright}
          ${online ? html`
            <div class="chips">
              ${app ? html`<span class="chip ${app.fully ? "" : "attn"}" title=${app.pkg}>
                <ha-icon .icon=${app.icon}></ha-icon>${app.name} in front</span>` : ""}
              ${!isNaN(level) ? this._batteryChip(level, charging) : ""}
              ${page && !DEAD.includes(page) ? html`<span class="chip page" title=${page}>
                <ha-icon icon="mdi:web"></ha-icon><span class="ell">${pagePath(page)}</span></span>` : ""}
            </div>` : ""}
        </div>
      `;
    }

    _browserItems(t, I, online, forGrid) {
      const has = (name) => !!this._st(I.btn(name));
      const fg = this._st(I.fg)?.state;
      const fullyInFront = !!fg && !DEAD.includes(fg) && /fully/i.test(fg);
      const other = !fullyInFront ? appInfo(fg) : null;
      const front = ["front", "bring_to_foreground", "mdi:flip-to-front", "Bring to front",
        other ? `${other.name} is in front · puts Fully back` : "Puts Fully back on screen", "Bringing Fully to the front"];
      const back = ["back", "send_to_background", "mdi:flip-to-back", "Send to background", "Fully is on screen · shows the Android home screen", "Sending Fully to the background"];
      const items = [
        ["reload", "load_start_url", "mdi:refresh", "Reload page", "Opens the start page again", "Reloading page"],
        ["browser", "restart_browser", "mdi:restart", "Restart browser", "Relaunches Fully Kiosk", "Restarting browser"],
        ["cache", "clear_browser_cache", "mdi:broom", "Clear cache", "Clears the browser cache", "Clearing cache"],
      ].filter(([, name]) => has(name));
      if (forGrid) {
        const fully = fullyInFront && has("send_to_background") ? back : has("bring_to_foreground") ? front : has("send_to_background") ? back : null;
        if (fully) items.push(fully);
      } else {
        if (has("bring_to_foreground")) items.push(front);
        if (has("send_to_background")) items.push(back);
      }
      const run = ([k, name, , , , done]) => {
        const go = (feel) => { this._press(t, I.btn(name), `${t.key}:${k}`, done, feel); logAction(this.hass, t, done.toLowerCase()); };
        if (k === "back") {
          this._ask({
            icon: "mdi:flip-to-back", title: `Send Fully to the background on ${t.name}?`,
            text: "The tablet shows the Android home screen until Fully is brought back to the front.",
            go: "Send to background",
          }, () => go(false));
        } else go(true);
      };
      return items.map((a) => this._actBtn(a[2], a[3], a[4], this._busy === `${t.key}:${a[0]}`, !online, () => run(a)));
    }
    _actions(t, I, online) {
      return html`
        <div class="section">
          <div class="act-grid">${this._browserItems(t, I, online, false)}</div>
          ${this._plugRow(t)}
          ${this._restartBtn(t, I, online)}
        </div>`;
    }
    _restartBtn(t, I, online) {
      if (!this._st(I.btn("restart_device"))) return "";
      return html`
        <button class="act danger ${this._busy === `${t.key}:reboot` ? "busy" : ""}" ?disabled=${!online}
          @click=${() => this._ask({
            icon: "mdi:power-cycle", title: `Restart ${t.name} tablet?`,
            text: "The screen goes dark while it reboots. It's usually back on the dashboard within a couple of minutes.",
            go: "Restart",
          }, () => { this._press(t, I.reboot, `${t.key}:reboot`, `Restarting ${t.name} tablet`, false); logAction(this.hass, t, "restart requested"); })}>
          <ha-icon icon="mdi:power-cycle"></ha-icon>Restart tablet
        </button>`;
    }
    _browserSection(t, I, online) {
      const items = this._browserItems(t, I, online, true);
      if (!items.length) return "";
      return html`
        <div class="section">
          <div class="sec-head"><ha-icon icon="mdi:web"></ha-icon><span>Browser</span></div>
          <div class="act-grid">${items}</div>
        </div>`;
    }
    _powerSection(t, I, online) {
      const plug = this._plugRow(t);
      const restart = this._restartBtn(t, I, online);
      if (!plug && !restart) return "";
      return html`
        <div class="section power">
          <div class="sec-head"><ha-icon icon="mdi:power-plug-outline"></ha-icon><span>Power</span></div>
          ${plug}
          ${restart}
        </div>`;
    }

    /* ---------- this tablet (native) ---------- */
    _localBody(t) {
      const s = this._snap || {};
      if (this._dialog) {
        return html`<div class="tab-body cols">
          ${this._bmsSection()}
          <div class="col">${this._localScreenSection(t, s)}${this._infoSection(s)}</div>
          <div class="col">${this._localActions(t, "browser")}${this._localActions(t, "power")}</div>
        </div>`;
      }
      return html`<div class="tab-body">
        ${this._bmsSection()}
        ${this._localScreenSection(t, s)}
        ${this._localActions(t)}
        ${this._infoSection(s)}
      </div>`;
    }

    _bmsSection() {
      const b = bmsState();
      if (b === undefined) return "";
      const d = bmsDisplay(b);
      return html`
        <div class="section full">
          <div class="row">
            <div class="row-icon tone-${d.tone}"><ha-icon icon="mdi:battery-heart-variant"></ha-icon></div>
            <div class="row-text">
              <span class="row-title">Battery management</span>
              <span class="row-sub">${d.text}</span>
            </div>
            <button class="pill-btn" @click=${() => {
              haptic("light");
              window.dispatchEvent(new CustomEvent("pauseadaptivebrightness"));
              haptic("success");
              this._toast("Adaptive brightness paused");
            }}>Pause auto-dimming</button>
          </div>
        </div>`;
    }

    _localScreenSection(t, s) {
      const on = this._localOn();
      const canScreen = local.has("turnScreenOff") || local.has("turnScreenOn");
      const bPct = Number.isFinite(Number(s.brightness)) ? Math.round((Number(s.brightness) / 255) * 100) : null;
      const bShown = this._shown("lbright", bPct);
      const vol = Number.isFinite(Number(s.volume)) ? Math.round(Number(s.volume)) : null;
      const vShown = this._shown("lvol", vol);
      const level = Number(s.battery);
      return html`
        <div class="section">
          <div class="row">
            <div class="row-icon ${on ? "on" : ""}"><ha-icon .icon=${on ? "mdi:monitor" : "mdi:monitor-off"}></ha-icon></div>
            <div class="row-text">
              <span class="row-title">Screen</span>
              <span class="row-sub">${on ? "On" : "Off"}, controlled directly on this tablet</span>
            </div>
            ${canScreen ? this._toggle(on, false, () => this._localScreen(t)) : ""}
          </div>
          ${local.has("setScreenBrightness") ? this._sliderRow("Brightness", bShown != null ? `${bShown}%` : "", "mdi:brightness-5", "mdi:brightness-7",
            this._slider({
              key: "lbright", label: "Brightness", value: bPct,
              onInput: (v) => local.call("setScreenBrightness", Math.round((v / 100) * 255)),
              onCommit: (v) => this._localBrightness(v),
            })) : ""}
          ${local.has("setAudioVolume") ? this._sliderRow("Volume", vShown != null ? `${vShown}%` : "", "mdi:volume-low", "mdi:volume-high",
            this._slider({
              key: "lvol", label: "Volume", value: vol,
              onCommit: (v) => { local.call("setAudioVolume", v, 3); this._snapSoon(); },
            })) : ""}
          <div class="chips">
            ${Number.isFinite(level) ? this._batteryChip(level, !!s.plugged) : ""}
            ${s.ssid ? html`<span class="chip"><ha-icon icon="mdi:wifi"></ha-icon>${s.ssid}</span>` : ""}
          </div>
        </div>
      `;
    }

    _localActions(t, part) {
      const items = [
        { fn: "loadStartUrl", icon: "mdi:refresh", title: "Reload page", sub: "Opens the start page again", done: "Reloading page" },
        { fn: "clearCache", icon: "mdi:broom", title: "Clear cache", sub: "Clears the browser cache", done: "Cache cleared" },
        { fn: "restartApp", icon: "mdi:restart", title: "Restart browser", sub: "Relaunches Fully Kiosk", done: "Restarting browser",
          confirm: { icon: "mdi:restart", title: "Restart the browser on this tablet?", text: "Fully closes and reopens, so this sheet closes too.", go: "Restart browser" } },
        { fn: "disableWifi", needs: "enableWifi", icon: "mdi:wifi-refresh", title: "Reconnect Wi-Fi", sub: "Off for 5 seconds, then on",
          confirm: { icon: "mdi:wifi-refresh", title: "Reconnect Wi-Fi on this tablet?", text: "Wi-Fi turns off for 5 seconds, then back on. The dashboard reconnects on its own.", go: "Reconnect" },
          run: () => this._wifiSequence(t) },
        { fn: "bringToBackground", icon: "mdi:flip-to-back", title: "Send to background", sub: "Shows the Android home screen", done: "Sending Fully to the background",
          confirm: { icon: "mdi:flip-to-back", title: "Send Fully to the background?", text: "This tablet shows the Android home screen until Fully is brought back to the front from Home Assistant.", go: "Send to background" } },
      ].filter((a) => local.has(a.fn) && (!a.needs || local.has(a.needs)));
      const run = (a) => {
        const go = (feel) => (a.run ? a.run() : this._localDo(t, a.fn, a.done, feel));
        if (a.confirm) this._ask(a.confirm, () => go(false)); else go(true);
      };
      const btn = (a) => this._actBtn(a.icon, a.title, a.sub, false, false, () => run(a));
      const reboot = local.has("reboot") ? html`
            <button class="act danger" @click=${() => this._ask({
              icon: "mdi:power-cycle", title: "Restart this tablet?",
              text: "The screen goes dark while it reboots. It's usually back on the dashboard within a couple of minutes.",
              go: "Restart",
            }, () => this._localDo(t, "reboot", "Restarting this tablet", false))}>
              <ha-icon icon="mdi:power-cycle"></ha-icon>Restart tablet
            </button>` : "";
      if (part === "browser") {
        const b = items.filter((a) => a.fn !== "disableWifi");
        return b.length ? html`
          <div class="section">
            <div class="sec-head"><ha-icon icon="mdi:web"></ha-icon><span>Browser</span></div>
            <div class="act-grid">${b.map(btn)}</div>
          </div>` : "";
      }
      if (part === "power") {
        const wifi = items.find((a) => a.fn === "disableWifi");
        return html`
          <div class="section power">
            <div class="sec-head"><ha-icon icon="mdi:power-plug-outline"></ha-icon><span>Power</span></div>
            ${this._plugRow(t)}
            ${wifi ? html`<div class="act-grid one">${btn(wifi)}</div>` : ""}
            ${reboot}
          </div>`;
      }
      return html`
        <div class="section">
          <div class="act-grid">${items.map(btn)}</div>
          ${this._plugRow(t)}
          ${reboot}
        </div>
      `;
    }

    _infoSection(s) {
      const free = gb(s.storageFree), total = gb(s.storageTotal);
      const rows = [
        ["Model", s.model],
        ["Android", s.android],
        ["Fully version", s.fullyVersion],
        ["Wi-Fi", s.ssid ? `${s.ssid}${Number.isFinite(Number(s.signal)) ? `, ${s.signal} dBm` : ""}` : null],
        ["IP address", s.ip],
        ["Storage free", free ? `${free}${total ? ` of ${total}` : ""}` : null],
      ].filter(([, v]) => v !== undefined && v !== null && v !== "");
      if (!rows.length) return "";
      return html`
        <details class="section info full">
          <summary><ha-icon icon="mdi:information-outline"></ha-icon><span>Tablet details</span>
            <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="info-grid">${rows.map(([k, v]) => html`<span class="k">${k}</span><span class="v">${v}</span>`)}</div>
        </details>`;
    }

    /* ---------- shared bits ---------- */
    _toggle(on, disabled, onClick) {
      return html`<button class="toggle ${on ? "on" : ""}" role="switch" aria-checked=${on ? "true" : "false"}
        aria-label="Screen" ?disabled=${disabled} @click=${onClick}><span class="knob"></span></button>`;
    }
    _sliderRow(label, val, lowIcon, highIcon, slider) {
      return html`
        <div class="vol-head"><span class="lbl">${label}</span><span class="val">${val}</span></div>
        <div class="vol-row">
          <ha-icon class="sun" .icon=${lowIcon}></ha-icon>${slider}<ha-icon class="sun" .icon=${highIcon}></ha-icon>
        </div>`;
    }
    _batteryChip(level, charging) {
      return html`<span class="chip ${level < 20 && !charging ? "warn" : ""}">
        <ha-icon .icon=${batteryIcon(level, charging)}></ha-icon>${Math.round(level)}%${charging ? ", charging" : ""}</span>`;
    }
    _actBtn(icon, title, sub, busy, disabled, onClick) {
      return html`
        <button class="act ${busy ? "busy" : ""}" ?disabled=${disabled} @click=${onClick}>
          <ha-icon .icon=${icon}></ha-icon>
          <span class="act-title">${title}</span>
          <span class="act-sub">${sub}</span>
        </button>`;
    }

    _confirmDialog() {
      const c = this._confirm;
      return html`
        <div class="cf-scrim" @click=${() => this._cancelConfirm()}></div>
        <div class="cf" role="alertdialog" aria-label=${c.title}>
          <div class="cf-icon ${c.progress ? "calm" : ""}">
            <ha-icon class=${c.progress ? "spin" : ""} .icon=${c.progress ? "mdi:loading" : c.icon || "mdi:alert"}></ha-icon></div>
          <div class="cf-title">${c.title}</div>
          <div class="cf-text">${c.text}</div>
          ${c.progress ? "" : html`
            <div class="cf-btns">
              <button class="cf-cancel" @click=${() => this._cancelConfirm()}>Cancel</button>
              <button class="cf-go" @click=${() => this._go()}>${c.go || "Confirm"}</button>
            </div>`}
        </div>
      `;
    }
