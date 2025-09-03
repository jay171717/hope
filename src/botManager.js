import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
const { pathfinder, goals, Movements } = pathfinderPkg;
import mcdataFactory from "minecraft-data";
import { Vec3 } from "vec3";
import { ActionController } from "./actions.js";

export class BotManager {
  constructor(io, serverHost, serverPort, fixedVersion, headBase) {
    this.io = io;
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.fixedVersion = fixedVersion || null;
    this.headBase = headBase;
    this.bots = new Map(); // id -> entry
  }

  // Public list includes description so UI can persist it across reloads
  list() {
    return [...this.bots.entries()].map(([id, e]) => this._publicBotInfo(id, e));
  }

  _publicBotInfo(id, e) {
    return {
      id,
      name: e.name,
      online: !!e.bot && !!e.bot.player,
      toggledConnected: !!e.toggledConnected,
      description: e.description || "",
      headUrl: `${this.headBase}/${encodeURIComponent(e.name)}/32`,
      lastSeen: e.lastSeen || null,
      createdAt: e.createdAt || null
    };
  }

  broadcastList() { this.io.emit("bot:list", this.list()); }

  addBot({ id, name, auth = "offline" }) {
    // id optional; if missing create deterministic unique id
    const useId = id || `${name.replace(/\W+/g, "_")}_${Date.now().toString(36).slice(-6)}`;
    if (this.bots.has(useId)) throw new Error("Bot id already exists");
    const entry = {
      id: useId,
      name,
      auth: "offline", // force cracked/offline per your request
      bot: null,
      mcData: null,
      actions: null,
      toggledConnected: true,
      description: "",
      tweaks: {
        autoReconnect: true,
        autoRespawn: false,
        autoSprint: false,
        autoEat: false,
        followPlayer: null,
        autoMinePlace: false,
        autoSleep: false
      },
      createdAt: Date.now(),
      lastSeen: null,
      _telemetryTimer: null,
      _respListener: null,
      _eatTimer: null,
      _followTimer: null,
      _sleepTimer: null
    };
    this.bots.set(useId, entry);
    // spawn immediately if toggledConnected
    this._spawn(entry);
    this.broadcastList();
    return this._publicBotInfo(useId, entry);
  }

  setDescription(id, text) {
    const e = this.bots.get(id);
    if (!e) return;
    e.description = String(text || "").slice(0, 127);
    this.io.emit("bot:description", { id, description: e.description });
    this.broadcastList();
  }

  toggleConnection(id, shouldConnect) {
    const e = this.bots.get(id); if (!e) return;
    e.toggledConnected = !!shouldConnect;
    if (e.toggledConnected && !e.bot) this._spawn(e);
    if (!e.toggledConnected && e.bot) e.bot.end("User toggled disconnect");
    this.broadcastList();
  }

  removeBot(id) {
    const e = this.bots.get(id); if (!e) return;
    if (e.bot) {
      try { e.bot.end("Deleted by user"); } catch {}
    }
    // cleanup timers/listeners
    this._clearTimers(e);
    this.bots.delete(id);
    this.io.emit("bot:removed", { id });
    this.broadcastList();
  }

