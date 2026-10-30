"""Pure naming rules; registry IDs identify stored overrides."""

import re
from dataclasses import dataclass

SEGMENT = re.compile(r"[a-z][a-z0-9_]*\Z", re.ASCII)


def validate_segment(value):
    value = value.strip()
    if value and not SEGMENT.fullmatch(value):
        raise ValueError("Use lowercase ASCII letters, digits and underscores; start with a letter")
    return value


@dataclass(frozen=True)
class Rename:
    registry_id: str
    old: str
    new: str
    conflict: str = ""


def target_id(domain, area, device, suffix):
    omit = suffix == "-"
    segments = [segment for segment in (area, device, "" if omit else suffix) if segment]
    if not segments or (not suffix and not omit):
        raise ValueError("A suffix is required")
    for segment in segments:
        validate_segment(segment)
    result = domain + "." + "_".join(segments)
    if len(result) > 255:
        raise ValueError("Entity ID is too long")
    return result
