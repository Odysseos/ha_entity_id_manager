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
