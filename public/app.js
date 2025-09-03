const socket = io();
let currentBotId = null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function humanPos(p){ return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : "—"; }
function dur(ms){ if(!ms) return "—"; const s=Math.floor(ms/1000); const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); const sec=s%60; return `${h}h ${m}m ${sec}s`; }
function fmtItem(it){ if(!it) return "(empty)"; let t = `${it.name} x${it.count}`; if(it.enchants?.length) t += ` ✨${it.enchants.join(",")}`; if(it.durability!==null) t += ` (Dur:${it.durability})`; return t; }

// hide panel initially
$("#botPanel").style.display = "none";

// server status (single online players list)
socket.on("server:status", s => {
  $("#svOnline").textContent = s.online ? "Online" : "Offline";
  $("#svOnline").className = "badge " + (s.online ? "on" : "off");
  $("#svAddr").textContent = `${s.host}:${s.port}`;
  $("#svVersion").textContent = s.version ? `• ${s.version}` : "";
  $("#svUptime").textContent = s.uptime ? `• Uptime ${s.uptime}` : "";
  $("#svMotd").textContent = s.motd || "";
  const players = $("#svPlayers"); players.innerHTML = "";
  (s.players.sample || []).forEach(p => {
    const el = document.createElement("div"); el.className = "av";
    el.innerHTML = `<img src="${p.headUrl}"/> <span>${p.name}</span>`;
    players.appendChild(el);
  });
});

// bot list
socket.on("bot:list", list => {
  const cont = $("#botList"); cont.innerHTML = "";
  list.forEach(b => {
    const el = document.createElement("div");
    el.className = "bot";
    el.innerHTML = `<img src="${b.headUrl}"/><div><div class="name">${b.name}</div><div class="status">${b.online ? "Online":"Offline"}</div><div class="desc small">${b.description||""}</div></div>
    <div class="controls">
      <label><input type="checkbox" ${b.toggledConnected ? "checked":""} data-toggle="${b.id}"/>Connected</label>
      <button data-remove="${b.id}">Delete</button>
    </div>`;
    el.onclick = (ev) => {
      // ignore clicks on controls
      if (ev.target.dataset.toggle || ev.target.dataset.remove) return;
      // open only when clicking card
      currentBotId = b.id;
      $("#botPanel").style.display = "grid";
      // request latest telemetry/description will arrive via events; but we set description input now
      $("#botDesc").value = b.description || "";
    };
    cont.appendChild(el);
  });

  // wire controls
  cont.querySelectorAll("[data-remove]").forEach(btn => btn.onclick = () => {
    const id = btn.dataset.remove;
    socket.emit("bot:remove", id);
    if (currentBotId === id) { currentBotId = null; $("#botPanel").style.display = "none"; }
  });
  cont.querySelectorAll("[data-toggle]").forEach(cb => cb.onchange = () => socket.emit("bot:toggle", { id: cb.dataset.toggle, on: cb.checked }));
});

// clear UI when bot removed (extra)
socket.on("bot:removed", ({ id }) => { if (currentBotId === id) { currentBotId = null; $("#botPanel").style.display = "none"; } });

// add bot: cracked-only now
$("#addBot").onclick = () => {
  const name = $("#botName").value.trim();
  if (!name) return alert("Enter username");
  socket.emit("bot:add", { name }); // server will generate id and force offline
  $("#botName").value = "";
};

// telemetry updates
socket.on("bot:telemetry", ({ id, status, inventory }) => {
  if (id !== currentBotId) return;
  $("#stUptime").textContent = dur(status.uptime);
  $("#stDim").textContent = status.dim || "—";
  $("#stPos").textContent = humanPos(status.pos);
  $("#stHH").textContent = `${status.health ?? "—"} / ${status.hunger ?? "—"}`;
  $("#stXP").textContent = status.xp ?? "—";
  $("#stYawPitch").textContent = `${(status.yaw*180/Math.PI).toFixed(1)}° / ${(status.pitch*180/Math.PI).toFixed(1)}°`;
  $("#stFx").textContent = (status.effects||[]).map(e=>`${e.type}(${e.amp})`).join(", ") || "—";
  const look = status.looking;
  $("#stLooking").textContent = look?.entity ? `Entity: ${look.entity}` : (look?.block ? `Block: ${look.block.name} @ ${humanPos(look.block.pos)}` : "—");

  // inventory render
  const grid = $("#invGrid"); grid.innerHTML = "";
  (inventory.slots || []).forEach((it,i)=>{
    const d = document.createElement("div"); d.className = "slot";
    d.title = it ? `${it.name} x${it.count}` : "(empty)";
    d.textContent = it ? fmtItem(it) : "(empty)";
    d.onclick = () => socket.emit("bot:holdSlot", { id: currentBotId, index: i });
    grid.appendChild(d);
  });
  $("#mainHand").textContent = fmtItem(inventory.mainHand);
  $("#offHand").textContent = fmtItem(inventory.offHand);
  $$(".equip-slot").forEach(es => {
    const key = es.dataset.armor;
    const it = (inventory.armor||{})[key];
    es.textContent = it ? fmtItem(it) : key.toUpperCase();
    es.onclick = () => socket.emit("bot:unequipArmor", { id: currentBotId, part: key });
  });
});

