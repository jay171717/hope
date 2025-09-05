import { Vec3 } from "vec3";
import { goals } from "mineflayer-pathfinder";

// Sneak toggle
export function toggleSneak(e, io) {
  if (!e.bot) return;
  e._sneakState = !e._sneakState;
  try { e.bot.setControlState("sneak", e._sneakState); } catch {}
  io.emit("bot:log", { id: e.id, line: `Sneak ${e._sneakState ? "ON" : "OFF"}` });
}

// Auto sleep
export function ensureAutoSleep(e, io) {
  if (!e.bot) { e.tweaks.autoSleep = true; return; }
  if (e._sleepTimer) return;
  const b = e.bot;

  e._sleepTimer = setInterval(async () => {
    try {
      if (!b) return;
      if (!/overworld/i.test(b.game?.dimension || "")) return;

      const time = b.time?.timeOfDay || 0;
      const isNight = time > 12541 && time < 23458;
      if (!isNight || b.isSleeping) return;

      const beds = b.findBlocks({
        matching: block => block?.name?.includes("bed"),
        maxDistance: 10,
        count: 5
      });

      if (!beds.length) return;
      const bedPos = beds[0];

      io.emit("bot:log", { id: e.id, line: `AutoSleep: found bed at ${bedPos}` });

      const goal = new goals.GoalGetToBlock(bedPos.x, bedPos.y, bedPos.z);
      await b.pathfinder.goto(goal).catch(() => {});

      const bedBlock = b.blockAt(bedPos);
      if (bedBlock) {
        try {
          await b.sleep(bedBlock);
          io.emit("bot:log", { id: e.id, line: "Bot is now sleeping." });
        } catch (err) {
          io.emit("bot:log", { id: e.id, line: `Sleep failed: ${err?.message || err}` });
        }
      }
    } catch {}
  }, 5000);
}

export function clearAutoSleep(e) {
  if (e._sleepTimer) { clearInterval(e._sleepTimer); e._sleepTimer = null; }
}
