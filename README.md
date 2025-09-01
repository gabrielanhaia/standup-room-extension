Standup Room Chrome Extension
=============================

Chrome Web Store extension: https://chromewebstore.google.com/detail/iebkaopahcnhndaoganampgoaidglbhg?utm_source=item-share-cb

Extension to run quick standups with room-based presence using Supabase Realtime.

<img width="450" height="400" alt="Screenshot%202025-08-30%20at%2012 38 25_resized (1)" src="https://github.com/user-attachments/assets/6ac4490a-ed92-4919-9749-bbf43efb645a" />

Features
--------
- Name persistence: Save once, stored in `chrome.storage.local`.
- Page-based rooms: Room slug auto-derives from the current meeting URL (hostname + path).
- Presence via Supabase Realtime: Join `standup:<room>` and see participants live.
- Realtime updates: Join/leave/status changes sync instantly across everyone.
- Spoke toggle: Any participant can mark anyone as Waiting/Spoke.
- Reset/Leave: Reset your own status or leave the room from the popup.
- Sorting and summary: Waiting first, then Spoke; live counts in the status line.
- Resilience: Simple auto-reconnect with backoff while the page is open.
- Polished UI: Light/dark theme, avatars from initials, clear actions.

Setup
-----
- Create `config.json` from the example and fill in your Supabase project details:
  - Copy `config.example.json` to `config.json`
  - Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- `config.json` is ignored by git (see `.gitignore`). Do not commit your keys.

Development
-----------
- Load the folder as an unpacked extension in `chrome://extensions`.
- The extension auto-joins rooms derived from supported meeting URLs (Google Meet, Zoom, Teams, Jitsi, Whereby) when you’ve saved your name, or you can click Enter in the popup.

Build / Publish
---------------
- Ensure `manifest.json` version is bumped.
- Include `config.json` in your ZIP when publishing (it is ignored by git but must be present in the package). The extension reads it at runtime.

Make Targets
------------
- Create config.json from env vars:
  - `make config SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=your_anon_key`
- Package (creates dist/standup-extension-VERSION.zip):
  - `make package`
- Show current version:
  - `make version`
- Clean artifacts:
  - `make clean`

Security Notes
--------------
- Only the public Supabase anon key is used. Keep `config.json` out of source control.
- Content scripts are limited to specific meeting hosts to reduce review friction.

How It Works
------------
- Content script (`content.js`): Runs on supported meeting hosts. Loads Supabase settings from `config.json`, opens a presence channel, tracks your status, listens/broadcasts status changes, and reports state back to the popup.
- Popup (`popup.js`): Acts as a controller and view. Reads active tab URL to suggest a room, sends commands (join/leave/toggle/reset) to the content script, and renders the real-time participant list.
- Vendor (`vendor/supabase.min.js`): Supabase JavaScript client bundled in the extension.

Permissions
-----------
- `storage`: Save your deviceId, name, and last room locally.
- `tabs`: Read current tab URL for room derivation and message the content script.
- `host_permissions`: `https://*.supabase.co/*` to connect to Supabase.
- `content_scripts.matches`: Limited to common meeting hosts (Google Meet, Zoom, Teams, Jitsi, Whereby).

Credits
-------
- Created by Gabriel Anhaia — ga.contact.me@gmail.com — https://github.com/gabrielanhaia
