"""Admin-only atomic editing of naming overrides."""

import hashlib
import json
from copy import deepcopy

import probatio as vol
from homeassistant.components import websocket_api
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN
from .naming import validate_part

KEYS = ("areas", "devices", "entities")


class EditError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def mappings(entry):
    return {key: dict(entry.options.get(key, {})) for key in KEYS}


def revision(entry):
    return hashlib.sha256(json.dumps(mappings(entry), sort_keys=True).encode()).hexdigest()


def objects(hass):
    return {
        "areas": [{"id": o.id, "name": o.name} for o in ar.async_get(hass).areas.values()],
        "devices": [
            {"id": o.id, "name": o.name_by_user or o.name or o.id}
            for o in dr.async_get(hass).devices.values()
        ],
        "entities": [
            {"id": o.id, "name": o.entity_id}
            for o in er.async_get(hass).entities.values()
            if o.platform != DOMAIN
        ],
    }


def snapshot(hass, entry):
    return {"revision": revision(entry), "mappings": mappings(entry), "objects": objects(hass)}


async def save(hass, manager, expected_revision, changes):
    async with manager.lock:
        entry = manager.entry
        if revision(entry) != expected_revision:
            raise EditError("stale_editor", "Saved mappings changed. Reopen the editor.")
        if not isinstance(changes, dict) or any(key not in KEYS for key in changes):
            raise EditError("invalid_changes", "Invalid mapping section")
        available = {key: {obj["id"] for obj in rows} for key, rows in objects(hass).items()}
        options = deepcopy(dict(entry.options))
        for key, values in changes.items():
            if not isinstance(values, dict):
                raise EditError("invalid_changes", "Mappings must be dictionaries")
            section = options.setdefault(key, {})
            for object_id, value in values.items():
                if not isinstance(value, str):
                    raise EditError("invalid_part", "ID part must be a string")
                try:
                    part = validate_part(value)
                except ValueError as err:
                    raise EditError("invalid_part", str(err)) from err
                if object_id not in available[key] and part:
                    raise EditError("missing_object", "Object no longer exists")
                if part:
                    section[object_id] = part
                else:
                    section.pop(object_id, None)
        # All values were validated before this single configuration write.
        hass.config_entries.async_update_entry(entry, options=options)
        return snapshot(hass, entry)


def get_manager(hass):
    managers = hass.data.get(DOMAIN, {})
    if not managers:
        raise EditError("not_loaded", "Entity ID Manager is not loaded")
    return next(iter(managers.values()))


@websocket_api.websocket_command({"type": f"{DOMAIN}/editor/get"})
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_get(hass, connection, msg):
    try:
        manager = get_manager(hass)
        connection.send_result(msg["id"], snapshot(hass, manager.entry))
    except EditError as err:
        connection.send_error(msg["id"], err.code, str(err))


@websocket_api.websocket_command(
    {"type": f"{DOMAIN}/editor/save", vol.Required("revision"): str, vol.Required("changes"): dict}
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_save(hass, connection, msg):
    try:
        result = await save(hass, get_manager(hass), msg["revision"], msg["changes"])
        connection.send_result(msg["id"], result)
    except EditError as err:
        connection.send_error(msg["id"], err.code, str(err))


def register(hass):
    if hass.data.get(f"{DOMAIN}_ws"):
        return
    websocket_api.async_register_command(hass, websocket_get)
    websocket_api.async_register_command(hass, websocket_save)
    hass.data[f"{DOMAIN}_ws"] = True
