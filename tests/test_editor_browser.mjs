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
    const snapshot={revision:'r1',mappings:{areas:{a:'living_room'},devices:{d:'neptun'},entities:{}},objects:{areas:[{id:'a',name:'Гостиная'},{id:'b',name:'Ванная'}],devices:[{id:'d',name:'Нептун'}],entities:[{id:'e',name:'sensor.test'}]}};
    window.test={snapshot,calls:[],fail:false};
    document.querySelector('entity-id-manager-panel').hass={locale:{language:'ru'},callWS:async(msg)=>{
      if(msg.type.endsWith('/get'))return structuredClone(window.test.snapshot);
      window.test.calls.push(structuredClone(msg));
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
  await q("dialog").waitFor({ state: "visible" });
  await choose("a");
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
  assert.equal(await q("dialog").isVisible(), true);
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
  await q("dialog").waitFor({ state: "hidden" });
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
  await q("dialog").waitFor({ state: "hidden" });
  await q("#open").click();
  await choose("a");
  assert.equal(await q("#part").inputValue(), "lounge");
  await q("#cancel").click();
  assert.deepEqual(errors, []);
  console.log(
    "Browser editor: selection, draft labels, reset, clear, cancel, batch save, validation and stale guard passed",
  );
} finally {
  await browser.close();
}
