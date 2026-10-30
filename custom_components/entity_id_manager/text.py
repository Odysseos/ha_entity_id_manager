"""Editable saved ID segments, exposed under the integration."""

from copy import deepcopy

from homeassistant.components.text import TextEntity
from homeassistant.core import callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN
from .naming import validate_segment

KINDS = {"areas": "area", "devices": "device", "entities": "entity"}


async def async_setup_entry(hass, entry, async_add_entities):
    added = set()

    @callback
    def sync():
        new = []
        for key in KINDS:
            for object_id in entry.options.get(key, {}):
                token = (key, object_id)
                if token not in added:
                    added.add(token)
                    new.append(IDSegment(entry, key, object_id))
        if new:
            async_add_entities(new)

    entry.async_on_unload(
        async_dispatcher_connect(hass, f"{DOMAIN}_{entry.entry_id}_updated", sync)
    )
    sync()


class IDSegment(TextEntity):
    _attr_should_poll = False
    _attr_native_min = 0
    _attr_native_max = 200
    _attr_pattern = r"(?:[a-z][a-z0-9_]*)?"
    _attr_icon = "mdi:identifier"

    def __init__(self, entry, key, object_id):
        self.entry = entry
        self.key = key
        if key == "entities":
            self._attr_pattern = r"(?:[a-z][a-z0-9_]*|-)?"
        self.object_id = object_id
        self._attr_unique_id = f"{entry.entry_id}_{key}_{object_id}"
        self._attr_translation_key = KINDS[key]
        self._attr_has_entity_name = True

    def object_name(self):
        if self.key == "areas":
            obj = ar.async_get(self.hass).async_get_area(self.object_id)
            return obj.name if obj else self.object_id
        if self.key == "devices":
            obj = dr.async_get(self.hass).async_get(self.object_id)
            return (obj.name_by_user or obj.name or self.object_id) if obj else self.object_id
        obj = er.async_get(self.hass).async_get(self.object_id)
        return obj.entity_id if obj else self.object_id

    @property
    def translation_placeholders(self):
        return {"object": self.object_name()}

    @property
    def native_value(self):
        return self.entry.options.get(self.key, {}).get(self.object_id, "")

    @property
    def extra_state_attributes(self):
        return {
            "object_type": KINDS[self.key],
            "object_id": self.object_id,
            "object_name": self.object_name(),
        }

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, f"{DOMAIN}_{self.entry.entry_id}_updated", self.async_write_ha_state
            )
        )

    async def async_set_value(self, value):
        segment = "-" if self.key == "entities" and value == "-" else validate_segment(value)
        options = deepcopy(dict(self.entry.options))
        values = options.setdefault(self.key, {})
        if segment:
            values[self.object_id] = segment
        else:
            values.pop(self.object_id, None)
        self.hass.config_entries.async_update_entry(self.entry, options=options)
        self.async_write_ha_state()
