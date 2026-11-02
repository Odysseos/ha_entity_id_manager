import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL(
    "../custom_components/entity_id_manager/www/editor.js",
    import.meta.url,
  ),
  "utf8",
);
const { DraftStore, IDManagerPanel, buildTree, TreeModel } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const snapshot = {
  revision: "r1",
  mappings: { areas: { a: "living_room" }, devices: {}, entities: {} },
  objects: {
    areas: [
      { id: "a", name: "Гостиная" },
      { id: "b", name: "Ванная" },
    ],
    devices: [],
    entities: [],
  },
};
const store = new DraftStore(snapshot);
assert.deepEqual(store.segments("areas", "a"), [
  { value: "living_room", kind: "saved" },
]);
store.set("areas", "a", "lounge");
store.set("areas", "b", "bathroom");
assert.equal(store.count, 2);
assert.equal(store.value("areas", "a"), "lounge");
assert.deepEqual(store.segments("areas", "a"), [
  { value: "living_room", kind: "removed" },
  { value: "lounge", kind: "added" },
]);
assert.deepEqual(store.segments("areas", "b"), [
  { value: "bathroom", kind: "added" },
]);
store.set("areas", "a", "");
assert.deepEqual(store.segments("areas", "a"), [
  { value: "living_room", kind: "removed" },
]);
store.reset("areas", "a");
assert.equal(store.value("areas", "a"), "living_room");
assert.equal(store.count, 1);
store.set("areas", "b", "INVALID");
assert.equal(store.valid, false);
store.set("areas", "b", "");
assert.equal(store.count, 0);
assert.equal(store.valid, true);
assert.deepEqual(snapshot.mappings, {
  areas: { a: "living_room" },
  devices: {},
  entities: {},
});
store.set("areas", "a", "lounge");
const changes = store.changes();
changes.areas.a = "mutated";
assert.equal(store.value("areas", "a"), "lounge");
const cancelled = new DraftStore(snapshot);
assert.equal(cancelled.count, 0);
assert.equal(cancelled.value("areas", "a"), "living_room");
assert.equal(store.prefix("areas", { id: "a" }), "");
assert.equal(store.prefix("devices", { area_id: "a" }), "lounge");
assert.equal(store.prefix("devices", {}), "<ID зоны>");
assert.equal(new DraftStore(snapshot, "en").prefix("devices", {}), "<area ID>");
assert.equal(store.prefix("entities", { area_id: "a" }), "lounge/<ID устройства>");
store.set("devices", "d", "radiator");
assert.equal(
  store.prefix("entities", { area_id: "a", device_id: "d" }),
  "lounge/radiator",
);
store.set("areas", "a", "");
assert.equal(
  store.prefix("entities", { area_id: "a", device_id: "d" }),
  "<ID зоны>/radiator",
);
assert.deepEqual(
  store.parentSegments("entities", { area_id: "a", device_id: "d" }),
  [
    { value: "<ID зоны>", kind: "added" },
    { value: "radiator", kind: "added" },
  ],
);
store.reset("areas", "a");
assert.deepEqual(store.parentSegments("devices", { area_id: "a" }), [
  { value: "living_room", kind: "prefix" },
]);
console.log("Editor drafts: passed");

for (const kind of ["areas", "devices", "entities"]) {
  const context = {
    kind,
    store: { saved: { [kind]: { z: "saved" } } },
    objectLabel: (object) => object.name,
  };
  const rows = [
    { id: "z", name: "Zulu", area_name: "Room" },
    { id: "a", name: "Alpha", area_name: "Room" },
  ];
  if (kind !== "areas")
    rows.unshift({ id: "none", name: "Aardvark", area_name: null });
  const sorted = rows.sort((a, b) =>
    IDManagerPanel.prototype.compareObjects.call(context, a, b),
  );
  assert.deepEqual(
    sorted.map((row) => row.id),
    kind === "areas" ? ["a", "z"] : ["a", "z", "none"],
  );
}
console.log("Name-only sorting: passed");

const names = ["Мультисенсор (old)", "Мультисенсор"];
const compare = (kind, rows) =>
  rows.sort((a, b) =>
    IDManagerPanel.prototype.compareObjects.call({ kind }, a, b),
  );
