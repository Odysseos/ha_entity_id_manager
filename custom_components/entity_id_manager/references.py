"""Plan and transact entity reference updates without reformatting YAML."""

import asyncio
import inspect
import json
import os
import re
import stat
import tempfile
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import yaml
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from yaml.nodes import MappingNode, ScalarNode, SequenceNode

from .const import DOMAIN

# These values identify an object or a device protocol endpoint, not a HA reference.
IDENTITY_KEYS = {
    "id",
    "unique_id",
    "default_entity_id",
    "identifiers",
    "connections",
    "topic",
    "password",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "client_secret",
}


def protected(key):
    return isinstance(key, str) and (
        key in IDENTITY_KEYS or key.endswith(("_unique_id", "_topic", "_password", "_token"))
    )


class Replacer:
    def __init__(self, renames):
        self.renames = dict(renames)
        alternatives = "|".join(re.escape(old) for old in sorted(renames, key=len, reverse=True))
        # Allow dotted template access (states.sensor.example.state), but not
        # substrings of other entity IDs or wildcard selectors.
        self.pattern = re.compile(
            r"(?<![\w*?])(?:" + alternatives + r")(?![\w*?])" if alternatives else r"(?!)"
        )
        self.count = 0
        self.changed_offsets = []

    def text(self, value):
        def replace(match):
            self.count += 1
            return self.renames[match.group()]

        return self.pattern.sub(replace, value)

    def data(self, value):
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, list):
            return [self.data(item) for item in value]
        if isinstance(value, tuple):
            return tuple(self.data(item) for item in value)
        if isinstance(value, Mapping):
            result = {}
            for key, item in value.items():
                new_key = self.text(key) if isinstance(key, str) else key
                if new_key in result:
                    raise HomeAssistantError("Reference replacement would merge configuration keys")
                result[new_key] = deepcopy(item) if protected(key) else self.data(item)
            return result
        return value

    def yaml(self, text):
        """Edit scalar source spans, preserving comments, tags, anchors and spacing."""
        documents = list(yaml.compose_all(text, Loader=yaml.SafeLoader))
        blocked, visited = set(), set()

        def mark(node):
            if id(node) in blocked:
                return
            blocked.add(id(node))
            if isinstance(node, MappingNode):
                for key, value in node.value:
                    mark(key)
                    mark(value)
            elif isinstance(node, SequenceNode):
                for value in node.value:
                    mark(value)

        def protect(node):
            if node is None or id(node) in visited:
                return
            visited.add(id(node))
            if isinstance(node, MappingNode):
                for key, value in node.value:
                    if isinstance(key, ScalarNode) and protected(key.value):
                        mark(value)
                    protect(value)
            elif isinstance(node, SequenceNode):
                for value in node.value:
                    protect(value)

        for document in documents:
            protect(document)
        edits, visited = {}, set()

        def visit(node):
            if node is None or id(node) in visited:
                return
            visited.add(id(node))
            if isinstance(node, MappingNode):
                keys = {}
                for key, value in node.value:
                    if isinstance(key, ScalarNode):
                        target = self.pattern.sub(lambda m: self.renames[m.group()], key.value)
                        if target in keys and keys[target] != key.value:
                            raise HomeAssistantError("Reference replacement would merge YAML keys")
                        keys[target] = key.value
                    visit(key)
                    if not (isinstance(key, ScalarNode) and protected(key.value)):
                        visit(value)
            elif isinstance(node, SequenceNode):
                for value in node.value:
                    visit(value)
            elif isinstance(node, ScalarNode) and node.tag == "tag:yaml.org,2002:str":
                if not self.pattern.search(node.value):
                    return
                if id(node) in blocked:
                    raise HomeAssistantError(
                        "A YAML anchor shares an entity reference with a protected identifier"
                    )
                start, end = node.start_mark.index, node.end_mark.index
                raw = text[start:end]
                updated = self.text(raw)
                if updated == raw:
                    # Escaped double-quoted scalars may not contain the literal ID.
                    updated = json.dumps(self.text(node.value), ensure_ascii=False)
                edits[(start, end)] = updated

        for document in documents:
            visit(document)
        self.changed_offsets = list(edits)
        for (start, end), updated in sorted(edits.items(), reverse=True):
            text = text[:start] + updated + text[end:]
        list(yaml.compose_all(text, Loader=yaml.SafeLoader))
        return text


