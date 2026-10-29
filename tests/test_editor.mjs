import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL(
    "../custom_components/entity_id_manager/www/editor.js",
    import.meta.url,
  ),
  "utf8",
);
const { DraftStore, IDManagerPanel } = await import(
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
