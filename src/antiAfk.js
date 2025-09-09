// src/antiAfk.js
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
    const delay = randInt(5000, 15000); // 5–15 sec between actions
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

    const fn = actions[randInt(0, actions.length - 1)];
    try { fn(); } catch (err) {}
    this._scheduleNext();
  }

  _move() {
    const dirs = ["forward", "back", "left", "right"];
    const dir = dirs[randInt(0, dirs.length - 1)];
    this.bot.setControlState(dir, true);
    setTimeout(() => this.bot.setControlState(dir, false), randInt(300, 1200));
    this._log(`Moved ${dir}`);
  }

  _lookAround() {
    const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * Math.PI;
    const pitch = this.bot.entity.pitch + (Math.random() - 0.5) * 0.5;
    this.bot.look(yaw, pitch, true).catch(()=>{});
    this._log("Looked around");
  }

  _jump() {
    this.bot.setControlState("jump", true);
    setTimeout(() => this.bot.setControlState("jump", false), 300);
    this._log("Jumped");
  }

  _sneak() {
    this.bot.setControlState("sneak", true);
    setTimeout(() => this.bot.setControlState("sneak", false), randInt(500, 1500));
    this._log("Sneaked");
  }

  _fakeAttack() {
    if (typeof this.bot.swingArm === "function") {
      this.bot.swingArm("right");
      this._log("Fake attack");
    }
  }

  _chatMessage() {
    const msgs = [".", "hi", "afk", "zzz", "o/", "still here"];
    const msg = msgs[randInt(0, msgs.length - 1)];
    this.bot.chat(msg);
    this._log(`Sent chat: ${msg}`);
  }

  _swapHotbar() {
    if (!this.bot.quickBarSlot) return;
    const slot = randInt(0, 8);
    this.bot.setQuickBarSlot(slot);
    this._log(`Swapped hotbar to ${slot}`);
  }

  _log(msg) {
    if (this.io) {
      this.io.emit("bot:log", { id: this.botId, line: `[AntiAFK] ${msg}` });
    }
  }
}
