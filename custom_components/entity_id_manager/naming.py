"""Pure naming rules; registry IDs identify stored overrides."""

import re
from dataclasses import dataclass

PART = re.compile(r"[a-z][a-z0-9_]*\Z", re.ASCII)


def validate_part(value):
    value = value.strip()
    if value and not PART.fullmatch(value):
        raise ValueError("Use lowercase ASCII letters, digits and underscores; start with a letter")
    return value


@dataclass(frozen=True)
class Rename:
    registry_id: str
    old: str
    new: str
    conflict: str = ""


def target_id(domain, area, device, suffix):
    parts = [part for part in (area, device, suffix) if part]
    if not parts or not suffix:
        raise ValueError("A suffix is required")
    for part in parts:
        validate_part(part)
    result = domain + "." + "_".join(parts)
    if len(result) > 255:
        raise ValueError("Entity ID is too long")
    return result
