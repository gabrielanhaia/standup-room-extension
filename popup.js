// Popup now delegates realtime to the content script running on the page

const el = (id) => document.getElementById(id);
const nameInput = el("name");
const saveNameBtn = el("saveName");
const roomInput = el("room");
const joinBtn = el("join");
const statusEl = el("status");
const peopleEl = el("people");
const leaveBtn = el("leave");
const resetMeBtn = el("resetMe");

let my = { deviceId: null, name: "", spoke: false, room: "" };
let myKey = null;
let peopleCache = [];

init();

async function init() {
  const stored = await getStorage(["deviceId", "name", "room"]);
  my.deviceId = stored.deviceId || genId();
  if (!stored.deviceId) await setStorage({ deviceId: my.deviceId });
  if (stored.name) { my.name = stored.name; nameInput.value = stored.name; setStatus(`Saved name: ${stored.name}`, "ok"); }
  // Prefill room from current tab URL slug; this is the default room
  const url = await getActiveTabUrl();
  const derived = deriveRoomFromUrl(url);
  if (derived) roomInput.value = derived;

  // Ask content script for current state; if not connected, do not auto-join here
  const state = await sendToTab({ type: "get_state" }).catch(() => null);
  if (state && state.ok) {
    myKey = state.myKey || my.deviceId;
    my.room = state.room || "";
    peopleCache = state.people || [];
    render();
  }
  // No auto-join; user must click Enter, unless content is already joined

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "presence_update") {
      myKey = msg.myKey || myKey;
      my.room = msg.room || my.room;
      peopleCache = msg.people || [];
      render();
    }
    if (msg.type === "status_update") {
      if (msg.status === "joined") setStatus(`In room: ${msg.room}`, "ok");
      if (msg.status === "issue") setStatus(`Connection issue: ${msg.reason}`, "warn");
      if (msg.status === "left") setStatus("Left room.");
    }
  });
}

saveNameBtn.addEventListener("click", async () => {
  const v = nameInput.value.trim();
  if (!v) { setStatus("Enter a name before saving.", "warn"); return; }
  my.name = v;
  await setStorage({ name: v });
  setStatus(`Saved name: ${v}`, "ok");
  // Inform content script if running on current page
  try { await sendToTab({ type: "save_name", name: v }); } catch {}
});

joinBtn.addEventListener("click", async () => {
  if (!my.name) {
    const v = nameInput.value.trim();
    if (!v) { setStatus("Set your name first.", "warn"); return; }
    my.name = v;
    await setStorage({ name: v });
    setStatus(`Saved name: ${v}`, "ok");
  }
  const room = roomInput.value.trim();
  if (!room) { setStatus("Enter a room.", "warn"); return; }
  my.room = room;
  await setStorage({ room });
  await sendToTab({ type: "join", room, name: my.name }).catch(() => setStatus("Could not contact page.", "warn"));
});

leaveBtn.addEventListener("click", async () => {
  await sendToTab({ type: "leave" }).catch(() => {});
});

resetMeBtn.addEventListener("click", async () => {
  await sendToTab({ type: "reset_me" }).catch(() => {});
});

function getPeople() { return peopleCache || []; }

function render() {
  const people = getPeople();
  peopleEl.innerHTML = "";
  if (people.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "No one here yet.";
    peopleEl.appendChild(empty);
    return;
  }
  // Update status summary
  const waitingCount = people.filter(p => !p.spoke).length;
  const spokeCount = people.length - waitingCount;
  setStatus(`In room: ${my.room || roomInput.value} — Waiting ${waitingCount}, Spoke ${spokeCount}`, "ok");
  people.forEach(p => {
    const card = document.createElement("div");
    card.className = "card";
    const left = document.createElement("div");
    left.className = "left";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = initials(p.name);
    avatar.style.background = colorFromName(p.name);
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = p.name;
    left.appendChild(avatar);
    left.appendChild(name);
    if (p.key === myKey) {
      const you = document.createElement("span");
      you.className = "you";
      you.textContent = "You";
      left.appendChild(you);
    }
    const right = document.createElement("div");
    right.className = "pill" + (p.key === myKey ? " mine" : "") + (p.spoke ? " on" : "");
    right.textContent = p.spoke ? "Spoke" : "Waiting";
    right.addEventListener("click", async () => {
      if (p.key === myKey) {
        await sendToTab({ type: "toggle_spoke" }).catch(() => {});
      } else {
        await sendToTab({ type: "toggle_spoke_for", key: p.key, next: !p.spoke }).catch(() => {});
      }
    });
    card.appendChild(left);
    card.appendChild(right);
    peopleEl.appendChild(card);
  });
}

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = kind === "ok" ? "ok" : kind === "warn" ? "warn" : "";
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

// Utilities: current tab URL and room derivation
function getActiveTabUrl() {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        resolve((tabs && tabs[0] && tabs[0].url) || "");
      });
    } catch (e) { resolve(""); }
  });
}

function deriveRoomFromUrl(url) {
  try {
    const u = new URL(url);
    // Build a stable slug from hostname + pathname (no query/hash)
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

async function sendToTab(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs || !tabs[0]) return reject(new Error("no_active_tab"));
        chrome.tabs.sendMessage(tabs[0].id, message, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(err);
          resolve(resp);
        });
      });
    } catch (e) { reject(e); }
  });
}

// UI helpers
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).slice(0, 2);
  return parts.map(s => s[0] ? s[0].toUpperCase() : "").join("") || "?";
}

function colorFromName(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}deg 70% 45%)`;
}
