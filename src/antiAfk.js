// src/antiAfk.js
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randChoice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

export class AntiAfk {
  constructor(bot, io, botId) {
    this.bot = bot;
    this.io = io;
    this.botId = botId;
    this.timer = null;
    this.active = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._scheduleNext();
    this._log("Anti-AFK started");
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this._log("Anti-AFK stopped");
  }

  _scheduleNext() {
    if (!this.active) return;
    const delay = randInt(4000, 12000); // 4–12 sec between actions
    this.timer = setTimeout(() => this._doRandomAction(), delay);
  }

  _doRandomAction() {
    if (!this.bot || !this.active) return;

    const actions = [
      () => this._move(),
      () => this._lookAround(),
      () => this._jump(),
      () => this._sneak(),
      () => this._fakeAttack(),
      () => this._chatMessage(),
      () => this._swapHotbar()
    ];

    const fn = randChoice(actions);
    try { fn(); } catch (err) {}
    this._scheduleNext();
  }

  _move() {
    const dirs = ["forward", "back", "left", "right"];
    const dir = randChoice(dirs);
    this.bot.setControlState(dir, true);
    setTimeout(() => this.bot.setControlState(dir, false), randInt(300, 1000));
    this._log(`Moved ${dir}`);
  }

  _lookAround() {
    const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * Math.PI;
    const pitch = this.bot.entity.pitch + (Math.random() - 0.5) * 0.6;
    this.bot.look(yaw, pitch, true).catch(() => {});
    this._log("Looked around");
  }

  _jump() {
    this.bot.setControlState("jump", true);
    setTimeout(() => this.bot.setControlState("jump", false), randInt(200, 500));
    this._log("Jumped");
  }

  _sneak() {
    this.bot.setControlState("sneak", true);
    setTimeout(() => this.bot.setControlState("sneak", false), randInt(500, 2000));
    this._log("Sneaked");
  }

  _fakeAttack() {
    if (typeof this.bot.swingArm === "function") {
      this.bot.swingArm(randChoice(["left", "right"]));
      this._log("Fake attack");
    }
  }

  _chatMessage() {
    const msgs = [".", "hi", "afk", "zzz", "o/", "still here", "hm"];
    const msg = randChoice(msgs);
    this.bot.chat(msg);
    this._log(`Sent chat: ${msg}`);
  }

  _swapHotbar() {
    if (typeof this.bot.setQuickBarSlot !== "function") return;

    const oldSlot = this.bot.quickBarSlot;
    const newSlot = randInt(0, 8);
    if (newSlot === oldSlot) return; // avoid no-op

    this.bot.setQuickBarSlot(newSlot);
    this._log(`Swapped hotbar: ${oldSlot} → ${newSlot}`);

    // Occasionally swap back after a short delay (more human-like)
    if (Math.random() < 0.5) {
      setTimeout(() => {
        try {
          this.bot.setQuickBarSlot(oldSlot);
          this._log(`Swapped back to hotbar slot ${oldSlot}`);
        } catch {}
      }, randInt(800, 2500));
    }
  }

  _log(msg) {
    if (this.io) {
      this.io.emit("bot:log", { id: this.botId, line: `[AntiAFK] ${msg}` });
    }
  }
}
