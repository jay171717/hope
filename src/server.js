import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { BotManager } from "./botManager.js";
import { ServerStatusPoller } from "./statusPoller.js";
import crypto from "crypto";

dotenv.config();

const PORT = process.env.PORT || 3000;
const SERVER_HOST = process.env.SERVER_HOST || "fakesalmon.aternos.me";
const SERVER_PORT = Number(process.env.SERVER_PORT || 25565);
const FIXED_VERSION = process.env.MINECRAFT_VERSION || null;
const HEAD_BASE = process.env.HEAD_BASE || "https://minotar.net/helm";

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: "*" } });

app.use(express.static("public"));
app.use(express.json());

const manager = new BotManager(io, SERVER_HOST, SERVER_PORT, FIXED_VERSION, HEAD_BASE);
const poller = new ServerStatusPoller(io, SERVER_HOST, SERVER_PORT);
poller.start();

function genId(name) {
  return `${name.replace(/\W+/g,"_")}_${crypto.randomBytes(3).toString("hex")}`;
}

io.on("connection", socket => {
  socket.emit("bot:list", manager.list());

  socket.on("bot:add", ({ id, name }) => {
    try {
      const useId = id || genId(name || "bot");
      const info = manager.addBot({ id: useId, name });
      socket.emit("bot:added", info);
      manager.broadcastList();
    } catch (err) { socket.emit("error:toast", err.message || String(err)); }
  });

  socket.on("bot:remove", id => manager.removeBot(id));
  socket.on("bot:toggle", ({ id, on }) => manager.toggleConnection(id, !!on));
  socket.on("bot:desc", ({ id, text }) => manager.setDescription(id, text));

  socket.on("bot:chat", ({ id, text }) => manager.chat(id, text));
  socket.on("bot:respawn", id => manager.respawn(id));

  socket.on("bot:swapHands", id => manager.swapHands(id));
  socket.on("bot:holdSlot", ({ id, index }) => manager.holdInventorySlot(id, index));
  socket.on("bot:unequipArmor", ({ id, part }) => manager.unequipArmor(id, part));

  socket.on("bot:moveContinuous", ({ id, dir, on }) => manager.setContinuousMove(id, dir, on));
  socket.on("bot:jumpOnce", id => manager.jumpOnce(id));
  socket.on("bot:toggleSneak", id => manager.toggleSneak(id));
  socket.on("bot:moveBlocks", ({ id, dir, blocks }) => manager.moveBlocks(id, dir, blocks));
  socket.on("bot:stopPath", id => manager.stopPath(id));
  socket.on("bot:gotoXYZ", ({ id, x, y, z }) => manager.gotoXYZ(id, x, y, z));

  socket.on("bot:rotateStep", ({ id, dyaw, dpitch }) => manager.rotateStep(id, dyaw, dpitch));
  socket.on("bot:lookAngles", ({ id, yaw, pitch }) => manager.lookAtAngles(id, yaw, pitch));
  socket.on("bot:lookAt", ({ id, x, y, z }) => manager.lookAtCoord(id, x, y, z));

  socket.on("bot:setAction", ({ id, action, mode, intervalGt, dropStack }) =>
    manager.setActionMode(id, action, mode, { intervalGt, dropStack })
  );

  socket.on("bot:setTweaks", ({ id, toggles }) => manager.setTweaks(id, toggles));
  socket.on("bot:autoSleep", ({ id, on }) => manager.setTweaks(id, { autoSleep: !!on }));
});

http.listen(PORT, () => {
  console.log(`Web Control running on http://localhost:${PORT}`);
  console.log(`Target server: ${SERVER_HOST}:${SERVER_PORT}`);
});