const devices = compare(
  "devices",
  names.map((name, i) => ({ id: String(i), name, area_name: "Ванная" })),
);
const entities = compare(
  "entities",
  names.flatMap((device_name, i) =>
    ["Температура", "Батарея"].map((name, j) => ({
      id: `${i}-${j}`,
      name,
      device_name,
      area_name: "Ванная",
    })),
  ),
);
assert.deepEqual(
  devices.map((row) => row.name),
  ["Мультисенсор", "Мультисенсор (old)"],
);
assert.deepEqual(
  entities.map((row) => row.device_name),
  ["Мультисенсор", "Мультисенсор", "Мультисенсор (old)", "Мультисенсор (old)"],
);
assert.deepEqual(
  entities.map((row) => row.name),
  ["Батарея", "Температура", "Батарея", "Температура"],
);
console.log("Hierarchical sorting: passed");

const bulk = new DraftStore({
  revision: "bulk",
  mappings: { areas: {}, devices: { b: "other" }, entities: {} },
  objects: {
    areas: [],
    devices: [
      { id: "a", name: "Сенсор" },
      { id: "b", name: "Сенсор" },
      { id: "c", name: "сенсор" },
      { id: "d", name: "Другой" },
    ],
    entities: [],
  },
});
bulk.set("devices", "a", "sensor");
assert.equal(bulk.copyToNamesakes("devices", "a", false), 1);
assert.equal(bulk.value("devices", "b"), "other");
assert.equal(bulk.value("devices", "c"), "sensor");
assert.equal(bulk.undoBulk(), 1);
assert.equal(bulk.value("devices", "c"), "");
assert.equal(bulk.copyToNamesakes("devices", "a", true), 2);
bulk.set("devices", "c", "manual");
assert.equal(bulk.undoBulk(), 1);
assert.equal(bulk.value("devices", "b"), "other");
assert.equal(bulk.value("devices", "c"), "manual");
assert.equal(bulk.value("devices", "a"), "sensor");
assert.equal(bulk.value("devices", "d"), "");
console.log("Namesake bulk drafts and selective undo: passed");

const matching = new DraftStore({
  revision: "counts",
  mappings: { areas: {}, devices: { a: "sensor", b: "sensor", c: "other" }, entities: {} },
  objects: { areas: [], devices: [
    { id: "a", name: "Сенсор" }, { id: "b", name: "Сенсор" },
    { id: "c", name: "Сенсор" }, { id: "d", name: "Сенсор" },
  ], entities: [] },
});
assert.equal(matching.namesakeTargets("devices", "a", true).length, 2);
assert.equal(matching.namesakeTargets("devices", "a", false).length, 1);
assert.equal(matching.copyToNamesakes("devices", "a", true), 2);
assert.equal(matching.namesakeTargets("devices", "a", true).length, 0);
matching.set("devices", "b", "draft");
assert.equal(matching.namesakeTargets("devices", "a", true).length, 1);
assert.equal(matching.namesakeTargets("devices", "a", false).length, 0);
matching.set("devices", "a", "");
assert.equal(matching.namesakeTargets("devices", "a", true).length, 0);
console.log("Namesake counts include only effective changes: passed");

const alreadyNamed = new DraftStore({
  mappings: { areas: { room: "room" }, devices: { source: "sensor" }, entities: { sourceEntity: "humidity" } },
  objects: { areas: [], devices: [
    { id: "source", name: "Сенсор" }, { id: "correct", name: "Сенсор" }, { id: "wrong", name: "Сенсор" },
  ], entities: [
    { id: "sourceEntity", name: "Влажность", device_id: "source", area_id: "room", entity_id: "sensor.source", default_segments: { area: "room", device: "sensor", suffix: "vlazhnost" } },
    { id: "correctEntity", name: "Влажность", device_id: "correct", area_id: "room", entity_id: "sensor.room_sensor_humidity", default_segments: { area: "room", device: "sensor", suffix: "humidity" } },
    { id: "wrongEntity", name: "Влажность", device_id: "wrong", area_id: "room", entity_id: "sensor.wrong", default_segments: { area: "room", device: "sensor", suffix: "humidity" } },
  ] },
});
assert.deepEqual(alreadyNamed.namesakeTargets("entities", "sourceEntity", true).map(o => o.id), ["correctEntity", "wrongEntity"]);
assert.deepEqual(alreadyNamed.namesakeTargets("devices", "source", true).map(o => o.id), ["correct", "wrong"]);
alreadyNamed.set("areas", "room", "other_room");
assert.equal(alreadyNamed.namesakeTargets("entities", "sourceEntity", true).length, 2);
console.log("Unset overrides remain editable even when full IDs are already correct: passed");
alreadyNamed.omit("sourceEntity", true);
assert.equal(alreadyNamed.value("entities", "sourceEntity"), "-");
assert.equal(alreadyNamed.valid, true);
assert.equal(alreadyNamed.entityTarget(alreadyNamed.byId.entities.get("sourceEntity")), "sensor.other_room_sensor");
alreadyNamed.omit("sourceEntity", false);
assert.equal(alreadyNamed.value("entities", "sourceEntity"), "humidity");
alreadyNamed.omit("sourceEntity", true);
alreadyNamed.set("entities", "sourceEntity", "temperature");
assert.equal(alreadyNamed.value("entities", "sourceEntity"), "temperature");
alreadyNamed.reset("entities", "sourceEntity");
assert.equal(alreadyNamed.value("entities", "sourceEntity"), "humidity");
console.log("Omitted suffix is distinct from fallback and preserves drafts: passed");

