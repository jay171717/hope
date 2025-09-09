// src/antiAfk.js
import { Vec3 } from "vec3";

export function startAntiAfk(entry, io) {
  if (!entry?.bot) return;
  stopAntiAfk(entry); // clear any previous loop

  const bot = entry.bot;
  io.emit("bot:log", { id: entry.id, line: "Anti-AFK started." });

  entry._antiAfkInterval = setInterval(() => {
    if (!bot.entity) return;
    try {
      const action = pickRandom([
        "move", "look", "jump", "sneak", "attack", "hotbar", "chat"
      ]);
      switch (action) {
        case "move":
          doMove(bot, io, entry.id); break;
        case "look":
          doLook(bot, io, entry.id); break;
        case "jump":
          doJump(bot, io, entry.id); break;
        case "sneak":
          doSneak(bot, io, entry.id); break;
        case "attack":
          doAttack(bot, io, entry.id); break;
        case "hotbar":
          doHotbar(bot, io, entry.id); break;
        case "chat":
          doChat(bot, io, entry.id); break;
      }
    } catch (err) {
      io.emit("bot:log", { id: entry.id, line: `Anti-AFK error: ${err.message}` });
    }
  }, randomBetween(15000, 30000)); // every 15–30s
}

export function stopAntiAfk(entry) {
  if (entry._antiAfkInterval) {
    clearInterval(entry._antiAfkInterval);
    entry._antiAfkInterval = null;
    if (entry.id) {
      entry.bot?.chat?.("Stopping Anti-AFK.");
    }
  }
}

// --- Helpers ---
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- Actions ---
function doMove(bot, io, id) {
  const dir = pickRandom(["forward", "back", "left", "right"]);
  bot.setControlState(dir, true);
  setTimeout(() => bot.setControlState(dir, false), randomBetween(400, 1200));
  io.emit("bot:log", { id, line: `Anti-AFK: moved ${dir}` });
}

function doLook(bot, io, id) {
  const yaw = bot.entity.yaw + (Math.random() - 0.5) * Math.PI / 2;
  const pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, bot.entity.pitch + (Math.random() - 0.5) * Math.PI / 4));
  bot.look(yaw, pitch, true).catch(()=>{});
  io.emit("bot:log", { id, line: "Anti-AFK: looked around" });
}

function doJump(bot, io, id) {
  bot.setControlState("jump", true);
  setTimeout(() => bot.setControlState("jump", false), 300);
  io.emit("bot:log", { id, line: "Anti-AFK: jumped" });
}

function doSneak(bot, io, id) {
  bot.setControlState("sneak", true);
  setTimeout(() => bot.setControlState("sneak", false), randomBetween(1000, 3000));
  io.emit("bot:log", { id, line: "Anti-AFK: sneaked briefly" });
}

function doAttack(bot, io, id) {
  bot.swingArm("right");
  io.emit("bot:log", { id, line: "Anti-AFK: fake attack" });
}

function doHotbar(bot, io, id) {
  const slot = randomBetween(0, 8);
  bot.setQuickBarSlot(slot);
  io.emit("bot:log", { id, line: `Anti-AFK: switched to hotbar slot ${slot}` });
}

function doChat(bot, io, id) {
  const msg = pickRandom(["still here", "zzz", "just chilling", "alive"]);
  bot.chat(`/msg ${bot.username} ${msg}`);
  io.emit("bot:log", { id, line: `Anti-AFK: self-message "${msg}"` });
}
