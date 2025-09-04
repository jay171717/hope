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
    if (e.tweaks.autoSleep) this._ensureAutoSleep(e);
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
  toggleSneak(id) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    const b = e.bot;

    e._sneakState = !e._sneakState;
    try {
      b.setControlState("sneak", e._sneakState);
      this.io.emit("bot:log", { id, line: `Sneak ${e._sneakState ? "ON" : "OFF"}` });
    } catch (err) {
      this.io.emit("bot:log", { id, line: `Sneak toggle failed: ${err.message}` });
    }
  }

  _ensureAutoSleep(e) {
    if (!e.bot) { e.tweaks.autoSleep = true; return; }
    if (e._sleepTimer) return;
    const b = e.bot;

    e._sleepTimer = setInterval(async () => {
      try {
        if (!b || !/overworld/i.test(b.game?.dimension || "")) return;
        const time = b.time?.timeOfDay || 0;
        const isNight = time > 12541 && time < 23458;
        if (!isNight || b.isSleeping) return;

        const beds = b.findBlocks({
          matching: blk => blk.name.includes("bed"),
          maxDistance: 10,
          count: 5
        });

        if (beds.length) {
          const bedPos = beds[0];
          const bedBlock = b.blockAt(bedPos);

          this.io.emit("bot:log", { id: e.id, line: `Found bed at ${bedPos}` });

          try {
            await b.pathfinder.goto(new goals.GoalBlock(bedPos.x, bedPos.y, bedPos.z));
            await b.sleep(bedBlock);
            this.io.emit("bot:log", { id: e.id, line: "Bot is now sleeping" });
          } catch (err) {
            this.io.emit("bot:log", { id: e.id, line: `Sleep failed: ${err.message}` });
          }
        }
      } catch (err) {
        this.io.emit("bot:log", { id: e.id, line: `AutoSleep error: ${err.message}` });
      }
    }, 10000);
  }

  _clearTimersAndListeners(e) {
    if (e._telemetryTimer) { clearInterval(e._telemetryTimer); e._telemetryTimer = null; }
    if (e._eatTimer) { clearInterval(e._eatTimer); e._eatTimer = null; }
    if (e._followTimer) { clearInterval(e._followTimer); e._followTimer = null; }
    if (e._sleepTimer) { clearInterval(e._sleepTimer); e._sleepTimer = null; }
    if (e._respListener && e.bot) { try { e.bot.removeListener("death", e._respListener); } catch {} }
    e._respListener = null;
  }
}