const humidity = new DraftStore({
  revision: "h",
  mappings: { areas: {}, devices: {}, entities: {} },
  objects: {
    areas: [],
    devices: [],
    entities: [
      {
        id: "h1",
        name: "Влажность",
        area_name: "Кухня",
        device_name: "Датчик",
      },
      {
        id: "h2",
        name: "Влажность",
        area_name: "Ванная",
        device_name: "Мультисенсор",
      },
      { id: "t", name: "Температура" },
    ],
  },
});
humidity.set("entities", "h1", "humidity");
assert.equal(humidity.copyToNamesakes("entities", "h1", false), 1);
assert.equal(humidity.value("entities", "h2"), "humidity");
assert.equal(humidity.value("entities", "t"), "");
console.log("Namesake entities ignore parent paths: passed");

const tree = buildTree({
  areas: [{ id: "a", name: "Ванная" }],
  devices: [
    { id: "d", name: "Сенсор", area_id: "a" },
    { id: "none", name: "Без зоны" },
  ],
  entities: [
    { id: "e", name: "Влажность", area_id: "a", device_id: "d" },
    { id: "direct", name: "Шаблон", area_id: "a" },
    { id: "orphan", name: "Без зоны" },
  ],
});
assert.equal(tree[0].object.id, "a");
assert.equal(tree[0].children[0].object.id, "d");
assert.equal(tree[0].children[0].children[0].object.id, "e");
assert.equal(tree[0].children[1].object.id, "direct");
assert.equal(tree.at(-1).key, "no-area");
assert.equal(tree.at(-1).kind, null);
assert.equal(tree.at(-1).children.length, 2);
console.log("Unified tree grouping: passed");

const model = new TreeModel(humidity);
model.update({
  query: "new_unique_segment",
  conflictOnly: false,
  conflicts: {},
  scope: null,
});
assert.equal(model.rows.length, 0);
humidity.set("entities", "h2", "new_unique_segment");
assert.ok(model.rows.some((row) => row.key === "entities:h2"));
assert.equal(model.state("entities:h2").segments.at(-1).value, "new_unique_segment");
humidity.undoBulk();
model.destroy();
console.log("Nonvisual model changes synchronously without DOM: passed");

// Missing segments, saved rename plans and drafts describe different states.
const filters = new DraftStore({
  mappings: {areas: {a: 'bathroom'}, devices: {}, entities: {omitted: '-'}},
  objects: {
    areas: [{id: 'a', name: 'Ванная', default_segment: 'vannaya'}, {id: 'empty', name: 'Кладовая', default_segment: 'kladovaya'}],
    devices: [{id: 'd', name: 'Сенсор', area_id: 'a', default_segment: 'sensor'}],
    entities: [
      {id: 'e', name: 'Влажность', area_id: 'a', device_id: 'd', entity_id: 'sensor.old', default_segment: 'vlazhnost', default_segments: {area: 'vannaya', device: 'sensor', suffix: 'vlazhnost'}},
      {id: 'omitted', name: 'Основная', area_id: 'a', device_id: 'd', entity_id: 'light.bathroom_sensor', default_segment: 'state', default_segments: {area: 'vannaya', device: 'sensor', suffix: 'state'}},
      {id: 'untouched', name: 'Новая', entity_id: 'sensor.keep', default_segments: {area: '', device: '', suffix: 'different'}},
    ],
  },
});
assert.deepEqual([...filters.filterSets().saved], ['entities:e']);
assert.deepEqual([...filters.filterSets().pending], ['entities:e']);
assert.ok(filters.filterSets().missing.has('areas:empty'));
assert.ok(filters.filterSets().missing.has('devices:d'));
assert.ok(filters.filterSets().missing.has('entities:e'));
assert.ok(!filters.filterSets().missing.has('entities:omitted'));
assert.equal(filters.defaultSegment('areas', 'empty'), 'kladovaya');
assert.equal(filters.defaultSegment('devices', 'd'), 'sensor');
assert.equal(filters.defaultSegment('entities', 'e'), 'vlazhnost');
const filterModel = new TreeModel(filters);
filterModel.update({query: '', conflictOnly: false, conflicts: {}, scope: null, filter: 'draft'});
assert.equal(filterModel.rows.length, 0);
filters.set('entities', 'e', 'humidity');
assert.ok(filterModel.rows.some(row => row.key === 'entities:e'));
assert.ok(filterModel.rows.some(row => row.key === 'areas:a'));
assert.deepEqual([...filters.filterSets().draft], ['entities:e']);
assert.equal(filters.entityTarget(filters.byId.entities.get('e')), 'sensor.bathroom_sensor_humidity');
filters.set('entities', 'e', 'old');
assert.ok(filters.filterSets().saved.has('entities:e'));
filters.set('areas', 'a', '');
filters.set('entities', 'e', '');
assert.ok(!filters.filterSets().pending.has('entities:e'));
assert.ok(filters.filterSets().saved.has('entities:e'));
filters.omit('e', true);
filters.set('entities', 'e', filters.defaultSegment('entities', 'e'));
assert.equal(filters.value('entities', 'e'), 'vlazhnost');
filterModel.destroy();
console.log('Segment state filters, ancestor retention and generator defaults: passed');

