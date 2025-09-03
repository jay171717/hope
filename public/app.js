const socket = io();

let currentBotId = null;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function fmtPos(p) { return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : "—"; }
function dur(ms) { if (!ms) return "—"; const s = Math.floor(ms/1000); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60; return `${h}h ${m}m ${sec}s`; }
function fmtItem(it) { if (!it) return "(empty)"; let s = `${it.name} x${it.count}`; if (it.enchants?.length) s += ` ✨`; if (it.durability !== null) s += ` (Dur ${it.durability})`; return s; }

// server status -> show single "Online Players"
socket.on("server:status", s => {
  $("#svOnline").textContent = s.online ? "Online" : "Offline";
  $("#svOnline").className = "badge " + (s.online ? "on" : "off");
  $("#svAddr").textContent = `${s.host}:${s.port}`;
  $("#svVersion").textContent = s.version || "";
  $("#svUptime").textContent = s.uptime || "";
  $("#svMotd").textContent = s.motd || "";
  const cont = $("#svPlayers");
  cont.innerHTML = "";
  (s.players.sample || []).forEach(p => {
    const el = document.createElement("div");
    el.className = "av";
    el.innerHTML = `<img src="${p.headUrl}"/><span>${p.name}</span>`;
    cont.appendChild(el);
  });
});

// hide panels initially
function hideBotPanel() {
  currentBotId = null;
  $("#botPanel").style.display = "none";
  // clear fields
  $("#botDesc").value = "";
  $("#stUptime").textContent = "—";
  $("#stDim").textContent = "—";
  $("#stPos").textContent = "—";
  $("#stHH").textContent = "—";
  $("#stXP").textContent = "—";
  $("#stFx").textContent = "—";
  $("#stYawPitch").textContent = "—";
  $("#stLooking").textContent = "—";
  $("#invGrid").innerHTML = "";
  $("#mainHand").textContent = "";
  $("#offHand").textContent = "";
  $("#activeActions").innerHTML = "";
  $("#debugLog").textContent = "";
}
hideBotPanel();

// add bot (no auth selection — always cracked/offline)
$("#addBot").onclick = () => {
  const name = $("#botName").value.trim();
  if (!name) return alert("Enter bot username");
  socket.emit("bot:add", { name });
  $("#botName").value = "";
};

// bot list
socket.on("bot:list", list => {
  const cont = $("#botList"); cont.innerHTML = "";
  list.forEach(b => {
    const el = document.createElement("div");
    el.className = "bot";
    el.innerHTML = `
      <img src="${b.headUrl}"/>
      <div>
        <div class="name">${b.name}</div>
        <div class="status">${b.online ? "Online":"Offline"}</div>
        <div class="desc">${b.description || ""}</div>
      </div>
      <div class="controls">
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" ${b.toggledConnected ? "checked":""} data-toggle="${b.id}"/> Connected
        </label>
        <button data-del="${b.id}" style="background:#2b1520">Delete</button>
      </div>
    `;
    el.querySelector("[data-del]").onclick = (ev) => {
      ev.stopPropagation();
      socket.emit("bot:remove", el.querySelector("[data-del]").dataset.del);
      if (currentBotId === el.querySelector("[data-del]").dataset.del) hideBotPanel();
    };
    el.querySelector("[data-toggle]").onchange = (ev) => {
      ev.stopPropagation();
      socket.emit("bot:toggle", { id: ev.target.dataset.toggle, on: ev.target.checked });
    };
    el.onclick = () => {
      const id = el.querySelector("[data-del]").dataset.del;
      currentBotId = id;
      $("#botPanel").style.display = "grid";
    };
    cont.appendChild(el);
  });
  // if no bot selected, ensure panel hidden
  if (!currentBotId) hideBotPanel();
});

// when server tells a bot was removed
socket.on("bot:removed", id => {
  if (currentBotId === id) hideBotPanel();
});

