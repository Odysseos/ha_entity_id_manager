const KEYS = ["areas", "devices", "entities"];
const PART = /^[a-z][a-z0-9_]*$/;
const WORDS = {
  ru: {
    title: "Соответствия частей ID",
    areas: "Зоны",
    devices: "Устройства",
    entities: "Сущности",
    choose: "Выберите объект",
    part: "Часть ID",
    clear: "Очистить",
    reset: "Сбросить изменения",
    confirm: "Подтвердить",
    cancel: "Отмена",
    close: "Закрыть",
    open: "Открыть редактор",
    saved:
      "Соответствия сохранены. Переименование сущностей выполняется отдельно через «Просмотр и применение» в настройках интеграции.",
    intro:
      "Измените части ID нескольких объектов и подтвердите их одной операцией. Отображаемые названия не меняются.",
    settings: "Настройки интеграции: просмотр и применение",
    invalid:
      "Используйте строчные латинские буквы, цифры и подчёркивания; начните с буквы.",
    changed: "Изменено объектов",
    failed: "Не удалось сохранить. Черновик сохранён в открытом редакторе.",
    stale:
      "Соответствия изменились в другом окне. Отмените черновик и откройте редактор заново.",
    missing:
      "Объект больше не существует. Очистите его черновое значение или отмените изменения.",
    loadError: "Не удалось загрузить соответствия.",
    retry: "Повторить",
    saving: "Сохранение…",
    search: "Поиск",
  },
  en: {
    title: "ID part mappings",
    areas: "Areas",
    devices: "Devices",
    entities: "Entities",
    choose: "Select object",
    part: "ID part",
    clear: "Clear",
    reset: "Reset changes",
    confirm: "Confirm",
    cancel: "Cancel",
    close: "Close",
    open: "Open editor",
    saved:
      "Mappings saved. Rename entities separately using Preview and apply in integration options.",
    intro:
      "Edit ID parts for several objects and confirm them together. Display names stay unchanged.",
    settings: "Integration options: preview and apply",
    invalid:
      "Use lowercase ASCII letters, digits and underscores; start with a letter.",
    changed: "Changed objects",
    failed: "Could not save. Your draft remains in the open editor.",
    stale:
      "Mappings changed in another window. Cancel the draft and reopen the editor.",
    missing:
      "Object no longer exists. Clear its draft value or cancel changes.",
    loadError: "Could not load mappings.",
    retry: "Retry",
    saving: "Saving…",
    search: "Search",
  },
};

export class DraftStore {
  constructor(snapshot) {
    this.revision = snapshot.revision;
    this.objects = structuredClone(snapshot.objects);
    this.saved = structuredClone(snapshot.mappings);
    this.drafts = Object.fromEntries(KEYS.map((k) => [k, {}]));
  }
  value(key, id) {
    return Object.hasOwn(this.drafts[key], id)
      ? this.drafts[key][id]
      : this.saved[key][id] || "";
  }
  set(key, id, value) {
    const next = value.trim();
    if (next === (this.saved[key][id] || "")) delete this.drafts[key][id];
    else this.drafts[key][id] = next;
  }
  reset(key, id) {
    delete this.drafts[key][id];
  }
  get count() {
    return KEYS.reduce((n, k) => n + Object.keys(this.drafts[k]).length, 0);
  }
  get valid() {
    return KEYS.every((k) =>
      Object.values(this.drafts[k]).every((v) => !v || PART.test(v)),
    );
  }
  segments(key, id) {
    const saved = this.saved[key][id] || "";
    const changed = Object.hasOwn(this.drafts[key], id);
    const result = [];
    if (saved)
      result.push({ value: saved, kind: changed ? "removed" : "saved" });
    if (changed && this.drafts[key][id])
      result.push({ value: this.drafts[key][id], kind: "added" });
    return result;
  }
  changes() {
    return structuredClone(this.drafts);
  }
}

