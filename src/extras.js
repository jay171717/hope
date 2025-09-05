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
function _writeEntityActionIfPossible(bot, action) {
  // action: 1 = start sneaking, 2 = stop sneaking
  try {
    const id = bot?.entity?.id;
    if (!id) return;
    if (bot._client && typeof bot._client.write === "function") {
      try { bot._client.write("entity_action", { entityId: id, action }); } catch {}
    }
  } catch (e) {}
}

export function toggleSneak(entry, io) {
  if (!entry || !entry.bot) return false;
  const bot = entry.bot;

  // very short debounce to avoid accidental double toggles from UI clicks
  const now = Date.now();
  if (entry._lastSneakToggle && now - entry._lastSneakToggle < 80) {
    entry._lastSneakToggle = now;
    // allow toggle to continue anyway (don't return early) — but update timestamp
  }
  entry._lastSneakToggle = now;

  try {
    // flip state
    entry._sneakState = !entry._sneakState;

    if (entry._sneakState) {
      // start enforcing sneak repeatedly
      // clear any previous "stop retry" timers
      if (entry._sneakStopRetryTimers) {
        entry._sneakStopRetryTimers.forEach(t => clearTimeout(t));
        entry._sneakStopRetryTimers = null;
      }
      // ensure no duplicate interval
      if (entry._sneakInterval) clearInterval(entry._sneakInterval);
      // enforce every 200ms (keeps state despite interference)
      entry._sneakInterval = setInterval(() => {
        try { bot.setControlState("sneak", true); } catch (e) {}
        // best-effort: send entity_action start (some servers respond better to packet)
        _writeEntityActionIfPossible(bot, 1);
      }, 200);
      // immediate enforcement
      try { bot.setControlState("sneak", true); } catch (e) {}
      _writeEntityActionIfPossible(bot, 1);

    } else {
      // turning off: clear enforce interval and attempt multiple stop packets
      if (entry._sneakInterval) { clearInterval(entry._sneakInterval); entry._sneakInterval = null; }
      // also clear any legacy timers names (defensive)
      if (entry._sneakTimer) { clearInterval(entry._sneakTimer); entry._sneakTimer = null; }

      try { bot.setControlState("sneak", false); } catch (e) {}
      // send stop packet multiple times to be robust
      const timers = [];
      const sendStop = () => { try { _writeEntityActionIfPossible(bot, 2); } catch {} };
      sendStop();
      timers.push(setTimeout(sendStop, 150));
      timers.push(setTimeout(sendStop, 400));
      // keep references so clearSneak can cancel them (if needed)
      entry._sneakStopRetryTimers = timers;
    }

    io.emit("bot:log", { id: entry.id, line: `Sneak mode ${entry._sneakState ? "activated" : "deactivated"}` });
    return !!entry._sneakState;
  } catch (err) {
    io.emit("bot:log", { id: entry.id, line: `toggleSneak error: ${err?.message || err}` });
    return false;
  }
}

export function clearSneak(entry) {
  try {
    if (!entry) return;
    if (entry._sneakInterval) { clearInterval(entry._sneakInterval); entry._sneakInterval = null; }
    if (entry._sneakTimer) { clearInterval(entry._sneakTimer); entry._sneakTimer = null; }
    if (entry._sneakStopRetryTimers && Array.isArray(entry._sneakStopRetryTimers)) {
      entry._sneakStopRetryTimers.forEach(t => clearTimeout(t));
      entry._sneakStopRetryTimers = null;
    }
    if (entry.bot) {
      try { entry.bot.setControlState("sneak", false); } catch (e) {}
      try { _writeEntityActionIfPossible(entry.bot, 2); } catch (e) {}
    }
    entry._sneakState = false;
  } catch (e) {}
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
