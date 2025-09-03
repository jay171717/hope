const ioClient = io();
let currentBotId = null;
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function humanPos(p) { return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : "—"; }
function dur(ms) {
  if (!ms) return "—";
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return `${h}h ${m}m ${sec}s`;
}

// ---------- Server status ----------
ioClient.on("server:status", s => {
  $("#svOnline").textContent = s.online ? "Online" : "Offline";
  $("#svOnline").className = "badge " + (s.online ? "on" : "off");
  $("#svAddr").textContent = `${s.host}:${s.port}`;
  $("#svVersion").textContent = s.version ? `• ${s.version}` : "";
  $("#svUptime").textContent = s.uptime ? `• Uptime ${s.uptime}` : "";
  $("#svMotd").textContent = s.motd || "";

  // non-bot players
  const playersCont = $("#svPlayers"); playersCont.innerHTML = "";
  s.players.sample.forEach(p => {
    const el = document.createElement("div");
    el.className = "av";
    el.innerHTML = `<img src="${p.headUrl}" alt=""/> <span>${p.name}</span>`;
    playersCont.appendChild(el);
  });

  // bots
  const botCont = $("#botPlayers"); botCont.innerHTML = "";
  (s.bots || []).forEach(p => {
    const el = document.createElement("div");
    el.className = "av";
    el.innerHTML = `<img src="${p.headUrl}" alt=""/> <span>${p.name}</span>`;
    botCont.appendChild(el);
  });
});

// ---------- Add bot ----------
$("#addBot").onclick = () => {
  const name = $("#botName").value.trim();
  const auth = $("#botAuth").value;
  if (!name) return alert("Enter a bot username");
  ioClient.emit("bot:add", { name, auth });
  $("#botName").value = "";
};

ioClient.on("bot:list", list => {
  const cont = $("#botList"); cont.innerHTML = "";
  list.forEach(b => {
    const el = document.createElement("div");
    el.className = "bot";
    el.innerHTML = `
      <img src="${b.headUrl}" alt=""/>
      <div>
        <div class="name">${b.name}</div>
        <div class="status">${b.online ? "Online" : "Offline"}</div>
      </div>
      <div class="controls">
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" ${b.toggledConnected ? "checked":""} data-toggle="${b.id}"/> Connected
        </label>
        <button data-del="${b.id}" style="background:#2b1520">Delete</button>
      </div>
    `;
    el.onclick = e => {
      if (e.target.dataset.del || e.target.dataset.toggle !== undefined) return;
      openBot(b.id);
    };
    cont.appendChild(el);
  });

  cont.querySelectorAll("[data-del]").forEach(btn =>
    btn.onclick = () => {
      ioClient.emit("bot:remove", btn.dataset.del);
      if (currentBotId === btn.dataset.del) {
        currentBotId = null;
        $("#botPanel").style.display = "none";
      }
    }
  );
  cont.querySelectorAll("[data-toggle]").forEach(cb =>
    cb.onchange = () => ioClient.emit("bot:toggle", { id: cb.dataset.toggle, on: cb.checked })
  );
});

function openBot(id) {
  currentBotId = id;
  $("#botPanel").style.display = "grid";
}

// ---------- Status/telemetry ----------
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

  // Inventory grid (36)
  const grid = $("#invGrid"); grid.innerHTML = "";
  inventory.slots.forEach((it, i) => {
    const el = document.createElement("div");
    el.className = "slot";
    el.title = it ? `${it.name} x${it.count}` : "(empty)";
    el.textContent = it ? `${it.name} x${it.count}` : "";
    el.onclick = () => ioClient.emit("bot:holdSlot", { id: currentBotId, index: i });
    grid.appendChild(el);
  });
  // Armor
  $$(".equip-slot").forEach(es => {
    const k = es.dataset.armor;
    const it = inventory.armor[k];
    es.title = it ? `${it.name}` : "(empty)";
    es.textContent = it ? `${it.name}` : k.toUpperCase();
    es.onclick = () => ioClient.emit("bot:unequipArmor", { id: currentBotId, part: k });
  });
  // Hands
  $("#mainHand").textContent = inventory.mainHand
    ? `${inventory.mainHand.name} x${inventory.mainHand.count}${inventory.mainHand.durability ? ` (Dur ${inventory.mainHand.durability})`:""}`
    : "";
  $("#offHand").textContent = inventory.offHand
    ? `${inventory.offHand.name} x${inventory.offHand.count}${inventory.offHand.durability ? ` (Dur ${inventory.offHand.durability})`:""}`
    : "";
});

