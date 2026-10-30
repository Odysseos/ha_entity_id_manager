"""Exercise actual HA registries and flow schemas without physical devices."""

from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from custom_components.entity_id_manager.config_flow import OptionsFlow
from custom_components.entity_id_manager.manager import Manager
from custom_components.entity_id_manager.naming import target_id, validate_part


@pytest.fixture
def ctx(tmp_path):
    async def create():
        hass = HomeAssistant(str(tmp_path))
        await ar.async_get(hass).async_load()
        # Registers a real config entry so device-registry ownership is valid.
        from homeassistant.config_entries import ConfigEntries

        hass.config_entries = ConfigEntries(hass, {})
        await hass.config_entries.async_initialize()
        dr.async_setup(hass)
        await dr.async_load(hass, load_empty=True)
        await er.async_load(hass, load_empty=True)
        entry = ConfigEntry(
            version=1,
            minor_version=1,
            domain="entity_id_manager",
            title="Manager",
            data={},
            options={},
            source="user",
            unique_id="entity_id_manager",
            discovery_keys={},
            subentries_data=[],
        )
        hass.config_entries._entries[entry.entry_id] = entry
        area = ar.async_get(hass).async_create("Ванная")
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={("entity_id_manager", "neptun")},
            name="Нептун",
        )
        dr.async_get(hass).async_update_device(device.id, area_id=area.id)
        entity = er.async_get(hass).async_get_or_create(
            "binary_sensor",
            "demo",
            "leak",
            device_id=device.id,
            original_name="Water leak",
            has_entity_name=True,
        )
        options = {
            "areas": {area.id: "bathroom"},
            "devices": {device.id: "neptun"},
            "entities": {entity.id: "water_leak"},
        }
        hass.config_entries.async_update_entry(entry, options=options)
        await hass.async_block_till_done()
        return hass, entry, area, device, entity

    return create


@pytest.mark.asyncio
async def test_rename_and_stable_overrides(ctx):
    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    plan = manager.snapshot()
    assert len(plan) == 1
    assert plan[0].new == "binary_sensor.bathroom_neptun_water_leak"
    await manager.apply(plan)
    registry = er.async_get(hass)
    renamed = registry.async_get(plan[0].new)
    assert renamed.id == entity.id and renamed.unique_id == entity.unique_id
    assert renamed.original_name == entity.original_name
    assert dr.async_get(hass).async_get(device.id).name == "Нептун"
    assert ar.async_get(hass).async_get_area(area.id).name == "Ванная"
    assert manager.snapshot() == []
    await hass.async_stop()


@pytest.mark.asyncio
async def test_conflicts_and_stale_preview(ctx):
    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    plan = manager.snapshot()
    hass.states.async_set(plan[0].new, "on")
    assert manager.snapshot()[0].conflict == "occupied"
    with pytest.raises(HomeAssistantError):
        await manager.apply(plan)
    assert er.async_get(hass).async_get(entity.entity_id)
    hass.states.async_remove(plan[0].new)
    options = dict(entry.options)
    options["devices"] = {device.id: "another"}
    hass.config_entries.async_update_entry(entry, options=options)
    with pytest.raises(HomeAssistantError):
        await manager.apply(plan)
    await hass.async_stop()


@pytest.mark.asyncio
async def test_duplicate_targets_and_rollback(ctx):
    hass, entry, area, device, entity = await ctx()
    registry = er.async_get(hass)
    other = registry.async_get_or_create(
        "binary_sensor",
        "demo",
        "other",
        device_id=device.id,
        original_name="Other",
        has_entity_name=True,
    )
    options = dict(entry.options)
    options["entities"] = {entity.id: "water_leak", other.id: "water_leak"}
    hass.config_entries.async_update_entry(entry, options=options)
    manager = Manager(hass, entry)
    assert all(row.conflict == "duplicate_target" for row in manager.snapshot())
    options["entities"] = {entity.id: "water_leak", other.id: "other"}
    hass.config_entries.async_update_entry(entry, options=options)
    plan = manager.snapshot()
    original_update = registry.async_update_entity
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ValueError("simulated failure")
        return original_update(*args, **kwargs)

    with patch.object(registry, "async_update_entity", side_effect=fail_second):
        with pytest.raises(HomeAssistantError):
            await manager.apply(plan)
    assert registry.async_get(entity.entity_id) and registry.async_get(other.entity_id)
    assert not any(registry.async_get(row.new) for row in plan)
    await hass.async_stop()


