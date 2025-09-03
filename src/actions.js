/**
 * Centralized action scheduler for "Once / Interval / Stop".
 * Maintains per-bot active actions, intervals, and control states.
 */
const DEFAULT_INTERVAL_TICKS = 10; // 10 gt ~ 0.5s (20 gt/s)
const TICKS_PER_SECOND = 20;

export class ActionController {
  constructor(bot) {
    this.bot = bot;
    this.active = new Map(); // key -> {mode, intervalGt, timer}
    this.listeners = new Set();
  }

  onUpdate(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.listActive()); }

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
   * key: "mine"|"attack"|"place"|"eat"|"jump"|"drop"
   * mode: "Once"|"Interval"|"Stop"
   */
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

    if (mode === "Once") {
      this._performOnce(key, state);
    } else if (mode === "Interval") {
      const ms = (state.intervalGt / TICKS_PER_SECOND) * 1000;
      state.timer = setInterval(() => this._performOnce(key, state), ms);
    }
    this.emit();
  }

  _performOnce(key, state) {
    const b = this.bot;
    try {
      switch (key) {
        case "mine": {
          const block = b.blockAtCursor(5);
          if (block) b.dig(block).catch(() => {});
          break;
        }
        case "attack": {
          const ent = b.entityAtCursor(4);
          if (ent) b.attack(ent);
          break;
        }
        case "place": {
          const block = b.blockAtCursor(5);
          if (block && b.heldItem) {
            b.placeBlock(block, { x: 0, y: 1, z: 0 }).catch(() => {});
          }
          break;
        }
        case "eat": {
          if (b.heldItem && b.heldItem.name.includes("food")) {
            b.consume().catch(() => {});
          }
          break;
        }
        case "jump": {
          b.setControlState('jump', true);
          setTimeout(() => b.setControlState('jump', false), 200);
          break;
        }
        case "drop": {
          if (b.heldItem) {
            if (state.dropStack) b.tossStack(b.heldItem).catch(() => {});
            else b.toss(b.heldItem.type, null, 1).catch(() => {});
          }
          break;
        }
      }
    } catch { /* no-op */ }
  }
}
