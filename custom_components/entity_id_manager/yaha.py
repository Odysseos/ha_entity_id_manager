"""Migrate individual YaHA wildcard rules across entity ID changes."""

import json
import re
from collections import defaultdict
from difflib import SequenceMatcher
from fnmatch import translate
from os.path import commonprefix

import yaml
from homeassistant.exceptions import HomeAssistantError
from yaml.nodes import MappingNode, ScalarNode, SequenceNode
from yaml.tokens import BlockEntryToken, ScalarToken

DOMAIN = "yandex_smart_home"
FILTER_KEYS = ("include_entity_globs", "exclude_entity_globs")


def _infer_glob(matches, entity_ids):
    """Find a shared glob and verify it against the complete ID inventory."""
    if not matches:
        return None
    wanted = sorted(matches)
    others = entity_ids - matches

    def valid(pattern):
        match = re.compile(translate(pattern)).fullmatch
        return all(map(match, wanted)) and not any(map(match, others))

    prefix = commonprefix(wanted)
    suffix = commonprefix([value[len(prefix) :][::-1] for value in wanted])[::-1]
    if len(wanted) > 1 and valid(pattern := f"{prefix}*{suffix}"):
        return pattern

    # Keep anchors that occur in order across all IDs. Join adjacent anchors
    # wherever the resulting pattern still matches all target entities.
    anchors = min(wanted, key=lambda value: (len(value), value))
    for value in wanted:
        anchors = "".join(
            anchors[block.a : block.a + block.size]
            for block in SequenceMatcher(None, anchors, value, autojunk=False).get_matching_blocks()
        )
    blocks = list(anchors)
    index = 0
    while index < len(blocks) - 1:
        merged = blocks[:index] + [blocks[index] + blocks[index + 1]] + blocks[index + 2 :]
        match = re.compile(translate("*" + "*".join(merged) + "*")).fullmatch
        if all(map(match, wanted)):
            blocks = merged
        else:
            index += 1
    if blocks:
        pattern = "*".join(blocks)
        for candidate in (pattern, pattern + "*", "*" + pattern, "*" + pattern + "*"):
            if valid(candidate):
                return candidate

    # Character classes can distinguish IDs that share all literal anchors
    # with outsiders but differ at fixed positions.
    if len({len(value) for value in wanted}) == 1:
        columns = [sorted(set(chars)) for chars in zip(*wanted, strict=True)]
        pattern = "".join(
            chars[0] if len(chars) == 1 else "[" + "".join(chars) + "]" for chars in columns
        )
        if valid(pattern):
            return pattern
    return None


