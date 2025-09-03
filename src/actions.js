/**
 * Centralized action scheduler for "Once / Interval / Continuous / Stop".
 * Maintains per-bot active actions, intervals, and control states.
 *
 * Improvements:
 * - Once/Interval/Continuous implemented with safer calls.
 * - Continuous leftClick uses repeated attack or dig only if autoMinePlace allowed (the botManager will gate digging).
 * - RightClick continuous uses activateItem(true)/deactivateItem().
 * - Drop supports dropStack option.
 */

const DEFAULT_INTERVAL_TICKS = 10; // 10 gt ~ 0.5s (20 gt/s)
const TICKS_PER_SECOND = 20;

export class ActionController {
  constructor(bot) {
    this.bot = bot;
    this.active = new Map(); // key -> {mode, intervalGt, timer, continuous}
    this.listeners = new Set();
    this._continuousIntervals = {};
  }

  onUpdate(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) try { fn(this.listActive()); } catch{} }

  listActive() {
    const list = [];
    for (const [key, state] of this.active) {
      if (state.mode === "Stop") continue;
      list.push({ action: key, mode: state.mode, intervalGt: state.intervalGt || null });
    }
    return list;
  }

  stopAll() {
    for (const key of [...this.active.keys()]) this.setMode(key, "Stop");
  }

  /**
   * key: "leftClick"|"rightClick"|"jump"|"sneak"|"drop"
   * mode: "Once"|"Interval"|"Continuous"|"Stop"
   * opts: { intervalGt, dropStack }
   */
  setMode(key, mode, opts = {}) {
    const prev = this.active.get(key);
    if (prev?.timer) { clearInterval(prev.timer); }
    if (prev?.continuous) this._endContinuous(key);

    if (mode === "Stop") {
      this.active.delete(key);
      this.emit();
      return;
    }

    const state = { mode, intervalGt: opts.intervalGt || DEFAULT_INTERVAL_TICKS, dropStack: !!opts.dropStack };
    this.active.set(key, state);

    if (mode === "Once") {
      this._performOnce(key, state);
    } else if (mode === "Interval") {
      const ms = (state.intervalGt / TICKS_PER_SECOND) * 1000;
      state.timer = setInterval(() => this._performOnce(key, state), ms);
    } else if (mode === "Continuous") {
      state.continuous = true;
      this._startContinuous(key, state);
    }
    this.emit();
  }

  _performOnce(key, state) {
    const b = this.bot;
    try {
      switch (key) {
        case "leftClick": {
          // attack nearest entity if present, otherwise swing arm (no hold)
          const ent = b.nearestEntity();
          if (ent && ent.entity) b.attack(ent.entity);
          else b.swingArm();
          break;
        }
        case "rightClick":
          b.activateItem(false);
          setTimeout(() => { try { b.deactivateItem(); } catch{} }, 150);
          break;
        case "jump":
          b.setControlState('jump', true);
          setTimeout(() => { try { b.setControlState('jump', false); } catch{} }, 200);
          break;
        case "sneak":
          b.setControlState('sneak', true);
          setTimeout(() => { try { b.setControlState('sneak', false); } catch{} }, 400);
          break;
        case "drop":
          if (b.heldItem) {
            if (state.dropStack) b.tossStack(b.heldItem).catch(()=>{});
            else b.toss(b.heldItem.type, null, 1).catch(()=>{});
          }
          break;
      }
    } catch (err) { /* ignore runtime action errors */ }
  }

  _startContinuous(key, state) {
    const b = this.bot;
    switch (key) {
      case "leftClick":
        // Emulate hold: repeated attack if entity present, otherwise swingArm frequently.
        this._continuousIntervals[key] = setInterval(() => {
          try {
            const ent = b.nearestEntity();
            if (ent && ent.entity) b.attack(ent.entity);
            else b.swingArm();
          } catch {}
        }, 150);
        break;
      case "rightClick":
        try { b.activateItem(true); } catch {}
        break;
      case "jump":
        b.setControlState('jump', true);
        break;
      case "sneak":
        b.setControlState('sneak', true);
        break;
      case "drop":
        // Continuous drop -> drop items repeatedly
        this._continuousIntervals[key] = setInterval(() => {
          try { if (b.heldItem) b.toss(b.heldItem.type, null, 1).catch(()=>{}); } catch {}
        }, 300);
        break;
    }
  }

  _endContinuous(key) {
    const b = this.bot;
    if (this._continuousIntervals[key]) { clearInterval(this._continuousIntervals[key]); delete this._continuousIntervals[key]; }
    if (key === "rightClick") { try { b.deactivateItem(); } catch{} }
    if (key === "jump") { try { b.setControlState('jump', false); } catch{} }
    if (key === "sneak") { try { b.setControlState('sneak', false); } catch{} }
  }
}
