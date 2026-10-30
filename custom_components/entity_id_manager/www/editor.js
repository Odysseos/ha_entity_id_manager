const KEYS = ["areas", "devices", "entities"];
const SEGMENT = /^[a-z][a-z0-9_]*$/;
const WORDS = {
  ru: {
    title: "Сегменты ID",
    areas: "Зоны",
    devices: "Устройства",
    entities: "Сущности",
    choose: "Выберите объект",
    segment: "Сегмент ID",
    clear: "Очистить",
    reset: "Сбросить изменения",
    confirm: "Подтвердить",
    cancel: "Отмена",
    close: "Закрыть",
    open: "Открыть редактор",
    saved:
      "Соответствия сохранены. Для переименования сущностей нажмите «Просмотр и применение» на этой странице.",
    intro:
      "Измените сегменты ID нескольких объектов и подтвердите их одной операцией. Отображаемые названия не меняются.",
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
    title: "ID segments",
    areas: "Areas",
    devices: "Devices",
    entities: "Entities",
    choose: "Select object",
    segment: "ID segment",
    clear: "Clear",
    reset: "Reset changes",
    confirm: "Confirm",
    cancel: "Cancel",
    close: "Close",
    open: "Open editor",
    saved:
      "Mappings saved. Rename entities using Preview and apply on this page.",
    intro:
      "Edit ID segments for several objects and confirm them together. Display names stay unchanged.",
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
  references: "При применении обновляются ссылки в подключённых YAML-файлах, шаблонах, панелях и настройках интеграций. Перед изменениями создаётся резервная копия.",
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
  references: "Applying updates references in included YAML, templates, dashboards and integration settings. A backup is created first.",
  applied: "Entities renamed",
  previewError: "Could not apply changes. Reopen preview and check the HA log.",
  occupied: "ID is occupied",
  duplicate_target: "Duplicate target ID",
});

Object.assign(WORDS.ru, { noArea: "Без зоны", noDevice: "Без устройства" });
Object.assign(WORDS.en, { noArea: "No area", noDevice: "No device" });

Object.assign(WORDS.ru, {
  conflicts: "Конфликтующих сущностей",
  conflictCheck: "Проверка конфликтов…",
  checkFailed: "Не удалось проверить конфликты",
  conflictWith: "Совпадает с",
  occupiedBy: "ID занят",
  copyId: "Скопировать текущий ID",
  openCard: "Открыть карточку",
});
Object.assign(WORDS.en, {
  conflicts: "Conflicting entities",
  conflictCheck: "Checking conflicts…",
  checkFailed: "Could not check conflicts",
  conflictWith: "Conflicts with",
  occupiedBy: "ID occupied",
  copyId: "Copy current ID",
  openCard: "Open details",
});

