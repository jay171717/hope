import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;

export function setupSneak(bot, io, id, entry) {
  entry._sneakState = false;

  function toggleSneak() {
    entry._sneakState = !entry._sneakState;
    try {
      bot.setControlState("sneak", entry._sneakState);
      io.emit("bot:log", { id, line: `Sneak ${entry._sneakState ? "ON" : "OFF"}` });
    } catch (err) {
      io.emit("bot:log", { id, line: `Sneak toggle error: ${err.message || err}` });
    }
  }

  return { toggleSneak };
}

export function setupAutoSleep(bot, io, id, entry) {
  let interval = null;

  function start() {
    if (interval) return;
    interval = setInterval(async () => {
      try {
        const time = bot.time?.timeOfDay || 0;
        const isNight = time > 12541 && time < 23458;
        if (!isNight || bot.isSleeping) return;

        const bedPos = bot.findBlock({
          matching: block => block.name.includes("bed"),
          maxDistance: 10,
        })?.position;

        if (bedPos) {
          io.emit("bot:log", { id, line: `Found bed at ${bedPos}` });
          try {
            await bot.pathfinder.goto(new goals.GoalBlock(bedPos.x, bedPos.y, bedPos.z));
            const bedBlock = bot.blockAt(bedPos);
            if (bedBlock) await bot.sleep(bedBlock);
          } catch (err) {
            io.emit("bot:log", { id, line: `Auto-sleep failed: ${err.message || err}` });
          }
        }
      } catch {}
    }, 5000);
  }

  function stop() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  return { start, stop };
}