// telemetry and inventory
socket.on("bot:telemetry", ({ id, status, inventory }) => {
  if (id !== currentBotId) return;
  $("#stUptime").textContent = dur(status.uptime);
  $("#stDim").textContent = status.dim || "—";
  $("#stPos").textContent = status.pos ? fmtPos(status.pos) : "—";
  $("#stHH").textContent = `${status.health ?? "—"} / ${status.hunger ?? "—"}`;
  $("#stXP").textContent = status.xp ?? "—";
  $("#stYawPitch").textContent = `${((status.yaw ?? 0)*(180/Math.PI)).toFixed(1)}° / ${((status.pitch ?? 0)*(180/Math.PI)).toFixed(1)}°`;
  $("#stFx").textContent = (status.effects || []).map(e=>`${e.type}(${e.amp})`).join(", ") || "—";
  $("#stLooking").textContent = status.looking?.block ? `${status.looking.block.name} @ ${status.looking.block.pos.x},${status.looking.block.pos.y},${status.looking.block.pos.z}` : (status.looking?.entity || "—");

  // inventory grid
  const grid = $("#invGrid"); grid.innerHTML = "";
  (inventory.slots || []).forEach((it, i) => {
    const d = document.createElement("div");
    d.className = "slot";
    d.title = it ? `${it.name} x${it.count}` : "(empty)";
    d.textContent = it ? fmtItem(it) : "";
    d.onclick = () => socket.emit("bot:holdSlot", { id: currentBotId, index: i });
    grid.appendChild(d);
  });
  // armor
  $$(".equip-slot").forEach(es => {
    const part = es.dataset.armor;
    const it = inventory.armor[part];
    es.textContent = it ? fmtItem(it) : part.toUpperCase();
    es.onclick = () => socket.emit("bot:unequipArmor", { id: currentBotId, part });
  });
  $("#mainHand").textContent = fmtItem(inventory.mainHand);
  $("#offHand").textContent = fmtItem(inventory.offHand);
});

// description (persisted in server memory)
$("#botDesc").onchange = () => {
  if (!currentBotId) return;
  socket.emit("bot:desc", { id: currentBotId, text: $("#botDesc").value });
};
socket.on("bot:description", ({ id, description }) => {
  if (id === currentBotId) $("#botDesc").value = description || "";
});

// chat
$("#chatSend").onclick = () => {
  if (!currentBotId) return;
  const txt = $("#chatInput").value.trim();
  if (!txt) return;
  socket.emit("bot:chat", { id: currentBotId, text: txt });
  $("#chatInput").value = "";
};
$("#btnRespawn").onclick = () => { if (!currentBotId) return; socket.emit("bot:respawn", currentBotId); };

// logs & active actions
socket.on("bot:activeActions", ({ id, actions }) => {
  if (id !== currentBotId) return;
  const cont = $("#activeActions"); cont.innerHTML = "";
  (actions || []).forEach(a => {
    const chip = document.createElement("div"); chip.className = "chip"; chip.textContent = `${a.action} • ${a.mode}`;
    cont.appendChild(chip);
  });
});
socket.on("bot:log", ({ id, line }) => {
  if (id !== currentBotId) return;
  const p = $("#debugLog"); p.textContent += line + "\n"; p.scrollTop = p.scrollHeight;
});
socket.on("bot:chat", ({ id, line }) => {
  if (id !== currentBotId) return;
  const p = $("#debugLog"); p.textContent += "[CHAT] " + line + "\n"; p.scrollTop = p.scrollHeight;
});

// swap hands (guarded)
$("#swapHands").onclick = () => {
  if (!currentBotId) return;
  socket.emit("bot:swapHands", currentBotId);
};

// Movement modes
let mvMode = "press";
$("#mvMode").onchange = e => mvMode = e.target.value;
let continuousState = { W:false, A:false, S:false, D:false };