export class IDManagerPanel extends (globalThis.HTMLElement || class {}) {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.kind = "areas";
    this.selected = {};
    this.busy = false;
  }
  set hass(value) {
    this._hass = value;
    if (!this.initialized && this.isConnected) this.initialize();
  }
  get words() {
    return WORDS[this._hass?.locale?.language?.startsWith("ru") ? "ru" : "en"];
  }
  connectedCallback() {
    if (this._hass && !this.initialized) this.initialize();
  }
  disconnectedCallback() {
    this.cancel();
    this.initialized = false;
  }
  initialize() {
    this.initialized = true;
    this.render();
  }
  render() {
    const w = this.words;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;height:100%;overflow:auto;color:var(--primary-text-color);background:var(--primary-background-color);font-family:var(--paper-font-body1_-_font-family,Roboto,sans-serif)}
      header{display:flex;align-items:center;gap:16px;height:64px;padding:0 20px;background:var(--app-header-background-color,var(--primary-color));color:var(--app-header-text-color,white)}h1{font-size:20px;margin:0}main{max-width:760px;margin:32px auto;padding:24px;background:var(--card-background-color,white);border-radius:16px}p{line-height:1.5}a{color:var(--primary-color)}
      button{font:inherit;padding:11px 18px;border:0;border-radius:24px;cursor:pointer;color:var(--primary-color);background:transparent}button.primary{background:var(--primary-color,#03a9c4);color:var(--text-primary-color,white)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}
      dialog{box-sizing:border-box;width:min(760px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:28px;border:0;border-radius:28px;color:var(--primary-text-color,#222);background:var(--card-background-color,white)}dialog::backdrop{background:#0006}.heading{display:flex;align-items:center;gap:12px}.heading h2{font-size:24px;margin:0}.heading button{font-size:28px;padding:0 8px}.tabs{display:flex;gap:8px;margin:24px 0}.tabs button[aria-selected=true]{background:var(--secondary-background-color,#eee);font-weight:bold}
      label{display:block;margin:22px 0 6px;font-size:14px;color:var(--secondary-text-color,#666)}input{box-sizing:border-box;width:100%;padding:16px 12px;font:inherit;color:var(--primary-text-color,#222);background:var(--secondary-background-color,#f5f5f5);border:0;border-bottom:1px solid var(--secondary-text-color,#777);border-radius:4px 4px 0 0}.tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.actions{display:flex;justify-content:flex-end;gap:12px;margin-top:28px}.hint,.count{font-size:14px;color:var(--secondary-text-color,#666)}.error{color:var(--error-color,#b00020);white-space:pre-wrap}#status{white-space:pre-wrap}@media(max-width:600px){main{margin:16px}dialog{padding:20px}.tabs{gap:0}.tabs button{padding:10px}}

      [hidden]{display:none!important}.picker{position:relative}#object{border-radius:4px 4px 0 0;border-bottom:1px solid var(--secondary-text-color,#777);background:var(--secondary-background-color,#f5f5f5);padding:16px 12px;width:100%;text-align:left}#object::after{content:"⌄";margin-left:auto;color:var(--secondary-text-color,#666)}
      .object-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--primary-text-color,#222);font-weight:normal}.object-name{overflow-wrap:anywhere}.id-chip{font-family:monospace;font-size:.92em;border-radius:4px;padding:3px 7px;overflow-wrap:anywhere;background:var(--secondary-background-color,#eee);color:var(--primary-text-color,#222)}.id-chip.removed{background:color-mix(in srgb,var(--error-color,#db4437) 22%,var(--card-background-color,white));text-decoration:line-through;text-decoration-thickness:1.5px}.id-chip.added{background:color-mix(in srgb,var(--success-color,#0f9d58) 24%,var(--card-background-color,white))}
      #object-dropdown{position:absolute;top:100%;left:0;right:0;z-index:2;background:var(--card-background-color,white);border:1px solid var(--divider-color,#ccc);border-radius:0 0 8px 8px;box-shadow:0 6px 18px #0003}#object-search{border-radius:0}#object-list{max-height:230px;overflow:auto}#object-list button{border-radius:0;display:flex;width:100%;text-align:left;padding:14px 12px}#object-list button:hover,#object-list button:focus-visible,#object-list button[aria-selected=true]{background:var(--secondary-background-color,#eee)}
    </style><header><ha-menu-button></ha-menu-button><h1>Entity ID Manager</h1></header><main><h2>${w.title}</h2><p>${w.intro}</p><button id="open" class="primary">${w.open}</button><p><a href="/config/integrations/integration/entity_id_manager">${w.settings}</a></p><p id="status" role="status"></p></main>
    <dialog><div class="heading"><button id="close" aria-label="${w.close}">×</button><h2>${w.title}</h2></div><div class="tabs" role="tablist">${KEYS.map((k) => `<button role="tab" data-kind="${k}">${w[k]}</button>`).join("")}</div><label id="object-label">${w.choose}</label><div class="picker"><button id="object" class="object-row" aria-labelledby="object-label" aria-haspopup="listbox" aria-expanded="false" aria-controls="object-list"></button><div id="object-dropdown" hidden><input id="object-search" type="search" aria-label="${w.search}" placeholder="${w.search}" autocomplete="off"><div id="object-list" role="listbox" aria-labelledby="object-label"></div></div></div><label for="part">${w.part}</label><input id="part" type="text" autocomplete="off" autocapitalize="none" spellcheck="false"><div class="tools"><button id="clear">${w.clear}</button><button id="reset">${w.reset}</button></div><p id="validation" class="error" role="status"></p><p id="count" class="count"></p><p id="error" class="error" role="alert"></p><div class="actions"><button id="cancel">${w.cancel}</button><button id="confirm" class="primary">${w.confirm}</button></div></dialog>`;
    const q = (s) => this.shadowRoot.querySelector(s);
    const menu = q("ha-menu-button");
    if (menu) menu.hass = this._hass;
    q("#open").onclick = () => this.open();
    q("#object").onclick = () => this.togglePicker();
    q("#object").onkeydown = (e) => {
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        this.togglePicker(true);
        const rows = this.shadowRoot.querySelectorAll(".object-option");
        (e.key === "ArrowUp" ? rows[rows.length - 1] : rows[0])?.focus();
      }
    };
    q("#object-search").oninput = () => this.renderOptions();
    q("#object-dropdown").onkeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closePicker();
        q("#object").focus();
        return;
      }
      const rows = [...this.shadowRoot.querySelectorAll(".object-option")];
      if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) &&
        (e.target !== q("#object-search") || e.key === "ArrowDown")
      ) {
        e.preventDefault();
        const index = rows.indexOf(e.target);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? rows.length - 1
              : e.key === "ArrowDown"
                ? Math.min(index + 1, rows.length - 1)
                : Math.max(index - 1, 0);
        rows[next]?.focus();
      }
    };
    q("dialog").addEventListener("click", (e) => {
      if (!e.composedPath().includes(q(".picker"))) this.closePicker();
    });
    q("#part").oninput = (e) => {
      this.store.set(this.kind, this.selected[this.kind], e.target.value);
      this.refresh();
    };
    q("#clear").onclick = () => {
      this.store.set(this.kind, this.selected[this.kind], "");
      this.fill();
    };
    q("#reset").onclick = () => {
      this.store.reset(this.kind, this.selected[this.kind]);
      this.fill();
    };
    for (const id of ["close", "cancel"])
      q(`#${id}`).onclick = () => this.cancel();
    q("#confirm").onclick = () => this.save();
    q("dialog").addEventListener("cancel", (e) => {
      e.preventDefault();
      this.cancel();
    });
    q("dialog").onclick = (e) => {
      if (e.target === q("dialog")) {
        const rect = e.target.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
          this.cancel();
      }
    };
    for (const button of this.shadowRoot.querySelectorAll("[data-kind]"))
      button.onclick = () => {
        this.kind = button.dataset.kind;
        this.selectKind();
      };
  }
  async open() {
    if (this.busy) return;
    this.busy = true;
    const q = (s) => this.shadowRoot.querySelector(s),
      w = this.words;
    q("#open").disabled = true;
    q("#status").textContent = "";
    try {
      const snapshot = await this._hass.callWS({
        type: "entity_id_manager/editor/get",
      });
      if (!this.isConnected) return;
      this.store = new DraftStore(snapshot);
      this.selected = {};
      this.busy = false;
      q("#error").textContent = "";
      this.selectKind();
      q("dialog").showModal();
    } catch (error) {
      q("#status").textContent = `${w.loadError} ${error.message || ""}`;
    } finally {
      this.busy = false;
      q("#open").disabled = false;
    }
  }
  selectKind() {
    if (!this.store) return;
    this.closePicker();
    const rows = this.store.objects[this.kind];
    if (!rows.some((o) => o.id === this.selected[this.kind]))
      this.selected[this.kind] = rows[0]?.id || "";
    for (const button of this.shadowRoot.querySelectorAll("[data-kind]"))
      button.setAttribute(
        "aria-selected",
        String(button.dataset.kind === this.kind),
      );
    this.fill();
  }
  renderObject(node, object) {
    node.replaceChildren();
    if (!object) return;
    const name = document.createElement("span");
    name.className = "object-name";
    name.textContent = object.name;
    node.append(name);
    for (const segment of this.store.segments(this.kind, object.id)) {
      const chip = document.createElement("span");
      chip.className = `id-chip ${segment.kind}`;
      chip.textContent = segment.value;
      node.append(chip);
    }
  }
  renderOptions() {
    const q = (s) => this.shadowRoot.querySelector(s),
      filter = q("#object-search").value.trim().toLocaleLowerCase();
    const rows = [...this.store.objects[this.kind]]
      .filter((object) =>
        [
          object.name,
          ...this.store.segments(this.kind, object.id).map((v) => v.value),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(filter),
      )
      .sort(
        (a, b) =>
          Number(Boolean(this.store.saved[this.kind][b.id])) -
            Number(Boolean(this.store.saved[this.kind][a.id])) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
    const list = q("#object-list");
    list.replaceChildren();
    for (const object of rows) {
      const option = document.createElement("button");
      option.className = "object-option object-row";
      option.dataset.objectId = object.id;
      option.setAttribute("role", "option");
      option.setAttribute(
        "aria-selected",
        String(this.selected[this.kind] === object.id),
      );
      option.tabIndex = -1;
      this.renderObject(option, object);
      option.onclick = () => {
        this.selected[this.kind] = object.id;
        this.closePicker();
        this.fill();
        q("#part").focus();
      };
      list.append(option);
    }
  }
  togglePicker(force) {
    if (this.busy || !this.store) return;
    const q = (s) => this.shadowRoot.querySelector(s),
      open = force ?? q("#object-dropdown").hidden;
    if (!open) {
      this.closePicker();
      return;
    }
    q("#object-search").value = "";
    this.renderOptions();
    q("#object-dropdown").hidden = false;
    q("#object").setAttribute("aria-expanded", "true");
    q("#object-search").focus();
  }
  closePicker() {
    const q = (s) => this.shadowRoot?.querySelector(s);
    if (q("#object-dropdown")) q("#object-dropdown").hidden = true;
    q("#object")?.setAttribute("aria-expanded", "false");
  }
  fill() {
    this.shadowRoot.querySelector("#part").value = this.store.value(
      this.kind,
      this.selected[this.kind],
    );
    this.refresh();
  }
  refresh() {
    if (!this.store) return;
    const q = (s) => this.shadowRoot.querySelector(s),
      w = this.words,
      id = this.selected[this.kind];
    this.renderObject(
      q("#object"),
      this.store.objects[this.kind].find((o) => o.id === id),
    );
    if (!q("#object-dropdown").hidden) this.renderOptions();
    q("#count").textContent = `${w.changed}: ${this.store.count}`;
    q("#validation").textContent = this.store.valid ? "" : w.invalid;
    q("#confirm").disabled =
      this.busy || !this.store.valid || !this.store.count;
    q("#confirm").textContent = this.busy ? w.saving : w.confirm;
    q("#part").disabled = this.busy || !id;
    q("#object").disabled = this.busy || !id;
    q("#clear").disabled = this.busy || !id || !this.store.value(this.kind, id);
    q("#reset").disabled =
      this.busy || !id || !Object.hasOwn(this.store.drafts[this.kind], id);
    for (const selector of ["#cancel", "#close", "[data-kind]"])
      for (const node of this.shadowRoot.querySelectorAll(selector))
        node.disabled = this.busy;
  }
  cancel() {
    if (this.busy) return;
    this.store = null;
    this.closePicker();
    this.shadowRoot?.querySelector("dialog")?.close();
  }
  async save() {
    if (this.busy || !this.store?.count || !this.store.valid) return;
    this.busy = true;
    this.refresh();
    const q = (s) => this.shadowRoot.querySelector(s),
      w = this.words;
    q("#error").textContent = "";
    try {
      await this._hass.callWS({
        type: "entity_id_manager/editor/save",
        revision: this.store.revision,
        changes: this.store.changes(),
      });
      this.busy = false;
      this.cancel();
      q("#status").textContent = w.saved;
    } catch (error) {
      q("#error").textContent =
        error.code === "stale_editor"
          ? w.stale
          : error.code === "missing_object"
            ? w.missing
            : `${w.failed} ${error.message || ""}`;
    } finally {
      this.busy = false;
      this.refresh();
    }
  }
}
if (globalThis.customElements && !customElements.get("entity-id-manager-panel"))
  customElements.define("entity-id-manager-panel", IDManagerPanel);