  // ---------- spawn & wiring ----------
  _spawn(e) {
    if (!e.toggledConnected) return;
    // create bot (force offline auth)
    const bot = mineflayer.createBot({
      host: this.serverHost,
      port: this.serverPort,
      username: e.name,
      auth: "offline",
      version: this.fixedVersion || false
    });

    e.bot = bot;
    e.actions = new ActionController(bot);
    e.actions.onUpdate(list => this.io.emit("bot:activeActions", { id: e.id, actions: list }));

    bot.loadPlugin(pathfinder);

    bot.once("spawn", () => {
      e.lastSeen = Date.now();
      e.mcData = mcdataFactory(bot.version);
      // movements config for pathfinder
      try {
        bot.pathfinder.setMovements(new Movements(bot, e.mcData));
      } catch {}
      this._wireTelemetry(e);
      this.io.emit("bot:status", { id: e.id, status: "online" });
      this.broadcastList();

      // apply tweaks
      if (e.tweaks.autoSprint) bot.setControlState("sprint", true);
      // autoRespawn listener binding handled in setTweaks
      this._applyTweaksAfterSpawn(e);
    });

    bot.on("end", (reason) => {
      this.io.emit("bot:log", { id: e.id, line: `Disconnected: ${reason || "ended"}` });
      e.actions?.stopAll();
      // clear telemetry timer
      if (e._telemetryTimer) { clearInterval(e._telemetryTimer); e._telemetryTimer = null; }
      // keep reference null so UI shows offline
      e.bot = null;

      // auto reconnect
      if (e.tweaks.autoReconnect && e.toggledConnected) {
        setTimeout(() => {
          if (e.tweaks.autoReconnect && e.toggledConnected) this._spawn(e);
        }, 3000);
      }
      this.broadcastList();
    });

    bot.on("kicked", reason => this.io.emit("bot:log", { id: e.id, line: `Kicked: ${reason}` }));
    bot.on("error", err => this.io.emit("bot:log", { id: e.id, line: `Error: ${err?.message || err}` }));
    bot.on("messagestr", (msg) => this.io.emit("bot:chat", { id: e.id, line: msg }));
  }

  _applyTweaksAfterSpawn(e) {
    const b = e.bot;
    if (!b) return;
    // autoRespawn binding (only if enabled)
    if (e.tweaks.autoRespawn) {
      if (!e._respListener) {
        e._respListener = () => setTimeout(() => { try { b.respawn(); } catch {} }, 500);
        b.on("death", e._respListener);
      }
    }
    // autoEat: handled by periodic timer
    if (e.tweaks.autoEat) this._ensureAutoEat(e);
    // follow player: ensure follow timer
    if (e.tweaks.followPlayer) this._ensureFollow(e);
    // autoSleep
    if (e.tweaks.autoSleep) this._ensureAutoSleep(e);
  }

  _wireTelemetry(e) {
    const b = e.bot;
    if (!b) return;
    // telemetry every 1s
    const send = () => {
      if (!e.bot) return;
      const ent = b.entity;
      const pos = ent?.position ? { x: ent.position.x, y: ent.position.y, z: ent.position.z } : null;
      const yaw = ent?.yaw ?? 0;
      const pitch = ent?.pitch ?? 0;
      // looking block
      let lookingBlock = null, lookingEntity = null;
      try { lookingBlock = b.blockAtCursor(6) || null; } catch {}
      try { const ne = b.nearestEntity(); lookingEntity = ne ? ne.name : null; } catch {}
      const effects = [...(b.effects ? b.effects.values() : [])].map(ev => ({
        type: ev.type?.name || ev.type || "effect", amp: ev.amplifier, dur: ev.duration
      }));
      const inv = this._serializeInventory(b);

      this.io.emit("bot:telemetry", {
        id: e.id,
        status: {
          uptime: e.lastSeen ? Date.now() - e.lastSeen : null,
          dim: b.game?.dimension || "unknown",
          pos,
          health: b.health ?? null,
          hunger: b.food ?? null,
          xp: b.experience?.level ?? null,
          yaw, pitch,
          effects,
          looking: {
            block: lookingBlock ? { name: lookingBlock.name, pos: lookingBlock.position } : null,
            entity: lookingEntity || null
          }
        },
        inventory: inv
      });
    };

    // clear existing telemetry timer
    if (e._telemetryTimer) clearInterval(e._telemetryTimer);
    e._telemetryTimer = setInterval(send, 1000);
    send();
  }

