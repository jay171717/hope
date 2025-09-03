/**
 * ActionController: Mine, Attack, Place, Eat, Drop
 * - "Once", "Interval", "Continuous", "Stop"
 * Notes:
 *  - Does NOT call bot.look() — actions only execute if the bot already has the target in reach/cursor/line-of-sight.
 *  - Continuous behavior uses small intervals or hold-style calls depending on action.
 */
const DEFAULT_INTERVAL_TICKS = 10;
const TICKS_PER_SECOND = 20;

function rad(deg) { return deg * Math.PI / 180; }

export class ActionController {
  constructor(bot) {
    this.bot = bot;
    this.active = new Map(); // action -> state
    this.listeners = new Set();
  }

  onUpdate(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.listActive()); }

  listActive() {
    const out = [];
    for (const [key, s] of this.active) {
      if (s.mode === "Stop") continue;
      out.push({ action: key, mode: s.mode, intervalGt: s.intervalGt || null });
    }
    return out;
  }

  stopAll() {
    for (const k of [...this.active.keys()]) this.setMode(k, "Stop");
  }

  setMode(action, mode, opts = {}) {
    const prev = this.active.get(action);
    if (prev?.timer) clearInterval(prev.timer);
    if (prev?.continuousStop) prev.continuousStop();

    if (mode === "Stop") {
      this.active.delete(action);
      this.emit();
      return;
    }

    const state = { mode, intervalGt: opts.intervalGt || DEFAULT_INTERVAL_TICKS };
    this.active.set(action, state);

    if (mode === "Once") this._performOnce(action);
    else if (mode === "Interval") {
      const ms = (state.intervalGt / TICKS_PER_SECOND) * 1000;
      state.timer = setInterval(() => this._performOnce(action), ms);
    } else if (mode === "Continuous") {
      state.continuousStop = this._startContinuous(action);
    }

    this.emit();
  }

  // Helper: is bot looking at entity/within angle threshold
  _isLookingAtEntity(ent, maxDeg = 35) {
    const b = this.bot;
    if (!ent || !ent.position || !b.entity || !b.entity.position) return false;
    const dx = ent.position.x - b.entity.position.x;
    const dy = (ent.position.y + (ent.height || 0) / 2) - (b.entity.position.y + 1.62);
    const dz = ent.position.z - b.entity.position.z;
    const distXZ = Math.sqrt(dx*dx + dz*dz);
    const yawTo = Math.atan2(dz, dx);
    const pitchTo = Math.atan2(dy, distXZ);
    const yawDiff = Math.abs(((b.entity.yaw - yawTo + Math.PI) % (2*Math.PI)) - Math.PI);
    const pitchDiff = Math.abs(((b.entity.pitch - pitchTo + Math.PI) % (2*Math.PI)) - Math.PI);
    return yawDiff <= rad(maxDeg) && pitchDiff <= rad(maxDeg);
  }

  _performOnce(action) {
    const b = this.bot;
    try {
      switch (action) {
        case "mine": {
          // only mine the block already in cursor (don't change look)
          let blk = null;
          try { blk = b.blockAtCursor(5); } catch {}
          if (blk) b.dig(blk).catch(() => {});
          break;
        }
        case "attack": {
          const ent = b.nearestEntity();
          if (ent && this._isLookingAtEntity(ent, 25)) b.attack(ent).catch(()=>{});
          break;
        }
        case "place": {
          // place only if there's a block in cursor and item in hand (no look change)
          let blk = null;
          try { blk = b.blockAtCursor(5); } catch {}
          if (blk && b.heldItem) {
            b.activateItem(false);
            setTimeout(() => b.deactivateItem(), 150);
          }
          break;
        }
        case "eat": {
          // consume only if the bot is already holding edible
          if (b.heldItem && /apple|bread|porkchop|beef|chicken|mushroom_stew|rabbit|melon|cookie|potato/i.test(b.heldItem.name)) {
            b.activateItem(false);
            setTimeout(() => b.deactivateItem(), 1200);
          }
          break;
        }
        case "drop": {
          if (b.heldItem) b.toss(b.heldItem.type, null, 1).catch(()=>{});
          break;
        }
      }
    } catch (e) { /* swallow */ }
  }

  _startContinuous(action) {
    const b = this.bot;
    // Returns a stop function to be saved by state.continuousStop
    if (action === "mine") {
      let running = true;
      const loop = async () => {
        while (running) {
          try {
            const blk = b.blockAtCursor(5);
            if (blk) await b.dig(blk);
          } catch {}
          await new Promise(r => setTimeout(r, 400));
        }
      };
      loop();
      return () => { running = false; };
    }
    if (action === "attack") {
      let running = true;
      const loop = async () => {
        while (running) {
          try {
            const ent = b.nearestEntity();
            if (ent && this._isLookingAtEntity(ent, 25)) await b.attack(ent);
          } catch {}
          await new Promise(r => setTimeout(r, 300));
        }
      };
      loop();
      return () => { running = false; };
    }
    if (action === "place") {
      let running = true;
      const loop = async () => {
        while (running) {
          try {
            const blk = b.blockAtCursor(5);
            if (blk && b.heldItem) {
              b.activateItem(true);
              await new Promise(r => setTimeout(r, 200));
              b.deactivateItem();
            }
          } catch {}
          await new Promise(r => setTimeout(r, 400));
        }
      };
      loop();
      return () => { running = false; };
    }
    if (action === "eat") {
      // hold consume
      try { b.activateItem(true); } catch {}
      return () => { try { b.deactivateItem(); } catch {} };
    }
    if (action === "drop") {
      let running = true;
      const loop = async () => {
        while (running) {
          try {
            if (b.heldItem) await b.toss(b.heldItem.type, null, 1);
          } catch {}
          await new Promise(r => setTimeout(r, 250));
        }
      };
      loop();
      return () => { running = false; };
    }
    return () => {};
  }
}