def plan_filter_edits(roots, sources, updated, renames, entity_ids, rename_log):
    """Transfer each rule's old match set to the projected entity IDs."""
    edits = defaultdict(dict)
    before_ids = set(entity_ids) | renames.keys()
    after_ids = {renames.get(entity_id, entity_id) for entity_id in before_ids}

    def resolve(path, node, files):
        visited = set()
        while isinstance(node, ScalarNode) and node.tag == "!include":
            path = (path.parent / node.value).resolve()
            if path in visited or path not in files:
                raise HomeAssistantError(f"Cannot resolve YaHA YAML include: {path}")
            visited.add(path)
            node = yaml.compose(files[path], Loader=yaml.SafeLoader)
        return path, node

    def directory_files(path, node, files):
        directory = (path.parent / node.value).resolve()
        return [
            item
            for item in sorted(files)
            if item.is_relative_to(directory)
            and item.suffix == ".yaml"
            and not any(p.startswith(".") for p in item.relative_to(directory).parts)
        ]

    def read_rules(path, node, files):
        path, node = resolve(path, node, files)
        if isinstance(node, ScalarNode) and node.tag in {
            "!include_dir_list",
            "!include_dir_merge_list",
        }:
            return [
                rule
                for item in directory_files(path, node, files)
                for rule in read_rules(
                    item, yaml.compose(files[item], Loader=yaml.SafeLoader), files
                )
            ]
        if node is None or node.tag == "tag:yaml.org,2002:null":
            return []
        items = node.value if isinstance(node, SequenceNode) else [node]
        if any(
            not isinstance(item, ScalarNode) or item.tag != "tag:yaml.org,2002:str"
            for item in items
        ):
            raise HomeAssistantError(f"Unsupported YaHA filter list in {path}")
        return [(path, item) for item in items]

    def mappings(path, node, files):
        path, node = resolve(path, node, files)
        if node is None or node.tag == "tag:yaml.org,2002:null":
            return []
        if isinstance(node, ScalarNode) and node.tag == "!include_dir_merge_named":
            return [
                pair
                for item in directory_files(path, node, files)
                for pair in mappings(item, yaml.compose(files[item], Loader=yaml.SafeLoader), files)
            ]
        if not isinstance(node, MappingNode):
            raise HomeAssistantError(f"Unsupported YaHA filter mapping in {path}")
        return [(path, node)]

    def read_filter(path, index, files):
        document = list(yaml.compose_all(files[path], Loader=yaml.SafeLoader))[index[0]]
        for offset in index[1:]:
            document = (
                document.value[offset][1]
                if isinstance(document, MappingNode)
                else document.value[offset]
            )
        parts = mappings(path, document, files)
        return parts, {
            key.value: (part_path, key, value)
            for part_path, part in parts
            for key, value in part.value
            if isinstance(key, ScalarNode)
        }

    def edit(path, span, value):
        previous = edits[path].setdefault(span, value)
        if previous != value:
            raise HomeAssistantError(f"Conflicting changes to a shared YaHA rule in {path}")

    def edit_scalar(path, node, replacement):
        start, end = node.start_mark.index, node.end_mark.index
        raw = updated[path][start:end]
        token = next(token for token in yaml.scan(raw) if isinstance(token, ScalarToken))
        trailing = re.search(r"(?:\r?\n[ \t]*)+$", raw[token.start_mark.index :])
        edit(
            path,
            (start + token.start_mark.index, end),
            json.dumps(replacement) + (trailing[0] if trailing else ""),
        )

    def edit_list(field, values, *, append_from=None):
        path, key, node = field
        path, resolved = resolve(path, node, updated)
        if resolved is None:
            edit(path, (0, 0), json.dumps(values) + "\n")
            return
        node = resolved
        start, end = node.start_mark.index, node.end_mark.index
        if isinstance(node, SequenceNode) and not node.flow_style:
            # The parser's block end can be at the next key. Stop at the last item.
            end = node.value[-1].end_mark.index
            raw = updated[path][start:end]
            first_dash = next(
                token for token in yaml.scan(raw) if isinstance(token, BlockEntryToken)
            )
            start += first_dash.start_mark.index
            indent = " " * (start - updated[path].rfind("\n", 0, start) - 1)
            newline = "\r\n" if "\r\n" in updated[path] else "\n"
            if append_from == len(node.value) and not updated[path][:end].endswith("\n"):
                # Append after the existing item's inline comment.
                next_line = updated[path].find("\n", end)
                offset = len(updated[path]) if next_line == -1 else next_line
                if offset and updated[path][offset - 1] == "\r":
                    offset -= 1
                edit(
                    path,
                    (offset, offset),
                    "".join(
                        f"{newline}{indent}- {json.dumps(item)}" for item in values[append_from:]
                    ),
                )
                return
            if values:
                value = (newline + indent).join(f"- {json.dumps(item)}" for item in values)
            else:
                # Indentless block sequences need indentation when converted to [].
                value = "  []"
        else:
            value = json.dumps(values)
            if start == end and key.end_mark.index < start:
                value = " " + value
        if end > start and updated[path][end - 1] == "\n":
            value += "\r\n" if updated[path][end - 2 : end] == "\r\n" else "\n"
        edit(path, (start, end), value)

    for path, index in roots:
        _, before = read_filter(path, index, sources)
        parts, after = read_filter(path, index, updated)
        missing_fields = []
        for key in FILTER_KEYS:
            if key not in before:
                continue
            old_rules = read_rules(before[key][0], before[key][2], sources)
            current_rules = read_rules(after[key][0], after[key][2], updated)
            migrated = []
            exact_ids = []
            for target, rule in old_rules:
                old_match = re.compile(translate(rule.value)).fullmatch
                matched = {entity_id for entity_id in before_ids if old_match(entity_id)}
                changed = {renames[entity_id] for entity_id in matched & renames.keys()}
                new_rules = []
                if not changed:
                    new_rules.append(rule.value)
                elif len(matched) == 1:
                    exact_ids.extend(changed)
                elif len(changed) == 1:
                    new_rules.append(rule.value)
                    exact_ids.extend(changed)
                else:
                    if len(changed) < len(matched):
                        new_rules.append(rule.value)
                    replacement = _infer_glob(changed, after_ids)
                    if replacement is None:
                        exact_ids.extend(sorted(changed))
                        comment = "No matching YaHA mask found; added entity IDs explicitly"
                    else:
                        if replacement not in new_rules:
                            new_rules.append(replacement)
                        comment = "Found a matching YaHA mask"
                    rename_log.append(
                        {
                            "comment": comment,
                            "file": str(target),
                            "filter": key,
                            "old_mask": rule.value,
                            "new_mask": replacement,
                            "entity_ids": sorted(changed),
                        }
                    )
                migrated.append(new_rules)

            if all(len(rules) == 1 for rules in migrated):
                for rules, (target, node) in zip(migrated, current_rules, strict=True):
                    if rules[0] != node.value:
                        edit_scalar(target, node, rules[0])
            else:
                edit_list(after[key], [rule for rules in migrated for rule in rules])

            if not exact_ids:
                continue
            exact_key = key.replace("_entity_globs", "_entities")
            if exact_key in after:
                field = after[exact_key]
                existing = [
                    item.strip()
                    for _, node in read_rules(field[0], field[2], updated)
                    for item in node.value.split(",")
                    if item.strip()
                ]
                merged = list(dict.fromkeys([*existing, *exact_ids]))
                if merged != existing:
                    edit_list(field, merged, append_from=len(existing))
            else:
                missing_fields.append(f"{exact_key}: {json.dumps(list(dict.fromkeys(exact_ids)))}")

        if missing_fields:
            target, mapping = next(part for part in reversed(parts) if part[1].value)
            if mapping.flow_style:
                offset = mapping.value[0][0].start_mark.index
                value = ", ".join(missing_fields) + ", "
            else:
                first_key = mapping.value[0][0]
                offset = first_key.start_mark.index
                newline = "\r\n" if "\r\n" in updated[target] else "\n"
                separator = newline + " " * first_key.start_mark.column
                value = separator.join(missing_fields) + separator
            edit(target, (offset, offset), value)
    return edits
