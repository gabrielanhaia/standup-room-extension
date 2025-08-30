// Content script: keeps presence running tied to the current page.
// Requires vendor/supabase.min.js. Loads config from optional extension file config.json.

let client = null;

let channel = null;
let my = { deviceId: null, name: "", spoke: false, room: "" };
let myKey = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let overrides = Object.create(null); // key -> boolean forced spoke state
let suppressAutoJoin = false; // prevent re-joining after a manual leave
let hasConfig = false;

loadConfig().then(init);

async function loadConfig() {
  try {
    const url = chrome.runtime.getURL('config.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error('config.json not found');
    const cfg = await res.json();
    if (cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      client = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      hasConfig = true;
    } else {
      throw new Error('missing keys');
    }
  } catch (e) {
    console.warn('Standup: Missing Supabase config.json or invalid format.', e);
    hasConfig = false;
  }
}

async function init() {
  if (!hasConfig) {
    chrome.runtime.sendMessage({ type: 'status_update', status: 'issue', reason: 'missing_config' });
    return;
  }
  const stored = await getStorage(["deviceId", "name"]);
  my.deviceId = stored.deviceId || genId();
  if (!stored.deviceId) await setStorage({ deviceId: my.deviceId });
  if (stored.name) my.name = stored.name;

  // Auto-join on known meeting hosts when name exists
  const derived = deriveRoomFromUrl(location.href);
  if (my.name && derived && isMeetingHost(location.hostname) && !suppressAutoJoin) {
    my.room = derived;
    connect(my.room);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === "save_name") {
        const name = (msg.name || "").trim();
        if (name) { my.name = name; await setStorage({ name }); }
        sendResponse({ ok: true });
        if (channel) await channel.track({ name: my.name, spoke: my.spoke });
        return;
      }
      if (msg && msg.type === "join") {
        const room = (msg.room || deriveRoomFromUrl(location.href) || "").trim();
        if (!room) return sendResponse({ ok: false, error: "no_room" });
        if (msg.name) { my.name = msg.name.trim(); await setStorage({ name: my.name }); }
        my.room = room;
        suppressAutoJoin = false;
        connect(room);
        return sendResponse({ ok: true });
      }
      if (msg && msg.type === "leave") {
        await leaveRoom();
        suppressAutoJoin = true;
        return sendResponse({ ok: true });
      }
      if (msg && msg.type === "toggle_spoke") {
        if (!channel) return sendResponse({ ok: false });
        my.spoke = !my.spoke;
        await channel.track({ name: my.name, spoke: my.spoke });
        return sendResponse({ ok: true, spoke: my.spoke });
      }
      if (msg && msg.type === "toggle_spoke_for") {
        if (!channel) return sendResponse({ ok: false });
        const key = msg.key;
        if (!key) return sendResponse({ ok: false, error: "no_key" });
        // If toggling self, use presence track; otherwise broadcast an override
        if (key === myKey) {
          my.spoke = typeof msg.next === 'boolean' ? !!msg.next : !my.spoke;
          await channel.track({ name: my.name, spoke: my.spoke });
          return sendResponse({ ok: true, spoke: my.spoke });
        } else {
          const current = effectiveSpokeForKey(key);
          const next = typeof msg.next === 'boolean' ? !!msg.next : !current;
          overrides[key] = next;
          try {
            await channel.send({ type: 'broadcast', event: 'mark_spoke', payload: { key, spoke: next } });
          } catch {}
          // Push update to popup immediately
          const people = getPeople();
          chrome.runtime.sendMessage({ type: "presence_update", people, myKey, room: my.room });
          return sendResponse({ ok: true, spoke: next });
        }
      }
      if (msg && msg.type === "reset_me") {
        if (!channel) return sendResponse({ ok: false });
        my.spoke = false;
        overrides[myKey] = false; // also clear any external override
        await channel.track({ name: my.name, spoke: my.spoke });
        try { await channel.send({ type: 'broadcast', event: 'mark_spoke', payload: { key: myKey, spoke: false } }); } catch {}
        return sendResponse({ ok: true });
      }
      if (msg && msg.type === "get_state") {
        const people = getPeople();
        return sendResponse({
          ok: true,
          people,
          myKey,
          name: my.name,
          room: my.room,
          joined: !!channel,
        });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep channel open for async sendResponse
});

function connect(room) {
  if (channel) client.removeChannel(channel);
  myKey = my.deviceId;
  channel = client.channel(`standup:${room}`, { config: { presence: { key: myKey } } });

  channel.on("presence", { event: "sync" }, () => {
    const people = getPeople();
    chrome.runtime.sendMessage({ type: "presence_update", people, myKey, room });
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(reconnectTimer);
      reconnectAttempts = 0;
      await channel.track({ name: my.name, spoke: false });
      chrome.runtime.sendMessage({ type: "status_update", status: "joined", room });
      const people = getPeople();
      chrome.runtime.sendMessage({ type: "presence_update", people, myKey, room });
    } else if (status === "TIMED_OUT" || status === "CLOSED" || status === "CHANNEL_ERROR") {
      chrome.runtime.sendMessage({ type: "status_update", status: "issue", reason: status });
      scheduleReconnect();
    }
  });

  // Listen for external marks
  channel.on('broadcast', { event: 'mark_spoke' }, ({ payload }) => {
    if (!payload) return;
    const { key, spoke } = payload;
    if (!key) return;
    overrides[key] = !!spoke;
    const people = getPeople();
    chrome.runtime.sendMessage({ type: 'presence_update', people, myKey, room });
  });
}

async function leaveRoom() {
  if (!channel) return;
  try { await channel.untrack(); } catch {}
  client.removeChannel(channel);
  channel = null;
  overrides = Object.create(null);
  chrome.runtime.sendMessage({ type: "status_update", status: "left" });
}

function getPeople() {
  if (!channel) return [];
  const state = channel.presenceState();
  const rows = [];
  for (const key of Object.keys(state)) {
    const metas = state[key] || [];
    metas.forEach(m => rows.push({ key, name: m.name, spoke: (key in overrides) ? !!overrides[key] : !!m.spoke }));
  }
  // Waiting first, then Spoke; then by name
  return rows.sort((a, b) => {
    if (a.spoke !== b.spoke) return a.spoke ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function effectiveSpokeForKey(key) {
  const people = getPeople();
  const p = people.find(r => r && r.key === key);
  return p ? !!p.spoke : false;
}

function scheduleReconnect() {
  if (!my.room) return;
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts || 0), 10000);
  reconnectAttempts = Math.min((reconnectAttempts || 0) + 1, 10);
  reconnectTimer = setTimeout(() => {
    connect(my.room);
  }, delay);
}

function isMeetingHost(host) {
  return (
    host === "meet.google.com" ||
    host.endsWith(".zoom.us") ||
    host === "teams.microsoft.com" ||
    host === "meet.jit.si" ||
    host === "whereby.com" ||
    host.endsWith(".whereby.com")
  );
}

function deriveRoomFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/home";
    const raw = `${u.hostname}${path}`.toLowerCase();
    return raw
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100);
  } catch {
    return "";
  }
}

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

function genId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Leave room on page unload
window.addEventListener("beforeunload", () => {
  try { if (channel) channel.untrack(); } catch {}
});
