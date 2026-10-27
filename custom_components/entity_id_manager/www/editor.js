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
      "Соответствия сохранены. Для переименования сущностей нажмите «Просмотр и применение» на этой странице.",
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
      "Mappings saved. Rename entities using Preview and apply on this page.",
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

Object.assign(WORDS.ru, {
  preview: "Просмотр и применение",
  apply: "Применить выбранные",
  automatic: "Автоматически переименовывать новые сущности",
  noChanges: "Нет сущностей, требующих переименования.",
  references: "Ссылки в YAML, автоматизациях и панелях не обновляются.",
  applied: "Переименовано сущностей",
  previewError:
    "Не удалось применить изменения. Откройте предпросмотр заново и проверьте журнал HA.",
  occupied: "ID занят",
  duplicate_target: "Одинаковый целевой ID",
});
Object.assign(WORDS.en, {
  preview: "Preview and apply",
  apply: "Apply selected",
  automatic: "Automatically rename new entities",
  noChanges: "No entities need renaming.",
  references: "References in YAML, automations and dashboards are not updated.",
  applied: "Entities renamed",
  previewError: "Could not apply changes. Reopen preview and check the HA log.",
  occupied: "ID is occupied",
  duplicate_target: "Duplicate target ID",
});

Object.assign(WORDS.ru, { noArea: "Без зоны", noDevice: "Без устройства" });
Object.assign(WORDS.en, { noArea: "No area", noDevice: "No device" });

