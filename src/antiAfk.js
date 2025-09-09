// src/antiAfk.js
/**
 * Advanced Anti-AFK system for bots.
 * Randomizes actions with delays to avoid detection.
 *
 * Actions include:
 * - Small random movements
 * - Random head rotations
 * - Sneak toggle
 * - Jump
 * - Fake chat message (to self)
 * - Hotbar slot swap
 * - Fake attack swing
 */

import { Vec3 } from "vec3";

export class AntiAfkController {
  constructor(entry, io) {
    this.entry = entry;
    this.io = io;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this._scheduleNext();
    this.io.emit("bot:log", { id: this.entry.id, line: "Anti-AFK started." });
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.io.emit("bot:log", { id: this.entry.id, line: "Anti-AFK stopped." });
  }

  _scheduleNext() {
    if (!this.entry?.bot) return;
    // random delay between 20s - 60s
    const delay = 20000 + Math.random() * 40000;
    this.timer = setTimeout(() => {
      this._performRandomAction();
      this._scheduleNext();
    }, delay);
  }

  _performRandomAction() {
    const b = this.entry.bot;
    if (!b) return;

    const actions = [
      () => {
        // Small random movement
        const dirs = ["forward", "back", "left", "right"];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        b.setControlState(dir, true);
        setTimeout(() => b.setControlState(dir, false), 400 + Math.random() * 600);
        this._log(`Moved ${dir}`);
      },
      () => {
        // Random look
        const yaw = b.entity.yaw + (Math.random() - 0.5) * Math.PI / 3;
        const pitch = b.entity.pitch + (Math.random() - 0.5) * Math.PI / 6;
        b.look(yaw, pitch, true).catch(()=>{});
        this._log("Looked around randomly");
      },
      () => {
        // Sneak toggle
        b.setControlState("sneak", true);
        setTimeout(() => b.setControlState("sneak", false), 1000 + Math.random() * 1000);
        this._log("Sneaked briefly");
      },
      () => {
        // Jump
        b.setControlState("jump", true);
        setTimeout(() => b.setControlState("jump", false), 300);
        this._log("Jumped");
      },
      () => {
        // Fake chat to self
        try {
          b.chat(`/msg ${b.username} still here!`);
          this._log("Sent fake self-chat");
        } catch {}
      },
      () => {
        // Hotbar slot swap
        const slot = Math.floor(Math.random() * 9);
        try { b.setQuickBarSlot(slot); } catch {}
        this._log(`Swapped to hotbar slot ${slot+1}`);
      },
      () => {
        // Fake attack swing
        try { b.swingArm("right"); } catch {}
        this._log("Swung arm");
      }
    ];

    const act = actions[Math.floor(Math.random() * actions.length)];
    act();
  }

  _log(msg) {
    this.io.emit("bot:log", { id: this.entry.id, line: `[AntiAFK] ${msg}` });
  }
}
