"""Registry-based previews and serialized, stale-checked rename operations."""

import asyncio
import logging
from collections import Counter

from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import slugify

from .const import DOMAIN
from .naming import Rename, target_id
from .references import ReferenceUpdate


class Manager:
    def __init__(self, hass, entry):
        self.hass = hass
        self.entry = entry
        self.lock = asyncio.Lock()
        self.unsub = None

    def snapshot(self, options=None, *, persist=True):
        registry = er.async_get(self.hass)
        devices = dr.async_get(self.hass)
        options = self.entry.options if options is None else options
        areas = options.get("areas", {})
        overrides = options.get("devices", {})
        suffixes = options.get("entities", {})
        rows = []
        fallbacks = dict(self.entry.data.get("fallback_suffixes", {}))
        original_fallbacks = dict(fallbacks)
        for entity in registry.entities.values():
            if entity.platform == DOMAIN:
                continue
            device = devices.async_get(entity.device_id) if entity.device_id else None
            area_id = er.async_get_effective_area_id(self.hass, entity)
            area = areas.get(area_id, "")
            prefix = overrides.get(entity.device_id, "")
            suffix = suffixes.get(entity.id, "")
            if not (area or prefix or suffix):
                continue
            if not area and area_id:
                if zone := ar.async_get(self.hass).async_get_area(area_id):
                    area = slugify(zone.name)
            # A supplied suffix is exact. Otherwise use the integration's original
            # entity name; this does not depend on the current, possibly renamed ID.
            if not suffix:
                if entity.original_name:
                    suffix = slugify(entity.original_name_unprefixed or entity.original_name)
                elif entity.has_entity_name:
                    suffix = "state"
                else:
                    suffix = fallbacks.setdefault(entity.id, entity.entity_id.split(".", 1)[1])
            if not prefix and device:
                prefix = slugify(device.name_by_user or device.name or "device")
            try:
                new = target_id(entity.domain, area, prefix, suffix)
            except ValueError as err:
                rows.append(Rename(entity.id, entity.entity_id, entity.entity_id, str(err)))
                continue
            if new != entity.entity_id:
                rows.append(Rename(entity.id, entity.entity_id, new))
        if persist and fallbacks != original_fallbacks:
            self.hass.config_entries.async_update_entry(
                self.entry, data={**self.entry.data, "fallback_suffixes": fallbacks}
            )
        counts = Counter(row.new for row in rows)
        existing = set(registry.entities) | set(self.hass.states.async_entity_ids())
        return sorted(
            [
                Rename(
                    row.registry_id,
                    row.old,
                    row.new,
                    row.conflict
                    or (
                        "duplicate_target"
                        if counts[row.new] > 1
                        else "occupied"
                        if row.new in existing and row.new != row.old
                        else ""
                    ),
                )
                for row in rows
            ],
            key=lambda row: row.old,
        )

    async def apply(self, selected):
        async with self.lock:
            current = {row.registry_id: row for row in self.snapshot()}
            registry = er.async_get(self.hass)
            # Validate the entire selection before the first mutation.
            for row in selected:
                if current.get(row.registry_id) != row or row.conflict:
                    raise HomeAssistantError(
                        "Preview is stale or contains conflicts. Open a new preview."
                    )
            references = await ReferenceUpdate(
                self.hass, {row.old: row.new for row in selected}
            ).prepare()
            applied = []
            try:
                await references.stage_files()
                current = {row.registry_id: row for row in self.snapshot()}
                if any(current.get(row.registry_id) != row or row.conflict for row in selected):
                    raise HomeAssistantError(
                        "Registry or mappings changed during reference preparation"
                    )
                for row in selected:
                    registry.async_update_entity(row.old, new_entity_id=row.new)
                    applied.append(row)
                return await references.apply()
            except (Exception, asyncio.CancelledError) as err:
                rollback_errors = []
                for row in reversed(applied):
                    try:
                        registry.async_update_entity(row.new, new_entity_id=row.old)
                    except Exception:
                        rollback_errors.append(row.new)
                try:
                    rollback_errors.extend(await references.rollback())
                except Exception as rollback_error:
                    rollback_errors.append(f"reference rollback: {rollback_error}")
                if isinstance(err, asyncio.CancelledError):
                    raise
                raise HomeAssistantError(
                    f"Rename/reference update failed: {err}. Rollback attempted. "
                    f"Unrestored items: {', '.join(rollback_errors) or 'none'}. "
                    f"Backup: {references.backup or 'not created'}"
                ) from err

    def start(self):
        self.unsub = self.hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, self._event)

    def stop(self):
        if self.unsub:
            self.unsub()
            self.unsub = None

    @callback
    def _event(self, event):
        if event.data.get("action") != "create" or not self.entry.options.get("auto_new", False):
            return
        entity_id = event.data["entity_id"]
        self.hass.async_create_task(self._auto(entity_id))

    async def _auto(self, entity_id):
        # Allow initial platform setup to publish the entity before renaming it.
        await asyncio.sleep(1)
        if not self.entry.options.get("auto_new", False) or self.unsub is None:
            return
        rows = [r for r in self.snapshot() if r.old == entity_id and not r.conflict]
        if rows:
            try:
                await self.apply(rows)
            except HomeAssistantError:
                logging.getLogger(__name__).exception("Automatic rename failed for %s", entity_id)
