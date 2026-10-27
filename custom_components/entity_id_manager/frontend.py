"""Register the administration editor using Home Assistant custom panels."""

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig

from .const import DOMAIN, VERSION

PANEL = "entity-id-manager"


async def async_register(hass):
    key = f"{DOMAIN}_static"
    if not hass.data.get(key):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    f"/{DOMAIN}/editor.js", str(Path(__file__).parent / "www/editor.js"), False
                )
            ]
        )
        hass.data[key] = True
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL,
        webcomponent_name="entity-id-manager-panel",
        sidebar_title="Entity ID Manager",
        sidebar_icon="mdi:identifier",
        module_url=f"/{DOMAIN}/editor.js?v={VERSION}",
        embed_iframe=False,
        require_admin=True,
        config_panel_domain=DOMAIN,
    )


def unregister(hass):
    if frontend.async_panel_exists(hass, PANEL):
        frontend.async_remove_panel(hass, PANEL)