// Regression: equal current entity IDs must not hide missing explicit segments.
for (const suffix of ["low_battery_valve_state", "linkquality"]) {
  const rooms = ["living_room", "kids_room", "kitchen", "bedroom"];
  const entities = rooms.map(area => ({
    id: `${area}_${suffix}`, name: suffix === "linkquality" ? "Linkquality" : "Low battery valve state",
    entity_id: `${suffix === "linkquality" ? "sensor" : "select"}.${area}_radiator_${suffix}`,
    area_id: area, device_id: `${area}_radiator`,
    default_segments: {area, device: "radiator", suffix}, default_segment: suffix,
  }));
  const group = new DraftStore({mappings: {areas: {}, devices: {}, entities: {}}, objects: {areas: [], devices: [], entities}});
  group.set("entities", entities[0].id, suffix);
  assert.equal(group.namesakeTargets("entities", entities[0].id, false).length, 3);
  assert.equal(group.copyToNamesakes("entities", entities[0].id, false), 3);
  assert.equal(group.namesakeTargets("entities", entities[0].id, true).length, 0);
  assert.equal(group.count, 4);
  assert.equal(group.filterSets().pending.size, 0);
  assert.equal(group.filterSets().missing.size, 0);
  assert.equal(group.undoBulk(), 3);
  assert.equal(group.namesakeTargets("entities", entities[0].id, false).length, 3);
}
console.log("Linkquality and low battery: unset segments counted independently of rename plans: passed");

