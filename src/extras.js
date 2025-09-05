// src/extras.js
import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { Vec3 } from "vec3";

/**
 * Robust sneak toggle + auto-sleep helpers.
 *
 * toggleSneak(entry, io) -> flips/enforces sneak, returns current state (true = sneaking)
 * clearSneak(entry) -> stops enforcing sneak and clears timers
 *
 * ensureAutoSleep(entry, io) and clearAutoSleep(entry) are included (kept from your working version).
 */

// ---------- Sneak ----------
// extras.js (replace toggleSneak & clearSneak)

export function toggleSneak(entry, io) {
  if (!entry?.bot) return false;
  const bot = entry.bot;

  entry._sneakState = !entry._sneakState;

  if (entry._sneakState) {
    // enable sneak
    if (entry._sneakInterval) clearInterval(entry._sneakInterval);
    bot.setControlState("sneak", true);
    entry._sneakInterval = setInterval(() => {
      bot.setControlState("sneak", true);
    }, 1000);

    io.emit("bot:log", { id: entry.id, line: "Sneak mode activated" });
  } else {
    // disable sneak
    if (entry._sneakInterval) {
      clearInterval(entry._sneakInterval);
      entry._sneakInterval = null;
    }
    bot.setControlState("sneak", false);

    io.emit("bot:log", { id: entry.id, line: "Sneak mode deactivated" });
  }

  return entry._sneakState;
}

export function clearSneak(entry) {
  if (!entry) return;
  if (entry._sneakInterval) {
    clearInterval(entry._sneakInterval);
    entry._sneakInterval = null;
  }
  if (entry.bot) {
    entry.bot.setControlState("sneak", false);
  }
  entry._sneakState = false;
}


// ---------- Auto-sleep (kept & slightly hardened) ----------
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
        matching: (block) => block && block.name && block.name.includes("bed"),
        maxDistance: 10,
        count: 6
      });

      if (!beds || beds.length === 0) {
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: no bed found nearby" });
        return;
      }

      // choose nearest bed (by euclidean distance)
      const myPos = b.entity.position;
      let best = beds[0];
      let bestDist = myPos.distanceTo(new Vec3(best.x, best.y, best.z));
      for (const bp of beds) {
        const d = myPos.distanceTo(new Vec3(bp.x, bp.y, bp.z));
        if (d < bestDist) { best = bp; bestDist = d; }
      }

      const bedPos = best;
      io.emit("bot:log", { id: entry.id, line: `Auto-sleep: found bed at (${bedPos.x}, ${bedPos.y}, ${bedPos.z})` });

      try {
        await b.pathfinder.goto(new goals.GoalGetToBlock(bedPos.x, bedPos.y, bedPos.z));
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: reached bed position" });
      } catch (err) {
        io.emit("bot:log", { id: entry.id, line: `Auto-sleep: pathfinding failed - ${err?.message || err}` });
        return;
      }

      const bedBlock = b.blockAt(new Vec3(bedPos.x, bedPos.y, bedPos.z));
      if (!bedBlock) {
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: bed block missing at position" });
        return;
      }

      try {
        await b.sleep(bedBlock);
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: bot is now sleeping" });
      } catch (err) {
        io.emit("bot:log", { id: entry.id, line: `Auto-sleep: failed normal sleep - ${err?.message || err}` });

        // log mobs near (within 8 blocks)
        try {
          const mobs = Object.values(b.entities || {}).filter(e => e && e.type === "mob" && e.position && b.entity && e.position.distanceTo(b.entity.position) <= 8);
          if (mobs.length) {
            mobs.forEach(m => {
              const dist = (m.position && b.entity) ? m.position.distanceTo(b.entity.position) : NaN;
              io.emit("bot:log", { id: entry.id, line: `Nearby mob: ${m.name || m.type} at ${isNaN(dist) ? "?" : dist.toFixed(1)} blocks` });
            });
          } else {
            io.emit("bot:log", { id: entry.id, line: "No mobs detected nearby (per bot.entities)" });
          }
        } catch (e) {}

        // fallback: right-click the bed (activateBlock)
        try {
          await b.activateBlock(bedBlock);
          io.emit("bot:log", { id: entry.id, line: "Auto-sleep: tried fallback activateBlock()" });
        } catch (fallbackErr) {
          io.emit("bot:log", { id: entry.id, line: `Auto-sleep: fallback failed - ${fallbackErr?.message || fallbackErr}` });
        }
      }

    } catch (err) {
      io.emit("bot:log", { id: entry.id, line: `Auto-sleep error: ${err?.message || err}` });
    }
  }, 10000);
}

export function clearAutoSleep(entry) {
  if (!entry) return;
  if (entry._sleepTimer) { clearInterval(entry._sleepTimer); entry._sleepTimer = null; }
}
