// extras.js
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;

/**
 * Toggle sneak on/off for the bot
 */
export function toggleSneak(entry, io) {
  if (!entry.bot) return;
  entry._sneakState = !entry._sneakState;
  entry.bot.setControlState("sneak", entry._sneakState);

  io.emit("bot:log", {
    id: entry.id,
    line: `Sneak ${entry._sneakState ? "ON" : "OFF"}`
  });
}

/**
 * Enable auto sleep with debug logging
 */
export function ensureAutoSleep(entry, io) {
  if (!entry.bot) return;
  if (entry._sleepTimer) return;

  const b = entry.bot;

  entry._sleepTimer = setInterval(async () => {
    try {
      // Check time
      const time = b.time?.timeOfDay || 0;
      const isNight = time > 12541 && time < 23458;
      if (!isNight) {
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: not night time" });
        return;
      }

      if (b.isSleeping) {
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: already sleeping" });
        return;
      }

      io.emit("bot:log", { id: entry.id, line: "Auto-sleep: searching for beds..." });

      // Find nearby beds
      const bed = b.findBlock({
        matching: block => block.name.includes("bed"),
        maxDistance: 10
      });

      if (!bed) {
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: no bed found nearby" });
        return;
      }

      io.emit("bot:log", {
        id: entry.id,
        line: `Auto-sleep: found bed at (${bed.position.x}, ${bed.position.y}, ${bed.position.z})`
      });

      // Pathfind to bed
      try {
        await b.pathfinder.goto(
          new goals.GoalGetToBlock(bed.position.x, bed.position.y, bed.position.z)
        );
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: reached bed position" });
      } catch (err) {
        io.emit("bot:log", { id: entry.id, line: `Auto-sleep: pathfinding failed - ${err.message}` });
        return;
      }

      // Try to sleep
      const bedBlock = b.blockAt(bed.position);
      if (!bedBlock) {
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: bed block missing at position" });
        return;
      }

      try {
        await b.sleep(bedBlock);
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: bot is now sleeping" });
      } catch (err) {
        io.emit("bot:log", { id: entry.id, line: `Auto-sleep: failed to sleep - ${err.message}` });
      }
    } catch (err) {
      io.emit("bot:log", { id: entry.id, line: `Auto-sleep error: ${err.message}` });
    }
  }, 5000);
}

export function clearAutoSleep(entry) {
  if (entry._sleepTimer) {
    clearInterval(entry._sleepTimer);
    entry._sleepTimer = null;
  }
}
