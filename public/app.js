const ioClient = io();
let currentBotId = null;
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function humanPos(p) { return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : "—"; }
function dur(ms) { if (!ms) return "—"; const s = Math.floor(ms/1000); const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60; return `${h}h ${m}m ${sec}s`; }

// ---------- Server status ----------
ioClient.on("server:status", s => {
  $("#svOnline").textContent = s.online ? "Online" : "Offline";
  $("#svOnline").className = "badge " + (s.online ? "on" : "off");
  $("#svAddr").textContent = `${s.host}:${s.port}`;
  $("#svVersion").textContent = s.version ? `• ${s.version}` : "";
  $("#svUptime").textContent = s.uptime ? `• Uptime ${s.uptime}` : "";
  $("#svMotd").textContent = s.motd || "";

  // real players
  const cont = $("#svPlayers"); cont.innerHTML = "";
  (s.players?.sample || []).forEach(p => {
    const el = document.createElement("div"); el.className = "av";
    el.innerHTML = `<img src="${p.headUrl}" alt=""/> <span>${p.name}</span>`;
    cont.appendChild(el);
  });

  // non-bot players (server provided 'sample' is already non-bot list in poller)
  const non = $("#svNonBotPlayers"); non.innerHTML = "";
  (s.players?.sample || []).forEach(p => {
    const el = document.createElement("div"); el.className = "av";
    el.innerHTML = `<img src="${p.headUrl}" alt=""/> <span>${p.name}</span>`;
    non.appendChild(el);
  });
});

// ---------- Add bot (no ID) ----------
$("#addBot").onclick = () => {
  const name = $("#botName").value.trim();
  const auth = $("#botAuth").value;
  if (!name) return alert("Fill username");
  ioClient.emit("bot:add", { id: name, name, auth });
  $("#botName").value = "";
};

// ---------- Bot list rendering (click to open) ----------
ioClient.on("bot:list", list => {
  const cont = $("#botList"); cont.innerHTML = "";
  list.forEach(b => {
    const el = document.createElement("div"); el.className = "bot";
    el.innerHTML = `
      <img src="${b.headUrl}" alt=""/>
      <div>
        <div class="name">${b.name}</div>
        <div class="status">${b.online ? "Online" : "Offline"} • ${b.name}</div>
      </div>
      <div class="controls">
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" ${b.toggledConnected ? "checked":""} data-toggle="${b.name}"/> Connected
        </label>
        <button data-del="${b.name}" style="background:#2b1520">Delete</button>
      </div>
    `;
    // select on click
    el.onclick = (ev) => { if (ev.target.closest('.controls')) return; selectBot(b.name); };
    cont.appendChild(el);
  });

  cont.querySelectorAll("[data-del]").forEach(btn => btn.onclick = (e) => {
    e.stopPropagation(); ioClient.emit("bot:remove", btn.dataset.del);
    if (currentBotId === btn.dataset.del) { currentBotId = null; $("#botPanel").style.display = "none"; }
  });
  cont.querySelectorAll("[data-toggle]").forEach(cb => {
    cb.onclick = ev => ev.stopPropagation();
    cb.onchange = (e) => ioClient.emit("bot:toggle", { id: e.target.dataset.toggle, on: e.target.checked });
  });
});

// select helper
function selectBot(id) {
  currentBotId = id;
  $("#botPanel").style.display = "grid";
  $("#debugLog").textContent = "";
  ioClient.emit("bot:requestState", id);
}

