import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { Vec3 } from "vec3";

/**
 * Sneak toggle for a bot entry
 */
export function toggleSneak(entry, io) {
  if (!entry?.bot) return;
  entry._sneakState = !entry._sneakState;
  try {
    entry.bot.setControlState("sneak", entry._sneakState);
    io.emit("bot:log", { id: entry.id, line: `Sneak ${entry._sneakState ? "ON" : "OFF"}` });
  } catch (err) {
    io.emit("bot:log", { id: entry.id, line: `Sneak toggle error: ${err.message || err}` });
  }
}

/**
 * Auto-sleep helpers
 */
export function ensureAutoSleep(entry, io) {
  if (!entry?.bot) return;
  if (entry._sleepTimer) return;

  const b = entry.bot;
  entry._sleepTimer = setInterval(async () => {
    try {
      const time = b.time?.timeOfDay || 0;
      const isNight = time > 12541 && time < 23458;
      if (!isNight || b.isSleeping) return;

      const bed = b.findBlock({
        matching: block => block.name.includes("bed"),
        maxDistance: 10
      });
      if (!bed) return;

      io.emit("bot:log", { id: entry.id, line: `Auto-sleep: found bed at ${bed.position}` });

      try {
        await b.pathfinder.goto(new goals.GoalGetToBlock(bed.position.x, bed.position.y, bed.position.z));
        const bedBlock = b.blockAt(bed.position);
        if (bedBlock) {
          await b.sleep(bedBlock);
          io.emit("bot:log", { id: entry.id, line: "Auto-sleep: bot is now sleeping" });
        }
      } catch (err) {
        io.emit("bot:log", { id: entry.id, line: `Auto-sleep error: ${err.message}` });
      }
    } catch {}
  }, 5000);
}

export function clearAutoSleep(entry) {
  if (entry._sleepTimer) {
    clearInterval(entry._sleepTimer);
    entry._sleepTimer = null;
  }
}
