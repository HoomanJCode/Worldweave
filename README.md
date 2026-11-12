# Worldweave

Worldweave is a browser-based vector map editor for planning game worlds. The published site opens a shared workspace: visitors choose a display name, then can view and edit the same maps without creating an account or using an invite link.

## Collaboration and access

- The Site is public. Anyone with its URL can join, see the shared map collection, and edit its maps. The URL is not an access secret.
- Names are remembered in that browser. Each map has its own change history, autosave revision, and live presence channel, so cursors from a different map do not appear on it.
- Map contents save to the shared online workspace. Non-overlapping edits can rebase; conflicting edits stay open in the current tab and can be downloaded as JSON. Map contents are not autosaved in the browser.
- The optional **Invite** flow creates a separate map with a long, secret edit link. Anyone holding that link can edit that separate map.
- Collaboration uses short-interval HTTP polling backed by the Sites D1 database. It is live collaboration, but it does not use a persistent WebSocket connection.

## Editor features

- Pan and zoom, reset or fit camera, adjustable grids, finite or infinite maps, optional character bounds, map background color, and a tactical mini-map.
- Vector selection and drawing, multi-select, single or group scale/rotation, anchor editing, Bézier handles, open and closed paths, copy/paste, ordering, and undo/redo.
- Object styles, visibility and locking, collision modes, and a WASD character with collision checks.
- Nested groups, a shared cross-map vector-template library, and deterministic wheat, corn, forest, and vegetation regions with adjustable seed, density, spacing, rotation, direction, scale, edge padding, and clustering.
- Convert procedural regions into editable vector instances while preserving selected template geometry, styling, and collision settings.
- Independent shared maps with create, rename, duplicate, import/export, and delete actions.
- Shared online autosave and JSON map backup/import. Only the display name and session identity are remembered by the browser.

## Run locally

Requirements: Node.js 22.13+ and npm.

```powershell
npm ci
npm run dev
```

Open the local URL printed in the terminal. The Site's D1 database binding is configured through Sites; a local dev server may use its local D1 preview data rather than production data.

## Checks

```powershell
npm run typecheck
npm test
npm run build
```

The automated suite covers camera and object transforms, Bézier sampling, curved-wall and solid collision, finite bounds, deterministic region generation, map validation, grouping visibility/locking, spatial selection indexing, and concurrent operation rebasing.

## Data and setup

See [SETUP.md](./SETUP.md) for D1 storage, access behavior, and deployment notes. Map JSON uses `formatVersion: 1`; imports validate it and assign fresh map, shape, group, and template IDs.
