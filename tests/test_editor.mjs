import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL(
    "../custom_components/entity_id_manager/www/editor.js",
    import.meta.url,
  ),
  "utf8",
);
const { DraftStore } = await import(
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