// ---------- Telemetry / inventory ----------
ioClient.on("bot:telemetry", ({ id, status, inventory }) => {
  if (id !== currentBotId) return;
  $("#stUptime").textContent = dur(status.uptime);
  $("#stDim").textContent = status.dim;
  $("#stPos").textContent = humanPos(status.pos);
  $("#stHH").textContent = `${status.health ?? "—"} / ${status.hunger ?? "—"}`;
  $("#stXP").textContent = status.xp ?? "—";
  $("#stYawPitch").textContent = `${(status.yaw*180/Math.PI).toFixed(1)}° / ${(status.pitch*180/Math.PI).toFixed(1)}°`;
  const fx = (status.effects || []).map(e => `${e.type} ${e.amp+1} (${Math.floor(e.dur/20)}s)`).join(", ");
  $("#stFx").textContent = fx || "—";
  const lookStr = status.looking?.entity ? `Entity: ${status.looking.entity}` :
                  status.looking?.block ? `Block: ${status.looking.block.name} @ ${humanPos(status.looking.block.pos)}` : "—";
  $("#stLooking").textContent = lookStr;

  // Inventory slots 36 (click empty -> unequip)
  const grid = $("#invGrid"); grid.innerHTML = "";
  (inventory.slots || []).forEach((it, i) => {
    const el = document.createElement("div"); el.className = "slot";
    el.title = it ? `${it.name} x${it.count}` : "(empty)";
    el.textContent = it ? `${it.name} x${it.count}` : "";
    el.onclick = () => {
      if (!currentBotId) return;
      if (it) ioClient.emit("bot:holdSlot", { id: currentBotId, index: i });
      else ioClient.emit("bot:holdSlot", { id: currentBotId, index: -1 }); // unequip
    };
    grid.appendChild(el);
  });

  // Armor
  $$(".equip-slot").forEach(es => {
    const k = es.dataset.armor;
    const it = inventory.armor?.[k];
    es.title = it ? `${it.name}` : "(empty)";
    es.textContent = it ? `${it.name}` : k.toUpperCase();
    es.onclick = (e) => { e.stopPropagation(); ioClient.emit("bot:unequipArmor", { id: currentBotId, part: k }); };
  });

  $("#mainHand").textContent = inventory.mainHand ? `${inventory.mainHand.name} x${inventory.mainHand.count}` : "";
  $("#offHand").textContent = inventory.offHand ? `${inventory.offHand.name} x${inventory.offHand.count}` : "";
});

// description sync
$("#botDesc").addEventListener("change", e => { if (!currentBotId) return; ioClient.emit("bot:desc", { id: currentBotId, text: e.target.value }); });
ioClient.on("bot:description", ({ id, description }) => { if (id===currentBotId) $("#botDesc").value = description || ""; });

// chat / respawn
$("#chatSend").onclick = () => {
  if (!currentBotId) return;
  const text = $("#chatInput").value.trim(); if (!text) return;
  ioClient.emit("bot:chat", { id: currentBotId, text });
  $("#chatInput").value = "";
};
$("#btnRespawn").onclick = () => currentBotId && ioClient.emit("bot:respawn", currentBotId);

// active actions + log
ioClient.on("bot:activeActions", ({ id, actions }) => {
  if (id !== currentBotId) return;
  const cont = $("#activeActions"); cont.innerHTML = "";
  (actions || []).forEach(a => {
    const c = document.createElement("div"); c.className = "chip";
    c.textContent = `${a.action} • ${a.mode}${a.intervalGt ? ` (${a.intervalGt}gt)`:""}`;
    cont.appendChild(c);
  });
});
ioClient.on("bot:log", ({ id, line }) => {
  if (id !== currentBotId) return;
  const pre = $("#debugLog");
  pre.textContent += line + "\n";
  pre.scrollTop = pre.scrollHeight;
});
ioClient.on("bot:chat", ({ id, line }) => {
  if (id !== currentBotId) return;
  const pre = $("#debugLog");
  pre.textContent += "[CHAT] " + line + "\n";
  pre.scrollTop = pre.scrollHeight;
});

// ---------- Swap hands (safe) ----------
$("#swapHands").onclick = () => currentBotId && ioClient.emit("bot:swapHands", currentBotId);

// ---------- Movement modes & WASD ----------
let mvHeld = { W:false, A:false, S:false, D:false };
function mvMode() { return $("#mvMode")?.value || "press"; }

$$(".wasd button").forEach(btn => {
  btn.onpointerdown = () => handleMove(btn.dataset.mv, true);
  btn.onpointerup = () => handleMove(btn.dataset.mv, false);
  btn.onpointerleave = () => handleMove(btn.dataset.mv, false);
});