@pytest.mark.asyncio
async def test_unmanaged_and_entity_area_override(ctx):
    hass, entry, area, device, entity = await ctx()
    registry = er.async_get(hass)
    untouched = registry.async_get_or_create(
        "sensor", "demo", "unmanaged", original_name="Unmanaged"
    )
    other_area = ar.async_get(hass).async_create("Кухня")
    registry.async_update_entity(entity.entity_id, area_id=other_area.id)
    options = dict(entry.options)
    options["areas"] = {area.id: "bathroom", other_area.id: "kitchen"}
    hass.config_entries.async_update_entry(entry, options=options)
    manager = Manager(hass, entry)
    assert manager.snapshot()[0].new == "binary_sensor.kitchen_neptun_water_leak"
    assert all(row.old != untouched.entity_id for row in manager.snapshot())
    await hass.async_stop()


@pytest.mark.asyncio
async def test_options_forms_and_apply(ctx):
    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    hass.data["entity_id_manager"] = {entry.entry_id: manager}
    flow = OptionsFlow()
    flow.hass = hass
    flow.handler = entry.entry_id
    menu = await flow.async_step_init()
    assert "preview" in menu["menu_options"]
    form = await flow.async_step_entity()
    form["data_schema"]({"object_id": entity.id})
    value = await flow.async_step_entity({"object_id": entity.id})
    assert value["description_placeholders"]["object"] == entity.entity_id
    invalid = await flow.async_step_value({"part": "Неверно"})
    assert invalid["errors"]["part"] == "invalid_part"
    preview = await flow.async_step_preview()
    assert preview["type"] == "form"
    empty = await flow.async_step_preview({"selected": []})
    assert empty["errors"]["base"] == "nothing_selected"
    result = await flow.async_step_preview({"selected": [entity.id]})
    assert result["type"] == "create_entry"
    assert manager.snapshot() == []
    # The stable registry ID can still be looked up after the entity_id changed.
    value = await flow.async_step_entity({"object_id": entity.id})
    assert value["description_placeholders"]["object"] == "binary_sensor.bathroom_neptun_water_leak"
    await hass.async_stop()


@pytest.mark.asyncio
async def test_auto_only_new(ctx):
    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    manager.start()
    options = dict(entry.options)
    options["auto_new"] = True
    hass.config_entries.async_update_entry(entry, options=options)
    er.async_get(hass).async_get_or_create(
        "sensor", "demo", "new", device_id=device.id, original_name="Battery", has_entity_name=True
    )
    await hass.async_block_till_done()
    assert er.async_get(hass).async_get("sensor.bathroom_neptun_battery")
    assert er.async_get(hass).async_get(entity.entity_id)
    manager.stop()
    later = er.async_get(hass).async_get_or_create(
        "sensor", "demo", "later", device_id=device.id, original_name="Signal", has_entity_name=True
    )
    await hass.async_block_till_done()
    assert er.async_get(hass).async_get(later.entity_id)
    await hass.async_stop()


def test_validation():
    assert target_id("sensor", "bathroom", "neptun", "battery") == "sensor.bathroom_neptun_battery"
    for bad in ["Ванная", "a.b", "a-b", "123", "Upper", "a/b"]:
        with pytest.raises(ValueError):
            validate_part(bad)


@pytest.mark.asyncio
async def test_saved_parts_and_removal(ctx):
    hass, entry, area, device, entity = await ctx()
    flow = OptionsFlow()
    flow.hass = hass
    flow.handler = entry.entry_id
    await flow.async_step_area({"object_id": area.id})
    saved = await flow.async_step_value({"part": "washroom"})
    assert saved["data"]["areas"][area.id] == "washroom"
    # Saving settings alone never renames an entity.
    assert er.async_get(hass).async_get(entity.entity_id)
    hass.config_entries.async_update_entry(entry, options=saved["data"])
    assert Manager(hass, entry).snapshot()[0].new == "binary_sensor.washroom_neptun_water_leak"
    await flow.async_step_area({"object_id": area.id})
    removed = await flow.async_step_value({"part": ""})
    assert area.id not in removed["data"]["areas"]
    assert removed["data"]["devices"][device.id] == "neptun"
    await hass.async_stop()


