# Changelog

## 0.7.0

- Update entity references when applying renames: active YAML includes, automation and template blueprints, Jinja files, Lovelace dashboards, integration data/options and subentries.
- Update area sensor selections, person device trackers and energy preferences through Home Assistant APIs.
- Preserve YAML formatting and object identities, check configuration before renaming, and reload affected configuration.
- Back up changed configuration and roll back renames and reference updates on failure; report components requiring a restart.
- Add reference replacement, transaction rollback and real automation/script reload tests.

## 0.6.2

- Separate the DOM-free tree model from the virtual viewport renderer.
- Update the model synchronously when drafts change, including offscreen rows.
- Create DOM nodes only for rows intersecting the viewport; recycle visible nodes and discard offscreen nodes during scrolling.
- Index object names for bulk operations and avoid scanning all tree rows on each keystroke.
- Test viewport bounds, offscreen edits and typing with 5,000 entities.

## 0.6.1

- Update only affected tree rows while editing ID parts instead of rebuilding the whole tree on each keystroke and conflict response.
- Index parent conflicts once per check result instead of repeatedly scanning all entities for each parent.
- Debounce tree search and preserve existing tree nodes and scroll position during editing.
- Add a browser regression check for typing with 5,000 entities.

## 0.6.0

- Replace separate area, device and entity tabs with one hierarchical tree and a persistent editor.
- Separate branch expansion from object selection and preserve drafts while navigating.
- Keep ancestor context in search and conflict filters, with unassigned objects grouped last.
- Stack the tree above the editor on narrow screens.

## 0.5.0

- Copy ID parts to devices or entities with the same own name across areas and devices.
- Choose between filling unset parts and replacing all matching parts when different values exist.
- Stage bulk edits as drafts, recalculate conflicts and allow undo without overwriting later manual edits.

## 0.4.6

- Give the editor and preview actions matching filled buttons, arranged side by side.

## 0.4.5

- Further compact object rows and reduce the desktop editor height to 80% of the viewport.

## 0.4.4

- Reduce vertical spacing and padding in selected objects and picker rows.
- Keep the compact selected-object height constant across tabs.

## 0.4.3

- Fix editor dialog dimensions and control row positions across tabs.
- Reserve a constant selected-object height and keep the footer in place.
- Scroll details inside the remaining middle region.

## 0.4.2

- Place explicit list filters above the object picker with separate all-conflict and parent-conflict counts.
- Switch directly between all objects, all conflicts and parent-scoped conflicts.
- Keep details links inside the selected row bounds.

## 0.4.1

- Replace parent conflict details with a count and navigation to affected child entities.
- Limit selected entity conflict details to three matches, with expandable scrolling for longer lists.

## 0.4.0

- Check draft mappings for final entity ID conflicts using the same backend naming rules as rename previews, without saving drafts.
- Mark conflicting entities and their parent devices and areas, show conflict details, and filter affected objects.
- Show the current full entity ID on a third line and provide a copy action.
- Preserve the ability to save incomplete mappings while preventing conflicting renames.

## 0.3.12

- Compare area, device and entity names separately so parent ordering matches across tabs regardless of path separators.

## 0.3.11

- Fall back to the effective area name normalized by Home Assistant when no area ID override is set.
- Keep entities without any explicit mapping outside rename plans.

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