Object.assign(WORDS.ru, { openCard: "Открыть карточку" });
Object.assign(WORDS.en, { openCard: "Open details" });

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
  prefix(key, object) {
    if (key === "areas") return "";
    const area = this.value("areas", object.area_id) || "<area_id>";
    if (key === "devices") return area;
    const device = this.value("devices", object.device_id) || "<device_id>";
    return `${area}/${device}`;
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
    this.viewportEvents?.abort();
    this.initialized = false;
  }
  initialize() {
    this.initialized = true;
    this.render();
    this.loadAutomatic();
    if (new URL(window.location.href).searchParams.has("config_entry"))
      this.open();
    this.viewportEvents = new AbortController();
    const options = { signal: this.viewportEvents.signal, capture: true };
    const reposition = () => this.positionPicker();
    window.addEventListener("resize", reposition, options);
    window.addEventListener("scroll", reposition, options);
    window.visualViewport?.addEventListener("resize", reposition, options);
    window.visualViewport?.addEventListener("scroll", reposition, options);
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
      .object-row{display:grid;grid-template-columns:24px minmax(0,1fr) minmax(0,1fr) auto;align-items:center;column-gap:10px;row-gap:4px;color:var(--primary-text-color,#222);font-weight:normal}.object-icon{grid-column:1;grid-row:1 / 3;--mdc-icon-size:24px;color:var(--secondary-text-color,#666)}.object-text{display:contents}.object-name{grid-column:2;grid-row:1}.object-description{grid-column:2;grid-row:2}.object-prefix{grid-column:3;grid-row:1}.object-own{grid-column:3;grid-row:2}.object-prefix,.object-own{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.object-row::after{grid-column:4;grid-row:1 / 3}.object-name{display:block;overflow-wrap:anywhere}.object-description{display:block;font-size:.8em;line-height:1.4;color:var(--secondary-text-color,#666);margin-top:0}.id-chip{font-family:monospace;font-size:.92em;border-radius:4px;padding:3px 7px;overflow-wrap:anywhere;background:color-mix(in srgb,#2196f3 18%,var(--card-background-color,#fff));color:var(--primary-text-color,#222)}.id-chip.prefix{background:color-mix(in srgb,#ffc107 22%,var(--card-background-color,#fff))}.id-chip.removed{background:color-mix(in srgb,var(--error-color,#db4437) 22%,var(--card-background-color,white));text-decoration:line-through;text-decoration-thickness:1.5px}.id-chip.added{background:color-mix(in srgb,var(--success-color,#0f9d58) 24%,var(--card-background-color,white))}
      .area-row{grid-template-columns:24px auto minmax(0,1fr) auto}.area-row .object-icon,.area-row::after{grid-row:1}.area-row .object-own{grid-row:1}.area-row .object-prefix{display:none}
      #object-dropdown{display:flex;flex-direction:column;position:fixed;inset:auto;margin:0;box-sizing:border-box;overflow:hidden;z-index:2;background:var(--card-background-color,white);border:1px solid var(--divider-color,#ccc);border-radius:0 0 8px 8px;box-shadow:0 6px 18px #0003}#object-search{display:block;flex:0 0 auto;border-radius:0;margin:0;line-height:1.5;min-height:56px}#object-search:focus-visible{outline-offset:-2px}#object-list{flex:1 1 auto;min-height:0;max-height:none;overflow:auto;overscroll-behavior:contain;padding-top:6px}#object-list button{box-sizing:border-box;min-height:48px;line-height:1.5;border-radius:0;width:100%;text-align:left;padding:14px 12px}#object-list button:hover,#object-list button:focus-visible,#object-list button[aria-selected=true]{background:var(--secondary-background-color,#eee)}
      .automatic{display:flex;align-items:center;gap:12px}.automatic input,.preview-row input{width:auto;min-height:0;flex:0 0 auto}.preview-row{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--divider-color,#ddd)}.preview-ids{overflow-wrap:anywhere;line-height:1.6}.preview-ids code{display:block}.preview-row .error{font-size:14px}
      #selected-link{display:flex;flex:0 0 40px}.selected-row,.object-choice{display:flex;align-items:center;min-width:0}.selected-row{background:var(--secondary-background-color,#f5f5f5)}.selected-row #object{flex:1;min-width:0;width:auto}.object-link{display:flex;align-items:center;justify-content:center;flex:0 0 40px;min-height:44px;text-decoration:none;color:var(--secondary-text-color,#666);--mdc-icon-size:20px}.object-link:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}.object-link:hover{color:var(--primary-color)}#object-list .object-option{flex:1;min-width:0;width:auto}.object-choice:hover{background:var(--secondary-background-color,#eee)}
    </style><header><ha-menu-button></ha-menu-button><h1>Entity ID Manager</h1></header><main><h2>${w.title}</h2><p>${w.intro}</p><button id="open" class="primary">${w.open}</button><button id="preview-open">${w.preview}</button><label class="automatic"><input id="automatic" type="checkbox" disabled> ${w.automatic}</label><p id="status" role="status"></p></main>
    <dialog id="editor-dialog"><div class="heading"><button id="close" aria-label="${w.close}">×</button><h2>${w.title}</h2></div><div class="tabs" role="tablist">${KEYS.map((k) => `<button role="tab" data-kind="${k}">${w[k]}</button>`).join("")}</div><label id="object-label">${w.choose}</label><div class="picker"><div class="selected-row"><button id="object" class="object-row" aria-labelledby="object-label" aria-haspopup="listbox" aria-expanded="false" aria-controls="object-list"></button><span id="selected-link"></span></div><div id="object-dropdown" popover="manual" hidden><input id="object-search" type="search" aria-label="${w.search}" placeholder="${w.search}" autocomplete="off"><div id="object-list" role="listbox" aria-labelledby="object-label"></div></div></div><label for="part">${w.part}</label><input id="part" type="text" autocomplete="off" autocapitalize="none" spellcheck="false"><div class="tools"><button id="clear">${w.clear}</button><button id="reset">${w.reset}</button></div><p id="validation" class="error" role="status"></p><p id="count" class="count"></p><p id="error" class="error" role="alert"></p><div class="actions"><button id="cancel">${w.cancel}</button><button id="confirm" class="primary">${w.confirm}</button></div></dialog><dialog id="preview-dialog"><div class="heading"><button id="preview-close" aria-label="${w.close}">×</button><h2>${w.preview}</h2></div><p>${w.references}</p><div id="preview-rows"></div><p id="preview-error" class="error" role="alert"></p><div class="actions"><button id="preview-cancel">${w.cancel}</button><button id="preview-apply" class="primary" disabled>${w.apply}</button></div></dialog>`;
    const q = (s) => this.shadowRoot.querySelector(s);
    const menu = q("ha-menu-button");
    if (menu) menu.hass = this._hass;
    q("#open").onclick = () => this.open();
    q("#preview-open").onclick = () => this.openPreview();
    q("#automatic").onchange = () => this.setAutomatic();
    q("#preview-close").onclick = q("#preview-cancel").onclick = () =>
      this.closePreview();
    q("#preview-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closePreview();
    });
    q("#preview-apply").onclick = () => this.applyPreview();
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
  async loadAutomatic() {
    const checkbox = this.shadowRoot.querySelector("#automatic");
    try {
      const data = await this._hass.callWS({
        type: "entity_id_manager/editor/get",
      });
      checkbox.checked = Boolean(data.auto_new);
      checkbox.disabled = false;
    } catch (error) {
      this.shadowRoot.querySelector("#status").textContent =
        `${this.words.loadError} ${error.message || ""}`;
    }
  }
  async setAutomatic() {
    const checkbox = this.shadowRoot.querySelector("#automatic"),
      requested = checkbox.checked;
    checkbox.disabled = true;
    try {
      await this._hass.callWS({
        type: "entity_id_manager/automatic",
        enabled: requested,
      });
    } catch (error) {
      checkbox.checked = !requested;
      this.shadowRoot.querySelector("#status").textContent =
        error.message || this.words.failed;
    } finally {
      checkbox.disabled = false;
    }
  }
  closePreview() {
    if (this.previewBusy) return;
    this.shadowRoot.querySelector("#preview-dialog").close();
    this.previewRows = [];
  }
  updatePreviewControls() {
    const q = (s) => this.shadowRoot.querySelector(s);
    q("#preview-apply").disabled =
      this.previewBusy ||
      ![...q("#preview-rows").querySelectorAll("input:checked")].length;
    for (const selector of [
      "#preview-close",
      "#preview-cancel",
      "#preview-rows input",
    ])
      for (const node of this.shadowRoot.querySelectorAll(selector))
        node.disabled = this.previewBusy || node.dataset.conflict === "true";
  }
  async openPreview() {
    if (this.busy || this.previewBusy) return;
    const q = (s) => this.shadowRoot.querySelector(s),
      w = this.words;
    q("#preview-open").disabled = true;
    try {
      this.previewRows = await this._hass.callWS({
        type: "entity_id_manager/preview",
      });
      q("#preview-rows").replaceChildren();
      q("#preview-error").textContent = "";
      if (!this.previewRows.length)
        q("#preview-rows").textContent = w.noChanges;
      for (const row of this.previewRows) {
        const label = document.createElement("label");
        label.className = "preview-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = row.registry_id;
        checkbox.dataset.conflict = String(Boolean(row.conflict));
        checkbox.disabled = Boolean(row.conflict);
        checkbox.onchange = () => this.updatePreviewControls();
        const ids = document.createElement("span");
        ids.className = "preview-ids";
        for (const [name, value] of [
          ["removed", row.old],
          ["added", row.new],
        ]) {
          const code = document.createElement("code");
          code.className = `id-chip ${name}`;
          code.textContent = value;
          ids.append(code);
        }
        if (row.conflict) {
          const reason = document.createElement("span");
          reason.className = "error";
          reason.textContent = w[row.conflict] || row.conflict;
          ids.append(reason);
        }
        label.append(checkbox, ids);
        q("#preview-rows").append(label);
      }
      this.updatePreviewControls();
      q("#preview-dialog").showModal();
    } catch (error) {
      q("#status").textContent = error.message || w.loadError;
    } finally {
      q("#preview-open").disabled = false;
    }
  }
  async applyPreview() {
    if (this.previewBusy) return;
    const q = (s) => this.shadowRoot.querySelector(s),
      selected = new Set(
        [...q("#preview-rows").querySelectorAll("input:checked")].map(
          (node) => node.value,
        ),
      );
    const rows = this.previewRows
      .filter((row) => selected.has(row.registry_id) && !row.conflict)
      .map(({ registry_id, old, new: next }) => ({
        registry_id,
        old,
        new: next,
      }));
    if (!rows.length) return;
    this.previewBusy = true;
    this.updatePreviewControls();
    try {
      const result = await this._hass.callWS({
        type: "entity_id_manager/apply",
        rows,
      });
      this.previewBusy = false;
      this.closePreview();
      q("#status").textContent = `${this.words.applied}: ${result.count}`;
    } catch (error) {
      q("#preview-error").textContent =
        `${this.words.previewError} ${error.message || ""}`;
    } finally {
      this.previewBusy = false;
      this.updatePreviewControls();
    }
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
    const rows = [...this.store.objects[this.kind]].sort((a, b) =>
      this.compareObjects(a, b),
    );
    if (!rows.some((o) => o.id === this.selected[this.kind]))
      this.selected[this.kind] = rows[0]?.id || "";
    for (const button of this.shadowRoot.querySelectorAll("[data-kind]"))
      button.setAttribute(
        "aria-selected",
        String(button.dataset.kind === this.kind),
      );
    this.fill();
  }
  compareObjects(a, b) {
    if (this.kind !== "areas") {
      const unassigned = Number(!a.area_name) - Number(!b.area_name);
      if (unassigned) return unassigned;
    }
    return (
      Number(Boolean(this.store.saved[this.kind][b.id])) -
        Number(Boolean(this.store.saved[this.kind][a.id])) ||
      this.objectLabel(a).localeCompare(this.objectLabel(b)) ||
      a.id.localeCompare(b.id)
    );
  }
  cardLink(object) {
    const link = document.createElement("a");
    link.className = "object-link";
    link.href =
      this.kind === "areas"
        ? `/config/areas/area/${encodeURIComponent(object.id)}`
        : this.kind === "devices"
          ? `/config/devices/device/${encodeURIComponent(object.id)}`
          : `/config/entities?more-info-entity-id=${encodeURIComponent(object.entity_id || object.name)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = this.words.openCard;
    link.setAttribute(
      "aria-label",
      `${this.words.openCard}: ${this.objectLabel(object)}`,
    );
    const icon = document.createElement("ha-icon");
    icon.icon = "mdi:open-in-new";
    link.append(icon);
    return link;
  }
  objectLabel(object) {
    if (this.kind === "areas") return object.name;
    if (this.kind === "devices")
      return `${object.area_name || this.words.noArea}/${object.name}`;
    return `${object.area_name || this.words.noArea}/${object.device_name || this.words.noDevice}/${object.name}`;
  }
  renderObject(node, object) {
    node.replaceChildren();
    node.classList.toggle("area-row", this.kind === "areas");
    if (!object) return;
    const state = object.entity_id
      ? this._hass.states?.[object.entity_id]
      : null;
    const icon = document.createElement(state ? "ha-state-icon" : "ha-icon");
    icon.className = "object-icon";
    icon.setAttribute("aria-hidden", "true");
    if (state) {
      icon.hass = this._hass;
      icon.stateObj = state;
      if (object.icon) icon.icon = object.icon;
    } else {
      const domain = object.entity_id?.split(".")[0];
      const defaults = {
        sensor: "mdi:eye",
        binary_sensor: "mdi:radiobox-marked",
        switch: "mdi:toggle-switch",
        light: "mdi:lightbulb",
        cover: "mdi:window-shutter",
        climate: "mdi:thermostat",
        text: "mdi:form-textbox",
        select: "mdi:form-select",
        number: "mdi:numeric",
        button: "mdi:gesture-tap-button",
      };
      icon.icon =
        object.icon ||
        (this.kind === "areas"
          ? "mdi:floor-plan"
          : this.kind === "devices"
            ? "mdi:devices"
            : defaults[domain] || "mdi:shape");
    }
    node.append(icon);
    const name = document.createElement("span");
    name.className = "object-name";
    name.textContent = this.objectLabel(object);
    if (object.entity_id) name.title = object.entity_id;
    const text = document.createElement("span");
    text.className = "object-text";
    text.append(name);
    if (object.description) {
      const description = document.createElement("span");
      description.className = "object-description";
      description.textContent = object.description;
      text.append(description);
    }
    node.append(text);
    const parentRow = document.createElement("span");
    parentRow.className = "object-prefix";
    const ownRow = document.createElement("span");
    ownRow.className = "object-own";
    node.append(parentRow, ownRow);
    const prefix = this.store.prefix(this.kind, object);
    if (prefix) {
      const chip = document.createElement("span");
      chip.className = "id-chip prefix";
      chip.textContent = prefix;
      parentRow.append(chip);
    }
    for (const segment of this.store.segments(this.kind, object.id)) {
      const chip = document.createElement("span");
      chip.className = `id-chip ${segment.kind}`;
      chip.textContent = segment.value;
      ownRow.append(chip);
    }
  }
  renderOptions() {
    const q = (s) => this.shadowRoot.querySelector(s),
      filter = q("#object-search").value.trim().toLocaleLowerCase();
    const rows = [...this.store.objects[this.kind]]
      .filter((object) =>
        [
          this.objectLabel(object),
          object.entity_id || "",
          object.description || "",
          this.store.prefix(this.kind, object),
          ...this.store.segments(this.kind, object.id).map((v) => v.value),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(filter),
      )
      .sort((a, b) => this.compareObjects(a, b));
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
      const wrapper = document.createElement("div");
      wrapper.className = "object-choice";
      wrapper.append(option, this.cardLink(object));
      list.append(wrapper);
    }
    this.positionPicker();
  }
  positionPicker() {
    const popup = this.shadowRoot?.querySelector("#object-dropdown");
    if (!popup || popup.hidden) return;
    const anchor = this.shadowRoot
      .querySelector(".selected-row")
      .getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0,
      left = viewport?.offsetLeft || 0;
    const bottom = top + (viewport?.height || window.innerHeight);
    const right = left + (viewport?.width || window.innerWidth);
    const margin = 8,
      gap = 4;
    const below = bottom - anchor.bottom - margin - gap;
    const above = anchor.top - top - margin - gap;
    const upward = below < 300 && above > below;
    const available = upward ? above : below;
    const cover = available < 120;
    popup.style.width = `${Math.min(anchor.width, right - left - 2 * margin)}px`;
    popup.style.maxHeight = `${Math.max(1, Math.min(520, cover ? bottom - top - 2 * margin : available))}px`;
    popup.style.left = `${Math.max(left + margin, Math.min(anchor.left, right - popup.getBoundingClientRect().width - margin))}px`;
    const height = popup.getBoundingClientRect().height;
    popup.style.top = `${cover ? top + margin : upward ? anchor.top - gap - height : anchor.bottom + gap}px`;
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
    q("#object-dropdown").showPopover();
    this.positionPicker();
    q("#object").setAttribute("aria-expanded", "true");
    q("#object-search").focus();
  }
  closePicker() {
    const q = (s) => this.shadowRoot?.querySelector(s);
    const popup = q("#object-dropdown");
    if (popup) {
      if (popup.matches(":popover-open")) popup.hidePopover();
      popup.hidden = true;
    }
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
    const current = this.store.objects[this.kind].find(
      (object) => object.id === id,
    );
    q("#selected-link").replaceChildren();
    if (current) q("#selected-link").append(this.cardLink(current));
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