  _serializeInventory(b) {
    const inv = b.inventory;
    const slots = Array.from({ length: 36 }, (_, i) => inv.slots[9 + i] || null);
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
      durability: (it.maxDurability !== undefined && it.durabilityUsed !== undefined) ? (it.maxDurability - it.durabilityUsed) : null
    }) : null;

    return {
      slots: slots.map(toItem),
      armor: { head: toItem(armorSlots.head), chest: toItem(armorSlots.chest), legs: toItem(armorSlots.legs), feet: toItem(armorSlots.feet) },
      mainHand: toItem(mainHand),
      offHand: toItem(offHand)
    };
  }

  // ---------- UI commands ----------
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
    try { await e.bot.swapHands(); } catch (err) { this.io.emit("bot:log", { id, line: `swapHands error: ${err.message||err}` }); }
  }

  async holdInventorySlot(id, index) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    try {
      const slot = b.inventory.slots[9 + index];
      if (!slot) {
        // hold nothing -> unequip hand
        await b.unequip("hand").catch(()=>{});
        return;
      }
      await b.equip(slot, "hand");
    } catch (err) { /* ignore */ }
  }

  async unequipArmor(id, part) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    try {
      const slotMap = { head: "head", chest: "torso", legs: "legs", feet: "feet" };
      await b.unequip(slotMap[part]).catch(()=>{});
    } catch {}
  }

  // Movement
  setContinuousMove(id, dir, on) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const map = { W: "forward", A: "left", S: "back", D: "right" };
    const key = map[dir]; if (!key) return;
    try { e.bot.setControlState(key, !!on); } catch {}
  }

  jumpOnce(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.setControlState("jump", true); setTimeout(()=>{ try{ e.bot.setControlState("jump", false); }catch{} }, 200); } catch {}
  }

  toggleSneak(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { const now = e.bot.getControlState("sneak"); e.bot.setControlState("sneak", !now); } catch {}
  }

  // Move X blocks in current horizontal facing (keeps pitch/yaw unchanged because we use pathfinder without forcing look)
  moveBlocks(id, dir, blocks = 5) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    try {
      const pos = b.entity.position.clone();
      const yaw = b.entity.yaw;
      const forward = new Vec3(Math.cos(yaw), 0, Math.sin(yaw));
      const right = new Vec3(Math.cos(yaw + Math.PI/2), 0, Math.sin(yaw + Math.PI/2));
      let target = pos.clone();
      if (dir === "W") target = pos.plus(forward.scaled(blocks));
      if (dir === "S") target = pos.minus(forward.scaled(blocks));
      if (dir === "A") target = pos.minus(right.scaled(blocks));
      if (dir === "D") target = pos.plus(right.scaled(blocks));
      const tx = Math.round(target.x), ty = Math.round(target.y), tz = Math.round(target.z);
      // setGoal with look=true only when necessary for pathfinder; set false to avoid changing yaw/pitch
      b.pathfinder.setGoal(new goals.GoalBlock(tx, ty, tz), false);
    } catch (err) { this.io.emit("bot:log", { id, line: `moveBlocks error: ${err.message||err}` }); }
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
    try {
      const b = e.bot;
      const yaw = b.entity.yaw + (dYawDeg * Math.PI / 180);
      const pitch = b.entity.pitch + (dPitchDeg * Math.PI / 180);
      b.look(yaw, pitch, true).catch(()=>{});
    } catch {}
  }

  lookAtAngles(id, yawDeg, pitchDeg) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.look(yawDeg * Math.PI/180, pitchDeg * Math.PI/180, true).catch(()=>{}); } catch {}
  }

  lookAtCoord(id, x, y, z) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.lookAt(new Vec3(x, y, z)).catch(()=>{}); } catch {}
  }

  // Actions: mine/attack/place/eat/drop - preserve orientation by restoring yaw/pitch after action
  async setActionMode(id, action, mode, options = {}) {
    const e = this.bots.get(id); if (!e?.bot) return;
    // bind into ActionController which calls back into bot instance; but we need to enforce "attack only when looking"
    // so we will patch ActionController's perform calls via its bot instance behaviour (ActionController uses b.* directly).
    // Here we simply pass through to e.actions.setMode
    e.actions.setMode(action, mode, options);

    // Additional enforcement: for attack continuous/once ensure we only attack when looking
    // We'll also intercept ActionController's _perform behavior within actions.js (implemented there).
  }

  // Tweaks & misc
  setTweaks(id, toggles) {
    const e = this.bots.get(id); if (!e) return;
    e.tweaks = { ...e.tweaks, ...toggles };

    const b = e.bot;
    // AutoSprint immediate effect
    if (b && toggles.autoSprint !== undefined) {
      try { b.setControlState("sprint", !!toggles.autoSprint); } catch {}
    }

    // AutoReconnect handled by spawn/on end logic (e.tweaks.autoReconnect used there)

    // AutoRespawn: attach/remove death listener
    if (b && toggles.autoRespawn !== undefined) {
      if (toggles.autoRespawn) {
        if (!e._respListener) {
          e._respListener = () => setTimeout(() => { try { b.respawn(); } catch {} }, 500);
          b.on("death", e._respListener);
        }
      } else {
        if (e._respListener) {
          try { b.removeListener("death", e._respListener); } catch {}
          e._respListener = null;
        }
      }
    }

    // AutoEat: create/clear periodic eater
    if (toggles.autoEat !== undefined) {
      if (toggles.autoEat) this._ensureAutoEat(e);
      else this._clearAutoEat(e);
    }

    // followPlayer: start/stop follow timer
    if (toggles.followPlayer !== undefined) {
      e.tweaks.followPlayer = toggles.followPlayer || null;
      if (e.tweaks.followPlayer) this._ensureFollow(e);
      else this._clearFollow(e);
    }

    // autoMinePlace toggle: just store in tweaks for other logic to check
    // autoSleep
    if (toggles.autoSleep !== undefined) {
      e.tweaks.autoSleep = !!toggles.autoSleep;
      if (e.tweaks.autoSleep) this._ensureAutoSleep(e); else this._clearAutoSleep(e);
    }

    this.broadcastList();
  }

  _ensureAutoEat(e) {
    const b = e.bot; if (!b) return;
    if (e._eatTimer) return;
    e._eatTimer = setInterval(() => {
      if (!e.bot) return;
      try {
        // only eat if food low and holding edible or inventory has edible
        if (b.food < 14) {
          const edible = b.inventory.items().find(it => /apple|bread|cooked|steak|pork|melon|cookie/i.test(it.name));
          if (edible) {
            // equip edible in hand if not already
            b.equip(edible, "hand").then(() => b.consume().catch(()=>{})).catch(()=>{});
          }
        }
      } catch {}
    }, 3000);
  }
  _clearAutoEat(e) { if (e._eatTimer) { clearInterval(e._eatTimer); e._eatTimer = null; } }

  _ensureFollow(e) {
    const b = e.bot; if (!b) return;
    if (e._followTimer) return;
    e._followTimer = setInterval(() => {
      if (!e.bot) return;
      try {
        const targetName = e.tweaks.followPlayer;
        if (!targetName) return;
        const p = Object.values(b.players).find(p => p.username === targetName || p.displayName === targetName);
        const entity = p?.entity;
        if (entity) b.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
      } catch {}
    }, 1500);
  }
  _clearFollow(e) { if (e._followTimer) { clearInterval(e._followTimer); e._followTimer = null; } }

  _ensureAutoSleep(e) {
    const b = e.bot; if (!b) return;
    if (e._sleepTimer) return;
    e._sleepTimer = setInterval(async () => {
      if (!e.bot) return;
      try {
        if (!/overworld/i.test(b.game?.dimension || "")) return;
        const time = b.time?.timeOfDay || 0;
        const isNight = time > 12541 && time < 23458;
        if (!isNight) return;
        const center = b.entity.position;
        for (let dx = -10; dx <= 10; dx++) {
          for (let dz = -10; dz <= 10; dz++) {
            const pos = center.offset(dx, 0, dz);
            const block = b.blockAt(pos);
            if (block?.name?.includes("bed")) {
              await b.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));
              await b.sleep(block);
              return;
            }
          }
        }
      } catch {}
    }, 5000);
  }
  _clearAutoSleep(e) { if (e._sleepTimer) { clearInterval(e._sleepTimer); e._sleepTimer = null; } }

  _clearTimers(e) {
    if (e._telemetryTimer) { clearInterval(e._telemetryTimer); e._telemetryTimer = null; }
    if (e._eatTimer) { clearInterval(e._eatTimer); e._eatTimer = null; }
    if (e._followTimer) { clearInterval(e._followTimer); e._followTimer = null; }
    if (e._sleepTimer) { clearInterval(e._sleepTimer); e._sleepTimer = null; }
    if (e._respListener && e.bot) { try { e.bot.removeListener("death", e._respListener); } catch {} }
    e._respListener = null;
  }
}
