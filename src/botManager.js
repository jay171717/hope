import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
const { pathfinder, goals } = pathfinderPkg;
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
    return [...this.bots.entries()].map(([id, b]) =>
      this._publicBotInfo(id, b)
    );
  }

  _publicBotInfo(id, data) {
    return {
      id,
      name: data?.name,
      online: !!data?.bot && data.bot.player,
      toggledConnected: data?.toggledConnected ?? true,
      description: data?.description || "",
      headUrl: `${this.headBase}/${encodeURIComponent(data.name)}/32`,
      lastSeen: data?.lastSeen || null,
      createdAt: data?.createdAt || null,
    };
  }

  broadcastList() {
    this.io.emit("bot:list", this.list());
  }

  addBot({ id, name }) {
    if (this.bots.has(id)) throw new Error("Bot id already exists");
    const entry = {
      id,
      name,
      auth: "offline",
      bot: null,
      mcData: null,
      actions: null,
      toggledConnected: true,
      description: "",
      createdAt: Date.now(),
      lastSeen: null,
      toggles: {
        autoReconnect: false,
        autoRespawn: false,
        autoSprint: false,
        autoEat: false,
        followPlayer: null,
        autoMinePlace: false,
      },
    };
    this.bots.set(id, entry);
    this._spawn(entry);
    this.broadcastList();
    return this._publicBotInfo(id, entry);
  }

  setDescription(id, text) {
    const e = this.bots.get(id);
    if (!e) return;
    e.description = String(text || "").slice(0, 127);
    this.io.emit("bot:description", { id, description: e.description });
  }

  toggleConnection(id, shouldConnect) {
    const e = this.bots.get(id);
    if (!e) return;
    e.toggledConnected = !!shouldConnect;
    if (shouldConnect && !e.bot) this._spawn(e);
    if (!shouldConnect && e.bot) e.bot.end("User toggled disconnect");
    this.broadcastList();
  }

  removeBot(id) {
    const e = this.bots.get(id);
    if (!e) return;
    if (e.bot) e.bot.end("Deleted by user");
    this.bots.delete(id);
    this.broadcastList();
  }

  // ---------- Spawning & wiring ----------
  _spawn(entry) {
    if (!entry.toggledConnected) return;
    const bot = mineflayer.createBot({
      host: this.serverHost,
      port: this.serverPort,
      username: entry.name,
      auth: "offline",
      version: this.fixedVersion || false,
    });

    entry.bot = bot;
    entry.actions = new ActionController(bot);
    entry.actions.onUpdate((list) =>
      this.io.emit("bot:activeActions", { id: entry.id, actions: list })
    );

    bot.loadPlugin(pathfinder);
    bot.once("spawn", () => {
      entry.lastSeen = Date.now();
      entry.mcData = mcdataFactory(bot.version);
      this._wireTelemetry(entry);
      this.io.emit("bot:status", { id: entry.id, status: "online" });
      this.broadcastList();
    });

    bot.on("end", () => {
      this.io.emit("bot:status", { id: entry.id, status: "offline" });
      entry.actions?.stopAll();
      entry.bot = null;
      if (entry.toggles.autoReconnect && entry.toggledConnected) {
        setTimeout(() => this._spawn(entry), 3000);
      }
      this.broadcastList();
    });

    bot.on("death", () => {
      if (entry.toggles.autoRespawn) {
        setTimeout(() => {
          try {
            bot.respawn();
          } catch {}
        }, 1000);
      }
    });

    bot.on("kicked", (reason) => {
      this.io.emit("bot:log", { id: entry.id, line: `Kicked: ${reason}` });
    });
    bot.on("error", (err) => {
      this.io.emit("bot:log", { id: entry.id, line: `Error: ${err.message}` });
    });
    bot.on("messagestr", (msg) => {
      this.io.emit("bot:chat", { id: entry.id, line: msg });
    });
  }

  _wireTelemetry(entry) {
    const bot = entry.bot;
    const sendStatus = () => {
      if (!entry.bot) return;
      const b = entry.bot;
      const ent = b.entity;

      const status = {
        uptime: entry.lastSeen ? Date.now() - entry.lastSeen : null,
        dim: b.game?.dimension || "unknown",
        pos: ent?.position
          ? { x: ent.position.x, y: ent.position.y, z: ent.position.z }
          : null,
        health: b.health ?? null,
        hunger: b.food ?? null,
        xp: b.experience?.level ?? null,
        yaw: ent?.yaw ?? 0,
        pitch: ent?.pitch ?? 0,
        effects: [...(b.effects ? b.effects.values() : [])].map((e) => ({
          type: e.type?.name || e.type || "effect",
          amp: e.amplifier,
          dur: e.duration,
        })),
      };

      this.io.emit("bot:telemetry", {
        id: entry.id,
        status,
        inventory: this._serializeInventory(b),
      });
    };
    entry._telemetryTimer = setInterval(sendStatus, 1000);
  }

  _serializeInventory(b) {
    const inv = b.inventory;
    const slots = Array.from({ length: 36 }, (_, i) => inv.slots[9 + i] || null);
    const armorSlots = {
      head: inv.slots[5] || null,
      chest: inv.slots[6] || null,
      legs: inv.slots[7] || null,
      feet: inv.slots[8] || null,
    };
    const mainHand = b.heldItem || null;
    const offHand = inv.slots[45] || null;

    const toItem = (it) =>
      it
        ? {
            name: it.name,
            count: it.count,
            enchants:
              (it.nbt?.value?.Enchantments?.value?.value || []).map(
                (e) => e.id?.value || e.id
              ) || [],
            durability:
              it.durabilityUsed !== undefined && it.maxDurability !== undefined
                ? it.maxDurability - it.durabilityUsed
                : null,
          }
        : null;

    return {
      slots: slots.map(toItem),
      armor: {
        head: toItem(armorSlots.head),
        chest: toItem(armorSlots.chest),
        legs: toItem(armorSlots.legs),
        feet: toItem(armorSlots.feet),
      },
      mainHand: toItem(mainHand),
      offHand: toItem(offHand),
    };
  }

  // ---------- Commands from UI ----------
  chat(id, text) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    e.bot.chat(text);
  }

  respawn(id) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    try {
      e.bot.respawn();
    } catch {}
  }

  holdInventorySlot(id, index, hand = "hand") {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    const b = e.bot;
    const slot = b.inventory.slots[9 + index];
    if (!slot) return;
    b.equip(slot, hand).catch(() => {});
  }

  unequipArmor(id, part) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    const b = e.bot;
    if (b.inventory.emptySlotCount() <= 0) return;
    const mapping = { head: "head", chest: "torso", legs: "legs", feet: "feet" };
    b.unequip(mapping[part]).catch(() => {});
  }

  setContinuousMove(id, dir, on) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    const map = { W: "forward", A: "left", S: "back", D: "right" };
    const key = map[dir];
    if (!key) return;
    e.bot.setControlState(key, !!on);
  }

  jumpOnce(id) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    e.bot.setControlState("jump", true);
    setTimeout(() => e.bot.setControlState("jump", false), 200);
  }

  toggleSneak(id) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    const b = e.bot;
    const sneaking = b.getControlState("sneak");
    b.setControlState("sneak", !sneaking);
  }

  gotoXYZ(id, x, y, z) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    const b = e.bot;
    b.pathfinder.setGoal(
      new goals.GoalBlock(Math.round(x), Math.round(y), Math.round(z)),
      true
    );
  }

  rotateStep(id, dYawDeg = 0, dPitchDeg = 0) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    const b = e.bot;
    const yaw = b.entity.yaw + (dYawDeg * Math.PI) / 180;
    const pitch = b.entity.pitch + (dPitchDeg * Math.PI) / 180;
    b.look(yaw, pitch, true).catch(() => {});
  }

  setActionMode(id, action, mode, options) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    e.actions.setMode(action, mode, options);
  }

  setTweaks(id, toggles) {
    const e = this.bots.get(id);
    if (!e?.bot) return;
    e.toggles = { ...e.toggles, ...toggles };
  }
}
