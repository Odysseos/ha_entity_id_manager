"""Manage entity IDs independently of display names."""

from homeassistant.const import Platform
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send

from . import editor, frontend
from .const import DOMAIN
from .manager import Manager

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PLATFORMS = [Platform.TEXT]


async def _options_updated(hass, entry):
    async_dispatcher_send(hass, f"{DOMAIN}_{entry.entry_id}_updated")


async def async_setup_entry(hass, entry):
    manager = Manager(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = manager
    manager.start()
    try:
        editor.register(hass)
        await frontend.async_register(hass)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except Exception:
        manager.stop()
        hass.data[DOMAIN].pop(entry.entry_id, None)
        frontend.unregister(hass)
        raise
    entry.async_on_unload(entry.add_update_listener(_options_updated))
    return True


async def async_unload_entry(hass, entry):
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    hass.data[DOMAIN].pop(entry.entry_id).stop()
    frontend.unregister(hass)
    return True
