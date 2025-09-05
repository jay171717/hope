// src/extras.js
import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { Vec3 } from "vec3";

/**
 * Robust sneak toggle:
 * - debounce quick flips
 * - keep re-applying sneak while enabled (interval)
 * - fallback: send 'entity_action' packet start/stop sneak (best-effort)
 */
export function toggleSneak(entry, io) {
  if (!entry || !entry.bot) return false;

  const now = Date.now();
  // debounce spurious rapid toggles (120ms)
  if (entry._lastSneakToggle && now - entry._lastSneakToggle < 120) {
    entry._lastSneakToggle = now;
    return entry._sneakState || false;
  }
  entry._lastSneakToggle = now;

  try {
    // flip state
    entry._sneakState = !entry._sneakState;

    if (entry._sneakState) {
      // start enforcing sneak repeatedly
      if (!entry._sneakInterval) {
        entry._sneakInterval = setInterval(() => {
          try { entry.bot.setControlState("sneak", true); } catch (e) {}
          // send packet fallback (best effort)
          try {
            const id = entry.bot.entity?.id;
            if (id && entry.bot._client && typeof entry.bot._client.write === "function") {
              // entity_action packet: action 1 = start sneaking (2 = stop sneaking)
              try { entry.bot._client.write("entity_action", { entityId: id, action: 1 }); } catch(e){}
            }
          } catch (e) {}
        }, 200);
      }
      // immediate enforcement
      try { entry.bot.setControlState("sneak", true); } catch (e) {}
      try {
        const id = entry.bot.entity?.id;
        if (id && entry.bot._client && typeof entry.bot._client.write === "function") {
          try { entry.bot._client.write("entity_action", { entityId: id, action: 1 }); } catch(e){}
        }
      } catch (e) {}
    } else {
      // turn off
      if (entry._sneakInterval) { clearInterval(entry._sneakInterval); entry._sneakInterval = null; }
      try { entry.bot.setControlState("sneak", false); } catch (e) {}
      try {
        const id = entry.bot.entity?.id;
        if (id && entry.bot._client && typeof entry.bot._client.write === "function") {
          try { entry.bot._client.write("entity_action", { entityId: id, action: 2 }); } catch(e) {}
        }
      } catch (e) {}
    }

    io.emit("bot:log", { id: entry.id, line: `Sneak mode ${entry._sneakState ? "activated" : "deactivated"}` });
    return entry._sneakState;
  } catch (err) {
    io.emit("bot:log", { id: entry.id, line: `toggleSneak error: ${err?.message || err}` });
    return false;
  }
}

/**
 * Stop sneak enforcement and clear state (call when cleaning up bot)
 */
export function clearSneak(entry) {
  try {
    if (!entry) return;
    if (entry._sneakInterval) { clearInterval(entry._sneakInterval); entry._sneakInterval = null; }
    if (entry.bot) try { entry.bot.setControlState("sneak", false); } catch (e) {}
    entry._sneakState = false;
  } catch (e) {}
}

// --- Auto-sleep kept as before (with logging & fallback) ---
// ensureAutoSleep / clearAutoSleep from previous working version

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
        count: 5
      });

      if (!beds || beds.length === 0) {
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: no bed found nearby" });
        return;
      }
      const bedPos = beds[0];
      io.emit("bot:log", { id: entry.id, line: `Auto-sleep: found bed at (${bedPos.x}, ${bedPos.y}, ${bedPos.z})` });

      // pathfind
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

      // try normal sleep
      try {
        await b.sleep(bedBlock);
        io.emit("bot:log", { id: entry.id, line: "Auto-sleep: bot is now sleeping" });
      } catch (err) {
        io.emit("bot:log", { id: entry.id, line: `Auto-sleep: failed normal sleep - ${err?.message || err}` });

        // log nearby mobs up to 8 blocks
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

        // fallback: right-click the bed
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
