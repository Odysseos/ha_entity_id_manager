"""Back up all HA settings and fail closed before registry/reference writes."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.entity_id_manager.backup import create_backup
from custom_components.entity_id_manager.manager import Manager
from custom_components.entity_id_manager.naming import Rename


@pytest.mark.asyncio
@pytest.mark.parametrize("supervised", [False, True])
async def test_standard_backup_includes_all_settings(supervised):
    agent = "hassio.local" if supervised else "backup.local"
    backup = SimpleNamespace(
        backup_agents={agent: object()},
        config=SimpleNamespace(
            data=SimpleNamespace(create_backup=SimpleNamespace(password="secret"))
        ),
        async_create_backup=AsyncMock(),
    )
    hass = SimpleNamespace(config=SimpleNamespace(components={"hassio"} if supervised else set()))
    with patch("custom_components.entity_id_manager.backup.async_get_manager", return_value=backup):
        name = await create_backup(hass)
    args = backup.async_create_backup.call_args.kwargs
    assert args["agent_ids"] == [agent]
    assert args["include_homeassistant"] and args["include_database"]
    assert args["include_all_addons"] is supervised
    assert bool(args["include_folders"]) is supervised
    assert args["password"] == "secret"
    assert name.startswith("Entity ID Manager — before rename")


@pytest.mark.asyncio
async def test_missing_local_backup_never_falls_back():
    hass = SimpleNamespace(config=SimpleNamespace(components=set()))
    backup = SimpleNamespace(backup_agents={})
    with patch("custom_components.entity_id_manager.backup.async_get_manager", return_value=backup):
        with pytest.raises(HomeAssistantError, match="unavailable"):
            await create_backup(hass)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [False, True])
async def test_backup_finishes_before_mutations(failure):
    events = []
    row = Rename("entity", "sensor.old", "sensor.new")
    manager = Manager(Mock(), Mock())
    manager.snapshot = Mock(return_value=[row])
    registry = Mock()
    registry.async_update_entity.side_effect = lambda *a, **k: events.append("rename")

    async def backup(hass):
        events.append("backup")
        if failure:
            raise HomeAssistantError("disk full")
        return "restore point"

    async def stage():
        events.append("stage")

    refs = SimpleNamespace(
        stage_files=stage, apply=AsyncMock(return_value={}), rollback=AsyncMock()
    )
    with (
        patch("custom_components.entity_id_manager.backup.create_backup", side_effect=backup),
        patch("custom_components.entity_id_manager.manager.er.async_get", return_value=registry),
        patch("custom_components.entity_id_manager.manager.ReferenceUpdate") as update,
    ):
        update.return_value.prepare = AsyncMock(return_value=refs)
        if failure:
            with pytest.raises(HomeAssistantError, match="no renames were applied"):
                await manager.apply([row], backup=True)
            update.assert_not_called()
            registry.async_update_entity.assert_not_called()
            assert events == ["backup"]
        else:
            report = await manager.apply([row], backup=True)
            assert events == ["backup", "stage", "rename"]
            assert report["homeassistant_backup"] == "restore point"


@pytest.mark.asyncio
async def test_preview_revalidated_after_backup():
    row = Rename("entity", "sensor.old", "sensor.new")
    manager = Manager(Mock(), Mock())
    manager.snapshot = Mock(side_effect=[[row], []])
    with (
        patch("custom_components.entity_id_manager.backup.create_backup", new=AsyncMock()),
        patch("custom_components.entity_id_manager.manager.er.async_get") as registry,
        patch("custom_components.entity_id_manager.manager.ReferenceUpdate") as update,
    ):
        with pytest.raises(HomeAssistantError, match="changed during backup"):
            await manager.apply([row], backup=True)
        update.assert_not_called()
        registry.return_value.async_update_entity.assert_not_called()
