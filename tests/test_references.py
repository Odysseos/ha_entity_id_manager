"""Reference replacement must preserve identity, formatting and include scope."""

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.entity_id_manager.references import (
    FileChange,
    ReferenceUpdate,
    Replacer,
    collect_files,
)


def test_yaml_references_preserve_source_and_identity():
    old, new = "sensor.old", "sensor.room_temperature"
    source = """# sensor.old in a comment stays unchanged
sensor.old:  # a configuration key
  unique_id: sensor.old
  new_unique_id: sensor.old
  default_entity_id: sensor.old
  state_topic: sensor.old
  password: sensor.old
  entity_id: [sensor.old, sensor.old_2, sensor.old*]
  state: >-
    {{ states('sensor.old') }} {{ states.sensor.old.state }}
  alias: 'sensor.old'
  escaped: "sensor.\\u006fld"
"""
    result = Replacer({old: new}).yaml(source)
    assert result.startswith("# sensor.old in a comment stays unchanged\nsensor.room_temperature:")
    for key in ["unique_id", "new_unique_id", "default_entity_id", "state_topic", "password"]:
        assert f"  {key}: sensor.old\n" in result
    assert "entity_id: [sensor.room_temperature, sensor.old_2, sensor.old*]" in result
    assert (
        "{{ states('sensor.room_temperature') }} {{ states.sensor.room_temperature.state }}"
        in result
    )
    assert "alias: 'sensor.room_temperature'" in result
    assert 'escaped: "sensor.room_temperature"' in result


def test_boundaries_simultaneous_replacements_and_keys():
    replacer = Replacer({"sensor.one": "sensor.two", "sensor.two": "sensor.three"})
    assert replacer.text("sensor.one sensor.two sensor.one_more xsensor.one") == (
        "sensor.two sensor.three sensor.one_more xsensor.one"
    )
    with pytest.raises(HomeAssistantError, match="merge"):
        Replacer({"sensor.one": "sensor.two"}).data({"sensor.one": {}, "sensor.two": {}})
    with pytest.raises(HomeAssistantError, match="merge"):
        Replacer({"sensor.one": "sensor.two"}).yaml("sensor.one: 1\nsensor.two: 2\n")


def test_yaml_aliases_and_protected_anchors():
    replace = Replacer({"sensor.old": "sensor.new"})
    assert "&target sensor.new" in replace.yaml("entity_id: &target sensor.old\nother: *target\n")
    with pytest.raises(HomeAssistantError, match="anchor"):
        replace.yaml("unique_id: &identity sensor.old\nentity_id: *identity\n")


def test_include_graph_blueprints_dashboards_and_jinja(tmp_path):
    (tmp_path / "configuration.yaml").write_bytes(
        b"# Keep CRLF\r\nautomation: !include automations.yaml\r\nscript: !include_dir_merge_named includes\r\nlovelace:\r\n  dashboards:\r\n    custom:\r\n      filename: panel.yaml\r\n"
    )
    (tmp_path / "automations.yaml").write_text(
        "- use_blueprint:\n    path: example.yaml\n    input:\n      entity_id: sensor.old\n"
    )
    (tmp_path / "includes").mkdir()
    (tmp_path / "includes" / "script.yaml").write_text(
        "run:\n  sequence:\n    - target:\n        entity_id: sensor.old\n"
    )
    (tmp_path / "blueprints" / "automation").mkdir(parents=True)
    (tmp_path / "blueprints" / "automation" / "example.yaml").write_text(
        "condition: \"{{ is_state('sensor.old', 'on') }}\"\n"
    )
    (tmp_path / "panel.yaml").write_text("views: [{cards: [{entity: sensor.old}]}]\n")
    (tmp_path / "unused.yaml").write_text("entity_id: sensor.old\n")
    (tmp_path / "secrets.yaml").write_text("entity: sensor.old\nother: keep\n")
    (tmp_path / "custom_templates").mkdir()
    (tmp_path / "custom_templates" / "macro.jinja").write_text("{{ states.sensor.old.state }}")
    changes, exists = collect_files(tmp_path, [], Replacer({"sensor.old": "sensor.new"}))
    assert exists
    assert {change.path.name for change in changes} == {
        "automations.yaml",
        "script.yaml",
        "example.yaml",
        "panel.yaml",
        "secrets.yaml",
        "macro.jinja",
    }
    assert (tmp_path / "configuration.yaml").read_bytes().count(b"\r\n") == 7
    assert all(b"sensor.new" in change.after for change in changes)
    assert "sensor.old" in (tmp_path / "unused.yaml").read_text()


def test_concurrent_file_edits_are_not_overwritten(tmp_path):
    path = tmp_path / "script.yaml"
    path.write_bytes(b"user edit")
    change = FileChange(path, b"before", b"after", 0o640)
    with pytest.raises(HomeAssistantError, match="concurrently"):
        ReferenceUpdate._write_checked(change, False)
    with pytest.raises(HomeAssistantError, match="concurrently"):
        ReferenceUpdate._write_checked(change, True)
    assert path.read_bytes() == b"user edit"


def test_atomic_write_preserves_file_mode(tmp_path):
    path = tmp_path / "scene.yaml"
    path.write_bytes(b"before")
    path.chmod(0o640)
    change = FileChange(path, b"before", b"after", 0o640)
    ReferenceUpdate._write_checked(change, False)
    assert path.read_bytes() == b"after"
    assert path.stat().st_mode & 0o777 == 0o640
    ReferenceUpdate._write_checked(change, True)
    assert path.read_bytes() == b"before"


def test_external_includes_block_before_any_write(tmp_path):
    (tmp_path / "configuration.yaml").write_text("script: !include ../outside.yaml\n")
    with pytest.raises(HomeAssistantError, match="outside"):
        collect_files(tmp_path, [], Replacer({"sensor.old": "sensor.new"}))
