// src/extras.js
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
import { Vec3 } from "vec3";

// sneak
export function toggleSneak(entry, io) {
  if (!entry?.bot) return false;

  // track sneaking state per entry
  entry.isSneaking = !entry.isSneaking;

  try {
    entry.bot.setControlState("sneak", entry.isSneaking);

    const status = entry.isSneaking ? "activated" : "deactivated";
    io.emit("bot:log", {
      id: entry.id,
      line: `Sneak mode ${status}`
    });

    return entry.isSneaking;
  } catch (err) {
    io.emit("bot:log", {
      id: entry.id,
      line: `toggleSneak error: ${err.message}`
    });
    return false;
  }
}



// --- Auto sleep handling ---
export function ensureAutoSleep(entry, io) {
  if (!entry?.bot) return;
  if (entry._sleepTimer) return;

  const b = entry.bot;
  entry._sleepTimer = setInterval(async () => {
    try {
      if (!b || !b.entity) return;

      const time = b.time?.timeOfDay ?? 0;
      const isNight = time > 12541 && time < 23458;
      if (!isNight) return;

      io.emit("bot:log", { id: entry.id, line: "Auto-sleep: searching for beds..." });

      const beds = b.findBlocks({
        matching: (block) => block.name.includes("bed"),
        maxDistance: 10,
        count: 5
      });

      if (!beds.length) return;
      const bedPos = beds[0];
      io.emit("bot:log", { id: entry.id, line: `Auto-sleep: found bed at (${bedPos.x}, ${bedPos.y}, ${bedPos.z})` });

      // Pathfind to bed
      const goal = new goals.GoalGetToBlock(bedPos.x, bedPos.y, bedPos.z);
      await b.pathfinder.goto(goal);
      io.emit("bot:log", { id: entry.id, line: "Auto-sleep: reached bed position" });

      const bedBlock = b.blockAt(new Vec3(bedPos.x, bedPos.y, bedPos.z));
      if (!bedBlock) return;

      // Try proper sleep first
      try {
        await b.sleep(bedBlock);
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: bot is now sleeping" });
      } catch (err) {
        io.emit("bot:log", { id: entry.id, line: `Auto-sleep: failed normal sleep - ${err.message}` });

        // Log nearby mobs that might block sleep
        try {
          const mobs = Object.values(b.entities)
            .filter(e => e.type === "mob" && e.position.distanceTo(b.entity.position) <= 8);
          if (mobs.length) {
            for (const m of mobs) {
              io.emit("bot:log", {
                id: entry.id,
                line: `Nearby mob: ${m.name || m.type} at ${m.position.distanceTo(b.entity.position).toFixed(1)} blocks`
              });
            }
          } else {
            io.emit("bot:log", { id: entry.id, line: "No mobs detected nearby, strange!" });
          }
        } catch {}

        // Fallback: right click bed
        try {
          await b.activateBlock(bedBlock);
          io.emit("bot:log", { id: entry.id, line: "Auto-sleep: tried fallback activateBlock()" });
        } catch (fallbackErr) {
          io.emit("bot:log", { id: entry.id, line: `Auto-sleep: fallback failed - ${fallbackErr.message}` });
        }
      }
    } catch (err) {
      io.emit("bot:log", { id: entry.id, line: `Auto-sleep error: ${err.message}` });
    }
  }, 10000); // check every 10s
}

export function clearAutoSleep(entry) {
  if (entry._sleepTimer) {
    clearInterval(entry._sleepTimer);
    entry._sleepTimer = null;
  }
}
