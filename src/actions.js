import { Vec3 } from "vec3";

/**
 * Actions: mine, attack, place, eat, drop
 * Modes: Once, Interval, Stop  (No Continuous)
 *
 * - Attack uses entityAtCursor (what bot is actually looking at)
 * - Place tries placeBlock / falls back to activateItem, and restores look after
 * - Eat uses bot.consume() if available to finish eating
 */
const DEFAULT_INTERVAL_TICKS = 10;
const TICKS_PER_SECOND = 20;

export class ActionController {
  constructor(bot) {
    this.bot = bot;
    this.active = new Map();
    this.listeners = new Set();
  }

  onUpdate(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.listActive()); }

  listActive() {
    const arr = [];
    for (const [k, s] of this.active) {
      if (s.mode === "Stop") continue;
      arr.push({ action: k, mode: s.mode, intervalGt: s.intervalGt || null });
    }
    return arr;
  }

  stopAll() {
    for (const k of [...this.active.keys()]) this.setMode(k, "Stop");
  }

  setMode(key, mode, opts = {}) {
    const prev = this.active.get(key);
    if (prev?.timer) clearInterval(prev.timer);

    if (mode === "Stop") {
      this.active.delete(key);
      this.emit();
      return;
    }

    const state = { mode, intervalGt: opts.intervalGt || DEFAULT_INTERVAL_TICKS, dropStack: !!opts.dropStack };
    this.active.set(key, state);

    if (mode === "Once") this._performOnce(key, state);
    else if (mode === "Interval") {
      const ms = (state.intervalGt / TICKS_PER_SECOND) * 1000;
      state.timer = setInterval(() => this._performOnce(key, state), ms);
    }

    this.emit();
  }

  _saveLook() {
    const b = this.bot;
    if (!b || !b.entity) return null;
    return { yaw: b.entity.yaw, pitch: b.entity.pitch };
  }
  _restoreLook(l) {
    if (!l) return;
    try { this.bot.look(l.yaw, l.pitch, false).catch(()=>{}); } catch {}
  }

  _isEntityInSight(entity, maxDeg = 25) {
    if (!entity || !this.bot.entity) return false;
    try {
      const botPos = this.bot.entity.position;
      const dx = entity.position.x - botPos.x;
      const dz = entity.position.z - botPos.z;
      const yawTo = Math.atan2(dz, dx);
      const yawDiff = Math.abs(((this.bot.entity.yaw - yawTo + Math.PI) % (2*Math.PI)) - Math.PI);
      const yawDeg = Math.abs(yawDiff * 180 / Math.PI);
      return yawDeg <= maxDeg;
    } catch { return false; }
  }

  async _performOnce(key, state) {
    const b = this.bot;
    if (!b) return;
    const prev = this._saveLook();
    try {
      switch (key) {
        case "mine": {
          const blk = (() => { try { return b.blockAtCursor(6); } catch { return null; } })();
          if (blk) await b.dig(blk).catch(()=>{});
          break;
        }
        case "attack": {
          // prefer entityAtCursor (what bot is actually looking at)
          let target = null;
          try { target = b.entityAtCursor ? b.entityAtCursor(6) : null; } catch {}
          if (!target) {
            // fallback: nearest entity but must be in sight
            try {
              const ne = b.nearestEntity ? b.nearestEntity() : null;
              if (ne && this._isEntityInSight(ne)) target = ne;
            } catch {}
          }
          if (target) await b.attack(target).catch(()=>{});
          break;
        }
        case "place": {
          const blk = (() => { try { return b.blockAtCursor(6); } catch { return null; } })();
          if (blk && b.heldItem) {
            try {
              // prefer placeBlock if available
              if (typeof b.placeBlock === "function") {
                await b.placeBlock(blk, new Vec3(0, 1, 0)).catch(()=>{});
              } else {
                // fallback: activateItem briefly
                b.activateItem(false);
                setTimeout(()=>{ try { b.deactivateItem(); } catch {} }, 150);
              }
            } catch {}
          }
          break;
        }
        case "eat": {
          if (b.heldItem) {
            if (typeof b.consume === "function") {
              await b.consume().catch(()=>{});
            } else {
              b.activateItem(false);
              await new Promise(r => setTimeout(r, 1500));
              try { b.deactivateItem(); } catch {}
            }
          }
          break;
        }
        case "drop": {
          if (b.heldItem) {
            if (state.dropStack && typeof b.tossStack === "function") await b.tossStack(b.heldItem).catch(()=>{});
            else await b.toss(b.heldItem.type, null, 1).catch(()=>{});
          }
          break;
        }
      }
    } catch {}
    finally {
      this._restoreLook(prev);
    }
  }
}
