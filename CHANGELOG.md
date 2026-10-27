# Changelog

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