@pytest.mark.asyncio
async def test_disabled_entities(ctx):
    hass, entry, area, device, entity = await ctx()
    registry = er.async_get(hass)
    registry.async_update_entity(entity.entity_id, disabled_by=er.RegistryEntryDisabler.USER)
    manager = Manager(hass, entry)
    plan = manager.snapshot()
    await manager.apply(plan)
    assert registry.async_get(plan[0].new).disabled_by == er.RegistryEntryDisabler.USER
    await hass.async_stop()


@pytest.mark.asyncio
async def test_legacy_suffix_is_stable(ctx):
    hass, entry, area, device, entity = await ctx()
    registry = er.async_get(hass)
    legacy = registry.async_get_or_create(
        "switch", "demo", "legacy", device_id=device.id, suggested_object_id="old_valve"
    )
    manager = Manager(hass, entry)
    plan = manager.snapshot()
    await manager.apply(plan)
    assert manager.snapshot() == []
    assert entry.data["fallback_suffixes"][legacy.id] == "old_valve"
    assert Manager(hass, entry).snapshot() == []
    await hass.async_stop()


@pytest.mark.asyncio
async def test_real_integration_setup_and_options(tmp_path, monkeypatch):
    import shutil
    from pathlib import Path

    from homeassistant import auth, bootstrap, config_entries, loader

    source = Path(__file__).parents[1] / "custom_components"
    shutil.copytree(
        source, tmp_path / "custom_components", ignore=shutil.ignore_patterns("__pycache__")
    )
    hass = HomeAssistant(str(tmp_path))
    hass.config.skip_pip = True
    loader.async_setup(hass)
    hass.config_entries = config_entries.ConfigEntries(hass, {})
    await bootstrap.async_load_base_functionality(hass)
    hass.auth = await auth.auth_manager_from_config(hass, [], [])
    from unittest.mock import AsyncMock

    from homeassistant.components import network

    monkeypatch.setattr(network, "async_get_source_ip", AsyncMock(return_value="127.0.0.1"))
    monkeypatch.setattr(network, "async_get_adapters", AsyncMock(return_value=[]))
    flow = await hass.config_entries.flow.async_init(
        "entity_id_manager", context={"source": "user"}
    )
    assert flow["type"] == "form", flow
    result = await hass.config_entries.flow.async_configure(flow["flow_id"], {})
    assert result["type"] == "create_entry", result
    await hass.async_block_till_done()
    entry = result["result"]
    assert entry.state.value == "loaded"
    from homeassistant.components.frontend import async_panel_exists

    assert async_panel_exists(hass, "entity-id-manager")
    assert "entity_id_manager/editor/get" in hass.data["websocket_api"]
    assert "entity_id_manager/editor/save" in hass.data["websocket_api"]
    duplicate = await hass.config_entries.flow.async_init(
        "entity_id_manager", context={"source": "user"}
    )
    assert duplicate["reason"] == "already_configured"
    options = await hass.config_entries.options.async_init(entry.entry_id)
    assert options["type"] == "menu"
    automatic = await hass.config_entries.options.async_configure(
        options["flow_id"], {"next_step_id": "automatic"}
    )
    assert automatic["type"] == "form"
    saved = await hass.config_entries.options.async_configure(
        options["flow_id"], {"auto_new": True}
    )
    assert saved["type"] == "create_entry"
    assert entry.options["auto_new"] is True
    area = ar.async_get(hass).async_create("Ванная")
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, "areas": {area.id: "bathroom"}}
    )
    await hass.async_block_till_done()
    texts = [
        e
        for e in er.async_get(hass).entities.values()
        if e.platform == "entity_id_manager" and e.domain == "text"
    ]
    assert len(texts) == 1
    text_id = texts[0].entity_id
    assert hass.states.get(text_id).state == "bathroom"
    await hass.services.async_call(
        "text", "set_value", {"entity_id": text_id, "value": "washroom"}, blocking=True
    )
    await hass.async_block_till_done()
    assert entry.options["areas"][area.id] == "washroom"
    assert hass.states.get(text_id).state == "washroom"
    assert hass.data["entity_id_manager"][entry.entry_id].snapshot() == []
    select_flow = OptionsFlow()
    select_flow.hass = hass
    select_flow.handler = entry.entry_id
    selection = await select_flow.async_step_area()
    control = next(iter(selection["data_schema"].schema.values()))
    assert control.config["options"][0]["label"] == "Ванная (washroom)"
    await hass.services.async_call(
        "text", "set_value", {"entity_id": text_id, "value": ""}, blocking=True
    )
    await hass.async_block_till_done()
    assert area.id not in entry.options["areas"]
    assert hass.states.get(text_id).state == ""
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert not async_panel_exists(hass, "entity-id-manager")
    await hass.async_stop()


