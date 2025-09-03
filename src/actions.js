const DEFAULT_INTERVAL_TICKS = 10; // 0.5s
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
    return [...this.active.entries()].map(([key, state]) => ({
      action: key,
      mode: state.mode,
      intervalGt: state.intervalGt || null
    }));
  }

  stopAll() {
    for (const key of [...this.active.keys()]) this.setMode(key, "Stop");
  }

  setMode(key, mode, opts = {}) {
    const prev = this.active.get(key);
    if (prev?.timer) clearInterval(prev.timer);

    if (mode === "Stop") {
      this.active.delete(key);
      this.emit();
      return;
    }

    const state = { mode, intervalGt: opts.intervalGt || DEFAULT_INTERVAL_TICKS };
    this.active.set(key, state);

    if (mode === "Once") this._perform(key);
    if (mode === "Interval") {
      const ms = (state.intervalGt / TICKS_PER_SECOND) * 1000;
      state.timer = setInterval(() => this._perform(key), ms);
    }
    if (mode === "Continuous") this._startContinuous(key);

    this.emit();
  }

  _perform(key) {
    const b = this.bot;
    try {
      switch (key) {
        case "mine":
          b.dig(b.blockAtCursor(5)).catch(() => {});
          break;
        case "attack":
          const ent = b.nearestEntity();
          if (ent) b.attack(ent);
          break;
        case "place":
          b.activateItem(false);
          setTimeout(() => b.deactivateItem(), 200);
          break;
        case "eat":
          b.consume().catch(() => {});
          break;
        case "drop":
          if (b.heldItem) b.toss(b.heldItem.type, null, 1).catch(() => {});
          break;
      }
    } catch {}
  }

  _startContinuous(key) {
    const b = this.bot;
    if (key === "mine") {
      const blk = b.blockAtCursor(5);
      if (blk) b.dig(blk).catch(() => {});
    }
    if (key === "attack") {
      const ent = b.nearestEntity();
      if (ent) b.attack(ent);
    }
    if (key === "place") b.activateItem(true);
    if (key === "eat") b.consume().catch(() => {});
  }
}
