# Worldweave setup and access

## Published workspace

The main Site URL opens the global shared workspace. Every visitor is asked for a display name, then joins automatically. The name is saved in that browser for the next visit. Click your avatar to change it or forget the saved name. All maps created in this workspace are visible and editable to everyone who can open the Site.

The Site audience is public. Treat the Site URL as public information; it is not a password or invite secret. If a collaborator needs a separate map, use **Invite** to create a room with a random edit key in its URL fragment. Anyone holding the complete room link can edit that room. Do not put sensitive data in maps or share invite links publicly.

## Storage and synchronization

Production persistence uses the Sites D1 binding declared as `d1: "DB"` in `.openai/hosting.json`. The Drizzle schema and migrations define `shared_rooms` for map snapshots/revisions and `room_presence` for cursors and characters. Sites applies pending migrations when deploying.

Each shared map is stored as its own room row and has an independent revision. Edits are sent as shape operations and map-setting patches instead of whole-map snapshots. Foreground editors check for map changes about every 300 ms and cursor/character presence about every 400 ms. The server keeps a bounded history of recent operations for incremental polling and uses compare-and-swap revision checks. Different-object edits can rebase; conflicting edits remain in the current tab until downloaded as JSON or discarded in favor of the online version. Map contents are never autosaved to browser storage.

Presence is scoped to a map row. Cursor and character positions use world coordinates. Inactive cursors expire after five seconds, and moving users refresh presence several times per second. Each user's camera remains local to their browser.

## Local development

```powershell
npm ci
npm run dev
```

The local Wrangler preview uses its own local D1 state and does not read or modify production map data. As in production, map contents are stored through the server database rather than browser storage.

## Current limits

- Collaboration is polling over HTTP, not a persistent WebSocket. The editor targets roughly 300–400 ms update checks while a tab is in the foreground; network conditions and browser throttling can add delay.
- The public workspace intentionally has no sign-in or per-user edit permissions. Anyone who reaches the public Site can edit its shared maps.
- Invite rooms have an edit key, but do not have separate viewer roles, per-room revocation controls, or account-based permissions.
- The vector template library is stored on the workspace entry map and synchronized across the public map collection; invite-only rooms keep their own map-level templates.
- Automated checks cover geometry, curved collision, finite bounds, collaboration-patch rebasing, grouping, and generation. Two browser sessions were verified joining and seeing one another. Conflicting simultaneous edits, reconnect recovery, and the full hosted create/switch/delete flow have not been exercised against disposable production data.
