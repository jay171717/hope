import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
const { pathfinder, goals } = pathfinderPkg;
import mcdataFactory from "minecraft-data";
import { Vec3 } from "vec3";
import { ActionController } from "./actions.js";
import { formatDuration } from "./utils.js";

export class BotManager {
  constructor(io, serverHost, serverPort, fixedVersion, headBase) {
    this.io = io;
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.fixedVersion = fixedVersion || null;
    this.headBase = headBase;
    // bots: id -> entry
    // entry: { id, name, auth, bot, mcData, actions, toggledConnected, createdAt, lastSeen, description, tweaks, timers... }
    this.bots = new Map();
  }

  // public listing (includes description)
  list() {
    return [...this.bots.entries()].map(([id, e]) => ({
      id,
      name: e.name,
      online: !!e.bot && !!e.bot.player,
      toggledConnected: e.toggledConnected,
      description: e.description || "",
      headUrl: `${this.headBase}/${encodeURIComponent(e.name)}/32`,
      lastSeen: e.lastSeen || null,
      createdAt: e.createdAt || null
    }));
  }

  broadcastList() { this.io.emit("bot:list", this.list()); }

  // creates and returns id
  addBot({ name, auth = "offline" }) {
    const id = `${name.replace(/[^a-zA-Z0-9_-]/g,"_")}_${Date.now().toString(36)}`;
    const entry = {
      id, name, auth,
      bot: null, mcData: null, actions: null,
      toggledConnected: true,
      createdAt: Date.now(), lastSeen: null,
      description: "",
      tweaks: {
        autoReconnect: true,
        autoRespawn: true,
        autoSprint: false,
        autoEat: false,
        autoSleep: false,
        followPlayer: null
      },
      _timers: {}
    };
    this.bots.set(id, entry);
    this._spawn(entry);
    this.broadcastList();
    return this.list().find(b => b.id === id);
  }

  setDescription(id, text) {
    const e = this.bots.get(id); if (!e) return;
    e.description = String(text || "").slice(0,127);
    this.io.emit("bot:description", { id, description: e.description });
    this.broadcastList();
  }

  toggleConnection(id, shouldConnect) {
    const e = this.bots.get(id); if (!e) return;
    e.toggledConnected = !!shouldConnect;
    if (shouldConnect && !e.bot) this._spawn(e);
    if (!shouldConnect && e.bot) e.bot.end("User toggled disconnect");
    this.broadcastList();
  }

  removeBot(id) {
    const e = this.bots.get(id); if (!e) return;
    if (e.bot) try { e.bot.end("Deleted by user"); } catch {}
    // clear timers
    if (e._telemetryTimer) clearInterval(e._telemetryTimer);
    if (e._sleepTimer) clearInterval(e._sleepTimer);
    if (e._eatTimer) clearInterval(e._eatTimer);
    if (e._followTimer) clearInterval(e._followTimer);
    this.bots.delete(id);
    this.broadcastList();
    this.io.emit("bot:removed", id);
  }

  _spawn(entry) {
    if (!entry.toggledConnected) return;
    const bot = mineflayer.createBot({
      host: this.serverHost,
      port: this.serverPort,
      username: entry.name,
      auth: entry.auth || "offline",
      version: this.fixedVersion || false
    });

    entry.bot = bot;
    entry.actions = new ActionController(bot);

    // Action updates -> emit
    entry.actions.onUpdate(list => this.io.emit("bot:activeActions", { id: entry.id, actions: list }));

    // load pathfinder
    bot.loadPlugin(pathfinder);

    bot.once("spawn", () => {
      entry.lastSeen = Date.now();
      try { entry.mcData = mcdataFactory(bot.version); } catch { entry.mcData = null; }
      // telemetry
      this._wireTelemetry(entry);
      // apply tweaks that require immediate state
      if (entry.tweaks.autoSprint) bot.setControlState("sprint", true);
      this.io.emit("bot:status", { id: entry.id, status: "online" });
      this.broadcastList();
    });

    bot.on("end", () => {
      this.io.emit("bot:status", { id: entry.id, status: "offline" });
      entry.actions?.stopAll();
      entry.bot = null;
      // clear timers but keep tweak-config; on reconnect they will be reset
      if (entry._telemetryTimer) { clearInterval(entry._telemetryTimer); entry._telemetryTimer = null; }
      if (entry._sleepTimer) { clearInterval(entry._sleepTimer); entry._sleepTimer = null; }
      if (entry._eatTimer) { clearInterval(entry._eatTimer); entry._eatTimer = null; }
      if (entry._followTimer) { clearInterval(entry._followTimer); entry._followTimer = null; }

      // auto-reconnect respects tweak now
      if (entry.tweaks?.autoReconnect && entry.toggledConnected) {
        setTimeout(() => this._spawn(entry), 3000);
      }
      this.broadcastList();
    });

    bot.on("kicked", reason => this.io.emit("bot:log", { id: entry.id, line: `Kicked: ${reason}` }));
    bot.on("error", err => this.io.emit("bot:log", { id: entry.id, line: `Error: ${err?.message || err}` }));
    bot.on("messagestr", (msg) => this.io.emit("bot:chat", { id: entry.id, line: msg }));
    // death -> auto respawn if enabled
    bot.on("death", () => {
      this.io.emit("bot:log", { id: entry.id, line: "Bot died" });
      if (entry.tweaks?.autoRespawn) {
        setTimeout(() => { try { bot.respawn(); } catch {} }, 600);
      }
    });
  }

