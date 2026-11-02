"""Create a standard Home Assistant backup before a manual rename."""

from homeassistant.components.backup import async_get_manager
from homeassistant.components.backup.models import Folder
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util


async def create_backup(hass):
    """Wait for a full local backup; never fall back to renaming without it."""
    manager = async_get_manager(hass)
    supervised = "hassio" in hass.config.components
    agent = "hassio.local" if supervised else "backup.local"
    if agent not in manager.backup_agents:
        raise HomeAssistantError("Local Home Assistant backup storage is unavailable")
    name = f"Entity ID Manager — before rename — {dt_util.now().isoformat(timespec='seconds')}"
    await manager.async_create_backup(
        agent_ids=[agent],
        name=name,
        password=manager.config.data.create_backup.password,
        include_homeassistant=True,
        include_database=True,
        include_all_addons=supervised,
        include_addons=None,
        include_folders=list(Folder) if supervised else None,
        extra_metadata={"entity_id_manager.before_rename": True},
    )
    return name