export class DraftStore {
  constructor(snapshot, language = "ru") {
    this.language = language;
    this.listeners = new Set();
    this.batching = 0;
    this.revision = snapshot.revision;
    this.versions = {};
    this.bulkUndo = null;
    this.omittedValues = new Map();
    this.objects = structuredClone(snapshot.objects);
    this.treeDirty = new Set();
    this.byId = {};
    this.byName = {};
    for (const key of KEYS) {
      this.byId[key] = new Map();
      this.byName[key] = new Map();
      for (const object of this.objects[key]) {
        this.byId[key].set(object.id, object);
        const name = object.name.trim().normalize("NFC").toLocaleLowerCase();
        if (!this.byName[key].has(name)) this.byName[key].set(name, []);
        this.byName[key].get(name).push(object);
      }
    }
    this.saved = structuredClone(snapshot.mappings);
    this.deviceEntities = new Map();
    for (const entity of this.objects.entities) {
      if (!this.deviceEntities.has(entity.device_id)) this.deviceEntities.set(entity.device_id, []);
      this.deviceEntities.get(entity.device_id).push(entity);
    }
    this.drafts = Object.fromEntries(KEYS.map((k) => [k, {}]));
  }
  value(key, id) {
    return Object.hasOwn(this.drafts[key], id)
      ? this.drafts[key][id]
      : this.saved[key][id] || "";
  }
  set(key, id, value) {
    this.versions[`${key}:${id}`] = (this.versions[`${key}:${id}`] || 0) + 1;
    this.treeDirty.add(`${key}:${id}`);
    const next = value.trim();
    if (next === (this.saved[key][id] || "")) delete this.drafts[key][id];
    else this.drafts[key][id] = next;
    this.emit();
  }
  omit(id, enabled) {
    if (enabled) {
      this.omittedValues.set(id, this.value("entities", id));
      this.set("entities", id, "-");
    } else this.set("entities", id, this.omittedValues.get(id) || "");
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit() {
    if (!this.batching) for (const listener of this.listeners) listener();
  }
  reset(key, id) {
    this.set(key, id, this.saved[key][id] || "");
  }
  get count() {
    return KEYS.reduce((n, k) => n + Object.keys(this.drafts[k]).length, 0);
  }
  get valid() {
    return KEYS.every((k) =>
      Object.values(this.drafts[k]).every((v) => !v || (k === "entities" && v === "-") || SEGMENT.test(v)),
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
  parentSegments(key, object) {
    if (key === "areas") return [];
    const segments = [["areas", object.area_id, this.language === "ru" ? "<ID зоны>" : "<area ID>"]];
    if (key === "entities")
      segments.push(["devices", object.device_id, this.language === "ru" ? "<ID устройства>" : "<device ID>"]);
    return segments.map(([section, id, placeholder]) => ({
      value: this.value(section, id) || placeholder,
      kind: Object.hasOwn(this.drafts[section], id) ? "added" : "prefix",
    }));
  }
  prefix(key, object) {
    return this.parentSegments(key, object)
      .map((segment) => segment.value)
      .join("/");
  }
  namesakes(key, id) {
    if (key === "areas") return [];
    const current = this.byId[key].get(id);
    if (!current) return [];
    const name = current.name.trim().normalize("NFC").toLocaleLowerCase();
    return (this.byName[key].get(name) || []).filter(
      (object) => object.id !== id,
    );
  }
  entityTarget(entity) {
    if (!entity?.default_segments || !entity.entity_id) return "";
    const defaults = entity.default_segments;
    const suffix = this.value("entities", entity.id) || defaults.suffix;
    return entity.entity_id.split(".", 1)[0] + "." + [
      this.value("areas", entity.area_id) || defaults.area,
      this.value("devices", entity.device_id) || defaults.device,
      suffix === "-" ? "" : suffix,
    ].filter(Boolean).join("_");
  }
  namesakeTargets(key, id, replace) {
    const after = this.value(key, id);
    if (!after || !(SEGMENT.test(after) || (key === "entities" && after === "-"))) return [];
    return this.namesakes(key, id).filter((object) => {
      const before = this.value(key, object.id);
      if (before === after || (before && !replace)) return false;
      const entities = key === "entities" ? [object] : this.deviceEntities.get(object.id) || [];
      // Missing defaults in older snapshots must not hide editable objects.
      return !entities.length || entities.some((entity) => {
        if (!entity.default_segments || !entity.entity_id) return true;
        const defaults = entity.default_segments;
        const area = this.value("areas", entity.area_id) || defaults.area;
        const device = key === "devices" ? after : this.value("devices", entity.device_id) || defaults.device;
        const suffix = key === "entities" ? after : this.value("entities", entity.id) || defaults.suffix;
        const target = entity.entity_id.split(".", 1)[0] + "." + [area, device, suffix === "-" ? "" : suffix].filter(Boolean).join("_");
        return target !== entity.entity_id;
      });
    });
  }
  copyToNamesakes(key, id, replace) {
    const after = this.value(key, id);
    if (!after || !(SEGMENT.test(after) || (key === "entities" && after === "-"))) return 0;
    const segments = [];
    this.batching++;
    for (const object of this.namesakeTargets(key, id, replace)) {
      const before = this.value(key, object.id);
      this.set(key, object.id, after);
      segments.push({
        id: object.id,
        before,
        version: this.versions[`${key}:${object.id}`],
      });
    }
    this.batching--;
    this.emit();
    this.bulkUndo = segments.length ? { key, segments } : this.bulkUndo;
    return segments.length;
  }
  undoBulk() {
    if (!this.bulkUndo) return 0;
    const { key, segments } = this.bulkUndo;
    let count = 0;
    this.batching++;
    for (const segment of segments) {
      if (this.versions[`${key}:${segment.id}`] !== segment.version) continue;
      this.set(key, segment.id, segment.before);
      count++;
    }
    this.batching--;
    this.emit();
    this.bulkUndo = null;
    return count;
  }
  changes() {
    return structuredClone(this.drafts);
  }
}

export function buildTree(objects) {
  const roots = objects.areas.map((object) => ({
    key: `areas:${object.id}`,
    kind: "areas",
    object,
    children: [],
  }));
  const missing = { key: "no-area", kind: null, object: null, children: [] };
  const areas = new Map(roots.map((node) => [node.object.id, node]));
  const devices = new Map(objects.devices.map((object) => [object.id, object]));
  const branches = new Map();
  const areaNode = (id) => areas.get(id) || missing;
  const deviceNode = (object, areaId) => {
    const parent = areaNode(areaId),
      key = `devices:${object.id}@${parent.key}`;
    if (!branches.has(key)) {
      const node = { key, kind: "devices", object, children: [] };
      parent.children.push(node);
      branches.set(key, node);
    }
    return branches.get(key);
  };
  for (const object of objects.devices) deviceNode(object, object.area_id);
  for (const object of objects.entities) {
    const device = devices.get(object.device_id);
    const parent = device
      ? deviceNode(device, object.area_id)
      : areaNode(object.area_id);
    parent.children.push({
      key: `entities:${object.id}`,
      kind: "entities",
      object,
      children: [],
    });
  }
  const sort = (nodes) => {
    nodes.sort(
      (a, b) =>
        Number(a.kind === "entities") - Number(b.kind === "entities") ||
        a.object.name.localeCompare(b.object.name) ||
        a.key.localeCompare(b.key),
    );
    for (const node of nodes) sort(node.children);
  };
  sort(roots);
  if (missing.children.length) {
    sort(missing.children);
    roots.push(missing);
  }
  return roots;
}

export class TreeModel {
  constructor(store, noArea = "No area") {
    this.store = store;
    this.noArea = noArea;
    this.roots = buildTree(store.objects);
    this.nodes = new Map();
    this.closed = new Set();
    this.query = "";
    this.conflictOnly = false;
    this.conflicts = {};
    this.scope = null;
    this.revision = 0;
    const index = (nodes, parentKey = null, depth = 0) => {
      for (const node of nodes) {
        node.parentKey = parentKey;
        node.depth = depth;
        this.nodes.set(node.key, node);
        index(node.children, node.key, depth + 1);
      }
    };
    index(this.roots);
    this.unsubscribe = store.subscribe(() => {
      this.revision++;
      if (this.query) this.rebuild();
    });
    this.rebuild();
  }
  state(key) {
    const node = this.nodes.get(key);
    return node?.object
      ? {
          segments: this.store.segments(node.kind, node.object.id),
          parents: this.store.parentSegments(node.kind, node.object),
          conflicts: this.conflicts[node.object.id] || [],
        }
      : null;
  }
  update({ query, conflictOnly, conflicts, scope }) {
    const next = query.trim().toLocaleLowerCase();
    if (
      next === this.query &&
      conflictOnly === this.conflictOnly &&
      conflicts === this.conflicts &&
      scope === this.scope
    )
      return;
    const structural =
      next !== this.query ||
      conflictOnly !== this.conflictOnly ||
      (conflictOnly && (conflicts !== this.conflicts || scope !== this.scope));
    this.query = next;
    this.conflictOnly = conflictOnly;
    this.conflicts = conflicts;
    this.scope = scope;
    if (structural) this.rebuild();
    else this.revision++;
  }
  toggle(key) {
    if (this.query || this.conflictOnly) return;
    if (this.closed.has(key)) this.closed.delete(key);
    else this.closed.add(key);
    this.rebuild();
  }
  reveal(key) {
    let node = this.nodes.get(key);
    while (node?.parentKey) {
      this.closed.delete(node.parentKey);
      node = this.nodes.get(node.parentKey);
    }
    this.rebuild();
  }
  rebuild() {
    const filtered = (nodes, ancestor = false) =>
      nodes.flatMap((node) => {
        const object = node.object;
        let match = !this.query || ancestor;
        if (!match) {
          const text = object
            ? [
                object.name,
                object.area_name,
                object.device_name,
                object.description,
                object.entity_id,
                ...this.store
                  .segments(node.kind, object.id)
                  .map((segment) => segment.value),
                this.store.prefix(node.kind, object),
              ].join(" ")
            : this.noArea;
          match = text.toLocaleLowerCase().includes(this.query);
        }
        const children = filtered(node.children, Boolean(this.query && match));
        const own =
          match &&
          (!this.conflictOnly ||
            (node.kind === "entities" &&
              this.conflicts[object.id]?.length &&
              (!this.scope || object[this.scope.field] === this.scope.id)));
        return own || children.length ? [{ node, children }] : [];
      });
    this.rows = [];
    let top = 0;
    const flatten = (entries) =>
      entries.forEach(({ node, children }, index) => {
        const height =
          node.kind === "entities"
            ? 80
            : node.kind === "devices"
              ? 64
              : node.kind === "areas"
                ? 48
                : 36;
        const expanded = Boolean(
          this.query || this.conflictOnly || !this.closed.has(node.key),
        );
        this.rows.push({
          key: node.key,
          node,
          top,
          height,
          expanded,
          hasChildren: children.length > 0,
          pos: index + 1,
          size: entries.length,
        });
        top += height;
        if (expanded) flatten(children);
      });
    flatten(filtered(this.roots));
    this.height = top;
    this.revision++;
  }
  destroy() {
    this.unsubscribe();
  }
}

export class VirtualTree {
  constructor(viewport, create, update) {
    this.viewport = viewport;
    this.create = create;
    this.update = update;
    this.items = new Map();
    this.rows = [];
    this.surface = document.createElement("div");
    this.surface.className = "virtual-tree-surface";
    this.surface.setAttribute("role", "presentation");
    viewport.replaceChildren(this.surface);
    this.onScroll = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.render();
      });
    };
    viewport.addEventListener("scroll", this.onScroll, { passive: true });
    this.resize = new ResizeObserver(() => this.render());
    this.resize.observe(viewport);
  }
  setRows(rows) {
    this.rows = rows;
    const last = rows.at(-1);
    this.surface.style.height = `${last ? last.top + last.height : 0}px`;
    this.render();
  }
  render() {
    const { rows, viewport } = this;
    const active = viewport.getRootNode().activeElement;
    const activeKey = active?.dataset?.nodeKey;
    const activeToggle = active?.classList?.contains("tree-toggle");
    const top = viewport.scrollTop,
      bottom = top + viewport.clientHeight;
    let low = 0,
      high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (rows[middle].top + rows[middle].height <= top) low = middle + 1;
      else high = middle;
    }
    const visible = [];
    if (viewport.clientHeight)
      for (let i = low; i < rows.length && rows[i].top < bottom; i++)
        visible.push(rows[i]);
    const keys = new Set(visible.map((row) => row.key));
    for (const [key, element] of this.items)
      if (!keys.has(key)) {
        element.remove();
        this.items.delete(key);
      }
    let cursor = this.surface.firstElementChild;
    for (const row of visible) {
      let item = this.items.get(row.key);
      if (!item) {
        item = this.create(row);
        this.items.set(row.key, item);
      }
      item.style.top = `${row.top}px`;
      item.style.height = `${row.height}px`;
      this.update(item, row);
      if (item !== cursor) this.surface.insertBefore(item, cursor);
      else cursor = cursor.nextElementSibling;
    }
    if (activeKey && !active.isConnected)
      this.items
        .get(activeKey)
        ?.querySelector(activeToggle ? ".tree-toggle" : ".tree-select")
        ?.focus({ preventScroll: true });
  }
  reveal(key) {
    const row = this.rows.find((row) => row.key === key);
    if (!row) return;
    const view = this.viewport;
    if (row.top < view.scrollTop) view.scrollTop = row.top;
    else if (row.top + row.height > view.scrollTop + view.clientHeight)
      view.scrollTop = row.top + row.height - view.clientHeight;
    this.render();
  }
  destroy() {
    this.resize.disconnect();
    this.viewport.removeEventListener("scroll", this.onScroll);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.items.clear();
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
      .main-actions{display:flex;gap:12px;flex-wrap:wrap}
      button{font:inherit;padding:11px 18px;border:0;border-radius:24px;cursor:pointer;color:var(--primary-color);background:transparent}button.primary{background:var(--primary-color,#03a9c4);color:var(--text-primary-color,white)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}
      dialog{box-sizing:border-box;width:min(760px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:28px;border:0;border-radius:28px;color:var(--primary-text-color,#222);background:var(--card-background-color,white)}dialog::backdrop{background:#0006}.heading{display:flex;align-items:center;gap:12px}.heading h2{font-size:24px;margin:0}.heading button{font-size:28px;padding:0 8px}.tabs{display:flex;gap:8px;margin:24px 0}.tabs button[aria-selected=true]{background:var(--secondary-background-color,#eee);font-weight:bold}
      label{display:block;margin:22px 0 6px;font-size:14px;color:var(--secondary-text-color,#666)}input{box-sizing:border-box;width:100%;padding:16px 12px;font:inherit;color:var(--primary-text-color,#222);background:var(--secondary-background-color,#f5f5f5);border:0;border-bottom:1px solid var(--secondary-text-color,#777);border-radius:4px 4px 0 0}.tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.actions{display:flex;justify-content:flex-end;gap:12px;margin-top:28px}.hint,.count{font-size:14px;color:var(--secondary-text-color,#666)}.error{color:var(--error-color,#b00020);white-space:pre-wrap}#status{white-space:pre-wrap}@media(max-width:600px){main{margin:16px}dialog{padding:20px}.tabs{gap:0}.tabs button{padding:10px}}

      [hidden]{display:none!important}.picker{position:relative}#object{border-radius:4px 4px 0 0;border-bottom:1px solid var(--secondary-text-color,#777);background:var(--secondary-background-color,#f5f5f5);padding:16px 12px;width:100%;text-align:left}#object::after{content:"⌄";margin-left:auto;color:var(--secondary-text-color,#666)}
      .object-row{display:grid;grid-template-columns:24px minmax(0,1fr) minmax(0,1fr) auto;align-items:center;column-gap:10px;row-gap:0;line-height:1.15;color:var(--primary-text-color,#222);font-weight:normal}.object-icon{grid-column:1;grid-row:1 / 3;--mdc-icon-size:24px;color:var(--secondary-text-color,#666)}.object-text{display:contents}.object-name{grid-column:2;grid-row:1}.object-description{grid-column:2;grid-row:2}.object-prefix{grid-column:3;grid-row:1}.object-own{grid-column:3;grid-row:2}.object-prefix,.object-own{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.object-row::after{grid-column:4;grid-row:1 / 3}.object-name{display:block;overflow-wrap:anywhere}.object-description{display:block;font-size:.8em;line-height:1.2;color:var(--secondary-text-color,#666);margin-top:0}.id-chip{font-family:monospace;font-size:.92em;border-radius:4px;padding:1px 7px;overflow-wrap:anywhere;background:color-mix(in srgb,#2196f3 18%,var(--card-background-color,#fff));color:var(--primary-text-color,#222)}.id-chip.prefix{background:transparent;padding:0;display:inline-flex;align-items:baseline;flex-wrap:wrap}.parent-segment{padding:1px 7px;border-radius:4px}.parent-segment.prefix{background:color-mix(in srgb,#ffc107 22%,var(--card-background-color,#fff))}.parent-segment.added{background:color-mix(in srgb,var(--success-color,#0f9d58) 24%,var(--card-background-color,white))}.id-chip.removed{background:color-mix(in srgb,var(--error-color,#db4437) 22%,var(--card-background-color,white));text-decoration:line-through;text-decoration-thickness:1.5px}.id-chip.added{background:color-mix(in srgb,var(--success-color,#0f9d58) 24%,var(--card-background-color,white))}
      .area-row{grid-template-columns:24px auto minmax(0,1fr) auto}.area-row .object-icon,.area-row::after{grid-row:1}.area-row .object-own{grid-row:1}.area-row .object-prefix{display:none}
      .object-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:16px;font-size:.85em}.object-filters button{padding:6px 10px;max-width:100%;overflow-wrap:anywhere}.object-filters button[aria-pressed=true]{background:var(--secondary-background-color,#eee);box-shadow:inset 0 0 0 1px var(--primary-color,#03a9f4)}#check-status{color:var(--secondary-text-color,#666)}
      .object-current-id{grid-column:2 / 4;grid-row:3;font-family:monospace;font-size:.75em;color:var(--secondary-text-color,#666);overflow-wrap:anywhere;user-select:all}.object-conflict{color:var(--error-color,#db4437);--mdc-icon-size:20px}#conflict-filter[aria-pressed=true]{background:var(--secondary-background-color,#eee)}#conflict-detail{font-size:.85em;overflow-wrap:anywhere;white-space:pre-wrap;max-height:180px;overflow:auto}.conflict-jump{display:flex;align-items:center;gap:4px;color:var(--error-color,#db4437);padding:8px;flex:0 0 auto}#conflict-more{padding:4px 0;font-size:.85em}#copy-id{font-size:.85em;padding:4px 0}
      #object-dropdown{display:flex;flex-direction:column;position:fixed;inset:auto;margin:0;box-sizing:border-box;overflow:hidden;z-index:2;background:var(--card-background-color,white);border:1px solid var(--divider-color,#ccc);border-radius:0 0 8px 8px;box-shadow:0 6px 18px #0003}#object-search{display:block;flex:0 0 auto;border-radius:0;margin:0;line-height:1.5;min-height:56px}#object-search:focus-visible{outline-offset:-2px}#object-list{flex:1 1 auto;min-height:0;max-height:none;overflow:auto;overscroll-behavior:contain;padding-top:6px}#object-list .object-option{box-sizing:border-box;min-height:40px;line-height:1.2;border-radius:0;width:100%;text-align:left;padding:3px 12px}#object-list .object-option:hover,#object-list .object-option:focus-visible,#object-list .object-option[aria-selected=true]{background:var(--secondary-background-color,#eee)}
      .automatic{display:flex;align-items:center;gap:12px}.automatic input,.preview-row input{width:auto;min-height:0;flex:0 0 auto}.preview-row{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--divider-color,#ddd)}.preview-ids{overflow-wrap:anywhere;line-height:1.6}.preview-ids code{display:block}.preview-row .error{font-size:14px}
      #selected-link{display:flex;flex:0 0 auto;min-width:40px;align-items:center}.selected-row,.object-choice{display:flex;align-items:center;min-width:0}.selected-row{box-sizing:border-box;width:100%;background:var(--secondary-background-color,#f5f5f5)}.selected-row #object{flex:1;min-width:0;width:auto}.object-link{display:flex;align-items:center;justify-content:center;flex:0 0 40px;width:40px;box-sizing:border-box;min-height:44px;text-decoration:none;color:var(--secondary-text-color,#666);--mdc-icon-size:20px}.object-link:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}.object-link:hover{color:var(--primary-color)}#object-list .object-option{flex:1;min-width:0;width:auto}.object-choice:hover{background:var(--secondary-background-color,#eee)}
      #editor-dialog{width:min(960px,calc(100vw - 32px));height:80dvh;max-height:calc(100dvh - 16px);padding:20px;overflow:hidden;margin:auto;position:fixed;inset:0}
      #editor-dialog[open]{display:grid;grid-template-rows:32px 40px 44px 18px 66px 18px 48px 36px minmax(0,1fr) 64px;gap:4px}
      #editor-dialog .heading{min-width:0}#editor-dialog .heading h2{font-size:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #editor-dialog .tabs{margin:0;align-items:center}#editor-dialog .object-filters{margin:0;min-height:0;overflow:auto;align-content:center}#editor-dialog label{margin:0;align-self:end}
      #editor-dialog .picker,#editor-dialog .selected-row{height:100%;min-height:0}#editor-dialog #object{box-sizing:border-box;height:100%;padding:3px 12px;grid-template-rows:20px 20px 16px;align-content:center;row-gap:0}
      #editor-dialog #object.area-row{grid-template-rows:1fr}#editor-dialog #object .object-name,#editor-dialog #object .object-description,#editor-dialog #object .object-current-id{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
      #editor-dialog #object .object-prefix,#editor-dialog #object .object-own{flex-wrap:nowrap;overflow:hidden}#editor-dialog #object .id-chip{white-space:nowrap;flex-shrink:0}#editor-dialog #object .id-chip.prefix{flex-wrap:nowrap}
      #editor-dialog .segment-heading{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;min-height:26px;font:inherit}#editor-dialog .segment-heading label{align-self:baseline;font:inherit;line-height:24px}#editor-dialog #omit-label{display:inline-block;white-space:nowrap;font:inherit}#omit-label span{font:inherit}#omit-segment{width:18px;height:18px;margin:0 6px 0 0;padding:0;vertical-align:middle}#editor-dialog #segment{height:48px;padding:12px}#editor-dialog .tools{margin:0;flex-wrap:wrap;align-items:baseline;overflow:visible;min-width:0;min-height:32px;gap:4px}#editor-dialog .tools button{white-space:nowrap;flex-shrink:0}#bulk-choice,#bulk-result{font-size:.85em}#bulk-choice button,#bulk-result button{padding:4px 10px}#editor-dialog .tools button{padding:6px 12px}
      .editor-details{min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 0}.editor-details p{margin:4px 0}.editor-details #conflict-detail{max-height:180px}.editor-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.editor-footer .count{margin:0}.editor-footer .actions{margin:0;gap:8px}
      @media(max-width:600px),(max-height:700px){#editor-dialog{width:calc(100vw - 16px);height:calc(100dvh - 16px);padding:12px;border-radius:18px}.editor-footer{font-size:.85em}.editor-footer .actions button{padding:10px}.editor-footer .count{max-width:45%}}
      @media(max-height:550px){#editor-dialog[open]{grid-template-rows:28px 32px 40px 16px 80px 16px 40px 30px minmax(0,1fr) 48px;gap:2px}#editor-dialog #object{padding:2px 12px}#editor-dialog #segment{height:40px}}
      #editor-dialog{width:min(1240px,calc(100vw - 32px))}#editor-dialog[open]{grid-template-rows:32px 44px minmax(0,1fr) 64px}
      .tree-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:18px;min-height:0}.tree-pane,.editor-pane{min-width:0;min-height:0}.tree-pane{contain:layout style;border:1px solid var(--divider-color,#ddd);border-radius:8px;overflow:hidden}.editor-pane{display:grid;grid-template-rows:18px 66px auto 48px auto minmax(0,1fr);gap:4px}
      #object-dropdown{position:static;display:flex;height:100%;width:100%;border:0;box-shadow:none;border-radius:0;box-sizing:border-box}#object-list{padding:4px 0;overflow:auto;flex:1;min-height:0}#object-search{min-height:42px;padding:10px;line-height:1.2}
      .tree-line{display:flex;align-items:center;min-width:0;box-sizing:border-box}.tree-toggle,.tree-spacer{flex:0 0 24px;width:24px;padding:4px 0;text-align:center}.tree-group-title{padding:8px}.tree-select{flex:1;min-width:0;border-radius:0;text-align:left;padding:4px;grid-template-columns:22px minmax(0,1fr);column-gap:6px;row-gap:2px}.tree-select .object-name{grid-column:2;grid-row:1}.tree-select .object-description{grid-column:2;grid-row:2}.tree-select .object-current-id{grid-column:2;grid-row:3}.tree-select .object-prefix{display:none}.tree-select .object-own{grid-column:2;grid-row:4}.tree-select .object-name,.tree-select .object-description,.tree-select .object-current-id{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-select .object-icon{grid-column:1;grid-row:1 / 3}.tree-select .object-own:empty{display:none}.tree-select.area-row{grid-template-columns:22px minmax(0,1fr)}.tree-select.area-row .object-own{grid-column:2;grid-row:2}.tree-select::after{display:none}[role=treeitem][aria-selected=true] > .tree-line{background:var(--secondary-background-color,#eee)}.tree-line:hover{background:var(--secondary-background-color,#eee)}.tree-line .object-link{flex-basis:28px;width:28px;--mdc-icon-size:18px}.tree-line .conflict-jump{padding:4px;font-size:.8em}
      #editor-dialog #object::after{display:none}
      @media(max-width:700px){#editor-dialog .object-filters{flex-wrap:nowrap;align-content:normal;overflow-x:auto;white-space:nowrap}#editor-dialog .object-filters > *{flex-shrink:0}#editor-dialog[open]{grid-template-rows:32px 40px minmax(0,1fr) 56px}.tree-layout{grid-template-columns:1fr;grid-template-rows:minmax(100px,1fr) minmax(220px,1fr);gap:8px}.editor-pane{grid-template-rows:16px 66px auto 40px auto minmax(0,1fr)}#editor-dialog #segment{height:40px}.editor-pane .tools{font:inherit}.tree-select .object-description,.tree-select .object-current-id{display:none}}
      .virtual-tree-surface{position:relative;width:100%;contain:layout style}.virtual-tree-item{position:absolute;inset-inline:0;overflow:hidden;box-sizing:border-box}.virtual-tree-item > .tree-line{height:100%;content-visibility:visible;contain-intrinsic-size:none}.virtual-tree-item .tree-select{height:100%;box-sizing:border-box;align-content:center;overflow:hidden}.virtual-tree-item .object-own{flex-wrap:nowrap;overflow:hidden}.virtual-tree-item .id-chip{flex-shrink:0}#object-list{padding:0;position:relative;overflow-anchor:none}
    </style><header><ha-menu-button></ha-menu-button><h1>Entity ID Manager</h1></header><main><h2>${w.title}</h2><p>${w.intro}</p><div class="main-actions"><button id="open" class="primary">${w.open}</button><button id="preview-open" class="primary">${w.preview}</button></div><label class="automatic"><input id="automatic" type="checkbox" disabled> ${w.automatic}</label><p id="status" role="status"></p></main>
    <dialog id="editor-dialog"><div class="heading"><button id="close" aria-label="${w.close}">×</button><h2>${w.title}</h2></div><div class="object-filters" role="group" aria-label="${this.words === WORDS.ru ? "Фильтр списка" : "List filter"}"><span>${this.words === WORDS.ru ? "Фильтр:" : "Filter:"}</span><button id="filter-all"></button><button id="conflict-filter"></button><button id="filter-scope" hidden></button><span id="check-status" role="status"></span></div><div class="tree-layout"><section class="tree-pane"><div id="object-dropdown"><input id="object-search" type="search" aria-label="${w.search}" placeholder="${w.search}" autocomplete="off"><div id="object-list" role="tree" aria-label="${w.choose}"></div></div></section><section class="editor-pane"><label id="object-label">${w.choose}</label><div class="picker"><div class="selected-row"><div id="object" class="object-row" aria-labelledby="object-label"></div><span id="selected-link"></span></div></div><div class="segment-heading"><label for="segment">${w.segment}</label><label id="omit-label"><input id="omit-segment" type="checkbox"><span>${this.words === WORDS.ru ? "Без собственного сегмента ID" : "No own ID segment"}</span></label></div><input id="segment" type="text" autocomplete="off" autocapitalize="none" spellcheck="false"><div class="tools"><button id="clear">${w.clear}</button><button id="reset">${w.reset}</button><button id="bulk-copy"></button></div><div class="editor-details"><p id="target-id"></p><div id="omit-suggestion" hidden><span id="omit-reason"></span> <button id="omit-accept"></button></div><div id="bulk-choice" hidden><p id="bulk-question"></p><button id="bulk-empty"></button><button id="bulk-all"></button><button id="bulk-cancel"></button></div><div id="bulk-result" hidden><span id="bulk-message" role="status"></span><button id="bulk-undo"></button></div><p id="validation" class="error" role="status"></p><div id="conflict-detail" class="error" role="status"></div><button id="conflict-more" hidden></button><button id="copy-id" hidden></button><p id="error" class="error" role="alert"></p></div></section></div><div class="editor-footer"><p id="count" class="count"></p><div class="actions"><button id="cancel">${w.cancel}</button><button id="confirm" class="primary">${w.confirm}</button></div></div></dialog><dialog id="preview-dialog"><div class="heading"><button id="preview-close" aria-label="${w.close}">×</button><h2>${w.preview}</h2></div><p>${w.references}</p><div id="preview-rows"></div><p id="preview-error" class="error" role="alert"></p><div class="actions"><button id="preview-cancel">${w.cancel}</button><button id="preview-apply" class="primary" disabled>${w.apply}</button></div></dialog>`;
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
    q("#object-search").oninput = () => this.renderOptions();
    q("#object-list").tabIndex = 0;
    q("#object-list").onkeydown = (event) => {
      if (!this.treeModel) return;
      const current = event.target.closest("[data-node-key]");
      let index = this.treeModel.rows.findIndex(
        (row) => row.key === current?.dataset.nodeKey,
      );
      if (index < 0) index = 0;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? this.treeModel.rows.length - 1
              : Math.max(
                  0,
                  Math.min(
                    this.treeModel.rows.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
        this.focusTreeRow(this.treeModel.rows[index]?.key);
      }
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const row = this.treeModel.rows[index];
        if (!row) return;
        if (row.hasChildren && (event.key === "ArrowRight") !== row.expanded) {
          this.treeModel.toggle(row.key);
          this.renderOptions();
          this.focusTreeRow(row.key);
        } else if (event.key === "ArrowLeft")
          this.focusTreeRow(row.node.parentKey);
        else this.focusTreeRow(this.treeModel.rows[index + 1]?.key);
      }
    };
    q("#omit-accept").onclick = () => {
      if (!this.omitSuggestion || this.busy) return;
      this.store.omit(this.selected.entities, true);
      this.fill();
    };
    q("#omit-segment").onchange = (e) => {
      this.store.omit(this.selected.entities, e.target.checked);
      this.fill();
    };
    q("#segment").oninput = (e) => {
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
    q("#bulk-copy").onclick = () => {
      const key = this.kind,
        id = this.selected[key],
        value = this.store.value(key, id);
      const different = this.store
        .namesakeTargets(key, id, true)
        .filter(
          (object) =>
            this.store.value(key, object.id) &&
            this.store.value(key, object.id) !== value,
        );
      if (different.length) {
        this.bulkPending = { key, id, value };
        this.refresh();
      } else this.applyBulk(key, id, false);
    };
    q("#bulk-empty").onclick = () =>
      this.applyBulk(this.bulkPending.key, this.bulkPending.id, false);
    q("#bulk-all").onclick = () =>
      this.applyBulk(this.bulkPending.key, this.bulkPending.id, true);
    q("#bulk-cancel").onclick = () => {
      this.bulkPending = null;
      this.refresh();
    };
    q("#bulk-undo").onclick = () => {
      const count = this.store.undoBulk();
      this.bulkMessage = `${this.words === WORDS.ru ? "Отменено изменений" : "Changes undone"}: ${count}`;
      this.fill();
    };
    q("#confirm").onclick = () => this.save();
    q("#conflict-more").onclick = () => {
      this.expandedConflict =
        this.expandedConflict === this.selected.entities
          ? null
          : this.selected.entities;
      this.refresh();
    };
    for (const mode of ["filter-all", "conflict-filter", "filter-scope"]) {
      q(`#${mode}`).onclick = (event) => {
        event.stopPropagation();
        this.conflictOnly = mode !== "filter-all";
        this.conflictScope = mode === "filter-scope" ? this.scopeChoice : null;
        this.refresh();
        this.togglePicker(true);
      };
    }
    q("#copy-id").onclick = async () => {
      const object = this.store?.objects.entities.find(
        (o) => o.id === this.selected.entities,
      );
      if (this.kind === "entities" && object) {
        try {
          await navigator.clipboard.writeText(object.entity_id);
        } catch {
          q("#error").textContent = object.entity_id;
        }
      }
    };
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
        if (this.kind !== "entities") this.conflictScope = null;
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
      const report = result.references;
      const ru = this.words === WORDS.ru;
      const lines = [`${this.words.applied}: ${result.count}`];
      if (report) {
        lines.push(`${ru ? "Обновлено ссылок" : "References updated"}: ${report.references}`);
        if (report.backup) lines.push(`${ru ? "Резервная копия" : "Backup"}: ${report.backup}`);
        if (report.restart_required?.length) lines.push(`${ru ? "Для применения настроек нужен перезапуск HA" : "Restart HA to apply settings"}: ${report.restart_required.join(", ")}`);
      }
      q("#status").textContent = lines.join("\n");
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
      this.store = new DraftStore(snapshot, this.words === WORDS.ru ? "ru" : "en");
      this.bulkPending = null;
      this.bulkMessage = "";
      this.bulkSource = null;
      this.conflicts = {};
      this.conflictOnly = false;
      this.conflictScope = null;
      this.scopeChoice = null;
      this.expandedConflict = null;
      this.checkKey = null;
      this.checkError = "";
      this.selected = {};
      this.kind = "areas";
      this.virtualTree?.destroy();
      this.treeModel?.destroy();
      this.treeModel = new TreeModel(this.store, this.words.noArea);
      this.entityLookup = new Map(
        this.store.objects.entities.map((object) => [object.id, object]),
      );
      this.indexedConflicts = null;
      q("#object-search").value = "";
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
    if (this.kind !== "areas") {
      const area = (a.area_name || "").localeCompare(b.area_name || "");
      if (area) return area;
    }
    if (this.kind === "entities") {
      const missing = Number(!a.device_name) - Number(!b.device_name);
      if (missing) return missing;
      const device = (a.device_name || "").localeCompare(b.device_name || "");
      if (device) return device;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
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
    if (object.entity_id) {
      const fullId = document.createElement("span");
      fullId.className = "object-current-id";
      fullId.textContent = object.entity_id;
      text.append(fullId);
    }
    node.append(text);
    const parentRow = document.createElement("span");
    parentRow.className = "object-prefix";
    const ownRow = document.createElement("span");
    ownRow.className = "object-own";
    node.append(parentRow, ownRow);
    if (this.kind === "entities" && this.objectConflicts(object).length) {
      const warning = document.createElement("ha-icon");
      warning.icon = "mdi:alert-circle";
      warning.className = "object-conflict";
      warning.title = this.words.conflicts;
      warning.setAttribute("aria-label", this.words.conflicts);
      ownRow.append(warning);
    }
    const prefix = this.store.prefix(this.kind, object);
    if (prefix) {
      const chip = document.createElement("span");
      chip.className = "id-chip prefix";
      for (const [index, segment] of this.store
        .parentSegments(this.kind, object)
        .entries()) {
        if (index) chip.append("/");
        const span = document.createElement("span");
        span.className = `parent-segment ${segment.kind}`;
        span.textContent = segment.value;
        chip.append(span);
      }
      parentRow.append(chip);
    }
    for (const segment of this.store.segments(this.kind, object.id)) {
      const chip = document.createElement("span");
      chip.className = `id-chip ${segment.kind}`;
      chip.textContent = segment.value === "-" ? (this.words === WORDS.ru ? "<без сегмента>" : "<no segment>") : segment.value;
      ownRow.append(chip);
    }
  }
  renderOptions() {
    if (!this.store || !this.treeModel) return;
    const root = this.shadowRoot.querySelector("#object-list");
    this.treeModel.update({
      query: this.shadowRoot.querySelector("#object-search").value,
      conflictOnly: this.conflictOnly,
      conflicts: this.conflicts,
      scope: this.conflictScope,
    });
    if (!this.virtualTree)
      this.virtualTree = new VirtualTree(
        root,
        () => {
          const item = document.createElement("div");
          item.className = "virtual-tree-item";
          item.setAttribute("role", "treeitem");
          return item;
        },
        (item, row) => this.renderVirtualRow(item, row),
      );
    this.virtualTree.setRows(this.treeModel.rows);
  }
  renderVirtualRow(item, row) {
    const node = row.node,
      previousKind = this.kind;
    const selected =
      previousKind === node.kind &&
      this.selected[node.kind] === node.object?.id;
    item.setAttribute("aria-level", String(node.depth + 1));
    item.setAttribute("aria-posinset", String(row.pos));
    item.setAttribute("aria-setsize", String(row.size));
    if (node.object) item.setAttribute("aria-selected", String(selected));
    if (row.hasChildren)
      item.setAttribute("aria-expanded", String(row.expanded));
    else item.removeAttribute("aria-expanded");
    const signature = JSON.stringify([
      node.object ? this.treeSignature(node) : "",
      selected,
      row.expanded,
      row.hasChildren,
      this.treeModel.query,
      this.conflictOnly,
    ]);
    if (item.dataset.signature === signature) return;
    item.dataset.signature = signature;
    const line = document.createElement("div");
    line.className = "tree-line";
    line.style.paddingInlineStart = `${node.depth * 18}px`;
    if (row.hasChildren) {
      const toggle = document.createElement("button");
      toggle.className = "tree-toggle";
      toggle.dataset.nodeKey = node.key;
      toggle.textContent = row.expanded ? "▾" : "▸";
      toggle.setAttribute(
        "aria-label",
        `${row.expanded ? (this.words === WORDS.ru ? "Свернуть" : "Collapse") : this.words === WORDS.ru ? "Развернуть" : "Expand"}: ${node.object?.name || this.words.noArea}`,
      );
      toggle.disabled = Boolean(this.treeModel.query || this.conflictOnly);
      toggle.onclick = () => {
        this.treeModel.toggle(node.key);
        this.renderOptions();
      };
      line.append(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "tree-spacer";
      line.append(spacer);
    }
    if (node.object) {
      this.kind = node.kind;
      const button = document.createElement("button");
      button.className = "tree-select object-row";
      button.dataset.nodeKey = node.key;
      button.dataset.kindId = node.kind;
      button.dataset.objectId = node.object.id;
      button.tabIndex = selected ? 0 : -1;
      this.renderObject(button, node.object);
      button.querySelector(".object-name").textContent = node.object.name;
      button.querySelector(".object-name").title = this.objectLabel(
        node.object,
      );
      button.disabled = this.busy;
      button.onclick = () => {
        this.kind = node.kind;
        this.selected[node.kind] = node.object.id;
        this.fill();
      };
      line.append(button);
      const jump = this.conflictJump(node.object);
      if (jump) line.append(jump);
      line.append(this.cardLink(node.object));
      this.kind = previousKind;
    } else {
      const title = document.createElement("span");
      title.className = "tree-group-title";
      title.textContent = this.words.noArea;
      line.append(title);
    }
    item.replaceChildren(line);
  }
  focusTreeRow(key) {
    if (!key || !this.virtualTree) return;
    this.virtualTree.reveal(key);
    const item = this.virtualTree.items.get(key);
    (
      item?.querySelector(".tree-select") || item?.querySelector(".tree-toggle")
    )?.focus({ preventScroll: true });
  }
  revealTreeObject(kind, id) {
    const node = [...this.treeModel.nodes.values()].find(
      (node) => node.kind === kind && node.object?.id === id,
    );
    if (!node) return;
    this.treeModel.reveal(node.key);
    this.renderOptions();
    this.virtualTree.reveal(node.key);
  }
  positionPicker() {}
  togglePicker() {
    this.renderOptions();
  }
  closePicker() {}
  fill() {
    const value = this.store.value(this.kind, this.selected[this.kind]);
    this.shadowRoot.querySelector("#segment").value = value === "-" ? "" : value;
    this.refresh();
  }
  refresh({ tree = true } = {}) {
    if (!this.store) return;
    this.scheduleCheck();
    this.scheduleOmitSuggestion();
    const q = (s) => this.shadowRoot.querySelector(s),
      w = this.words,
      id = this.selected[this.kind];
    this.renderObject(q("#object"), this.store.byId[this.kind].get(id));
    const current = this.store.byId[this.kind].get(id);
    q("#selected-link").replaceChildren();
    if (current) {
      const jump = this.conflictJump(current);
      if (jump) q("#selected-link").append(jump);
      q("#selected-link").append(this.cardLink(current));
    }
    if (tree) this.updateTreeRows();
    const issues =
      this.kind === "entities" && current ? this.objectConflicts(current) : [];
    const lines = [
      ...new Set(
        issues.flatMap((issue) => {
          if (!issue.related.length)
            return [`${issue.target}: ${w[issue.reason] || issue.reason}`];
          return issue.related.map((peer) => {
            const object = this.store.byId.entities.get(peer);
            const label = object
              ? `${object.area_name || w.noArea}/${object.device_name || w.noDevice}/${object.name}`
              : peer;
            return `${issue.target}: ${w.conflictWith}: ${label}`;
          });
        }),
      ),
    ];
    const expanded = this.expandedConflict === id;
    q("#conflict-detail").textContent = (
      expanded ? lines : lines.slice(0, 3)
    ).join("\n");
    q("#conflict-detail").hidden = !lines.length;
    q("#conflict-more").hidden = lines.length <= 3;
    q("#conflict-more").textContent =
      this.words === WORDS.ru
        ? expanded
          ? "Свернуть"
          : `Ещё ${lines.length - 3}`
        : expanded
          ? "Show less"
          : `More ${lines.length - 3}`;
    q("#conflict-more").setAttribute("aria-expanded", String(expanded));
    const count = Object.keys(this.conflicts || {}).length;
    const ru = this.words === WORDS.ru;
    q("#filter-all").textContent = ru ? "Все объекты" : "All objects";
    q("#filter-all").setAttribute("aria-pressed", String(!this.conflictOnly));
    q("#filter-all").disabled = this.busy;
    q("#conflict-filter").textContent =
      `${ru ? "Все конфликты" : "All conflicts"} (${count})`;
    q("#conflict-filter").setAttribute(
      "aria-pressed",
      String(Boolean(this.conflictOnly && !this.conflictScope)),
    );
    q("#conflict-filter").disabled =
      this.busy || this.checking || Boolean(this.checkError) || !count;
    q("#check-status").textContent =
      this.checkError || (this.checking ? w.conflictCheck : "");
    q("#filter-scope").hidden = !this.scopeChoice;
    if (this.scopeChoice) {
      const scope = this.scopeChoice;
      const scopedCount = this.store.objects.entities.filter(
        (entity) =>
          entity[scope.field] === scope.id &&
          this.conflicts?.[entity.id]?.length,
      ).length;
      q("#filter-scope").textContent = `${scope.label} (${scopedCount})`;
      q("#filter-scope").title = scope.label;
      q("#filter-scope").setAttribute(
        "aria-pressed",
        String(Boolean(this.conflictOnly && this.conflictScope)),
      );
      q("#filter-scope").disabled =
        this.busy || this.checking || Boolean(this.checkError) || !scopedCount;
    }
    q("#copy-id").hidden = this.kind !== "entities" || !current?.entity_id;
    q("#copy-id").textContent = w.copyId;
    q("#count").textContent = `${w.changed}: ${this.store.count}`;
    q("#validation").textContent = this.store.valid ? "" : w.invalid;
    q("#confirm").disabled =
      this.busy || !this.store.valid || !this.store.count;
    q("#confirm").textContent = this.busy ? w.saving : w.confirm;
    q("#omit-suggestion").hidden = !this.omitSuggestion;
    q("#omit-reason").textContent = this.words === WORDS.ru ? "Основная сущность устройства." : "Primary device entity.";
    q("#omit-accept").textContent = this.words === WORDS.ru ? "Убрать собственный сегмент" : "Omit own segment";
    q("#omit-accept").disabled = this.busy;
    q("#omit-label").hidden = this.kind !== "entities";
    q("#omit-segment").checked = this.kind === "entities" && this.store.value(this.kind, id) === "-";
    q("#omit-segment").disabled = this.busy || !id;
    const target = this.kind === "entities" ? this.store.entityTarget(current) : "";
    q("#target-id").hidden = !target;
    q("#target-id").textContent = target ? `${this.words === WORDS.ru ? "Итоговый ID" : "Resulting ID"}: ${target}` : "";
    q("#segment").disabled = this.busy || !id;
    q("#object").disabled = this.busy || !id;
    q("#clear").disabled = this.busy || !id || !this.store.value(this.kind, id);
    const namesakes = this.store.namesakeTargets(this.kind, id, true);
    const unsetNamesakes = this.store.namesakeTargets(this.kind, id, false);
    const value = this.store.value(this.kind, id);
    q("#bulk-copy").textContent =
      `${this.words === WORDS.ru ? "Для одноимённых" : "Apply to same name"} (${namesakes.length})`;
    q("#bulk-copy").hidden = this.kind === "areas";
    q("#bulk-copy").disabled =
      this.busy || !namesakes.length || !value || !(SEGMENT.test(value) || (this.kind === "entities" && value === "-"));
    if (
      this.bulkPending &&
      (this.bulkPending.key !== this.kind ||
        this.bulkPending.id !== id ||
        this.bulkPending.value !== value)
    )
      this.bulkPending = null;
    const ruBulk = this.words === WORDS.ru;
    q("#bulk-choice").hidden = !this.bulkPending;
    q("#bulk-question").textContent = ruBulk
      ? "У некоторых одноимённых объектов уже задан другой сегмент ID. Какие значения заменить?"
      : "Some matching objects already have different ID segments. Which values should be replaced?";
    q("#bulk-empty").textContent = `${ruBulk ? "Только незаданные" : "Unset only"} (${unsetNamesakes.length})`;
    q("#bulk-all").textContent = `${ruBulk ? "Заменить у всех" : "Replace all"} (${namesakes.length})`;
    q("#bulk-cancel").textContent = w.cancel;
    q("#bulk-result").hidden = !this.bulkMessage ||
      this.bulkSource?.key !== this.kind || this.bulkSource?.id !== id;
    q("#bulk-message").textContent = this.bulkMessage || "";
    q("#bulk-undo").textContent = ruBulk ? "Отменить" : "Undo";
    q("#bulk-undo").hidden = !this.store.bulkUndo;
    for (const selector of [
      "#bulk-empty",
      "#bulk-all",
      "#bulk-cancel",
      "#bulk-undo",
    ])
      q(selector).disabled = this.busy;
    q("#bulk-empty").disabled = this.busy || !unsetNamesakes.length;
    q("#bulk-all").disabled = this.busy || !namesakes.length;
    q("#reset").disabled =
      this.busy || !id || !Object.hasOwn(this.store.drafts[this.kind], id);
    for (const selector of ["#cancel", "#close", "[data-kind]"])
      for (const node of this.shadowRoot.querySelectorAll(selector))
        node.disabled = this.busy;
  }
  applyBulk(key, id, replace) {
    if (!this.store || this.busy) return;
    const count = this.store.copyToNamesakes(key, id, replace);
    this.bulkPending = null;
    this.bulkSource = { key, id };
    this.bulkMessage = `${this.words === WORDS.ru ? "Изменено одноимённых объектов" : "Matching objects changed"}: ${count}`;
    this.fill();
  }
  ensureConflictIndex() {
    if (this.indexedConflicts === this.conflicts) return;
    this.indexedConflicts = this.conflicts;
    this.parentIssues = { areas: new Map(), devices: new Map() };
    this.parentIds = { areas: new Map(), devices: new Map() };
    for (const [id, issues] of Object.entries(this.conflicts || {})) {
      const entity = this.entityLookup?.get(id);
      if (!entity || !issues.length) continue;
      for (const [kind, parent] of [
        ["areas", entity.area_id],
        ["devices", entity.device_id],
      ]) {
        if (!parent) continue;
        if (!this.parentIssues[kind].has(parent)) {
          this.parentIssues[kind].set(parent, []);
          this.parentIds[kind].set(parent, []);
        }
        this.parentIssues[kind].get(parent).push(...issues);
        this.parentIds[kind].get(parent).push(id);
      }
    }
  }
  treeSignature(node) {
    this.ensureConflictIndex();
    return JSON.stringify([
      this.store.segments(node.kind, node.object.id),
      node.kind === "entities"
        ? Boolean(this.conflicts?.[node.object.id]?.length)
        : this.parentIds[node.kind].get(node.object.id)?.length || 0,
      this.busy,
    ]);
  }
  updateTreeRows() {
    this.renderOptions();
    this.store.treeDirty.clear();
  }
  conflictJump(object) {
    if (this.kind === "entities") return null;
    const field = this.kind === "areas" ? "area_id" : "device_id";
    const kind = this.kind;
    this.ensureConflictIndex();
    const ids = this.parentIds[kind].get(object.id) || [];
    const label = `${this.words[kind]}: ${this.objectLabel(object)}`;
    if (!ids.length) return null;
    const button = document.createElement("button");
    button.className = "conflict-jump";
    const icon = document.createElement("ha-icon");
    icon.icon = "mdi:alert-circle";
    icon.className = "object-conflict";
    button.append(icon, document.createTextNode(String(ids.length)));
    button.title = `${this.words.conflicts}: ${ids.length}`;
    button.setAttribute("aria-label", button.title);
    button.disabled = this.busy;
    button.onclick = (event) => {
      event.stopPropagation();
      this.conflictScope = {
        field,
        id: object.id,
        label,
      };
      this.scopeChoice = this.conflictScope;
      this.conflictOnly = true;
      this.kind = "entities";
      this.selected.entities = ids[0];
      this.selectKind();
      this.togglePicker(true);
    };
    return button;
  }
  objectConflicts(object) {
    if (!this.store) return [];
    if (this.kind === "entities") return this.conflicts?.[object.id] || [];
    if (this.kind === "areas" || this.kind === "devices") {
      this.ensureConflictIndex();
      return this.parentIssues[this.kind].get(object.id) || [];
    }
    return [];
  }
  scheduleOmitSuggestion() {
    const store = this.store;
    const id = this.selected.entities;
    const object = store?.byId.entities.get(id);
    if (this.kind !== "entities" || !object?.omit_candidate || !store.valid ||
        store.value("entities", id) || Object.hasOwn(store.drafts.entities, id)) {
      clearTimeout(this.omitTimer);
      this.omitKey = null;
      this.omitSuggestion = null;
      return;
    }
    const changes = store.changes();
    const key = JSON.stringify([store.revision, id, changes]);
    if (key === this.omitKey && this.omitStore === store) return;
    this.omitKey = key;
    this.omitStore = store;
    this.omitSuggestion = null;
    clearTimeout(this.omitTimer);
    this.omitTimer = setTimeout(async () => {
      let result = null;
      try {
        result = await this._hass.callWS({type: "entity_id_manager/editor/recommend_omit",
          revision: store.revision, entity_id: object.entity_id, changes});
      } catch { /* A suggestion is optional; a failed check must never offer it. */ }
      if (this.store !== store || this.omitKey !== key) return;
      this.omitSuggestion = result;
      this.refresh({tree: false});
    }, 250);
  }
  scheduleCheck() {
    if (!this.store?.valid) {
      clearTimeout(this.checkTimer);
      this.checkKey = null;
      this.conflicts = {};
      this.checking = false;
      this.checkError = "";
      return;
    }
    const store = this.store;
    const changes = store.changes();
    const key = JSON.stringify([store.revision, changes]);
    if (key === this.checkKey) return;
    this.checkKey = key;
    this.checking = true;
    this.checkError = "";
    this.conflicts = {};
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(async () => {
      try {
        const result = await this._hass.callWS({
          type: "entity_id_manager/editor/check",
          revision: store.revision,
          changes,
        });
        if (this.store !== store || this.checkKey !== key) return;
        this.conflicts = result;
      } catch (error) {
        if (this.store !== store || this.checkKey !== key) return;
        this.checkError =
          error.code === "stale_editor"
            ? this.words.stale
            : this.words.checkFailed;
      } finally {
        if (this.store === store && this.checkKey === key) {
          this.checking = false;
          this.refresh();
          if (
            this.conflictOnly ||
            this.shadowRoot.querySelector("#object-search").value.trim()
          )
            this.renderOptions();
        }
      }
    }, 250);
  }
  cancel() {
    if (this.busy) return;
    clearTimeout(this.checkTimer);
    clearTimeout(this.searchTimer);
    clearTimeout(this.omitTimer);
    clearTimeout(this.treeTimer);
    this.virtualTree?.destroy();
    this.virtualTree = null;
    this.treeModel?.destroy();
    this.treeModel = null;
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