$$(".wasd button").forEach(b => {
  b.onmousedown = () => handleMove(b.dataset.mv, true);
  b.onmouseup = () => handleMove(b.dataset.mv, false);
  b.onmouseleave = () => handleMove(b.dataset.mv, false);
});
function handleMove(dir, down) {
  if (!currentBotId) return;
  if (mvMode === "press") {
    socket.emit("bot:moveContinuous", { id: currentBotId, dir, on: down });
  } else if (mvMode === "blocks") {
    if (!down) return;
    const blocks = parseInt($("#mvBlocks").value || "5", 10);
    socket.emit("bot:moveBlocks", { id: currentBotId, dir, blocks });
  } else if (mvMode === "continuous") {
    if (down) {
      continuousState[dir] = !continuousState[dir];
      socket.emit("bot:moveContinuous", { id: currentBotId, dir, on: continuousState[dir] });
    }
  }
}
$("#mvStop").onclick = () => { if (!currentBotId) return; socket.emit("bot:stopPath", currentBotId); };
$("#mvJump").onclick = () => { if (!currentBotId) return; socket.emit("bot:jumpOnce", currentBotId); };
$("#mvSneak").onclick = () => { if (!currentBotId) return; socket.emit("bot:toggleSneak", currentBotId); };

// goto & stop path
$("#gotoBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#gotoX").value), y = Number($("#gotoY").value), z = Number($("#gotoZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) socket.emit("bot:gotoXYZ", { id: currentBotId, x, y, z });
};
$("#stopGotoBtn").onclick = () => { if (!currentBotId) return; socket.emit("bot:stopPath", currentBotId); };

// looking controls
$$(".plus button").forEach(b => {
  b.onclick = () => {
    if (!currentBotId) return;
    const step = Number($("#rotStep").value || "15");
    const map = { up:[0,-step], down:[0,step], left:[-step,0], right:[step,0] };
    const [dyaw, dpitch] = map[b.dataset.rot];
    socket.emit("bot:rotateStep", { id: currentBotId, dyaw, dpitch });
  };
});
$("#setAngles").onclick = () => {
  if (!currentBotId) return;
  const yaw = Number($("#yawSet").value), pitch = Number($("#pitchSet").value);
  if (Number.isFinite(yaw) && Number.isFinite(pitch)) socket.emit("bot:lookAngles", { id: currentBotId, yaw, pitch });
};
$("#lookBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#lookX").value), y = Number($("#lookY").value), z = Number($("#lookZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) socket.emit("bot:lookAt", { id: currentBotId, x, y, z });
};

// actions panel -> Mine, Attack, Place, Eat, Drop
$$(".action .apply").forEach(btn => {
  btn.onclick = () => {
    if (!currentBotId) return;
    const root = btn.closest(".action");
    const action = root.dataset.action;
    const mode = root.querySelector(".mode").value;
    const gt = Number(root.querySelector(".gt").value || "10");
    const dropStack = !!root.querySelector(".dropStack")?.checked;
    socket.emit("bot:setAction", { id: currentBotId, action, mode, intervalGt: gt, dropStack });
  };
});

// tweaks
function sendTweaks() {
  if (!currentBotId) return;
  const toggles = {
    autoReconnect: $("#twAutoReconnect").checked,
    autoRespawn: $("#twAutoRespawn").checked,
    autoSprint: $("#twAutoSprint").checked,
    autoSleep: $("#twAutoSleep").checked,
    autoEat: $("#twAutoEat").checked,
    followPlayer: $("#twFollowPlayer").value.trim() || null
  };
  socket.emit("bot:setTweaks", { id: currentBotId, toggles });
  socket.emit("bot:autoSleep", { id: currentBotId, on: toggles.autoSleep });
}
["#twAutoReconnect","#twAutoRespawn","#twAutoSprint","#twAutoSleep","#twAutoEat","#twFollowPlayer"].forEach(sel => {
  const el = $(sel); if (el) el.onchange = sendTweaks;
});
