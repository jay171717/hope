/**
 * Centralized action scheduler for "Once / Interval / Continuous / Stop".
 * Maintains per-bot active actions, intervals, and control states.
 */
const DEFAULT_INTERVAL_TICKS = 10; // 10 gt ~ 0.5s (20 gt/s)
const TICKS_PER_SECOND = 20;

export class ActionController {
  constructor(bot) {
    this.bot = bot;
    this.active = new Map(); // key -> {mode, intervalGt, timer, continuous}
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
   * key: "leftClick"|"rightClick"|"jump"|"sneak"|"drop"
   * mode: "Once"|"Interval"|"Continuous"|"Stop"
   * opts: { intervalGt, dropStack }
   */
  setMode(key, mode, opts = {}) {
    const prev = this.active.get(key);
    // clear timers / continuous states
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
        case "leftClick":
          b.attack(b.nearestEntity()?.entity || undefined); // if entity is close it will attack
          // Also simulate a block dig tick: one click only
          break;
        case "rightClick":
          b.activateItem(false); // briefly uses item (eat/place/use) – once
          setTimeout(() => b.deactivateItem(), 150);
          break;
        case "jump":
          b.setControlState('jump', true);
          setTimeout(() => b.setControlState('jump', false), 200);
          break;
        case "sneak":
          b.setControlState('sneak', true);
          setTimeout(() => b.setControlState('sneak', false), 400);
          break;
        case "drop":
          // Drop one item in hand (or stack if toggle)
          if (b.heldItem) {
            if (state.dropStack) b.tossStack(b.heldItem).catch(() => {});
            else b.toss(b.heldItem.type, null, 1).catch(() => {});
          }
          break;
      }
    } catch { /* no-op */ }
  }

  _startContinuous(key, state) {
    const b = this.bot;
    switch (key) {
      case "leftClick":
        // Continuous mine (hold dig)
        b.swingArm("right", true);
        break;
      case "rightClick":
        b.activateItem(true); // hold use/eat/place/interact
        break;
      case "jump":
        b.setControlState('jump', true);
        break;
      case "sneak":
        b.setControlState('sneak', true);
        break;
      case "drop":
        // Not meaningful as hold; ignore and treat as interval fast drop?
        break;
    }
  }

  _endContinuous(key) {
    const b = this.bot;
    switch (key) {
      case "leftClick":
        b.swingArm("right", false);
        break;
      case "rightClick":
        b.deactivateItem();
        break;
      case "jump":
        b.setControlState('jump', false);
        break;
      case "sneak":
        b.setControlState('sneak', false);
        break;
      case "drop":
        break;
    }
  }
}
