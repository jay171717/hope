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
    return [...this.bots.entries()].map(([id, b]) => this._publicBotInfo(id, b));
  }

  _publicBotInfo(id, data) {
    return {
      id,
      name: data.name,
      online: !!data?.bot && data.bot.player,
      toggledConnected: data.toggledConnected,
      description: data.description || "",
      headUrl: `${this.headBase}/${encodeURIComponent(data.name)}/32`
    };
  }

  broadcastList() { this.io.emit("bot:list", this.list()); }

  addBot({ name, auth="offline" }) {
    const id = name.toLowerCase() + "-" + Date.now();
    const entry = {
      id, name, auth, bot: null, mcData: null,
      actions: null, toggledConnected: true,
      description: "", lastSeen: null
    };
    this.bots.set(id, entry);
    this._spawn(entry);
    this.broadcastList();
    return this._publicBotInfo(id, entry);
  }

  setDescription(id, text) {
    const e = this.bots.get(id); if (!e) return;
    e.description = text;
    this.io.emit("bot:description", { id, description: e.description });
  }

  toggleConnection(id, on) {
    const e = this.bots.get(id); if (!e) return;
    e.toggledConnected = !!on;
    if (on && !e.bot) this._spawn(e);
    if (!on && e.bot) e.bot.end("User toggled disconnect");
    this.broadcastList();
  }

  removeBot(id) {
    const e = this.bots.get(id); if (!e) return;
    if (e.bot) e.bot.end("Deleted");
    this.bots.delete(id);
    this.broadcastList();
  }

  _spawn(entry) {
    const bot = mineflayer.createBot({
      host: this.serverHost, port: this.serverPort,
      username: entry.name, auth: entry.auth,
      version: this.fixedVersion || false
    });

    entry.bot = bot;
    entry.actions = new ActionController(bot);
    bot.loadPlugin(pathfinder);

    bot.once("spawn", () => {
      entry.mcData = mcdataFactory(bot.version);
      this._telemetry(entry);
      this.io.emit("bot:status", { id: entry.id, status: "online" });
      this.broadcastList();
    });

    bot.on("end", () => {
      entry.bot = null;
      setTimeout(() => {
        if (entry.toggledConnected) this._spawn(entry);
      }, 3000);
      this.broadcastList();
    });

    bot.on("messagestr", msg => this.io.emit("bot:chat", { id: entry.id, line: msg }));
  }

  _telemetry(entry) {
    const bot = entry.bot;
    setInterval(() => {
      if (!entry.bot) return;
      const b = entry.bot;
      this.io.emit("bot:telemetry", {
        id: entry.id,
        status: {
          pos: b.entity.position,
          yaw: b.entity.yaw, pitch: b.entity.pitch,
          health: b.health, hunger: b.food, xp: b.experience?.level
        },
        inventory: this._serializeInventory(b)
      });
    }, 1000);
  }

  _serializeInventory(b) {
    const inv = b.inventory;
    const slots = Array.from({ length: 36 }, (_, i) => inv.slots[9 + i] || null);
    const toItem = it => it ? ({
      name: it.name, count: it.count,
      durability: it.maxDurability ? (it.maxDurability - it.durabilityUsed) : null,
      enchants: []
    }) : null;
    return {
      slots: slots.map(toItem),
      armor: { head:null,chest:null,legs:null,feet:null },
      mainHand: toItem(b.heldItem),
      offHand: toItem(inv.slots[45] || null)
    };
  }

  chat(id, text) { const e=this.bots.get(id); if(e?.bot) e.bot.chat(text); }
  respawn(id) { const e=this.bots.get(id); e?.bot?.respawn(); }
  swapHands(id) { const e=this.bots.get(id); e?.bot?.swapHands(); }
  holdInventorySlot(id, i) {
    const e=this.bots.get(id); if (!e?.bot) return;
    const slot=e.bot.inventory.slots[9+i]; if (slot) e.bot.equip(slot,"hand");
  }
  setContinuousMove(id, dir, on) {
    const map={W:"forward",A:"left",S:"back",D:"right"};
    const e=this.bots.get(id); if (e?.bot) e.bot.setControlState(map[dir],on);
  }
  jumpOnce(id) { const e=this.bots.get(id); if(e?.bot){e.bot.setControlState("jump",true);setTimeout(()=>e.bot.setControlState("jump",false),200);} }
  moveBlocks(id,dir,blocks){/* simplified, similar to before */}
  gotoXYZ(id,x,y,z){ const e=this.bots.get(id); if(e?.bot)e.bot.pathfinder.setGoal(new goals.GoalBlock(x,y,z)); }
  rotateStep(id,dyaw,dpitch){ const e=this.bots.get(id); if(e?.bot) e.bot.look(e.bot.entity.yaw+dyaw*Math.PI/180,e.bot.entity.pitch+dpitch*Math.PI/180,true); }
  lookAtAngles(id,y,p){ const e=this.bots.get(id); if(e?.bot) e.bot.look(y*Math.PI/180,p*Math.PI/180,true); }
  setActionMode(id,a,m,o){ const e=this.bots.get(id); e?.actions?.setMode(a,m,o); }
  setTweaks(id,t){ /* handle autoRespawn, autoSprint, autoEat, follow etc. */ }
}
