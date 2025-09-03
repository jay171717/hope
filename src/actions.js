import { Vec3 } from "vec3";

/**
 * Actions: mine, attack, place, eat, drop
 * Modes: Once, Interval, Continuous, Stop
 *
 * - Attack only if the entity is roughly in the bot's look direction (angle check)
 * - Place uses blockAtCursor and placeBlock() where possible, without changing look
 * - Eat uses bot.consume() when available
 */
const DEFAULT_INTERVAL_TICKS = 10;
const TICKS_PER_SECOND = 20;

function degToRad(d) { return d * Math.PI / 180; }

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
    if (prev?.continuousStop) prev.continuousStop();

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
    } else if (mode === "Continuous") {
      state.continuousStop = this._startContinuous(key, state);
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

  _isLookingAtEntity(entity, maxDeg = 25) {
    if (!entity || !entity.position || !this.bot.entity) return false;
    const botPos = this.bot.entity.position;
    const dx = entity.position.x - botPos.x;
    const dz = entity.position.z - botPos.z;
    const yawTo = Math.atan2(dz, dx);
    // mineflayer yaw is rotated relative; compare difference
    const yawDiff = Math.abs(((this.bot.entity.yaw - yawTo + Math.PI) % (2*Math.PI)) - Math.PI);
    const yawDeg = Math.abs(yawDiff * 180 / Math.PI);
    return yawDeg <= maxDeg;
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
          // prefer entityAtCursor (if available) so we attack what we're looking directly at
          let target = null;
          try { target = b.entityAtCursor ? b.entityAtCursor(6) : null; } catch {}
          if (!target) {
            // fallback: nearest entity but require angle check
            try { const ne = b.nearestEntity(); if (ne && this._isLookingAtEntity(ne)) target = ne; } catch {}
          }
          if (target) await b.attack(target).catch(()=>{});
          break;
        }
        case "place": {
          // try to place against the block at cursor (without forcing look)
          const blk = (() => { try { return b.blockAtCursor(6); } catch { return null; } })();
          if (blk && b.heldItem) {
            // find adjacent position / if placeBlock API exists
            try {
              // mineflayer place API: bot.placeBlock(referenceBlock, directionVector)
              const vec = new Vec3(0, 1, 0);
              await b.placeBlock(blk, vec).catch(() => {});
            } catch {
              // fallback: activate item (brief)
              b.activateItem(false);
              setTimeout(()=>{ try { b.deactivateItem(); } catch {} }, 150);
            }
          }
          break;
        }
        case "eat": {
          if (b.heldItem) {
            if (typeof b.consume === "function") {
              await b.consume().catch(()=>{});
            } else {
              b.activateItem(false);
              // ensure longer duration so it finishes
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
    } catch (err) {
      // no-op
    } finally {
      this._restoreLook(prev);
    }
  }

  _startContinuous(key, state) {
    const b = this.bot;
    if (!b) return () => {};
    if (key === "mine") {
      let running = true;
      (async () => {
        while (running) {
          const prev = this._saveLook();
          try {
            const blk = (() => { try { return b.blockAtCursor(6); } catch { return null; } })();
            if (blk) await b.dig(blk).catch(()=>{});
          } catch {}
          this._restoreLook(prev);
          await new Promise(r => setTimeout(r, 500));
        }
      })();
      return () => { running = false; };
    }
    if (key === "attack") {
      let running = true;
      (async () => {
        while (running) {
          try {
            let target = null;
            try { target = b.entityAtCursor ? b.entityAtCursor(6) : null; } catch {}
            if (!target) {
              const ne = b.nearestEntity ? b.nearestEntity() : null;
              if (ne && this._isLookingAtEntity(ne)) target = ne;
            }
            if (target) await b.attack(target).catch(()=>{});
          } catch {}
          await new Promise(r => setTimeout(r, 350));
        }
      })();
      return () => { running = false; };
    }
    if (key === "place") {
      let running = true;
      (async () => {
        while (running) {
          const prev = this._saveLook();
          try {
            const blk = (() => { try { return b.blockAtCursor(6); } catch { return null; } })();
            if (blk && b.heldItem) {
              try { await b.placeBlock(blk, new Vec3(0, 1, 0)).catch(()=>{}); } catch {
                b.activateItem(false);
                setTimeout(()=>{ try { b.deactivateItem(); } catch {} }, 200);
              }
            }
          } catch {}
          this._restoreLook(prev);
          await new Promise(r => setTimeout(r, 600));
        }
      })();
      return () => { running = false; };
    }
    if (key === "eat") {
      // hold consume if supported
      try { if (typeof b.consume === "function") { /* consume is blocking and returns when finished */ } else { b.activateItem(true); } } catch {}
      return () => { try { if (typeof b.deactivateItem === "function") b.deactivateItem(); } catch {} };
    }
    if (key === "drop") {
      let running = true;
      (async () => {
        while (running) {
          try { if (b.heldItem) await b.toss(b.heldItem.type, null, 1).catch(()=>{}); } catch {}
          await new Promise(r => setTimeout(r, 300));
        }
      })();
      return () => { running = false; };
    }
    return () => {};
  }
}
