import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
const { pathfinder, goals, Movements } = pathfinderPkg;
import mcdataFactory from "minecraft-data";
import { Vec3 } from "vec3";
import { ActionController } from "./actions.js";
import { toggleSneak, ensureAutoSleep, clearAutoSleep } from "./extras.js";

export class BotManager {
  constructor(io, serverHost, serverPort, fixedVersion, headBase) {
    this.io = io;
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.fixedVersion = fixedVersion || null;
    this.headBase = headBase;
    this.bots = new Map();
  }

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
      createdAt: e.createdAt || null,
      tweaks: e.tweaks || {}
    };
  }

  broadcastList() {
    this.io.emit("bot:list", this.list());
  }

  addBot({ id, name }) {
    const useId = id || `${name.replace(/\W+/g, "_")}_${Date.now().toString(36).slice(-6)}`;
    if (this.bots.has(useId)) throw new Error("Bot id already exists");
    const e = {
      id: useId,
      name,
      auth: "offline",
      bot: null,
      mcData: null,
      actions: null,
      toggledConnected: true,
      description: "",
      tweaks: {
        autoReconnect: false,
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
      _eatTimer: null,
      _followTimer: null,
      _sleepTimer: null,
      _respListener: null,
      _sneakState: false
    };
    this.bots.set(useId, e);
    this._spawn(e);
    this.broadcastList();
    return this._publicBotInfo(useId, e);
  }

  setDescription(id, text) {
    const e = this.bots.get(id); if (!e) return;
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
    if (e.bot) try { e.bot.end("Deleted by user"); } catch {}
    this._clearTimersAndListeners(e);
    this.bots.delete(id);
    this.io.emit("bot:removed", { id });
    this.broadcastList();
  }

  // ---------- spawn & wiring ----------
  _spawn(e) {
    if (!e.toggledConnected) return;

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
      try { e.mcData = mcdataFactory(bot.version); } catch { e.mcData = null; }
      try { bot.pathfinder.setMovements(new Movements(bot, e.mcData)); } catch {}
      this._wireTelemetry(e);
      this.io.emit("bot:status", { id: e.id, status: "online" });
      this.broadcastList();
      if (e.tweaks.autoSprint) try { bot.setControlState("sprint", true); } catch {}
      this._applyTweaksAfterSpawn(e);
    });

    bot.on("end", (reason) => {
      this.io.emit("bot:log", { id: e.id, line: `Disconnected: ${reason || "end"}` });
      e.actions?.stopAll();
      if (e._telemetryTimer) { clearInterval(e._telemetryTimer); e._telemetryTimer = null; }
      e.bot = null;

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

    bot.on("death", () => {
      this.io.emit("bot:log", { id: e.id, line: "Bot died" });
      if (e.tweaks.autoRespawn) {
        setTimeout(() => { try { bot.respawn(); } catch {} }, 600);
      }
    });
  }

  _applyTweaksAfterSpawn(e) {
    const b = e.bot;
    if (!b) return;
    if (e.tweaks.autoRespawn && !e._respListener) {
      e._respListener = () => setTimeout(() => { try { b.respawn(); } catch {} }, 500);
      try { b.on("death", e._respListener); } catch {}
    }
    if (e.tweaks.autoEat) this._ensureAutoEat(e);
    if (e.tweaks.followPlayer) this._ensureFollow(e);
    if (e.tweaks.autoSleep) ensureAutoSleep(e, this.io);
  }

  _wireTelemetry(e) {
    const b = e.bot;
    if (!b) return;
    const send = () => {
      if (!e.bot) return;
      const ent = b.entity;
      const pos = ent?.position ? { x: ent.position.x, y: ent.position.y, z: ent.position.z } : null;
      const yaw = ent?.yaw ?? 0;
      const pitch = ent?.pitch ?? 0;
      let lookingBlock = null;
      try { lookingBlock = b.blockAtCursor(6) || null; } catch {}
      let lookingEntity = null;
      try { const ec = b.entityAtCursor ? b.entityAtCursor(6) : null; lookingEntity = ec ? (ec.name || ec.username || ec.type) : null; } catch {}
      const effects = [...(b.effects ? b.effects.values() : [])].map(ev => ({ type: ev.type?.name || ev.type || "effect", amp: ev.amplifier, dur: ev.duration }));
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

  async equipSlot(id, index, hand) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    try {
      const slot = b.inventory.slots[9 + index] || null;
      const dest = (hand === "off") ? "off-hand" : "hand";
      if (!slot) {
        if (dest === "hand") await b.unequip("hand").catch(()=>{});
        else await b.unequip("off-hand").catch(()=>{});
        return;
      }
      await b.equip(slot, dest).catch(async () => {
        if (dest === "off-hand") {
          try { await b.equip(slot, "offhand").catch(()=>{}); } catch {}
        }
      });
    } catch (err) {
      this.io.emit("bot:log", { id, line: `equipSlot error: ${err?.message || err}` });
    }
  }

  setContinuousMove(id, dir, on) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const map = { W: "forward", A: "left", S: "back", D: "right" };
    const key = map[dir]; if (!key) return;
    try { e.bot.setControlState(key, !!on); } catch {}
  }

  jumpOnce(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try {
      e.bot.setControlState("jump", true);
      setTimeout(()=>{ try { e.bot.setControlState("jump", false); } catch {} }, 200);
    } catch {}
  }

  toggleSneak(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    toggleSneak(e, this.io);
  }

  stopPath(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.pathfinder.setGoal(null); } catch {}
  }

  gotoXYZ(id, x, y, z) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.pathfinder.setGoal(new goals.GoalBlock(Math.round(x), Math.round(y), Math.round(z)), true); } catch {}
  }

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

  setActionMode(id, action, mode, options = {}) {
    const e = this.bots.get(id); if (!e?.bot) return;
    e.actions.setMode(action, mode, options);
  }

  setTweaks(id, toggles) {
    const e = this.bots.get(id); if (!e) return;
    e.tweaks = { ...e.tweaks, ...toggles };
    const b = e.bot;

    if (b) {
      if (toggles.autoSprint !== undefined) {
        try { b.setControlState("sprint", !!toggles.autoSprint); } catch {}
      }

      if (toggles.autoRespawn !== undefined) {
        if (toggles.autoRespawn) {
          if (!e._respListener) {
            e._respListener = () => setTimeout(()=>{ try { b.respawn(); } catch {} }, 500);
            try { b.on("death", e._respListener); } catch {}
          }
        } else {
          if (e._respListener) {
            try { b.removeListener("death", e._respListener); } catch {}
            e._respListener = null;
          }
        }
      }

      if (toggles.autoEat !== undefined) {
        if (toggles.autoEat) this._ensureAutoEat(e); else this._clearAutoEat(e);
      }

      if (toggles.followPlayer !== undefined) {
        e.tweaks.followPlayer = toggles.followPlayer || null;
        if (e.tweaks.followPlayer) this._ensureFollow(e);
        else this._clearFollow(e);
      }

      if (toggles.autoSleep !== undefined) {
        e.tweaks.autoSleep = !!toggles.autoSleep;
        if (e.tweaks.autoSleep) ensureAutoSleep(e, this.io);
        else clearAutoSleep(e);
      }

      if (toggles.autoMinePlace !== undefined) {
        e.tweaks.autoMinePlace = !!toggles.autoMinePlace;
      }
    }

    this.broadcastList();
  }

  // Auto-eat
  _ensureAutoEat(e) {
    if (!e.bot) { e.tweaks.autoEat = true; return; }
    if (e._eatTimer) return;
    const b = e.bot;
    e._eatTimer = setInterval(async () => {
      try {
        if (!b) return;
        const need = (b.food !== undefined && b.food <= 10) || (b.health !== undefined && b.health <= 10);
        if (!need) return;
        const edible = b.inventory.items().find(it => /apple|bread|porkchop|beef|chicken|stew|rabbit|melon|cookie|potato/i.test(it.name));
        if (edible) {
          await b.equip(edible, "hand").catch(()=>{});
          try {
            if (typeof b.consume === "function") {
              await b.consume().catch(()=>{});
            } else {
              b.activateItem(false);
              await new Promise(r => setTimeout(r, 1500));
              try { b.deactivateItem(); } catch {}
            }
            this.io.emit("bot:log", { id: e.id, line: "Auto-eat: tried to eat." });
          } catch (err) { this.io.emit("bot:log", { id: e.id, line: `Auto-eat error: ${err?.message||err}` }); }
        }
      } catch {}
    }, 2500);
  }
  _clearAutoEat(e) { if (e._eatTimer) { clearInterval(e._eatTimer); e._eatTimer = null; } }

  _ensureFollow(e) {
    if (!e.bot) return;
    if (e._followTimer) return;
    const b = e.bot;
    e._followTimer = setInterval(() => {
      try {
        if (!b) return;
        const name = e.tweaks.followPlayer;
        if (!name) return;
        const plEntry = Object.values(b.players).find(p => (p.username === name) || (p.displayName === name));
        const ent = plEntry?.entity;
        if (ent) b.pathfinder.setGoal(new goals.GoalFollow(ent, 2), true);
      } catch {}
    }, 1200);
  }
  _clearFollow(e) {
    if (e._followTimer) { clearInterval(e._followTimer); e._followTimer = null; }
    if (e.bot) try { e.bot.pathfinder.setGoal(null); } catch {}
  }

  _clearTimersAndListeners(e) {
    if (e._telemetryTimer) { clearInterval(e._telemetryTimer); e._telemetryTimer = null; }
    if (e._eatTimer) { clearInterval(e._eatTimer); e._eatTimer = null; }
    if (e._followTimer) { clearInterval(e._followTimer); e._followTimer = null; }
    clearAutoSleep(e);
    if (e._respListener && e.bot) { try { e.bot.removeListener("death", e._respListener); } catch {} }
    e._respListener = null;
  }
}
