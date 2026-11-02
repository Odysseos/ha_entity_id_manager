"""Reference replacement must preserve identity, formatting and include scope."""

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entityfilter import FILTER_SCHEMA
from homeassistant.util.yaml import load_yaml

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
  glob: "sensor.old[12]"
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
    assert 'glob: "sensor.old[12]"' in result


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


def test_yaha_package_and_extensionless_includes(tmp_path):
    (tmp_path / "configuration.yaml").write_text(
        "homeassistant:\n  packages: !include_dir_named packages\n"
    )
    (tmp_path / "packages").mkdir()
    (tmp_path / "packages" / "voice.yaml").write_text(
        "yandex_smart_home:\n  entity_config: !include entities\n"
    )
    (tmp_path / "packages" / "entities").write_text(
        "sensor.old:\n  properties: [{entity: sensor.other}]\n  default_entity_id: sensor.old\n"
    )
    changes, _ = collect_files(
        tmp_path, [], Replacer({"sensor.old": "sensor.new", "sensor.other": "sensor.updated"})
    )
    assert len(changes) == 1
    assert changes[0].domains == ("yandex_smart_home",)
    assert changes[0].after == (
        b"sensor.new:\n  properties: [{entity: sensor.updated}]\n  default_entity_id: sensor.old\n"
    )


@pytest.mark.parametrize("layout", ["inline", "nested", "directory"])
def test_yaha_masks_preserve_exposure_and_exact_references(tmp_path, layout):
    root = tmp_path / "configuration.yaml"
    rules = tmp_path / "rules.yaml"
    allow = tmp_path / "allowed"
    allow.write_text("  - sensor.old_exact # keep\n")
    filter_yaml = (
        'include_entity_globs: ["sensor.old_*", "sensor.now_visible_*"] # include mask\n'
        'exclude_entity_globs: "light.private_*" # exclude mask\n'
        "include_domains: [light]\n"
        "include_entities: !include allowed\n"
    )
    if layout == "inline":
        root.write_text(
            "yandex_smart_home:\n  filter:\n"
            + "".join(f"    {line}\n" for line in filter_yaml.splitlines())
        )
    else:
        root.write_text("yandex_smart_home: !include voice\n")
        if layout == "nested":
            (tmp_path / "voice").write_text("filter: !include rules.yaml\n")
        else:
            (tmp_path / "voice").write_text("filter: !include_dir_merge_named filters\n")
            (tmp_path / "filters").mkdir()
            rules = tmp_path / "filters" / "rules.yaml"
            filter_yaml = filter_yaml.replace("!include allowed", "!include ../allowed")
        rules.write_text(filter_yaml)
    renames = {
        "sensor.old_exact": "sensor.room_group_exact",
        "sensor.old_visible": "sensor.room_group_visible",
        "sensor.now_visible_first": "sensor.new_visible_first",
        "light.private_one": "light.hidden_one",
        "light.private_other": "light.hidden_two",
        "light.visible": "light.private_two",
    }
    untouched = {"sensor.room_original", "sensor.unrelated", "light.hidden_other"}
    entity_ids = set(renames) | untouched | {"sensor.now_visible_second", "light.private_other"}
    before = FILTER_SCHEMA(load_yaml(str(root))["yandex_smart_home"]["filter"])
    changes, _ = collect_files(tmp_path, [], Replacer(renames), entity_ids)
    for change in changes:
        change.path.write_bytes(change.after)
    after = FILTER_SCHEMA(load_yaml(str(root))["yandex_smart_home"]["filter"])
    assert all(before(old) == after(renames.get(old, old)) for old in entity_ids)
    assert after.config["include_entities"] == [
        "sensor.room_group_exact",
        "sensor.new_visible_first",
    ]
    assert after.config["exclude_entities"] == []
    assert after.config["include_entity_globs"] == ["sensor.room_group_*", "sensor.now_visible_*"]
    assert after.config["exclude_entity_globs"] == ["light.hidden_[ot][nw][eo]"]

    changed = {change.path: change.after.decode() for change in changes}
    assert "sensor.room_group_exact # keep" in changed[allow]
    result = changed[root if layout == "inline" else rules]
    assert "# include mask" in result
    assert "# exclude mask" in result
    assert all("yandex_smart_home" in change.domains for change in changes)


