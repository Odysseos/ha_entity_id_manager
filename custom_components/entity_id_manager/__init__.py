"""Manage entity IDs independently of display names."""

from homeassistant.helpers import config_validation as cv

from .const import DOMAIN
from .manager import Manager

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup_entry(hass, entry):
    manager = Manager(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = manager
    manager.start()
    return True


async def async_unload_entry(hass, entry):
    hass.data[DOMAIN].pop(entry.entry_id).stop()
    return True
