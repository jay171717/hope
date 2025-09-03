import { Vec3 } from "vec3";

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
    const list = [];
    for (const [k, s] of this.active) {
      if (s.mode === "Stop") continue;
      list.push({ action: k, mode: s.mode, intervalGt: s.intervalGt || null });
    }
    return list;
  }

  stopAll() {
    for (const k of [...this.active.keys()]) this.setMode(k, "Stop");
  }

  setMode(key, mode, opts = {}) {
    const prev = this.active.get(key);
    if (prev?.timer) clearInterval(prev.timer);
    if (prev?.continuous) this._endContinuous(key);

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
      state.continuous = true;
      this._startContinuous(key, state);
    }

    this.emit();
  }

  _saveLook() {
    const b = this.bot;
    if (!b || !b.entity) return null;
    return { yaw: b.entity.yaw, pitch: b.entity.pitch };
  }
  _restoreLook(look) {
    if (!look) return;
    try { this.bot.look(look.yaw, look.pitch, false).catch(()=>{}); } catch {}
  }

  // helper: are we looking within threshold at entity?
  _isLookingAtEntity(entity, maxAngleDeg = 25) {
    if (!this.bot.entity || !entity || !entity.position) return false;
    const botPos = this.bot.entity.position;
    const toEnt = entity.position.minus(botPos);
    const horiz = Math.atan2(toEnt.z, toEnt.x); // note: mineflayer yaw math differs; but approximate
    const desiredYaw = horiz - Math.PI/2; // align to mineflayer yaw
    const yawDiff = Math.abs(((desiredYaw - this.bot.entity.yaw + Math.PI) % (2*Math.PI)) - Math.PI);
    const yawDiffDeg = Math.abs(yawDiff * 180 / Math.PI);
    return yawDiffDeg <= maxAngleDeg;
  }

  async _performOnce(key, state) {
    const b = this.bot;
    if (!b) return;
    const prevLook = this._saveLook();
    try {
      switch (key) {
        case "mine": {
          // dig the block at cursor but restore look after
          const blk = (() => { try { return b.blockAtCursor(6); } catch { return null; } })();
          if (blk) await b.dig(blk).catch(()=>{});
          break;
        }
        case "attack": {
          // only attack if we're roughly looking at it
          const ent = b.nearestEntity();
          if (ent && this._isLookingAtEntity(ent)) {
            await b.attack(ent).catch(()=>{});
          }
          break;
        }
        case "place": {
          // place without changing look: use activateItem once
          await b.activateItem(false);
          setTimeout(()=>{ try{ b.deactivateItem(); }catch{} }, 150);
          break;
        }
        case "eat": {
          // activate item briefly (keep orientation)
          if (b.heldItem) {
            await b.activateItem(false);
            setTimeout(()=>{ try{ b.deactivateItem(); }catch{} }, 1000);
          }
          break;
        }
        case "drop": {
          if (b.heldItem) {
            if (state.dropStack) await b.tossStack(b.heldItem).catch(()=>{});
            else await b.toss(b.heldItem.type, null, 1).catch(()=>{});
          }
          break;
        }
      }
    } catch {}
    finally { this._restoreLook(prevLook); }
  }

  _startContinuous(key, state) {
    const b = this.bot;
    if (!b) return;
    if (key === "mine") {
      // repeatedly dig whatever is in cursor without changing look permanently
      state.timer = setInterval(async () => {
        const prev = this._saveLook();
        try {
          const blk = (() => { try { return b.blockAtCursor(6); } catch { return null; } })();
          if (blk) await b.dig(blk).catch(()=>{});
        } catch {}
        this._restoreLook(prev);
      }, 400);
    } else if (key === "attack") {
      state.timer = setInterval(async () => {
        try {
          const ent = b.nearestEntity();
          if (ent && this._isLookingAtEntity(ent)) await b.attack(ent).catch(()=>{});
        } catch {}
      }, 400);
    } else if (key === "place") {
      state.timer = setInterval(async () => {
        const prev = this._saveLook();
        try { await b.activateItem(false); } catch {}
        this._restoreLook(prev);
      }, 600);
    } else if (key === "eat") {
      // hold eat: activateItem(true)
      try { b.activateItem(true); } catch {}
    } else if (key === "drop") {
      state.timer = setInterval(async () => {
        try { if (b.heldItem) await b.toss(b.heldItem.type, null, 1).catch(()=>{}); } catch {}
      }, 300);
    }
  }

  _endContinuous(key) {
    const s = this.active.get(key);
    if (!s) return;
    if (s.timer) { clearInterval(s.timer); s.timer = null; }
    if (key === "eat") try { this.bot.deactivateItem(); } catch {}
    this.active.delete(key);
    this.emit();
  }
}