// Description
$("#botDesc").addEventListener("change", e => {
  if (!currentBotId) return;
  ioClient.emit("bot:desc", { id: currentBotId, text: e.target.value });
});
ioClient.on("bot:description", ({ id, description }) => {
  if (id === currentBotId) $("#botDesc").value = description || "";
});

// Chat/respawn
$("#chatSend").onclick = () => {
  if (!currentBotId) return;
  const text = $("#chatInput").value.trim();
  if (!text) return;
  ioClient.emit("bot:chat", { id: currentBotId, text });
  $("#chatInput").value = "";
};
$("#btnRespawn").onclick = () => currentBotId && ioClient.emit("bot:respawn", currentBotId);

// Active actions + log
ioClient.on("bot:activeActions", ({ id, actions }) => {
  if (id !== currentBotId) return;
  const cont = $("#activeActions"); cont.innerHTML = "";
  actions.forEach(a => {
    const c = document.createElement("div");
    c.className = "chip";
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

// Swap hands
$("#swapHands").onclick = () => currentBotId && ioClient.emit("bot:swapHands", currentBotId);

// Movement controls
let mvMode = "press";
$("#mvMode").onchange = e => mvMode = e.target.value;

let mvHeld = { W:false, A:false, S:false, D:false };
$$(".wasd button").forEach(btn => {
  btn.onmousedown = () => handleMove(btn.dataset.mv, true);
  btn.onmouseup = () => handleMove(btn.dataset.mv, false);
  btn.onmouseleave = () => handleMove(btn.dataset.mv, false);
});
function handleMove(dir, on) {
  if (!currentBotId) return;
  if (mvMode === "press") {
    ioClient.emit("bot:moveContinuous", { id: currentBotId, dir, on });
  } else if (mvMode === "blocks" && on) {
    const blocks = parseInt($("#mvBlocks").value||"5",10);
    ioClient.emit("bot:moveBlocks", { id: currentBotId, dir, blocks });
  } else if (mvMode === "continuous" && on) {
    ioClient.emit("bot:moveContinuous", { id: currentBotId, dir, on:true });
  }
}
$("#mvStop").onclick = () => {
  if (!currentBotId) return;
  ["W","A","S","D"].forEach(d => ioClient.emit("bot:moveContinuous", { id: currentBotId, dir:d, on:false }));
};
$("#mvJump").onclick = () => currentBotId && ioClient.emit("bot:jumpOnce", currentBotId);
$("#mvSneak").onclick = () => currentBotId && ioClient.emit("bot:toggleSneak", currentBotId);

// Goto XYZ
$("#gotoBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#gotoX").value), y = Number($("#gotoY").value), z = Number($("#gotoZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    ioClient.emit("bot:gotoXYZ", { id: currentBotId, x, y, z });
  }
};
$("#stopGotoBtn").onclick = () => currentBotId && ioClient.emit("bot:stopPath", currentBotId);

// Looking
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
  if (Number.isFinite(yaw) && Number.isFinite(pitch))
    ioClient.emit("bot:lookAngles", { id: currentBotId, yaw, pitch });
};
$("#lookBtn").onclick = () => {
  if (!currentBotId) return;
  const x = Number($("#lookX").value), y = Number($("#lookY").value), z = Number($("#lookZ").value);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))
    ioClient.emit("bot:lookAt", { id: currentBotId, x, y, z });
};

// Actions panel
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

// Tweaks
function sendTweaks() {
  if (!currentBotId) return;
  ioClient.emit("bot:setTweaks", {
    id: currentBotId,
    toggles: {
      autoReconnect: $("#twAutoReconnect").checked,
      autoRespawn: $("#twAutoRespawn").checked,
      autoSprint: $("#twAutoSprint").checked,
      autoEat: $("#twAutoEat").checked,
      followPlayer: $("#twFollowPlayer").value.trim() || null
    }
  });
  ioClient.emit("bot:autoSleep", { id: currentBotId, on: $("#twAutoSleep").checked });
}
$("#twAutoReconnect").onchange = sendTweaks;
$("#twAutoRespawn").onchange = sendTweaks;
$("#twAutoSprint").onchange = sendTweaks;
$("#twAutoSleep").onchange = sendTweaks;
$("#twAutoEat").onchange = sendTweaks;
$("#twFollowPlayer").onchange = sendTweaks;