@pytest.mark.asyncio
async def test_selectors_show_saved_parts(ctx):
    hass, entry, area, device, entity = await ctx()
    flow = OptionsFlow()
    flow.hass = hass
    flow.handler = entry.entry_id
    for method, value, label in [
        (flow.async_step_area, area.id, "Ванная (bathroom)"),
        (flow.async_step_device, device.id, "Нептун (neptun)"),
        (flow.async_step_entity, entity.id, f"{entity.entity_id} (water_leak)"),
    ]:
        form = await method()
        control = next(iter(form["data_schema"].schema.values()))
        assert {"value": value, "label": label} in control.config["options"]
    await hass.async_stop()


@pytest.mark.asyncio
async def test_editor_atomic_save_and_stale_guard(ctx):
    from custom_components.entity_id_manager.editor import EditError, revision, save, snapshot

    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    before = snapshot(hass, entry)
    assert before["mappings"]["areas"][area.id] == "bathroom"
    update = hass.config_entries.async_update_entry
    with patch.object(hass.config_entries, "async_update_entry", wraps=update) as write:
        result = await save(
            hass,
            manager,
            before["revision"],
            {
                "areas": {area.id: "washroom"},
                "devices": {device.id: "water_guard"},
                "entities": {entity.id: "leak"},
            },
        )
        assert write.call_count == 1
    assert entry.options["areas"][area.id] == "washroom"
    assert entry.options["devices"][device.id] == "water_guard"
    assert result["revision"] != before["revision"]
    assert er.async_get(hass).async_get(entity.entity_id)
    with pytest.raises(EditError, match="changed"):
        await save(hass, manager, before["revision"], {"areas": {area.id: "old"}})
    assert entry.options["areas"][area.id] == "washroom"
    await save(hass, manager, revision(entry), {"entities": {entity.id: ""}})
    assert entity.id not in entry.options["entities"]
    await hass.async_stop()


@pytest.mark.asyncio
async def test_editor_invalid_batch_is_not_saved(ctx):
    from custom_components.entity_id_manager.editor import EditError, revision, save

    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    before = dict(entry.options)
    for changes in [
        {"areas": {area.id: "new"}, "devices": {device.id: "INVALID"}},
        {"areas": {"deleted": "new"}},
        {"unknown": {}},
        {"areas": []},
        {"entities": {entity.id: 42}},
    ]:
        with pytest.raises(EditError):
            await save(hass, manager, revision(entry), changes)
        assert dict(entry.options) == before
    await hass.async_stop()


@pytest.mark.asyncio
async def test_editor_admin_only(ctx):
    from types import SimpleNamespace

    from homeassistant.exceptions import Unauthorized

    from custom_components.entity_id_manager.editor import (
        websocket_apply,
        websocket_automatic,
        websocket_check,
        websocket_get,
        websocket_preview,
        websocket_save,
    )

    hass, entry, area, device, entity = await ctx()
    for handler in [
        websocket_get,
        websocket_save,
        websocket_preview,
        websocket_apply,
        websocket_automatic,
        websocket_check,
    ]:
        with pytest.raises(Unauthorized):
            handler(hass, SimpleNamespace(user=SimpleNamespace(is_admin=False)), {"id": 1})
    await hass.async_stop()


@pytest.mark.asyncio
async def test_panel_preview_apply_and_automatic(ctx):
    from custom_components.entity_id_manager.editor import apply_preview, set_automatic, snapshot

    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    before = dict(entry.options)
    await set_automatic(hass, manager, True)
    assert snapshot(hass, entry)["auto_new"] is True
    assert entry.options["entities"] == before["entities"]
    row = manager.snapshot()[0]
    request = [{"registry_id": row.registry_id, "old": row.old, "new": row.new}]
    with pytest.raises(HomeAssistantError):
        await apply_preview(manager, [{**request[0], "new": "binary_sensor.wrong"}])
    result = await apply_preview(manager, request)
    assert result["count"] == 1
    assert er.async_get(hass).async_get(row.new)
    assert manager.snapshot() == []
    await hass.async_stop()


