import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const source = await readFile(
  new URL(
    "../custom_components/entity_id_manager/www/editor.js",
    import.meta.url,
  ),
  "utf8",
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://editor.test/**", (route) => {
    if (new URL(route.request().url()).pathname === "/editor.js")
      return route.fulfill({ contentType: "text/javascript", body: source });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="ru"><meta charset="UTF-8"><body style="margin:0;--primary-text-color:#222;--primary-color:#009fbd;--primary-background-color:#fafafa;--card-background-color:white;--secondary-background-color:#f1f1f1"><entity-id-manager-panel></entity-id-manager-panel><script type="module">
    import '/editor.js';
    const snapshot={revision:'r1',mappings:{areas:{a:'living_room'},devices:{d:'neptun',unassigned:'controller'},entities:{}},objects:{areas:[{id:'a',name:'Гостиная'},{id:'b',name:'Ванная'}],devices:[{id:'unassigned',name:'Адаптер',area_name:null},{id:'d',name:'Нептун',area_id:'b',area_name:'Ванная',description:'Model X · Vendor'}],entities:[{id:'no_area',name:'Адаптер',entity_id:'sensor.no_area',area_name:null},{id:'e',description:'Temperature parameter',name:'Температура',entity_id:'sensor.test',area_id:'a',device_id:'d',area_name:'Кухня',device_name:'Мультисенсор'}]}};
    window.test={snapshot,calls:[],fail:false};
    document.querySelector('entity-id-manager-panel').hass={locale:{language:'ru'},callWS:async(msg)=>{
      if(msg.type.endsWith('/get'))return structuredClone(window.test.snapshot);
      if(msg.type.endsWith('/check'))return window.test.conflicts || {};
      window.test.calls.push(structuredClone(msg));
      if(msg.type==='entity_id_manager/automatic'){snapshot.auto_new=msg.enabled;return {auto_new:msg.enabled};}
      if(msg.type==='entity_id_manager/preview')return [{registry_id:'valid',old:'sensor.old',new:'sensor.next',conflict:''},{registry_id:'blocked',old:'sensor.other',new:'sensor.taken',conflict:'occupied'}];
      if(msg.type==='entity_id_manager/apply')return {count:msg.rows.length};
      if(window.test.fail)throw {code:'stale_editor'};
      for(const[k,v]of Object.entries(msg.changes))for(const[id,part]of Object.entries(v)){if(part)snapshot.mappings[k][id]=part;else delete snapshot.mappings[k][id];}
      snapshot.revision='r2';return structuredClone(snapshot);
    }};
    </script></body></html>`,
    });
  });
  await page.goto("http://editor.test/");
  const q = (s) => page.locator(`entity-id-manager-panel ${s}`);
  const choose = async (id) => {
    await q("#object").click();
    await q(`.object-option[data-object-id="${id}"]`).click();
  };
  await q("#open").click();
  await q("#editor-dialog").waitFor({ state: "visible" });
  await choose("a");
  assert.ok(
    await q("#object").evaluate((node) => {
      const a = node.querySelector(".object-name").getBoundingClientRect();
      const b = node.querySelector(".object-own").getBoundingClientRect();
      return Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 1;
    }),
  );
  assert.equal(
    await q("#selected-link a").getAttribute("href"),
    "/config/areas/area/a",
  );

  await q("#part").fill("lounge");
  assert.deepEqual(await q("#object .id-chip").allTextContents(), [
    "living_room",
    "lounge",
  ]);
  assert.equal(await q("#object .removed").count(), 1);
  assert.equal(await q("#object .added").count(), 1);
  assert.match(
    await q("#object .removed").evaluate(
      (node) => getComputedStyle(node).textDecorationLine,
    ),
    /line-through/,
  );
  await q("#object").click();
  assert.deepEqual(
    await q('.object-option[data-object-id="a"] .id-chip').allTextContents(),
    ["living_room", "lounge"],
  );
  await page.keyboard.press("Escape");
  assert.equal(await q("#editor-dialog").isVisible(), true);
  assert.equal(await q("#object-dropdown").isVisible(), false);

  await choose("b");
  await q("#part").fill("bathroom");
  await q("#object").click();
  await q("#object-search").fill("bathroom");
  assert.equal(await q(".object-option").count(), 1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await q("#part").inputValue(), "bathroom");
  await choose("a");
  assert.equal(await q("#part").inputValue(), "lounge");
  await q("#reset").click();
  assert.equal(await q("#part").inputValue(), "living_room");
  assert.equal(await q("#count").textContent(), "Изменено объектов: 1");
  await q("#clear").click();
  assert.deepEqual(await q("#object .id-chip").allTextContents(), [
    "living_room",
  ]);
  assert.equal(await q("#object .removed").count(), 1);
  assert.equal(await q("#object .added").count(), 0);
  assert.equal((await q("#object").textContent()).includes("удалить"), false);
  await q("#cancel").click();
  assert.equal(await page.evaluate(() => window.test.calls.length), 0);
  await q("#open").click();
  await choose("a");
  assert.equal(await q("#part").inputValue(), "living_room");
  await q("#part").fill("lounge");
  await choose("b");
  await q("#part").fill("bathroom");
  await q('[data-kind="devices"]').click();
  assert.match(await q("#object").textContent(), /Ванная\/Нептун/);
  assert.equal(await q("#object .object-icon").count(), 1);
  assert.equal(await q("#object .id-chip.prefix").textContent(), "bathroom");
  assert.equal(
    await q("#selected-link a").getAttribute("href"),
    "/config/devices/device/d",
  );
  assert.equal(await q("#selected-link a").getAttribute("target"), "_blank");
  const alignment = await q("#object").evaluate((node) => {
    const box = (selector) =>
      node.querySelector(selector).getBoundingClientRect();
    const name = box(".object-name"),
      hint = box(".object-description");
    const prefix = box(".object-prefix"),
      own = box(".object-own");
    return {
      first: Math.abs(
        (name.top + name.bottom - prefix.top - prefix.bottom) / 2,
      ),
      second: Math.abs((hint.top + hint.bottom - own.top - own.bottom) / 2),
      separated: own.top >= prefix.bottom,
    };
  });
  assert.ok(alignment.first < 1 && alignment.second < 1 && alignment.separated);
  await q("#object").click();
  assert.ok(
    await q('.object-option[data-object-id="d"]').evaluate((node) => {
      const box = (s) => node.querySelector(s).getBoundingClientRect();
      const name = box(".object-name"),
        hint = box(".object-description"),
        prefix = box(".object-prefix"),
        own = box(".object-own");
      return (
        getComputedStyle(node).display === "grid" &&
        Math.abs(name.top + name.height / 2 - prefix.top - prefix.height / 2) <
          1 &&
        Math.abs(hint.top + hint.height / 2 - own.top - own.height / 2) < 1 &&
        own.top >= prefix.bottom
      );
    }),
  );
  assert.deepEqual(
    await q(".object-option").evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.objectId),
    ),
    ["d", "unassigned"],
  );
  assert.equal(
    await q(".object-choice:last-child a").getAttribute("href"),
    "/config/devices/device/unassigned",
  );
  await page.keyboard.press("Escape");

  await q('[data-kind="entities"]').click();
  assert.match(
    await q("#object").textContent(),
    /Кухня\/Мультисенсор\/Температура/,
  );
  assert.equal(
    await q("#object .id-chip.prefix").textContent(),
    "lounge/neptun",
  );
  assert.equal(
    await q(
      "#object .id-chip.prefix.removed, #object .id-chip.prefix.added",
    ).count(),
    0,
  );
  assert.equal(
    await q("#selected-link a").getAttribute("href"),
    "/config/entities?more-info-entity-id=sensor.test",
  );

  assert.equal(
    await q("#object .object-current-id").textContent(),
    "sensor.test",
  );
  assert.equal(await q("#copy-id").isVisible(), true);
  assert.ok(
    await q(".selected-row").evaluate((row) => {
      const outer = row.getBoundingClientRect(),
        link = row.querySelector(".object-link").getBoundingClientRect();
      return link.left >= outer.left && link.right <= outer.right + 1;
    }),
  );
  assert.equal(await q("#object .object-icon").count(), 1);
  assert.equal(
    await q("#object .object-description").textContent(),
    "Temperature parameter",
  );
  await q("#object").click();
  assert.deepEqual(
    await q(".object-option").evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.objectId),
    ),
    ["e", "no_area"],
  );
  await page.keyboard.press("Escape");
  await q('[data-kind="devices"]').click();
  assert.equal(
    await q("#object .object-description").textContent(),
    "Model X · Vendor",
  );

  await q("#part").fill("water_guard");
  await q('[data-kind="areas"]').click();
  await choose("a");
  assert.equal(await q("#part").inputValue(), "lounge");
  await q("#part").fill("INVALID");
  assert.equal(await q("#confirm").isDisabled(), true);
  await q("#part").fill("lounge");
  if (process.env.EDITOR_SCREENSHOT) {
    await q("#object").click();
    await page.screenshot({ path: process.env.EDITOR_SCREENSHOT });
    await page.keyboard.press("Escape");
  }
  await q("#confirm").click();
  await q("#editor-dialog").waitFor({ state: "hidden" });
  const calls = await page.evaluate(() => window.test.calls);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].changes, {
    areas: { a: "lounge", b: "bathroom" },
    devices: { d: "water_guard" },
    entities: {},
  });
  await q("#open").click();
  await choose("a");
  await q("#part").fill("living");
  await page.evaluate(() => (window.test.fail = true));
  await q("#confirm").click();
  await q("#error").filter({ hasText: "другом окне" }).waitFor();
  assert.equal(await q("#part").inputValue(), "living");
  await page.keyboard.press("Escape");
  await q("#editor-dialog").waitFor({ state: "hidden" });
  await q("#open").click();
  await choose("a");
  assert.equal(await q("#part").inputValue(), "lounge");
  await q("#cancel").click();
  await page.evaluate(() => {
    window.test.snapshot.objects.areas = Array.from({ length: 60 }, (_, i) => ({
      id: `area_${i}`,
      name: `Комната ${String(i).padStart(2, "0")}`,
    }));
  });
  await page.setViewportSize({ width: 1024, height: 1000 });
  await q("#open").click();
  await q("#object").click();
  const geometry = await page
    .locator("entity-id-manager-panel")
    .evaluate((panel) => {
      const root = panel.shadowRoot;
      const popup = root.querySelector("#object-dropdown"),
        dialog = root.querySelector("#editor-dialog");
      const p = popup.getBoundingClientRect(),
        d = dialog.getBoundingClientRect();
      return {
        topLayer: popup.matches(":popover-open"),
        bottom: p.bottom,
        dialogBottom: d.bottom,
        height: p.height,
        viewport: innerHeight,
      };
    });
  assert.equal(geometry.topLayer, true);
  assert.ok(
    geometry.bottom > geometry.dialogBottom,
    "Long list must extend beyond the dialog",
  );
  assert.ok(geometry.bottom <= geometry.viewport - 7);
  assert.ok(geometry.height > 230);
  const searchTop = (await q("#object-search").boundingBox()).y;
  await q("#object-list").evaluate(
    (node) => (node.scrollTop = node.scrollHeight),
  );
  assert.equal((await q("#object-search").boundingBox()).y, searchTop);
  await q('.object-option[data-object-id="area_59"]').click();
  assert.match(await q("#object").textContent(), /Комната 59/);
  await page.setViewportSize({ width: 390, height: 640 });
  await q("#object").click();
  const small = await q("#object-dropdown").boundingBox();
  assert.ok(small.x >= 7 && small.x + small.width <= 383);
  assert.ok(small.y >= 7 && small.y + small.height <= 633);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1024, height: 550 });
  await page.locator("entity-id-manager-panel").evaluate((panel) => {
    panel.shadowRoot.querySelector("#editor-dialog").style.transform =
      "translateY(100px)";
    panel.togglePicker(true);
  });
  const up = await q("#object-dropdown").boundingBox(),
    anchor = await q("#object").boundingBox();
  assert.ok(
    up.y + up.height <= anchor.y,
    "List must open upwards when lower space is limited",
  );
  assert.ok(up.y >= 7);
  await page.keyboard.press("Escape");
  await page
    .locator("entity-id-manager-panel")
    .evaluate(
      (panel) =>
        (panel.shadowRoot.querySelector("#editor-dialog").style.transform = ""),
    );
  await q("#cancel").click();
  await q("#automatic").check();
  await page.waitForFunction(() => window.test.snapshot.auto_new === true);
  await q("#preview-open").click();
  await q("#preview-dialog").waitFor({ state: "visible" });
  assert.equal(
    await q('#preview-rows input[value="blocked"]').isDisabled(),
    true,
  );
  await q('#preview-rows input[value="valid"]').check();
  await q("#preview-apply").click();
  await q("#preview-dialog").waitFor({ state: "hidden" });
  assert.match(await q("#status").textContent(), /Переименовано сущностей: 1/);
  const applyCall = await page.evaluate(() =>
    window.test.calls.find((call) => call.type === "entity_id_manager/apply"),
  );
  assert.deepEqual(applyCall.rows, [
    { registry_id: "valid", old: "sensor.old", new: "sensor.next" },
  ]);
  await page.goto("http://editor.test/?config_entry=installed_entry");
  await q("#editor-dialog").waitFor({ state: "visible" });
  assert.equal(await q("#object").isVisible(), true);
  await q("#cancel").click();
  assert.deepEqual(errors, []);
  await page.evaluate(() => {
    window.test.conflicts = {
      e: [
        {
          target: "sensor.duplicate",
          reason: "occupied",
          related: ["no_area"],
        },
      ],
      no_area: [
        { target: "sensor.duplicate", reason: "occupied", related: ["e"] },
      ],
    };
  });
  await q("#open").click();
  await q("#conflict-filter").filter({ hasText: "2" }).waitFor();
  await q('[data-kind="entities"]').click();
  assert.equal(await q("#object .object-conflict").count(), 1);
  assert.match(await q("#conflict-detail").textContent(), /sensor.duplicate/);
  await q("#conflict-filter").click();
  assert.equal(await q(".object-option").count(), 2);
  await page.keyboard.press("Escape");
  await q('[data-kind="devices"]').click();
  assert.equal(await q("#conflict-detail").isVisible(), false);
  assert.equal(await q("#selected-link .conflict-jump").textContent(), "1");
  await q("#selected-link .conflict-jump").click();
  assert.equal(await q(".object-option").count(), 1);
  assert.equal(await q(".object-option").getAttribute("data-object-id"), "e");
  assert.match(await q("#filter-scope").textContent(), /Ванная\/Нептун.*\(1\)/);
  assert.equal(await q("#filter-scope").getAttribute("aria-pressed"), "true");
  assert.equal(await q("#conflict-filter").textContent(), "Все конфликты (2)");
  await q("#conflict-filter").click();
  assert.equal(await q(".object-option").count(), 2);
  assert.equal(
    await q("#conflict-filter").getAttribute("aria-pressed"),
    "true",
  );
  await q("#filter-scope").click();
  assert.equal(await q(".object-option").count(), 1);

  await page.keyboard.press("Escape");
  await q('[data-kind="areas"]').click();
  await choose("a");
  assert.equal(await q("#conflict-detail").isVisible(), false);
  assert.equal(await q("#selected-link .conflict-jump").textContent(), "1");
  await q("#cancel").click();
  await page.evaluate(() => {
    window.test.conflicts.e[0].related = Array.from(
      { length: 12 },
      (_, i) => `peer_${i}`,
    );
  });
  await q("#open").click();
  await q("#conflict-filter").filter({ hasText: "2" }).waitFor();
  await q('[data-kind="entities"]').click();
  await choose("e");
  assert.equal(
    (await q("#conflict-detail").textContent()).split("\n").length,
    3,
  );
  assert.equal(await q("#conflict-more").textContent(), "Ещё 9");
  await q("#conflict-more").click();
  assert.equal(
    (await q("#conflict-detail").textContent()).split("\n").length,
    12,
  );
  assert.ok(
    await q("#conflict-detail").evaluate(
      (node) =>
        node.clientHeight <= 180 && node.scrollHeight > node.clientHeight,
    ),
  );
  await q("#conflict-more").click();
  assert.equal(
    (await q("#conflict-detail").textContent()).split("\n").length,
    3,
  );
  await q("#cancel").click();
  console.log(
    "Browser editor: selection, draft labels, reset, clear, cancel, batch save, validation, stale guard and viewport popover geometry, preview, automatic mode and direct settings entry passed",
  );
} finally {
  await browser.close();
}