def test_yaha_glob_without_renamed_members_is_left_alone(tmp_path):
    config = tmp_path / "configuration.yaml"
    source = 'yandex_smart_home: {filter: {exclude_entity_globs: "sensor.private_*"}}\n'
    config.write_text(source)
    replacer = Replacer({"sensor.public": "sensor.private_one"})
    changes, _ = collect_files(tmp_path, [], replacer)
    assert not changes
    assert not replacer.rename_log


@pytest.mark.parametrize("partial", [False, True])
def test_yaha_glob_falls_back_to_explicit_ids_and_logs_search(tmp_path, partial):
    config = tmp_path / "configuration.yaml"
    config.write_text('yandex_smart_home: {filter: {exclude_entity_globs: "light.private_*"}}\n')
    renames = {"light.private_one": "light.hidden_one", "light.private_two": "light.public_other"}
    unchanged = {"light.hidden_other", "light.public_two", "light.hidden_two"}
    if partial:
        unchanged.add("light.private_three")
    replacer = Replacer(renames)
    changes, _ = collect_files(tmp_path, [], replacer, unchanged)
    config.write_bytes(changes[0].after)
    result = load_yaml(str(config))["yandex_smart_home"]["filter"]
    assert result["exclude_entities"] == ["light.hidden_one", "light.public_other"]
    assert result["exclude_entity_globs"] == ("light.private_*" if partial else [])
    assert len(replacer.rename_log) == 1
    assert replacer.rename_log[0]["new_mask"] is None
    assert replacer.rename_log[0]["entity_ids"] == result["exclude_entities"]


def test_yaha_glob_single_match_becomes_explicit_id_in_existing_include(tmp_path):
    config = tmp_path / "configuration.yaml"
    config.write_text(
        "yandex_smart_home:\n"
        "  filter:\n"
        "    include_entity_globs: !include masks\n"
        "    include_entities: !include ids\n"
    )
    masks = tmp_path / "masks"
    masks.write_text('- "sensor.old_*"\n')
    ids = tmp_path / "ids"
    ids.write_text("- sensor.existing\n")
    replacer = Replacer({"sensor.old_one": "sensor.new_one"})
    changes, _ = collect_files(tmp_path, [], replacer, {"sensor.existing"})
    for change in changes:
        change.path.write_bytes(change.after)
    result = load_yaml(str(config))["yandex_smart_home"]["filter"]
    assert result == {
        "include_entity_globs": [],
        "include_entities": ["sensor.existing", "sensor.new_one"],
    }
    assert not replacer.rename_log


def test_yaha_glob_partial_multiple_adds_new_mask_and_logs_search(tmp_path):
    config = tmp_path / "configuration.yaml"
    config.write_text(
        'yandex_smart_home:\n  filter:\n    include_entity_globs:\n    - "sensor.old_*"\n'
    )
    replacer = Replacer({"sensor.old_one": "sensor.new_one", "sensor.old_two": "sensor.new_two"})
    changes, _ = collect_files(tmp_path, [], replacer, {"sensor.old_three", "sensor.other"})
    config.write_bytes(changes[0].after)
    result = load_yaml(str(config))["yandex_smart_home"]["filter"]
    assert result == {"include_entity_globs": ["sensor.old_*", "sensor.new_*"]}
    assert len(replacer.rename_log) == 1
    assert replacer.rename_log[0]["new_mask"] == "sensor.new_*"


def test_yaha_masks_replace_rules_inside_included_list(tmp_path):
    root = tmp_path / "configuration.yaml"
    root.write_text("yandex_smart_home:\n  filter:\n    include_entity_globs: !include rules\n")
    rules = tmp_path / "rules"
    rules.write_text('- "sensor.old_*_temp" # keep\n- "light.*" # keep as-is\n')
    renames = {
        "sensor.old_bed_temp": "sensor.new_bed_temp",
        "sensor.old_kitchen_temp": "sensor.new_kitchen_temp",
    }
    changes, _ = collect_files(
        tmp_path, [], Replacer(renames), {"sensor.new_bed_humidity", "light.ceiling"}
    )
    assert [(change.path, change.after) for change in changes] == [
        (rules, b'- "sensor.new_*_temp" # keep\n- "light.*" # keep as-is\n')
    ]
