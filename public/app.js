const socket = io();
let currentBotId = null;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function fmtPos(p) { return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : "—"; }
function dur(ms) { if (!ms) return "—"; const s = Math.floor(ms/1000); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60; return `${h}h ${m}m ${sec}s`; }
function fmtItem(it) { if (!it) return "(empty)"; let s = `${it.name} x${it.count}`; if (it.enchants?.length) s += ` ✨`; if (it.durability !== null) s += ` (Dur ${it.durability})`; return s; }

// hide panel until a bot is selected
$("#botPanel").style.display = "none";

socket.on("server:status", s => {
  $("#svOnline").textContent = s.online ? "Online" : "Offline";
  $("#svOnline").className = "badge " + (s.online ? "on" : "off");
  $("#svAddr").textContent = `${s.host}:${s.port}`;
  $("#svVersion").textContent = s.version || "";
  $("#svUptime").textContent = s.uptime || "";
  $("#svMotd").textContent = s.motd || "";
  const cont = $("#svPlayers"); cont.innerHTML = "";
  (s.players.sample || []).forEach(p => {
    const el = document.createElement("div"); el.className = "av";
    el.innerHTML = `<img src="${p.headUrl}"/> <span>${p.name}</span>`;
    cont.appendChild(el);
  });
});

// BOT LIST
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
        <div class="desc small">${b.description||""}</div>
      </div>
      <div class="controls">
        <label><input type="checkbox" ${b.toggledConnected ? "checked":""} data-toggle="${b.id}"/>Connected</label>
        <button data-remove="${b.id}">Delete</button>
      </div>
    `;
    el.onclick = (ev) => {
      if (ev.target.dataset.toggle || ev.target.dataset.remove) return;
      currentBotId = b.id;
      $("#botPanel").style.display = "grid";
      $("#botDesc").value = b.description || "";
      if (b.tweaks) {
        $("#twAutoReconnect").checked = !!b.tweaks.autoReconnect;
        $("#twAutoRespawn").checked = !!b.tweaks.autoRespawn;
        $("#twAutoSprint").checked = !!b.tweaks.autoSprint;
        $("#twAutoEat").checked = !!b.tweaks.autoEat;
        $("#twAutoMinePlace").checked = !!b.tweaks.autoMinePlace;
        $("#twAutoSleep").checked = !!b.tweaks.autoSleep;
        $("#twFollowToggle").checked = !!b.tweaks.followPlayer;
        $("#twFollowPlayer").value = b.tweaks.followPlayer || "";
        $("#twFollowPlayer").disabled = !$("#twFollowToggle").checked;
      }
    };
    cont.appendChild(el);
  });

  cont.querySelectorAll("[data-remove]").forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.remove;
      socket.emit("bot:remove", id);
      if (currentBotId === id) { currentBotId = null; $("#botPanel").style.display = "none"; }
    };
  });
  cont.querySelectorAll("[data-toggle]").forEach(cb => {
    cb.onchange = (ev) => {
      ev.stopPropagation();
      socket.emit("bot:toggle", { id: ev.target.dataset.toggle, on: ev.target.checked });
    };
  });
});

// add bot
$("#addBot").onclick = () => {
  const name = $("#botName").value.trim();
  if (!name) return alert("Enter bot username");
  socket.emit("bot:add", { name });
  $("#botName").value = "";
};

// telemetry & inventory
socket.on("bot:telemetry", ({ id, status, inventory }) => {
  if (id !== currentBotId) return;
  $("#stUptime").textContent = dur(status.uptime);
  $("#stDim").textContent = status.dim || "—";
  $("#stPos").textContent = status.pos ? fmtPos(status.pos) : "—";
  $("#stHH").textContent = `${status.health ?? "—"} / ${status.hunger ?? "—"}`;
  $("#stXP").textContent = status.xp ?? "—";
  $("#stYawPitch").textContent = `${((status.yaw||0)*(180/Math.PI)).toFixed(1)}° / ${((status.pitch||0)*(180/Math.PI)).toFixed(1)}°`;
  $("#stFx").textContent = (status.effects || []).map(e => `${e.type}(${e.amp})`).join(", ") || "—";
  $("#stLooking").textContent = status.looking?.block ? `${status.looking.block.name} @ ${fmtPos(status.looking.block.pos)}` : (status.looking?.entity || "—");

  const grid = $("#invGrid"); grid.innerHTML = "";
  (inventory.slots || []).forEach((it, i) => {
    const d = document.createElement("div");
    d.className = "slot";
    d.title = it ? `${it.name} x${it.count}` : "(empty)";
    d.textContent = it ? fmtItem(it) : "";
    d.onclick = () => {
      if (!currentBotId) return;
      const hand = $("#selectedHand").value === "off" ? "off" : "main";
      socket.emit("bot:equipSlot", { id: currentBotId, index: i, hand });
    };
    grid.appendChild(d);
  });

  $$(".equip-slot").forEach(es => {
    const k = es.dataset.armor;
    const it = (inventory.armor || {})[k];
    es.textContent = it ? fmtItem(it) : k.toUpperCase();
    es.onclick = () => socket.emit("bot:unequipArmor", { id: currentBotId, part: k });
  });
  $("#mainHand").textContent = fmtItem(inventory.mainHand);
  $("#offHand").textContent = fmtItem(inventory.offHand);
});

// description persist
$("#botDesc").onchange = () => {
  if (!currentBotId) return;
  socket.emit("bot:desc", { id: currentBotId, text: $("#botDesc").value });
};
socket.on("bot:description", ({ id, description }) => {
  if (id === currentBotId) $("#botDesc").value = description || "";
});

// chat & respawn
$("#chatSend").onclick = () => {
  if (!currentBotId) return;
  const text = $("#chatInput").value.trim();
  if (!text) return;
  socket.emit("bot:chat", { id: currentBotId, text });
  $("#chatInput").value = "";
};
$("#btnRespawn").onclick = () => currentBotId && socket.emit("bot:respawn", currentBotId);

// logs & active actions
socket.on("bot:activeActions", ({ id, actions }) => {
  if (id !== currentBotId) return;
  const cont = $("#activeActions"); cont.innerHTML = "";
  (actions || []).forEach(a => { const c = document.createElement("div"); c.className = "chip"; c.textContent = `${a.action} • ${a.mode}`; cont.appendChild(c); });
});
socket.on("bot:log", ({ id, line }) => { if (id !== currentBotId) return; const pre = $("#debugLog"); pre.textContent += line + "\n"; pre.scrollTop = pre.scrollHeight; });
socket.on("bot:chat", ({ id, line }) => { if (id !== currentBotId) return; const pre = $("#debugLog"); pre.textContent += "[CHAT] " + line + "\n"; pre.scrollTop = pre.scrollHeight; });

// Movement
let mvMode = "press";
$("#mvMode").onchange = e => mvMode = e.target.value;
let contState = { W:false, A:false, S:false, D:false };

$$(".wasd button").forEach(btn => {
  btn.onmousedown = () => {
    if (!currentBotId) return;
    const dir = btn.dataset.mv;
    if (mvMode === "press") {
      socket.emit("bot:moveContinuous", { id: currentBotId, dir, on: true });
    } else {
      contState[dir] = !contState[dir];
      socket.emit("bot:moveContinuous", { id: currentBotId, dir, on: contState[dir] });
    }
  };
  btn.onmouseup = () => {
    if (!currentBotId) return;
    if (mvMode === "press") socket.emit("bot:moveContinuous", { id: currentBotId, dir: btn.dataset.mv, on: false });
  };
  btn.onmouseleave = btn.onmouseup;
});

$("#mvStop").onclick = () => {
  if (!currentBotId) return;
  socket.emit("bot:stopPath", currentBotId);
  ["W","A","S","D"].forEach(d => socket.emit("bot:moveContinuous", { id: currentBotId, dir: d, on: false }));
};
$("#mvJump").onclick = () => currentBotId && socket.emit("bot:jumpOnce", currentBotId);
$("#mvSneak").onclick = () => currentBotId && socket.emit("bot:toggleSneak", currentBotId);

// pathfinding
$("#gotoBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#gotoX").value), y = Number($("#gotoY").value), z = Number($("#gotoZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) socket.emit("bot:gotoXYZ", { id: currentBotId, x, y, z });
};
$("#stopGotoBtn").onclick = () => currentBotId && socket.emit("bot:stopPath", currentBotId);

// Looking
$$(".plus button").forEach(b => b.onclick = () => {
  if (!currentBotId) return;
  const step = Number($("#rotStep").value || "15");
  const map = { up:[0,-step], down:[0,step], left:[-step,0], right:[step,0] };
  const [dyaw, dpitch] = map[b.dataset.rot];
  socket.emit("bot:rotateStep", { id: currentBotId, dyaw, dpitch });
});
$("#setAngles").onclick = () => { if (!currentBotId) return; const yaw = Number($("#yawSet").value), pitch = Number($("#pitchSet").value); if (Number.isFinite(yaw) && Number.isFinite(pitch)) socket.emit("bot:lookAngles", { id: currentBotId, yaw, pitch }); };
$("#lookBtn").onclick = () => { if (!currentBotId) return; const x = Number($("#lookX").value), y = Number($("#lookY").value), z = Number($("#lookZ").value); if (Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)) socket.emit("bot:lookAt", { id: currentBotId, x, y, z }); };

// Actions
$$(".action .apply").forEach(btn => btn.onclick = () => {
  if (!currentBotId) return;
  const root = btn.closest(".action");
  const action = root.dataset.action;
  const mode = root.querySelector(".mode").value;
  const gt = Number(root.querySelector(".gt").value || "10");
  const dropStack = !!root.querySelector(".dropStack")?.checked;
  socket.emit("bot:setAction", { id: currentBotId, action, mode, intervalGt: gt, dropStack });
});

// Misc toggles
$("#twFollowToggle").onchange = (ev) => {
  $("#twFollowPlayer").disabled = !ev.target.checked;
  sendTweaks();
};
function sendTweaks() {
  if (!currentBotId) return;
  const toggles = {
    autoReconnect: !!$("#twAutoReconnect").checked,
    autoRespawn: !!$("#twAutoRespawn").checked,
    autoSprint: !!$("#twAutoSprint").checked,
    autoEat: !!$("#twAutoEat").checked,
    autoMinePlace: !!$("#twAutoMinePlace").checked,
    autoSleep: !!$("#twAutoSleep").checked,
    followPlayer: $("#twFollowToggle").checked ? ($("#twFollowPlayer").value.trim() || null) : null
  };
  socket.emit("bot:setTweaks", { id: currentBotId, toggles });
}
["#twAutoReconnect","#twAutoRespawn","#twAutoSprint","#twAutoEat","#twAutoMinePlace","#twAutoSleep","#twFollowPlayer"].forEach(sel => {
  const el = $(sel); if (el) el.onchange = sendTweaks;
});