@dataclass
class FileChange:
    path: Path
    before: bytes
    after: bytes
    mode: int
    domains: tuple[str, ...] = ()


def atomic_write(path, content, mode=0o600):
    descriptor, name = tempfile.mkstemp(prefix=".entity-id-manager-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def collect_files(config_dir, extra, replacer):
    """Follow active include/blueprint graphs, plus loaded dashboard/template files."""
    base = Path(config_dir).resolve()
    pending = [(base / "configuration.yaml", None), *[(Path(path), "lovelace") for path in extra]]
    seen, changes = set(), []
    root_exists = (base / "configuration.yaml").is_file()

    def include(path, domain):
        path = path.resolve()
        if not path.is_relative_to(base):
            raise HomeAssistantError(f"Configuration include is outside the HA directory: {path}")
        pending.append((path, domain))

    while pending:
        path, domain = pending.pop()
        path = path.resolve()
        if not path.is_relative_to(base):
            raise HomeAssistantError(f"Configuration file is outside the HA directory: {path}")
        if path in seen:
            continue
        seen.add(path)
        if not path.is_file():
            continue
        before = path.read_bytes()
        text = before.decode("utf-8")
        if path.suffix in {".yaml", ".yml"}:
            documents = list(yaml.compose_all(text, Loader=yaml.SafeLoader))
            walked = set()

            def walk(node, context):
                if node is None or id(node) in walked:
                    return
                walked.add(id(node))
                if isinstance(node, ScalarNode) and node.tag.startswith("!include"):
                    target = path.parent / node.value
                    if node.tag == "!include":
                        include(target, context)
                    elif node.tag in {
                        "!include_dir_list",
                        "!include_dir_named",
                        "!include_dir_merge_list",
                        "!include_dir_merge_named",
                    }:
                        for item in sorted(target.rglob("*.yaml")):
                            if not any(
                                part.startswith(".") for part in item.relative_to(target).parts
                            ):
                                include(item, context)
                    return
                if isinstance(node, MappingNode):
                    for key, value in node.value:
                        name = key.value if isinstance(key, ScalarNode) else ""
                        if name == "use_blueprint" and isinstance(value, MappingNode):
                            for field, filename in value.value:
                                if field.value == "path" and isinstance(filename, ScalarNode):
                                    include(
                                        base
                                        / "blueprints"
                                        / (context or "template")
                                        / filename.value,
                                        context,
                                    )
                        if (
                            name == "filename"
                            and context == "lovelace"
                            and isinstance(value, ScalarNode)
                        ):
                            include(base / value.value, "lovelace")
                        walk(
                            value,
                            name
                            if context is None
                            or name in {"automation", "script", "template", "scene", "lovelace"}
                            else context,
                        )
                elif isinstance(node, SequenceNode):
                    for value in node.value:
                        walk(value, context)

            for document in documents:
                walk(document, domain)
            after = replacer.yaml(text).encode("utf-8")
            domains = {domain} if domain else set()
            if domain is None:
                for document in documents:
                    if isinstance(document, MappingNode):
                        for key, value in document.value:
                            if isinstance(key, ScalarNode) and any(
                                key.start_mark.index <= start < value.end_mark.index
                                for start, _ in replacer.changed_offsets
                            ):
                                domains.add(key.value.split(" ", 1)[0])
        else:
            after = replacer.text(text).encode("utf-8")
            domains = {"homeassistant"}
        if after != before:
            changes.append(
                FileChange(
                    path, before, after, stat.S_IMODE(path.stat().st_mode), tuple(sorted(domains))
                )
            )
    # A !secret can supply an entity ID; preserve the secret's key and identity.
    secrets = base / "secrets.yaml"
    if root_exists and secrets.is_file() and secrets.resolve() not in seen:
        before = secrets.read_bytes()
        document = yaml.compose(before.decode("utf-8"), Loader=yaml.SafeLoader)
        if isinstance(document, MappingNode):
            text = before.decode("utf-8")
            edits = []
            for _, value in document.value:
                if isinstance(value, ScalarNode) and value.value in replacer.renames:
                    edits.append(
                        (
                            value.start_mark.index,
                            value.end_mark.index,
                            json.dumps(replacer.text(value.value)),
                        )
                    )
            for start, end, value in sorted(edits, reverse=True):
                text = text[:start] + value + text[end:]
            after = text.encode("utf-8")
            if after != before:
                changes.append(
                    FileChange(secrets, before, after, stat.S_IMODE(secrets.stat().st_mode))
                )
    templates = base / "custom_templates"
    if templates.is_dir():
        for path in sorted(templates.rglob("*.jinja")):
            path = path.resolve()
            if not path.is_relative_to(base):
                raise HomeAssistantError("Custom template is outside the HA directory")
            before = path.read_bytes()
            after = replacer.text(before.decode("utf-8")).encode("utf-8")
            if before != after:
                changes.append(FileChange(path, before, after, stat.S_IMODE(path.stat().st_mode)))
    return changes, root_exists


@dataclass
class RuntimeChange:
    label: str
    before: dict
    after: dict
    read: object
    write: object

    async def current(self):
        result = self.read()
        return deepcopy(await result if inspect.isawaitable(result) else result)

    async def save(self, value):
        result = self.write(value)
        if inspect.isawaitable(result):
            await result


class ReferenceUpdate:
    def __init__(self, hass, renames):
        self.hass = hass
        self.renames = renames
        self.files = []
        self.runtime = []
        self.attempted_runtime = []
        self.entries = []
        self.subentries = []
        self.dashboards = []
        self.yaml_dashboards = []
        self.backup = None
        self.attempted_files = []
        self.attempted_entries = []
        self.attempted_subentries = []
        self.attempted_dashboards = []
        self.restart = set()
        self.reloaded = False
        self.root_exists = False
        self.count = 0

    async def prepare(self):
        from homeassistant.components.lovelace.const import LOVELACE_DATA, ConfigNotFound

        replace = Replacer(self.renames)
        extra = []
        lovelace = self.hass.data.get(LOVELACE_DATA)
        for dashboard in lovelace.dashboards.values() if lovelace else []:
            if dashboard.mode == "yaml":
                extra.append(dashboard.path)
                self.yaml_dashboards.append(dashboard)
                continue
            try:
                before = deepcopy(await dashboard.async_load(False))
            except ConfigNotFound:
                continue
            after = replace.data(before)
            if before != after:
                self.dashboards.append((dashboard, before, after))
        self.files, self.root_exists = await self.hass.async_add_executor_job(
            collect_files, self.hass.config.config_dir, extra, replace
        )
        for entry in self.hass.config_entries.async_entries():
            if entry.domain == DOMAIN:
                continue
            before = {"data": deepcopy(dict(entry.data)), "options": deepcopy(dict(entry.options))}
            after = replace.data(before)
            if before != after:
                self.entries.append((entry, before, after))
            for subentry in entry.subentries.values():
                previous = deepcopy(dict(subentry.data))
                updated = replace.data(previous)
                if previous != updated:
                    self.subentries.append((entry, subentry.subentry_id, previous, updated))
        await self._prepare_runtime(replace)
        self.count = replace.count
        return self

    async def _prepare_runtime(self, replace):
        registry = ar.async_get(self.hass)
        for area in registry.areas.values():

            def read_area(area_id=area.id):
                current = registry.async_get_area(area_id)
                return {
                    field: getattr(current, field)
                    for field in ("temperature_entity_id", "humidity_entity_id")
                }

            before = read_area()
            after = replace.data(before)
            if before == after:
                continue

            async def write_area(value, area_id=area.id):
                # Entity platforms publish the renamed state asynchronously.
                ready = asyncio.Event()

                @callback
                def check_state(event=None):
                    if all(
                        not entity_id or self.hass.states.get(entity_id)
                        for entity_id in value.values()
                    ):
                        ready.set()

                unsubscribe = self.hass.bus.async_listen("state_changed", check_state)
                try:
                    check_state()
                    async with asyncio.timeout(10):
                        await ready.wait()
                finally:
                    unsubscribe()
                registry.async_update(area_id, **value)

            self.runtime.append(
                RuntimeChange(f"area:{area.id}", before, after, read_area, write_area)
            )
        person = self.hass.data.get("person")
        if person:
            collection = person[1]
            for item in collection.async_items():

                def read_person(person_id=item["id"]):
                    return {"device_trackers": list(collection.data[person_id]["device_trackers"])}

                before = read_person()
                after = replace.data(before)
                if before == after:
                    continue

                async def write_person(value, person_id=item["id"]):
                    await collection.async_update_item(person_id, value)
                    await collection.store.async_save({"items": collection.async_items()})

                self.runtime.append(
                    RuntimeChange(f"person:{item['id']}", before, after, read_person, write_person)
                )
        if "energy" in self.hass.config.components:
            from homeassistant.components.energy.data import async_get_manager

            energy = await async_get_manager(self.hass)
            if energy.data:
                before = deepcopy(energy.data)
                after = replace.data(before)
                if before != after:

                    async def write_energy(value):
                        await energy.async_update(value)

                    self.runtime.append(
                        RuntimeChange("energy", before, after, lambda: energy.data, write_energy)
                    )

    def _backup(self):
        base = Path(self.hass.config.config_dir).resolve()
        parent = base / ".storage" / f"{DOMAIN}_backups"
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(parent, 0o700)
        backup = parent / uuid4().hex
        backup.mkdir(mode=0o700)
        self.backup = backup
        manifest = {
            "state": "prepared",
            "renames": self.renames,
            "files": [],
            "entries": [],
            "subentries": [],
            "dashboards": [],
            "runtime": [{"label": change.label, "data": change.before} for change in self.runtime],
        }
        for index, change in enumerate(self.files):
            atomic_write(backup / f"file-{index}", change.before)
            manifest["files"].append(
                {"path": str(change.path), "backup": f"file-{index}", "mode": change.mode}
            )
        for entry, before, _ in self.entries:
            manifest["entries"].append({"entry_id": entry.entry_id, **before})
        for entry, subentry_id, before, _ in self.subentries:
            manifest["subentries"].append(
                {"entry_id": entry.entry_id, "subentry_id": subentry_id, "data": before}
            )
        for dashboard, before, _ in self.dashboards:
            manifest["dashboards"].append({"url_path": dashboard.url_path, "config": before})
        atomic_write(
            backup / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode()
        )

    async def stage_files(self):
        await self.hass.async_add_executor_job(self._backup)
        for change in self.files:
            self.attempted_files.append(change)
            await self.hass.async_add_executor_job(self._write_checked, change, False)
        if self.files and self.root_exists:
            from homeassistant.config import async_check_ha_config_file

            if error := await async_check_ha_config_file(self.hass):
                raise HomeAssistantError(f"Updated configuration is invalid: {error}")

    @staticmethod
    def _write_checked(change, reverse):
        current = change.path.read_bytes()
        source, target = (change.after, change.before) if reverse else (change.before, change.after)
        if current == target:
            return
        if current != source:
            raise HomeAssistantError(f"Configuration changed concurrently: {change.path}")
        atomic_write(change.path, target, change.mode)

    async def apply(self):
        for dashboard, before, after in self.dashboards:
            current = await dashboard.async_load(False)
            if current != before and current != after:
                raise HomeAssistantError("Dashboard changed concurrently")
            self.attempted_dashboards.append((dashboard, before, after))
            await dashboard.async_save(after)
        for entry, before, after in self.entries:
            current = {"data": dict(entry.data), "options": dict(entry.options)}
            if current != before and current != after:
                raise HomeAssistantError(
                    f"Integration configuration changed concurrently: {entry.domain}"
                )
            self.attempted_entries.append((entry, before, after))
            self.hass.config_entries.async_update_entry(entry, **after)
        for entry, subentry_id, before, after in self.subentries:
            subentry = entry.subentries[subentry_id]
            if dict(subentry.data) not in (before, after):
                raise HomeAssistantError("Integration subentry changed concurrently")
            self.attempted_subentries.append((entry, subentry_id, before, after))
            self.hass.config_entries.async_update_subentry(entry, subentry, data=after)
        await self.reload()
        for change in self.runtime:
            current = await change.current()
            if current != change.before and current != change.after:
                raise HomeAssistantError(f"Configuration changed concurrently: {change.label}")
            self.attempted_runtime.append(change)
            await change.save(change.after)
        await self._mark("committed")
        return {
            "references": self.count,
            "runtime": len(self.runtime),
            "files": len(self.files),
            "dashboards": len(self.dashboards),
            "entries": len({entry.entry_id for entry, *_ in [*self.entries, *self.subentries]}),
            "backup": str(self.backup.relative_to(Path(self.hass.config.config_dir).resolve())),
            "restart_required": sorted(self.restart),
        }

    async def reload(self):
        if self.files:
            for domain in {domain for change in self.files for domain in change.domains}:
                if (
                    domain not in {"homeassistant", "lovelace"}
                    and domain in self.hass.config.components
                    and not self.hass.services.has_service(domain, "reload")
                ):
                    self.restart.add(domain)
            if self.hass.services.has_service("homeassistant", "reload_all"):
                await self.hass.services.async_call("homeassistant", "reload_all", blocking=True)
            else:
                self.restart.add("YAML")
        for dashboard in self.yaml_dashboards:
            if self.files:
                await dashboard.async_load(True)
        entries = {entry.entry_id: entry for entry, *_ in [*self.entries, *self.subentries]}
        for entry in entries.values():
            if entry.state is not ConfigEntryState.LOADED:
                continue
            if entry.supports_unload:
                if not await self.hass.config_entries.async_reload(entry.entry_id):
                    raise HomeAssistantError(f"Failed to reload {entry.domain}")
            else:
                self.restart.add(entry.domain)
        self.reloaded = True

    async def rollback(self):
        errors = []
        for change in reversed(self.attempted_runtime):
            try:
                current = await change.current()
                if current != change.before and current != change.after:
                    raise HomeAssistantError("Configuration changed concurrently")
                await change.save(change.before)
            except Exception:
                errors.append(change.label)
        for change in reversed(self.attempted_files):
            try:
                await self.hass.async_add_executor_job(self._write_checked, change, True)
            except Exception:
                errors.append(str(change.path))
        for dashboard, before, after in reversed(self.attempted_dashboards):
            try:
                current = await dashboard.async_load(False)
                if current != after and current != before:
                    raise HomeAssistantError("Dashboard changed concurrently")
                await dashboard.async_save(before)
            except Exception:
                errors.append(f"dashboard:{dashboard.url_path}")
        for entry, before, after in reversed(self.attempted_entries):
            try:
                current = {"data": dict(entry.data), "options": dict(entry.options)}
                if current != after and current != before:
                    raise HomeAssistantError("Integration changed concurrently")
                self.hass.config_entries.async_update_entry(entry, **before)
            except Exception:
                errors.append(f"entry:{entry.entry_id}")
        for entry, subentry_id, before, after in reversed(self.attempted_subentries):
            try:
                subentry = entry.subentries[subentry_id]
                if dict(subentry.data) not in (before, after):
                    raise HomeAssistantError("Integration subentry changed concurrently")
                self.hass.config_entries.async_update_subentry(entry, subentry, data=before)
            except Exception:
                errors.append(f"subentry:{subentry_id}")
        if self.attempted_entries or self.attempted_subentries or self.attempted_files:
            try:
                await self.reload()
            except Exception:
                errors.append("runtime reload")
        await self._mark("rollback_failed" if errors else "rolled_back")
        return errors

    async def _mark(self, state):
        if not self.backup:
            return

        def write():
            path = self.backup / "manifest.json"
            if not path.exists():
                return
            manifest = json.loads(path.read_bytes())
            manifest["state"] = state
            atomic_write(path, json.dumps(manifest, ensure_ascii=False, indent=2).encode())

        await self.hass.async_add_executor_job(write)