// description persistent
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
  const t = $("#chatInput").value.trim(); if (!t) return;
  socket.emit("bot:chat", { id: currentBotId, text: t });
  $("#chatInput").value = "";
};
$("#btnRespawn").onclick = () => currentBotId && socket.emit("bot:respawn", currentBotId);

// active actions and logs
socket.on("bot:activeActions", ({ id, actions }) => {
  if (id !== currentBotId) return;
  const c = $("#activeActions"); c.innerHTML = "";
  (actions || []).forEach(a => { const el = document.createElement("div"); el.className="chip"; el.textContent=`${a.action} • ${a.mode}`; c.appendChild(el); });
});
socket.on("bot:log", ({ id, line }) => { if (id !== currentBotId) return; const p = $("#debugLog"); p.textContent += line + "\n"; p.scrollTop = p.scrollHeight; });
socket.on("bot:chat", ({ id, line }) => { if (id !== currentBotId) return; const p = $("#debugLog"); p.textContent += "[CHAT] " + line + "\n"; p.scrollTop = p.scrollHeight; });

// swap hands
$("#swapHands").onclick = () => { if (!currentBotId) return; socket.emit("bot:swapHands", currentBotId); };

// Movement controls
let mvMode = "press"; $("#mvMode").onchange = e => mvMode = e.target.value;
let continuousHeld = { W:false,A:false,S:false,D:false };

$$(".wasd button").forEach(btn => {
  btn.onmousedown = () => {
    if (!currentBotId) return;
    const dir = btn.dataset.mv;
    if (mvMode === "press") socket.emit("bot:moveContinuous", { id: currentBotId, dir, on: true });
    else if (mvMode === "blocks") { const blocks = parseInt($("#mvBlocks").value||"5",10); socket.emit("bot:moveBlocks", { id: currentBotId, dir, blocks }); }
    else if (mvMode === "continuous") { continuousHeld[dir] = !continuousHeld[dir]; socket.emit("bot:moveContinuous", { id: currentBotId, dir, on: continuousHeld[dir] }); }
  };
  btn.onmouseup = () => { if (!currentBotId) return; if (mvMode === "press") socket.emit("bot:moveContinuous", { id: currentBotId, dir: btn.dataset.mv, on: false }); };
  btn.onmouseleave = btn.onmouseup;
});

$("#mvStop").onclick = () => { if (!currentBotId) return; socket.emit("bot:stopPath", currentBotId); ["W","A","S","D"].forEach(d=>socket.emit("bot:moveContinuous",{id:currentBotId,dir:d,on:false})); };
$("#mvJump").onclick = () => currentBotId && socket.emit("bot:jumpOnce", currentBotId);
$("#mvSneak").onclick = () => currentBotId && socket.emit("bot:toggleSneak", currentBotId);

$("#gotoBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#gotoX").value), y = Number($("#gotoY").value), z = Number($("#gotoZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) socket.emit("bot:gotoXYZ", { id: currentBotId, x, y, z });
};
$("#stopGotoBtn").onclick = () => currentBotId && socket.emit("bot:stopPath", currentBotId);

// Look controls
$$(".plus button").forEach(btn => btn.onclick = () => {
  if (!currentBotId) return;
  const step = Number($("#rotStep").value||"15");
  const map = { up:[0,-step], down:[0,step], left:[-step,0], right:[step,0] };
  const [dyaw, dpitch] = map[btn.dataset.rot];
  socket.emit("bot:rotateStep", { id: currentBotId, dyaw, dpitch });
});
$("#setAngles").onclick = () => { if (!currentBotId) return; const yaw=Number($("#yawSet").value), pitch=Number($("#pitchSet").value); if (Number.isFinite(yaw)&&Number.isFinite(pitch)) socket.emit("bot:lookAngles",{id:currentBotId,yaw,pitch}); };
$("#lookBtn").onclick = () => { if (!currentBotId) return; const x=Number($("#lookX").value), y=Number($("#lookY").value), z=Number($("#lookZ").value); if (Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)) socket.emit("bot:lookAt",{id:currentBotId,x,y,z}); };

// Actions
$$(".action .apply").forEach(btn => {
  btn.onclick = () => {
    if (!currentBotId) return;
    const root = btn.closest(".action");
    const action = root.dataset.action;
    const mode = root.querySelector(".mode").value;
    const gt = Number(root.querySelector(".gt").value||"10");
    const dropStack = root.querySelector(".dropStack")?.checked || false;
    socket.emit("bot:setAction", { id: currentBotId, action, mode, intervalGt: gt, dropStack });
  };
});

// Tweaks
function sendTweaks() {
  if (!currentBotId) return;
  socket.emit("bot:setTweaks", {
    id: currentBotId,
    toggles: {
      autoReconnect: $("#twAutoReconnect").checked,
      autoRespawn: $("#twAutoRespawn").checked,
      autoSprint: $("#twAutoSprint").checked,
      autoEat: $("#twAutoEat").checked,
      autoMinePlace: $("#twAutoMinePlace").checked,
      autoSleep: $("#twAutoSleep").checked,
      followPlayer: $("#twFollowPlayer").value.trim() || null
    }
  });
}
["#twAutoReconnect","#twAutoRespawn","#twAutoSprint","#twAutoEat","#twAutoMinePlace","#twAutoSleep","#twFollowPlayer"].forEach(sel => { const el=$(sel); if (el) el.onchange = sendTweaks; });