  _wireTelemetry(entry) {
    const bot = entry.bot;
    if (!bot) return;
    // telemetry emitter every second
    const send = () => {
      if (!entry.bot) return;
      const b = entry.bot;
      const ent = b.entity || {};
      // looking: block in cursor & nearest entity (by name)
      let lookingBlock = null;
      try { lookingBlock = b.blockAtCursor(5) || null; } catch {}
      let lookingEntity = null;
      try {
        const ne = b.nearestEntity();
        lookingEntity = ne ? (ne.name || (ne.username || ne.type)) : null;
      } catch {}
      const effects = [...(b.effects ? b.effects.values() : [])].map(e => ({
        type: e.type?.name || e.type || "effect",
        amp: e.amplifier,
        dur: e.duration
      }));
      const inv = this._serializeInventory(b);

      this.io.emit("bot:telemetry", {
        id: entry.id,
        status: {
          uptime: entry.lastSeen ? Date.now() - entry.lastSeen : null,
          dim: b.game?.dimension || "unknown",
          pos: ent?.position ? { x: ent.position.x, y: ent.position.y, z: ent.position.z } : null,
          health: b.health ?? null,
          hunger: b.food ?? null,
          xp: b.experience?.level ?? null,
          yaw: ent?.yaw ?? 0,
          pitch: ent?.pitch ?? 0,
          effects,
          looking: {
            block: lookingBlock ? { name: lookingBlock.name, pos: lookingBlock.position } : null,
            entity: lookingEntity || null
          }
        },
        inventory: inv
      });
    };

    entry._telemetryTimer = setInterval(send, 1000);
    send(); // immediate
  }

  _serializeInventory(b) {
    const inv = b.inventory;
    const rawSlots = Array.from({ length: 36 }, (_, i) => inv.slots[9 + i] || null);
    const armorSlots = {
      head: inv.slots[5] || null,
      chest: inv.slots[6] || null,
      legs: inv.slots[7] || null,
      feet: inv.slots[8] || null
    };
    const mainHand = b.heldItem || null;
    const offHand = inv.slots[45] || null;

    const toItem = it => it ? ({
      name: it.name,
      count: it.count,
      enchants: (it.nbt?.value?.Enchantments?.value?.value || []).map(e => e.id?.value || e.id),
      durability: (it.maxDurability !== undefined && it.durabilityUsed !== undefined)
        ? (it.maxDurability - it.durabilityUsed)
        : null
    }) : null;

    return {
      slots: rawSlots.map(toItem),
      armor: {
        head: toItem(armorSlots.head),
        chest: toItem(armorSlots.chest),
        legs: toItem(armorSlots.legs),
        feet: toItem(armorSlots.feet)
      },
      mainHand: toItem(mainHand),
      offHand: toItem(offHand)
    };
  }