@pytest.mark.asyncio
async def test_editor_object_context_and_icons(ctx):
    from custom_components.entity_id_manager.editor import objects

    hass, entry, area, device, entity = await ctx()
    ar.async_get(hass).async_update(area.id, icon="mdi:shower")
    kitchen = ar.async_get(hass).async_create("Кухня")
    other = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("demo", "other")}, name="Нептун"
    )
    dr.async_get(hass).async_update_device(other.id, area_id=kitchen.id)
    er.async_get(hass).async_update_entity(entity.entity_id, area_id=kitchen.id, icon="mdi:water")
    dr.async_get(hass).async_update_device(device.id, model="Model X", manufacturer="Vendor")
    data = objects(hass)
    assert next(o for o in data["areas"] if o["id"] == area.id)["icon"] == "mdi:shower"
    first = next(o for o in data["devices"] if o["id"] == device.id)
    second = next(o for o in data["devices"] if o["id"] == other.id)
    assert first["description"] == "Model X · Vendor · entity_id_manager"
    assert first["area_id"] == area.id
    assert first["name"] == second["name"] == "Нептун"
    assert first["area_name"] == "Ванная" and second["area_name"] == "Кухня"
    row = next(o for o in data["entities"] if o["id"] == entity.id)
    assert row["area_name"] == "Кухня"
    assert row["device_name"] == "Нептун"
    assert row["entity_id"] == entity.entity_id
    assert row["icon"] == "mdi:water"
    assert row["description"].endswith("demo")
    assert row["area_id"] == kitchen.id
    assert row["device_id"] == device.id
    await hass.async_stop()


@pytest.mark.asyncio
async def test_area_name_fallback(ctx):
    from homeassistant.util import slugify

    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    options = dict(entry.options)
    options["areas"] = {}
    hass.config_entries.async_update_entry(entry, options=options)
    assert manager.snapshot()[0].new == f"binary_sensor.{slugify(area.name)}_neptun_water_leak"
    kitchen = ar.async_get(hass).async_create("Кухня")
    er.async_get(hass).async_update_entity(entity.entity_id, area_id=kitchen.id)
    assert manager.snapshot()[0].new == f"binary_sensor.{slugify(kitchen.name)}_neptun_water_leak"
    er.async_get(hass).async_update_entity(entity.entity_id, area_id=None)
    dr.async_get(hass).async_update_device(device.id, area_id=None)
    assert manager.snapshot()[0].new == "binary_sensor.neptun_water_leak"
    hass.config_entries.async_update_entry(entry, options={})
    assert manager.snapshot() == []
    await hass.async_stop()


@pytest.mark.asyncio
async def test_draft_conflicts_do_not_save(ctx):
    from copy import deepcopy

    from custom_components.entity_id_manager.editor import draft_conflicts

    hass, entry, area, device, entity = await ctx()
    registry = er.async_get(hass)
    other = registry.async_get_or_create(
        "binary_sensor", "demo", "second", device_id=device.id, original_name="Other"
    )
    manager = Manager(hass, entry)
    before = deepcopy(dict(entry.options)), deepcopy(dict(entry.data))
    changes = {"entities": {entity.id: "test", other.id: "test"}}
    issues = draft_conflicts(hass, manager, changes)
    assert set(issues) == {entity.id, other.id}
    assert issues[entity.id][0]["target"] == "binary_sensor.bathroom_neptun_test"
    assert other.id in issues[entity.id][0]["related"]
    assert (dict(entry.options), dict(entry.data)) == before
    assert draft_conflicts(hass, manager, {"entities": {other.id: "different"}}) == {}
    registry.async_update_entity(
        other.entity_id, new_entity_id="binary_sensor.bathroom_neptun_test"
    )
    issues = draft_conflicts(hass, manager, {"entities": {entity.id: "test"}})
    assert set(issues) == {entity.id, other.id}
    await hass.async_stop()