function handleMove(dir, down) {
  if (!currentBotId) return;
  const mode = mvMode();
  if (mode === "press") {
    // press -> move only while held (setControlState)
    ioClient.emit("bot:moveContinuous", { id: currentBotId, dir, on: down });
  } else if (mode === "blocks") {
    // blocks -> send single move on pointerdown
    if (down) {
      const blocks = parseInt($("#mvBlocks").value||"5",10);
      ioClient.emit("bot:moveBlocks", { id: currentBotId, dir, blocks });
    }
  } else if (mode === "continuous") {
    // continuous -> start on pointerdown, stop on pointerup
    ioClient.emit("bot:moveContinuous", { id: currentBotId, dir, on: down });
  }
}

$("#mvGoBlocks").onclick = () => {
  if (!currentBotId) return;
  const blocks = parseInt($("#mvBlocks").value||"5",10);
  // pick last held or default W
  const pressed = Object.entries(mvHeld).find(([,v])=>v)?.[0] || "W";
  ioClient.emit("bot:moveBlocks", { id: currentBotId, dir: pressed, blocks });
};

$("#mvStop").onclick = () => {
  if (!currentBotId) return;
  ["W","A","S","D"].forEach(d => ioClient.emit("bot:moveContinuous", { id: currentBotId, dir:d, on:false }));
  ioClient.emit("bot:stopPath", currentBotId);
};

$("#mvJump").onclick = () => currentBotId && ioClient.emit("bot:jumpOnce", currentBotId);

// GOTO
$("#gotoBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#gotoX").value), y = Number($("#gotoY").value), z = Number($("#gotoZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) ioClient.emit("bot:gotoXYZ", { id: currentBotId, x, y, z });
};

// LOOKING controls (rotation steps)
$$(".plus button").forEach(btn => {
  btn.onclick = () => {
    if (!currentBotId) return;
    const step = Number($("#rotStep").value||"15");
    const map = { up:[0,-step], down:[0,step], left:[-step,0], right:[step,0] };
    const [dyaw, dpitch] = map[btn.dataset.rot];
    ioClient.emit("bot:rotateStep", { id: currentBotId, dyaw, dpitch });
  };
});
$("#setAngles").onclick = () => {
  if (!currentBotId) return;
  const yaw = Number($("#yawSet").value), pitch = Number($("#pitchSet").value);
  if (Number.isFinite(yaw) && Number.isFinite(pitch)) ioClient.emit("bot:lookAngles", { id: currentBotId, yaw, pitch });
};
$("#lookBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#lookX").value), y = Number($("#lookY").value), z = Number($("#lookZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) ioClient.emit("bot:lookAt", { id: currentBotId, x, y, z });
};

// -------- Actions (apply) ----------
$$(".action .apply").forEach(btn => {
  btn.onclick = () => {
    if (!currentBotId) return;
    const root = btn.closest(".action");
    const action = root.dataset.action;
    const mode = root.querySelector(".mode").value;
    const gt = Number(root.querySelector(".gt").value||"10");
    const dropStack = root.querySelector(".dropStack")?.checked || false;
    ioClient.emit("bot:setAction", { id: currentBotId, action, mode, intervalGt: gt, dropStack });
  };
});

// ---------- Tweaks (misc) ----------
function sendTweaks() {
  if (!currentBotId) return;
  const payload = {
    id: currentBotId,
    toggles: {
      autoRespawn: !!$("#twAutoRespawn").checked,
      autoSprint: !!$("#twAutoSprint").checked,
      autoReconnect: !!$("#twAutoReconnect").checked,
      autoSleep: !!$("#twAutoSleep").checked,
      autoMinePlace: !!$("#twAutoMinePlace").checked
    }
  };
  ioClient.emit("bot:setTweaks", payload);
}
["twAutoReconnect","twAutoRespawn","twAutoSprint","twAutoSleep","twAutoMinePlace"].forEach(id => {
  const el = $(`#${id}`); if (el) el.onchange = sendTweaks;
});
