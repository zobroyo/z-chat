# ZChat theme system

## What will change
- Add a small frontend theme controller with three appearance choices: System, Light, and Dark.
- Save the choice in local browser storage and apply it before the page becomes visible to avoid a theme flash.
- Add three restrained accent choices that preserve ZChat’s existing electric-blue identity: Blue, Teal, and Coral.
- Add an Appearance section to the existing Profile & settings page using compact, accessible selection controls.
- Extend the existing semantic color tokens for a polished light palette while keeping the current dark palette intact.
- Make browser and installed-iPhone status areas follow the active theme.

## Scope and preservation
- Frontend files only; no backend, authentication, database, query, notification, push, or infrastructure changes.
- Existing chat layout, messages, composer, dialogs, menus, login flow, and behavior remain unchanged.
- Existing components continue using semantic colors, so the theme applies consistently without redesigning screens.

## Verification
- Confirm persistence after reload and System mode behavior.
- Check login, profile, chat sidebar, messages, composer, buttons, dialogs, and menus in light and dark themes.
- Check desktop, mobile Safari-sized, and installed-PWA-style viewports.
- Exercise chat selection and message composition without submitting test data; verify notification controls still render and no runtime errors appear.

## Technical details
- Store only appearance and accent identifiers in `localStorage`.
- Apply `data-theme` and `data-accent` attributes to the document root.
- Resolve System with `prefers-color-scheme` and respond when that operating-system preference changes.
- Keep all palette values in `src/styles.css` semantic tokens; feature components receive no hardcoded theme colors.