@pytest.mark.asyncio
async def test_reference_transaction_yaml_dashboard_helpers_and_backup(ctx, monkeypatch):
    import json
    from pathlib import Path
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from homeassistant.components.lovelace.const import LOVELACE_DATA
    from homeassistant.components.lovelace.dashboard import LovelaceStorage
    from homeassistant.config_entries import ConfigSubentry

    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    row = manager.snapshot()[0]
    root = Path(hass.config.config_dir)
    (root / "configuration.yaml").write_text(
        "automation: !include automations.yaml\nscript: !include scripts.yaml\n"
    )
    automation = f"- id: example\n  alias: Example\n  triggers: []\n  actions:\n    - target:\n        entity_id: {row.old}\n"
    (root / "automations.yaml").write_text(automation)
    script = f"example:\n  sequence:\n    - variables:\n        value: \"{{{{ states('{row.old}') }}}}\"\n"
    (root / "scripts.yaml").write_text(script)
    dashboard = LovelaceStorage(hass, None)
    panel = {"views": [{"cards": [{"type": "entity", "entity": row.old}]}]}
    await dashboard.async_save(panel)
    hass.data[LOVELACE_DATA] = SimpleNamespace(dashboards={None: dashboard})
    helper = ConfigEntry(
        version=1,
        minor_version=1,
        domain="demo",
        title="Helper",
        data={"source_entity": row.old, "unique_id": row.old},
        options={"entity_id": row.old},
        source="user",
        unique_id="helper",
        discovery_keys={},
        subentries_data=[],
    )
    hass.config_entries._entries[helper.entry_id] = helper
    subentry = ConfigSubentry(
        data={"entity_id": row.old},
        subentry_id="sub",
        subentry_type="helper",
        title="Sub",
        unique_id="sub",
    )
    hass.config_entries.async_add_subentry(helper, subentry)
    check = AsyncMock(return_value=None)
    monkeypatch.setattr("homeassistant.config.async_check_ha_config_file", check)
    reloads = []

    async def reload_yaml(call):
        reloads.append(call)

    hass.services.async_register("homeassistant", "reload_all", reload_yaml)
    result = await manager.apply([row])
    assert row.new in (root / "automations.yaml").read_text()
    assert row.new in (root / "scripts.yaml").read_text()
    assert (await dashboard.async_load(False))["views"][0]["cards"][0]["entity"] == row.new
    assert helper.data["source_entity"] == row.new and helper.data["unique_id"] == row.old
    assert helper.options["entity_id"] == row.new
    assert helper.subentries["sub"].data["entity_id"] == row.new
    assert len(reloads) == 1
    assert check.await_count == 1
    backup = root / result["backup"]
    manifest = json.loads((backup / "manifest.json").read_text())
    assert manifest["state"] == "committed"
    assert (backup / "file-0").stat().st_mode & 0o777 == 0o600
    assert result["files"] == 2 and result["dashboards"] == 1 and result["entries"] == 1
    await hass.async_stop()


@pytest.mark.asyncio
async def test_reference_reload_failure_rolls_back_everything(ctx, monkeypatch):
    from pathlib import Path
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from homeassistant.components.lovelace.const import LOVELACE_DATA
    from homeassistant.components.lovelace.dashboard import LovelaceStorage

    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    row = manager.snapshot()[0]
    root = Path(hass.config.config_dir)
    original = f"homeassistant:\n  customize:\n    {row.old}:\n      icon: mdi:water\n"
    (root / "configuration.yaml").write_text(original)
    dashboard = LovelaceStorage(hass, None)
    panel = {"views": [{"cards": [{"entity": row.old}]}]}
    await dashboard.async_save(panel)
    hass.data[LOVELACE_DATA] = SimpleNamespace(dashboards={None: dashboard})
    monkeypatch.setattr(
        "homeassistant.config.async_check_ha_config_file", AsyncMock(return_value=None)
    )
    attempts = 0

    async def reload_yaml(call):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise HomeAssistantError("Reload failed")

    hass.services.async_register("homeassistant", "reload_all", reload_yaml)
    with pytest.raises(HomeAssistantError, match="Rollback"):
        await manager.apply([row])
    assert (root / "configuration.yaml").read_text() == original
    assert await dashboard.async_load(False) == panel
    assert er.async_get(hass).async_get(row.old)
    assert not er.async_get(hass).async_get(row.new)
    assert attempts == 2
    await hass.async_stop()


@pytest.mark.asyncio
async def test_invalid_reference_configuration_does_not_rename(ctx, monkeypatch):
    from pathlib import Path
    from unittest.mock import AsyncMock

    hass, entry, area, device, entity = await ctx()
    manager = Manager(hass, entry)
    row = manager.snapshot()[0]
    root = Path(hass.config.config_dir)
    original = f"group:\n  example:\n    entities: [{row.old}]\n"
    (root / "configuration.yaml").write_text(original)
    monkeypatch.setattr(
        "homeassistant.config.async_check_ha_config_file", AsyncMock(return_value="invalid config")
    )
    with pytest.raises(HomeAssistantError, match="invalid config"):
        await manager.apply([row])
    assert (root / "configuration.yaml").read_text() == original
    assert er.async_get(hass).async_get(row.old)
    await hass.async_stop()


