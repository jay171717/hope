const DEFAULT_INTERVAL_TICKS = 10;
const TICKS_PER_SECOND = 20;

export class ActionController {
  constructor(bot) {
    this.bot = bot;
    this.active = new Map();
    this.listeners = new Set();
  }

  onUpdate(fn) {
    this.listeners.add(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this.listActive());
  }

  listActive() {
    return [...this.active.entries()]
      .filter(([_, state]) => state.mode !== "Stop")
      .map(([key, state]) => ({
        action: key,
        mode: state.mode,
        intervalGt: state.intervalGt || null,
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

    const state = {
      mode,
      intervalGt: opts.intervalGt || DEFAULT_INTERVAL_TICKS,
    };
    this.active.set(key, state);

    if (mode === "Once") {
      this._performOnce(key, state);
    } else if (mode === "Interval") {
      const ms = (state.intervalGt / TICKS_PER_SECOND) * 1000;
      state.timer = setInterval(
        () => this._performOnce(key, state),
        ms
      );
    }
    this.emit();
  }

  _performOnce(key, state) {
    const b = this.bot;
    try {
      switch (key) {
        case "mine":
          b.dig(b.blockAtCursor(5)).catch(() => {});
          break;
        case "attack":
          const ent = b.nearestEntity();
          if (ent) {
            const dir = ent.position.minus(b.entity.position);
            const yaw = Math.atan2(-dir.x, -dir.z);
            b.look(yaw, b.entity.pitch, true).then(() => b.attack(ent));
          }
          break;
        case "place":
          const block = b.blockAtCursor(5);
          if (block && b.heldItem) {
            b.placeBlock(block, { x: 0, y: 1, z: 0 }).catch(() => {});
          }
          break;
        case "eat":
          if (b.heldItem) {
            b.consume().catch(() => {});
          }
          break;
        case "drop":
          if (b.heldItem) {
            b.toss(b.heldItem.type, null, 1).catch(() => {});
          }
          break;
      }
    } catch {}
  }
}
