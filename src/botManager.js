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
    this.bots = new Map(); // id -> {bot, info, actions, createdAt, description, toggledConnected}
  }

  list() {
    return [...this.bots.entries()].map(([id, b]) => this._publicBotInfo(id, b));
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
      createdAt: data?.createdAt || null
    };
  }

  broadcastList() {
    this.io.emit("bot:list", this.list());
  }

  addBot({ id, name, auth="offline" }) {
    if (this.bots.has(id)) throw new Error("Bot id already exists");
    const entry = {
      id, name, auth, bot: null, mcData: null,
      info: {},
      actions: null,
      toggledConnected: true,
      description: "",
      createdAt: Date.now(),
      lastSeen: null
    };
    this.bots.set(id, entry);
    this._spawn(entry);
    this.broadcastList();
    return this._publicBotInfo(id, entry);
  }

  setDescription(id, text) {
    const e = this.bots.get(id); if (!e) return;
    e.description = String(text || "").slice(0, 127);
    this.io.emit("bot:description", { id, description: e.description });
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
      auth: entry.auth, // "offline" for cracked
      version: this.fixedVersion || false
    });

    entry.bot = bot;
    entry.actions = new ActionController(bot);
    entry.actions.onUpdate(list => this.io.emit("bot:activeActions", { id: entry.id, actions: list }));

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
      setTimeout(() => {
        if (entry.toggledConnected) this._spawn(entry);
      }, 3000); // Auto-reconnect default ON
      this.broadcastList();
    });

    bot.on("kicked", (reason) => {
      this.io.emit("bot:log", { id: entry.id, line: `Kicked: ${reason}` });
    });
    bot.on("error", (err) => {
      this.io.emit("bot:log", { id: entry.id, line: `Error: ${err.message}` });
    });
    bot.on("messagestr", (msg, pos) => {
      this.io.emit("bot:chat", { id: entry.id, line: msg });
    });
  }

  _wireTelemetry(entry) {
    const bot = entry.bot;
    const sendStatus = () => {
      if (!entry.bot) return;
      const b = entry.bot;
      const ent = b.entity;
      const health = b.health ?? null;
      const food = b.food ?? null;
      const xp = b.experience?.level ?? null;

      let lookingBlock = null, lookingEntity = null;
      try {
        if (b.blockAtCursor) lookingBlock = b.blockAtCursor(5) || null;
      } catch {}
      try {
        if (b.nearestEntity) lookingEntity = b.nearestEntity();
      } catch {}

      const dim = b.game?.dimension || "unknown";
      const pos = ent?.position ? { x: ent.position.x, y: ent.position.y, z: ent.position.z } : null;
      const yaw = ent?.yaw ?? 0;
      const pitch = ent?.pitch ?? 0;

      const inv = this._serializeInventory(b);
      const effects = [...(b.effects ? b.effects.values() : [])].map(e => ({
        type: e.type?.name || e.type || "effect",
        amp: e.amplifier,
        dur: e.duration
      }));

      this.io.emit("bot:telemetry", {
        id: entry.id,
        status: {
          uptime: entry.lastSeen ? Date.now() - entry.lastSeen : null,
          dim,
          pos,
          health,
          hunger: food,
          xp,
          yaw,
          pitch,
          effects,
          looking: {
            block: lookingBlock ? { name: lookingBlock.name, pos: lookingBlock.position } : null,
            entity: lookingEntity?.name || null
          }
        },
        inventory: inv
      });
    };
    entry._telemetryTimer = setInterval(sendStatus, 1000);
  }

  _serializeInventory(b) {
    const inv = b.inventory;
    const slots = Array.from({ length: 36 }, (_, i) => inv.slots[9 + i] || null); // 9x4 (skip container slots)
    const armorSlots = {
      head: inv.slots[5] || null,
      chest: inv.slots[6] || null,
      legs: inv.slots[7] || null,
      feet: inv.slots[8] || null
    };
    const mainHand = b.heldItem || null;
    const offHand = inv.slots[45] || null; // offhand

    const toItem = it => it ? ({
      name: it.name, count: it.count,
      enchants: (it.nbt?.value?.Enchantments?.value?.value || []).map(e => e.id?.value || e.id),
      durability: it.durabilityUsed !== undefined && it.maxDurability !== undefined
        ? (it.maxDurability - it.durabilityUsed)
        : null
    }) : null;

    return {
      slots: slots.map(toItem),
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

  // ---------- Commands from UI ----------

  chat(id, text) {
    const e = this.bots.get(id); if (!e?.bot) return;
    e.bot.chat(text);
  }

  respawn(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    try { e.bot.respawn(); } catch {}
  }

  swapHands(id) {
    const e = this.bots.get(id); if (!e?.bot) return;
    e.bot.swapHands().catch(() => {});
  }

  holdInventorySlot(id, index) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    const slot = b.inventory.slots[9 + index];
    if (!slot) return;
    b.equip(slot, "hand").catch(() => {});
  }

  unequipArmor(id, part) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    if (b.inventory.emptySlotCount() <= 0) return; // no space
    const mapping = { head: "head", chest: "torso", legs: "legs", feet: "feet" };
    b.unequip(mapping[part]).catch(() => {});
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
    const b = e.bot;
    b.setControlState('jump', true);
    setTimeout(() => b.setControlState('jump', false), 200);
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
    b.pathfinder.setGoal(new goals.GoalBlock(Math.round(target.x), Math.round(target.y), Math.round(target.z)));
  }

  gotoXYZ(id, x, y, z) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    // Try exact XYZ first
    const attempt = (gx, gy, gz) => b.pathfinder.setGoal(new goals.GoalBlock(gx, gy, gz), true);
    attempt(Math.round(x), Math.round(y), Math.round(z));
    // If fails, try nearest XZ with any Y
    setTimeout(() => {
      if (!b.pathfinder.isMoving()) attempt(Math.round(x), Math.round(b.entity.position.y), Math.round(z));
    }, 2000);
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
    const b = e.bot;
    b.lookAt(new Vec3(x, y, z)).catch(() => {});
  }

  // Actions
  setActionMode(id, action, mode, options) {
    const e = this.bots.get(id); if (!e?.bot) return;
    e.actions.setMode(action, mode, options);
  }

  // Misc toggles (auto features)
  setTweaks(id, toggles) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    // Auto-sprint
    if (toggles.autoSprint !== undefined) b.setControlState('sprint', !!toggles.autoSprint);
    // Auto-respawn
    if (toggles.autoRespawn !== undefined) {
      if (toggles.autoRespawn) {
        if (!e._resp) {
          e._resp = () => setTimeout(() => { try { b.respawn(); } catch {} }, 500);
          b.on("death", e._resp);
        }
      } else if (e._resp) {
        b.removeListener("death", e._resp);
        e._resp = null;
      }
    }
    // Auto-reconnect is handled by toggledConnected + on 'end'
    // Auto-jump: just keep jump when colliding – simplified: not implemented (MC has client auto-jump; headless doesn’t)
  }

  // Auto-sleep (every night in overworld within radius)
  enableAutoSleep(id, on) {
    const e = this.bots.get(id); if (!e?.bot) return;
    const b = e.bot;
    if (on) {
      if (e._sleepTimer) return;
      e._sleepTimer = setInterval(async () => {
        try {
          const dim = b.game?.dimension || "";
          if (!/overworld/i.test(dim)) return;
          const time = b.time?.timeOfDay || 0; // 0..24000
          const isNight = time > 12541 && time < 23458;
          if (!isNight) return;
          // search nearby beds within ~10 blocks
          const center = b.entity.position;
          const candidates = [];
          for (let dx = -10; dx <= 10; dx++) {
            for (let dz = -10; dz <= 10; dz++) {
              const pos = center.offset(dx, 0, dz);
              const block = b.blockAt(pos);
              if (block?.name?.includes("bed")) candidates.push(block);
            }
          }
          if (candidates.length) {
            const bed = candidates[0];
            await b.pathfinder.goto(new goals.GoalBlock(bed.position.x, bed.position.y, bed.position.z));
            await b.sleep(bed);
          }
        } catch {}
      }, 5000);
    } else {
      clearInterval(e._sleepTimer);
      e._sleepTimer = null;
    }
  }
}
