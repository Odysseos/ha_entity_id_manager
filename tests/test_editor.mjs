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
assert.equal(store.prefix("devices", {}), "<area_id>");
assert.equal(store.prefix("entities", { area_id: "a" }), "lounge/<device_id>");
store.set("devices", "d", "radiator");
assert.equal(
  store.prefix("entities", { area_id: "a", device_id: "d" }),
  "lounge/radiator",
);
store.set("areas", "a", "");
assert.equal(
  store.prefix("entities", { area_id: "a", device_id: "d" }),
  "<area_id>/radiator",
);
assert.deepEqual(
  store.parentParts("entities", { area_id: "a", device_id: "d" }),
  [
    { value: "<area_id>", kind: "added" },
    { value: "radiator", kind: "added" },
  ],
);
store.reset("areas", "a");
assert.deepEqual(store.parentParts("devices", { area_id: "a" }), [
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
  query: "new_unique_part",
  conflictOnly: false,
  conflicts: {},
  scope: null,
});
assert.equal(model.rows.length, 0);
humidity.set("entities", "h2", "new_unique_part");
assert.ok(model.rows.some((row) => row.key === "entities:h2"));
assert.equal(model.state("entities:h2").parts.at(-1).value, "new_unique_part");
humidity.undoBulk();
model.destroy();
console.log("Nonvisual model changes synchronously without DOM: passed");
