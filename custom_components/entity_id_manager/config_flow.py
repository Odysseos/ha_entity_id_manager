"""Configure naming overrides and explicitly approve a preview."""

from copy import deepcopy

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import selector

from .const import DOMAIN
from .naming import validate_part


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Entity ID Manager", data={})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return OptionsFlow()


class OptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        return self.async_show_menu(step_id="init", menu_options=["editor", "preview", "automatic"])

    async def async_step_editor(self, user_input=None):
        if user_input is not None:
            return await self.async_step_init()
        return self.async_show_form(step_id="editor", data_schema=vol.Schema({}))

    async def _select(self, kind, user_input):
        if user_input is not None:
            self.kind = kind
            self.object_id = user_input["object_id"]
            return await self.async_step_value()
        key = {"area": "areas", "device": "devices", "entity": "entities"}[kind]
        configured = self.config_entry.options.get(key, {})
        if kind == "area":
            objects = [(obj.id, obj.name) for obj in ar.async_get(self.hass).areas.values()]
        elif kind == "device":
            objects = [
                (obj.id, obj.name_by_user or obj.name or obj.id)
                for obj in dr.async_get(self.hass).devices.values()
            ]
        else:
            objects = [
                (obj.id, obj.entity_id)
                for obj in er.async_get(self.hass).entities.values()
                if obj.platform != DOMAIN
            ]
        choices = [
            {
                "value": object_id,
                "label": f"{name} ({configured[object_id]})" if object_id in configured else name,
            }
            for object_id, name in sorted(
                objects, key=lambda item: (item[1].casefold(), item[0])
            )
        ]
        control = selector.SelectSelector(
            selector.SelectSelectorConfig(
                options=choices, mode=selector.SelectSelectorMode.DROPDOWN, custom_value=False
            )
        )
        return self.async_show_form(
            step_id=kind, data_schema=vol.Schema({vol.Required("object_id"): control})
        )

    async def async_step_area(self, user_input=None):
        return await self._select("area", user_input)

    async def async_step_device(self, user_input=None):
        return await self._select("device", user_input)

    async def async_step_entity(self, user_input=None):
        return await self._select("entity", user_input)

    async def async_step_value(self, user_input=None):
        key = {"area": "areas", "device": "devices", "entity": "entities"}[self.kind]
        options = deepcopy(dict(self.config_entry.options))
        values = options.setdefault(key, {})
        errors = {}
        if user_input is not None:
            try:
                part = validate_part(user_input.get("part", ""))
            except ValueError:
                errors["part"] = "invalid_part"
            else:
                if part:
                    values[self.object_id] = part
                else:
                    values.pop(self.object_id, None)
                return self.async_create_entry(title="", data=options)
        if self.kind == "area":
            obj = ar.async_get(self.hass).async_get_area(self.object_id)
            name = obj.name if obj else self.object_id
        elif self.kind == "device":
            obj = dr.async_get(self.hass).async_get(self.object_id)
            name = (obj.name_by_user or obj.name) if obj else self.object_id
        else:
            obj = er.async_get(self.hass).async_get(self.object_id)
            name = obj.entity_id if obj else self.object_id
        return self.async_show_form(
            step_id="value",
            errors=errors,
            description_placeholders={"object": str(name)},
            data_schema=vol.Schema(
                {vol.Optional("part", default=values.get(self.object_id, "")): str}
            ),
        )

    async def async_step_automatic(self, user_input=None):
        if user_input is not None:
            options = deepcopy(dict(self.config_entry.options))
            options["auto_new"] = user_input["auto_new"]
            return self.async_create_entry(title="", data=options)
        return self.async_show_form(
            step_id="automatic",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "auto_new", default=self.config_entry.options.get("auto_new", False)
                    ): bool
                }
            ),
        )

    async def async_step_preview(self, user_input=None):
        manager = self.hass.data[DOMAIN][self.config_entry.entry_id]
        if not hasattr(self, "rows"):
            self.rows = manager.snapshot()
        errors = {}
        if user_input is not None:
            selected = set(user_input.get("selected", []))
            rows = [row for row in self.rows if row.registry_id in selected]
            if not rows:
                errors["base"] = "nothing_selected"
            else:
                try:
                    await manager.apply(rows)
                except HomeAssistantError:
                    errors["base"] = "stale_preview"
                    self.rows = manager.snapshot()
                else:
                    return self.async_create_entry(title="", data=dict(self.config_entry.options))
        if not self.rows:
            return self.async_abort(reason="no_changes")
        conflicts = [f"{row.old} → {row.new} ({row.conflict})" for row in self.rows if row.conflict]
        choices = {
            row.registry_id: f"{row.old} → {row.new}" for row in self.rows if not row.conflict
        }
        return self.async_show_form(
            step_id="preview",
            errors=errors,
            description_placeholders={"conflicts": "\n".join(conflicts) or "—"},
            data_schema=vol.Schema(
                {vol.Optional("selected", default=[]): cv_multi_select(choices)}
            ),
        )


def cv_multi_select(choices):
    from homeassistant.helpers import config_validation as cv

    return cv.multi_select(choices)