@pytest.mark.asyncio
async def test_real_automation_and_script_reference_reload(ctx):
    from pathlib import Path

    from homeassistant import loader
    from homeassistant.config import async_hass_config_yaml
    from homeassistant.core import CoreState
    from homeassistant.helpers import condition, trigger
    from homeassistant.setup import async_setup_component

    hass, entry, area, device, entity = await ctx()
    hass.config.skip_pip = True
    loader.async_setup(hass)
    await condition.async_setup(hass)
    await trigger.async_setup(hass)
    hass.state = CoreState.running
    manager = Manager(hass, entry)
    row = manager.snapshot()[0]
    root = Path(hass.config.config_dir)
    source = f"""script:
  reference_script:
    sequence:
      - event: reference_script_ran
        event_data:
          value: "{{{{ states('{row.old}') }}}}"
automation:
  - id: reference_automation
    alias: Reference automation
    triggers:
      - trigger: state
        entity_id: {row.old}
        to: 'on'
    actions:
      - event: reference_automation_ran
"""
    (root / "configuration.yaml").write_text(source)
    config = await async_hass_config_yaml(hass)
    assert await async_setup_component(hass, "script", config)
    assert await async_setup_component(hass, "automation", config)

    async def reload_config(call):
        await hass.services.async_call("script", "reload", blocking=True)
        await hass.services.async_call("automation", "reload", blocking=True)

    hass.services.async_register("homeassistant", "reload_all", reload_config)
    script_events, automation_events = [], []
    hass.bus.async_listen("reference_script_ran", lambda event: script_events.append(event.data))
    hass.bus.async_listen(
        "reference_automation_ran", lambda event: automation_events.append(event.data)
    )
    await manager.apply([row])
    hass.states.async_set(row.new, "off")
    await hass.async_block_till_done()
    hass.states.async_set(row.new, "on")
    await hass.async_block_till_done()
    await hass.services.async_call("script", "reference_script", blocking=True)
    await hass.async_block_till_done()
    assert script_events[-1]["value"] == "on"
    assert automation_events
    assert row.old not in (root / "configuration.yaml").read_text()
    await hass.async_stop()


@pytest.mark.asyncio
async def test_runtime_area_person_energy_references_and_rollback(ctx):
    import logging

    from homeassistant.components.energy.data import async_get_manager
    from homeassistant.components.person import PersonStorageCollection
    from homeassistant.helpers import collection
    from homeassistant.helpers.storage import Store

    from custom_components.entity_id_manager.references import ReferenceUpdate

    hass, entry, area, device, entity = await ctx()
    old, new = "sensor.old_temperature", "sensor.new_temperature"
    hass.states.async_set(old, "21", {"device_class": "temperature"})
    ar.async_get(hass).async_update(area.id, temperature_entity_id=old)
    people = PersonStorageCollection(
        Store(hass, 1, "person"),
        collection.IDManager(),
        collection.YamlCollection(logging.getLogger(__name__)),
    )
    person = await people.async_create_item(
        {"name": "Example", "device_trackers": ["device_tracker.old"]}
    )
    hass.data["person"] = (None, people)
    hass.config.components.add("energy")
    energy = await async_get_manager(hass)
    await energy.async_update({"device_consumption": [{"stat_consumption": old}]})
    update = await ReferenceUpdate(
        hass, {old: new, "device_tracker.old": "device_tracker.new"}
    ).prepare()
    assert len(update.runtime) == 3
    await update.stage_files()
    # A real platform publishes the renamed state after the registry event.
    import asyncio

    applying = hass.async_create_task(update.apply())
    await asyncio.sleep(0)
    hass.states.async_set(new, "21", {"device_class": "temperature"})
    await applying
    assert ar.async_get(hass).async_get_area(area.id).temperature_entity_id == new
    assert people.data[person["id"]]["device_trackers"] == ["device_tracker.new"]
    assert energy.data["device_consumption"][0]["stat_consumption"] == new
    assert await update.rollback() == []
    assert ar.async_get(hass).async_get_area(area.id).temperature_entity_id == old
    assert people.data[person["id"]]["device_trackers"] == ["device_tracker.old"]
    assert energy.data["device_consumption"][0]["stat_consumption"] == old
    await hass.async_stop()