  // ---------- Commands exposed to sockets ----------
  chat(id, text) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.chat(text); } catch {}
  }

  respawn(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.respawn(); } catch {}
  }

  async swapHands(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    try {
      if (!b.player) return;
      await b.swapHands();
    } catch (err) {
      this.io.emit("bot:log", { id, line: `swapHands failed: ${err?.message||err}` });
    }
  }

  holdInventorySlot(id, index) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    const slot = b.inventory.slots[9 + index];
    if (!slot) {
      // empty slot => hold nothing (unequip)
      b.unequip("hand").catch(()=>{});
      return;
    }
    b.equip(slot, "hand").catch(()=>{});
  }

  unequipArmor(id, part) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const mapping = { head: "head", chest: "torso", legs: "legs", feet: "feet" };
    e.bot.unequip(mapping[part]).catch(()=>{});
  }

  // Movement
  setContinuousMove(id, dir, on) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const map = { W: "forward", A: "left", S: "back", D: "right" };
    const key = map[dir]; if (!key) return;
    e.bot.setControlState(key, !!on);
  }

  jumpOnce(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    e.bot.setControlState('jump', true);
    setTimeout(() => e.bot.setControlState('jump', false), 200);
  }

  toggleSneak(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    const sneakNow = b.getControlState && b.getControlState('sneak');
    b.setControlState('sneak', !sneakNow);
  }

  moveBlocks(id, dir, blocks = 5) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    const pos = b.entity.position.clone();
    const yaw = b.entity.yaw;
    const forward = new Vec3(Math.cos(yaw), 0, Math.sin(yaw));
    const right = new Vec3(Math.cos(yaw + Math.PI/2), 0, Math.sin(yaw + Math.PI/2));
    let target = pos.clone();
    if (dir === "W") target = pos.plus(forward.scaled(blocks));
    if (dir === "S") target = pos.minus(forward.scaled(blocks));
    if (dir === "A") target = pos.minus(right.scaled(blocks));
    if (dir === "D") target = pos.plus(right.scaled(blocks));
    // Try exact target first
    try {
      b.pathfinder.setGoal(new goals.GoalBlock(Math.round(target.x), Math.round(target.y), Math.round(target.z)), false);
      // after 1.5s, if not moving, try same XZ at current Y (ignore Y)
      setTimeout(() => {
        try {
          if (!b.pathfinder.isMoving()) {
            b.pathfinder.setGoal(new goals.GoalBlock(Math.round(target.x), Math.round(b.entity.position.y), Math.round(target.z)), false);
          }
        } catch {}
      }, 1500);
    } catch (err) {
      // fallback to xz at current y
      try { b.pathfinder.setGoal(new goals.GoalBlock(Math.round(target.x), Math.round(b.entity.position.y), Math.round(target.z)), false); } catch {}
    }
  }

  stopPath(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.pathfinder.setGoal(null); } catch {}
  }

  gotoXYZ(id, x, y, z) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.pathfinder.setGoal(new goals.GoalBlock(Math.round(x), Math.round(y), Math.round(z)), true); } catch {}
  }

  // Looking
  rotateStep(id, dYawDeg = 0, dPitchDeg = 0) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    const yaw = b.entity.yaw + (dYawDeg * Math.PI / 180);
    const pitch = b.entity.pitch + (dPitchDeg * Math.PI / 180);
    b.look(yaw, pitch, true).catch(() => {});
  }

  lookAtAngles(id, yawDeg, pitchDeg) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    const yaw = yawDeg * Math.PI / 180;
    const pitch = pitchDeg * Math.PI / 180;
    b.look(yaw, pitch, true).catch(() => {});
  }

  lookAtCoord(id, x, y, z) {
    const e = this.bots.get(id); if (!e?.bot) return;
    e.bot.lookAt(new Vec3(x, y, z)).catch(() => {});
  }

  // Actions
  setActionMode(id, action, mode, options) {
    const e = this.bots.get(id); if (!e) return;
    e.actions.setMode(action, mode, options);
  }

  // Tweaks & misc
  setTweaks(id, toggles) {
    const e = this.bots.get(id); if (!e) return;
    // merge
    e.tweaks = { ...e.tweaks, ...toggles };

    // apply where immediate effect required
    if (e.bot) {
      if (toggles.autoSprint !== undefined) e.bot.setControlState('sprint', !!toggles.autoSprint);
      // autoRespawn handled on 'death' event (we check tweak there)
      // autoReconnect handled when 'end' occurs (we check tweak there)
      if (toggles.autoEat !== undefined) {
        if (toggles.autoEat) {
          if (!e._eatTimer) {
            e._eatTimer = setInterval(() => {
              try {
                if (e.bot && e.bot.food < 14) {
                  // simple auto-eat: consume first edible in inventory
                  const edible = e.bot.inventory.items().find(it => /apple|bread|porkchop|beef|chicken|mushroom_stew|rabbit|melon|cookie|potato/i.test(it.name));
                  if (edible) {
                    e.bot.equip(edible, 'hand').catch(()=>{});
                    e.bot.activateItem(false);
                    setTimeout(()=>e.bot.deactivateItem(), 1200);
                  }
                }
              } catch {}
            }, 4000);
          }
        } else {
          if (e._eatTimer) { clearInterval(e._eatTimer); e._eatTimer = null; }
        }
      }

      if (toggles.followPlayer !== undefined) {
        const name = toggles.followPlayer || null;
        if (e._followTimer) { clearInterval(e._followTimer); e._followTimer = null; }
        if (name) {
          e._followTimer = setInterval(() => {
            try {
              const target = Object.values(e.bot.players).find(p => p.username === name || p?.displayName === name)?.entity;
              if (target) e.bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
            } catch {}
          }, 2000);
        }
      }

      if (toggles.autoSleep !== undefined) {
        if (toggles.autoSleep) this.enableAutoSleep(id, true);
        else this.enableAutoSleep(id, false);
      }
    }
    this.broadcastList();
  }

  enableAutoSleep(id, on) {
    const e = this.bots.get(id); if (!e) return;
    const b = e.bot; if (!b) { e.tweaks.autoSleep = !!on; return; }
    e.tweaks.autoSleep = !!on;
    if (on) {
      if (e._sleepTimer) return;
      e._sleepTimer = setInterval(async () => {
        try {
          if (!/overworld/i.test(b.game?.dimension || "")) return;
          const time = b.time?.timeOfDay || 0;
          const isNight = time > 12541 && time < 23458;
          if (!isNight) return;
          const center = b.entity.position;
          // search for beds within 10 blocks radius
          for (let dx = -10; dx <= 10; dx++) {
            for (let dz = -10; dz <= 10; dz++) {
              try {
                const block = b.blockAt(center.offset(dx, 0, dz));
                if (block?.name?.includes("bed")) {
                  await b.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));
                  await b.sleep(block);
                  return;
                }
              } catch {}
            }
          }
        } catch {}
      }, 5000);
    } else {
      if (e._sleepTimer) { clearInterval(e._sleepTimer); e._sleepTimer = null; }
    }
  }
}
