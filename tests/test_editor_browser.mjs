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
  await page.evaluate(() => {
    window.test.snapshot.objects.entities.push({
      id: "e2",
      name: "Температура",
      entity_id: "sensor.second",
      area_id: "b",
      device_id: "d",
      area_name: "Ванная",
      device_name: "Нептун",
    });
    window.test.snapshot.mappings.entities.e2 = "previous";
  });
  const q = (s) => page.locator(`entity-id-manager-panel ${s}`);
  const select = async (kind, id) =>
    q(`.tree-select[data-kind-id="${kind}"][data-object-id="${id}"]`)
      .first()
      .click();
  await q("#open").click();
  await q("#editor-dialog").waitFor({ state: "visible" });
  assert.equal(await q(".tabs").count(), 0);
  assert.equal(await q('[role="tree"]').count(), 1);
  const layout = () => q("#editor-dialog").boundingBox();
  const initial = await layout();
  await select("entities", "e");
  assert.equal(
    await q("#object .object-current-id").textContent(),
    "sensor.test",
  );
  await q("#part").fill("temperature");
  await select("devices", "d");
  assert.equal(await q("#part").inputValue(), "neptun");
  await q("#part").fill("guard");
  await select("areas", "b");
  await q("#part").fill("bathroom");
  await select("entities", "e");
  assert.equal(await q("#part").inputValue(), "temperature");
  assert.deepEqual(await layout(), initial);
  await q("#bulk-copy").click();
  assert.equal(await q("#bulk-choice").isVisible(), true);
  await q("#bulk-all").click();
  await select("entities", "e2");
  assert.equal(await q("#part").inputValue(), "temperature");
  await q("#bulk-undo").click();
  assert.equal(await q("#part").inputValue(), "previous");
  await q("#object-search").fill("Temperature parameter");
  assert.equal(await q('.tree-select[data-kind-id="entities"]').count(), 1);
  assert.equal(await q('.tree-select[data-kind-id="areas"]').count(), 1);
  assert.equal(await q('.tree-select[data-kind-id="devices"]').count(), 1);
  await q("#object-search").fill("");
  await select("entities", "e");
  const areaToggle = q('.tree-toggle[aria-label="Свернуть: Гостиная"]');
  await areaToggle.click();
  assert.equal(await q('.tree-select[data-object-id="e"]').count(), 0);
  assert.equal(await q("#part").inputValue(), "temperature");
  await q('.tree-toggle[aria-label="Развернуть: Гостиная"]').click();
  assert.equal(await q('.tree-select[data-object-id="e"]').count(), 1);
  await page.evaluate(() => {
    window.test.conflicts = {
      e: [
        {
          target: "sensor.collision",
          reason: "duplicate_target",
          related: ["e2"],
        },
      ],
      e2: [
        {
          target: "sensor.collision",
          reason: "duplicate_target",
          related: ["e"],
        },
      ],
    };
  });
  await q("#part").fill("test");
  await q("#conflict-filter").filter({ hasText: "(2)" }).waitFor();
  await q("#conflict-filter").click();
  assert.equal(await q('.tree-select[data-kind-id="entities"]').count(), 2);
  assert.match(await q("#conflict-detail").textContent(), /sensor.collision/);
  assert.equal(await q('.tree-select[data-object-id="no_area"]').count(), 0);
  await q("#filter-all").click();
  assert.equal(await q('.tree-select[data-object-id="no_area"]').count(), 1);
  await q("#confirm").click();
  await q("#editor-dialog").waitFor({ state: "hidden" });
  const saves = await page.evaluate(() =>
    window.test.calls.filter((call) => call.type.endsWith("/save")),
  );
  assert.equal(saves.length, 1);
  assert.equal(saves[0].changes.entities.e, "test");
  assert.equal(saves[0].changes.devices.d, "guard");
  assert.equal(saves[0].changes.areas.b, "bathroom");
  await q("#open").click();
  await select("entities", "e");
  await q("#part").fill("discard");
  await q("#cancel").click();
  await q("#open").click();
  await select("entities", "e");
  assert.equal(await q("#part").inputValue(), "test");
  if (process.env.EDITOR_SCREENSHOT)
    await page.screenshot({
      path: process.env.EDITOR_SCREENSHOT.replace(".png", "-desktop.png"),
    });
  await page.setViewportSize({ width: 390, height: 720 });
  const bounds = await layout();
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 390 &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= 720,
  );
  assert.ok(await q("#confirm").isVisible());
  assert.ok(await q("#object-list").evaluate((node) => node.clientHeight > 80));
  if (process.env.EDITOR_SCREENSHOT)
    await page.screenshot({ path: process.env.EDITOR_SCREENSHOT });
  await q("#cancel").click();
  await q("#preview-open").click();
  await q('#preview-rows input[value="valid"]').check();
  await q("#preview-apply").click();
  await q("#preview-dialog").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "Unified tree: navigation, hierarchy, search, conflicts, bulk undo, batch save, cancellation, fixed layout and mobile bounds passed",
  );
} finally {
  await browser.close();
}