const existingIdCases = [
  ['binary_sensor.carbon_connectivity', 'kids_room', 'carbon', 'connectivity'],
  ['sensor.samsung_m2020_series_uptime', 'kids_room', 'samsung_m2020_series', 'uptime'],
  ['sensor.kids_room_samsung_m2020_series_uptime', 'kids_room', 'samsung_m2020_series', 'uptime'],
  ['sensor.carbon', 'kids_room', 'carbon', '-'],
  ['sensor.kids_room_carbon', 'kids_room', 'carbon', '-'],
  ['sensor.carbonate_temperature', 'kids_room', 'carbon', 'carbonate_temperature'],
  ['sensor.other_carbon_temperature', 'kids_room', 'carbon', 'other_carbon_temperature'],
  ['sensor.carbon_input_tray_1', '', 'carbon', 'input_tray_1'],
  ['sensor.kids_room_temperature', 'kids_room', '', 'temperature'],
  ['sensor.uptime', '', '', 'uptime'],
];
for (const [entity_id, area, device, expected] of existingIdCases) {
  const current = new DraftStore({mappings: {areas: {a: 'changed_area'}, devices: {d: 'changed_device'}, entities: {}}, objects: {
    areas: [], devices: [], entities: [{id: 'e', name: 'Переведённое имя', entity_id, default_segments: {area, device, suffix: 'ignored'}}],
  }});
  current.set('devices', 'd', 'draft_device');
  assert.equal(current.currentIdSegment('e'), expected, entity_id);
}
assert.equal(store.currentIdSegment('missing'), null);
console.log('Extract current ID: exact parent prefixes, unchanged drafts, empty suffix and boundaries: passed');
const positioning = new DraftStore({mappings: {areas: {a: 'room'}, devices: {d: 'device'}, entities: {primary: '-'}}, objects: {
  areas: [{id: 'a', name: 'Комната'}],
  devices: [{id: 'd', name: 'Устройство', area_id: 'a'}],
  entities: [{id: 'primary', name: 'А', area_id: 'a', device_id: 'd'}, {id: 'first', name: 'Б', area_id: 'a', device_id: 'd'}, {id: 'second', name: 'В', area_id: 'a'}],
}});
const positioningTree = new TreeModel(positioning);
assert.equal(positioningTree.firstUnset().object.id, 'first');
positioning.set('entities', 'first', 'first');
assert.equal(positioningTree.firstUnset().object.id, 'second');
positioning.set('entities', 'second', 'second');
assert.equal(positioningTree.firstUnset(), null);
positioningTree.destroy();
console.log('Initial selection: first unset in tree order, omission excluded and all-set fallback: passed');
const navigation = new DraftStore({mappings: {areas: {}, devices: {}, entities: {omitted: '-'}}, objects: {
  areas: [{id: 'a', name: 'Area'}], devices: [{id: 'd', name: 'Device', area_id: 'a'}],
  entities: [{id: 'first', name: 'First', area_id: 'a', device_id: 'd'}, {id: 'last', name: 'Last', area_id: 'a', device_id: 'd'}, {id: 'omitted', name: 'Omitted', area_id: 'a', device_id: 'd'}],
}});
const navigationTree = new TreeModel(navigation);
assert.equal(navigationTree.adjacentUnset('areas:a', -1), null);
assert.equal(navigationTree.adjacentUnset('areas:a', 1).object.id, 'd');
navigationTree.toggle('devices:d@areas:a');
assert.equal(navigationTree.adjacentUnset('devices:d@areas:a', 1).object.id, 'first');
assert.equal(navigationTree.adjacentUnset('entities:last', 1), null);
navigation.set('entities', 'first', 'first');
assert.equal(navigationTree.adjacentUnset('devices:d@areas:a', 1).object.id, 'last');
navigationTree.update({query: 'Last', conflictOnly: false, conflicts: {}, scope: null});
assert.equal(navigationTree.adjacentUnset('entities:last', -1), null);
assert.equal(navigationTree.adjacentUnset(undefined, 1).object.id, 'last');
navigationTree.update({query: '', conflictOnly: true, conflicts: {first: [{}], last: [{}]}, scope: {field: 'device_id', id: 'd'}});
assert.equal(navigationTree.adjacentUnset(undefined, 1).object.id, 'last');
navigationTree.destroy();
console.log('Unset navigation: collapsed branches, boundaries, search and scoped filters: passed');

const reviewSnapshot = {revision: 'seen', mappings: {areas: {}, devices: {}, entities: {e: '-'}}, objects: {
  areas: [{id: 'old', name: 'A old'}, {id: 'new', name: 'Z new'}], devices: [],
  entities: [{id: 'e', name: 'Primary', area_id: 'new'}],
}};
const bootstrap = new DraftStore(reviewSnapshot);
assert.equal(bootstrap.isNew('areas', 'old'), false);
assert.equal(bootstrap.needsReview, true);
const reviewed = new DraftStore({...reviewSnapshot, reviewed: {areas: ['old'], devices: [], entities: []}});
assert.equal(reviewed.isNew('areas', 'old'), false);
assert.equal(reviewed.isNew('areas', 'new'), true);
assert.equal(reviewed.isNew('entities', 'e'), true); // New even if an explicit segment exists.
assert.equal(reviewed.needsReview, true);
reviewed.set('areas', 'new', 'new');
assert.equal(reviewed.isNew('areas', 'new'), true); // Draft edits do not acknowledge.
assert.deepEqual(reviewed.reviewedObjects(), {areas: ['old', 'new'], devices: [], entities: ['e']});
const reviewTree = new TreeModel(reviewed);
assert.equal(reviewTree.firstUnset().object.id, 'old'); // No priority for new nodes.
assert.equal(reviewTree.adjacentUnset('areas:old', 1), null); // New but filled nodes are skipped.
reviewTree.destroy();
const acknowledged = new DraftStore({...reviewSnapshot, reviewed: reviewed.reviewedObjects()});
assert.equal(acknowledged.needsReview, false);
assert.equal(acknowledged.isNew('entities', 'e'), false);
console.log('Review state: first run, confirmation, new versus missing and unchanged tree order: passed');
