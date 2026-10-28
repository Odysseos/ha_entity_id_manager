# Changelog

## 0.3.10

- Sort objects by display name and context, independently of saved mappings and drafts.
- Keep devices and entities without an area last.
- Remove saved-mapping priority from fallback options selectors.

## 0.3.9

- Apply parent prefix backgrounds to individual parts, preventing yellow edges around green draft values.

## 0.3.8

- Highlight draft parent ID parts in green within the shared prefix, including placeholders for pending removals.
- Keep unchanged parent parts yellow and omit removed old values from the prefix.

## 0.3.7

- Keep area names and ID parts on one line in both picker views.
- Use the same two-row grid for device and entity list items and the selected object.
- Remove trailing slashes from parent ID prefixes.

## 0.3.6

- Align parent ID prefixes with object names and editable ID parts with descriptions in two rows.

## 0.3.5

- Include integration names in device and entity descriptions.
- Show a shared pale-yellow area/device prefix before each object’s editable ID part.
- Use parent drafts in the prefix and placeholders for unassigned parent ID parts.

## 0.3.4

- Give unchanged ID chips a subtle accent background so they remain visible on highlighted rows, without borders.

## 0.3.3

- Use the same area-aware sorting for devices and entities, with unassigned objects last.
- Show device model and manufacturer below the name.
- Show the original entity parameter name below the name and include descriptions in search.

## 0.3.2

- Sort devices without an area after all devices assigned to areas.
- Add native links to area, device and entity details in the picker and selected object.
- Open details in a new tab to preserve unsaved editor drafts.

## 0.3.1

- Add icons to object selection rows and the selected object.
- Show devices with their area and entities with their area and device.
- Search entity IDs as well as object names and context paths.
- Install the Home Assistant frontend explicitly for CI tests and configure fixture loop scope.

## 0.3.0

- Open the editor directly when navigating from the integration settings gear.
- Add rename previews, selective application and automatic naming settings to the management page.
- Validate preview rows against current registry state before applying changes.

## 0.2.2

- Display object selection above dialog boundaries using a top-layer popover.
- Adapt list height and opening direction to the available viewport space.
- Keep the search field visible while scrolling long object lists.

## 0.2.1

- Show saved, changed and removed ID parts with neutral, green and red chips without captions.
- Add searchable object selection and keyboard navigation.
- Fix spacing between the search field and the first object row.

## 0.2.0

- Add an admin editor with object selection and inline ID-part editing.
- Keep drafts across objects and tabs; show saved and draft values as neutral, red and green ID chips without captions.
- Add a searchable object picker with keyboard navigation and diff styling for replacements and removals.
- Add per-object Clear and Reset changes controls, batch confirmation and full cancellation.
- Validate all changes before one configuration write and reject stale editor sessions.
- Add browser interaction tests and backend authorization and batch validation tests.

## 0.1.1

- Expose saved ID parts as editable text entities under the integration.
- Show configured parts in object selectors and list configured objects first.
- Exclude configuration text entities from rename operations.

## 0.1.0

- Add independent area, device and entity ID parts through integration options.
- Add selective rename previews, collision checks and stale-preview validation.
- Preserve display names, registry identities and disabled states.
- Add optional automatic naming for newly registered entities.
- Add HACS installation metadata, Russian and English forms, and automated checks.
