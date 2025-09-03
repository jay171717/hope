import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { BotManager } from "./botManager.js";
import { ServerStatusPoller } from "./statusPoller.js";

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

const bots = new BotManager(io, SERVER_HOST, SERVER_PORT, FIXED_VERSION, HEAD_BASE);
const poller = new ServerStatusPoller(io, SERVER_HOST, SERVER_PORT);
poller.start();

// REST (optional)
app.get("/api/bots", (req, res) => res.json(bots.list()));

// Socket.IO
io.on("connection", socket => {
  // send initial lists
  socket.emit("bot:list", bots.list());

  // add/remove/toggle/desc
  socket.on("bot:add", ({ id, name, auth }) => {
    try { socket.emit("bot:added", bots.addBot({ id, name, auth: auth || "offline" })); }
    catch (e) { socket.emit("error:toast", e.message); }
  });
  socket.on("bot:remove", (id) => bots.removeBot(id));
  socket.on("bot:toggle", ({ id, on }) => bots.toggleConnection(id, !!on));
  socket.on("bot:desc", ({ id, text }) => bots.setDescription(id, text));

  // chat / respawn
  socket.on("bot:chat", ({ id, text }) => bots.chat(id, text));
  socket.on("bot:respawn", (id) => bots.respawn(id));

  // inventory
  socket.on("bot:swapHands", (id) => bots.swapHands(id));
  socket.on("bot:holdSlot", ({ id, index }) => bots.holdInventorySlot(id, index));
  socket.on("bot:unequipArmor", ({ id, part }) => bots.unequipArmor(id, part));

  // movement
  socket.on("bot:moveContinuous", ({ id, dir, on }) => bots.setContinuousMove(id, dir, on));
  socket.on("bot:jumpOnce", (id) => bots.jumpOnce(id));
  socket.on("bot:moveBlocks", ({ id, dir, blocks }) => bots.moveBlocks(id, dir, blocks));
  socket.on("bot:gotoXYZ", ({ id, x, y, z }) => bots.gotoXYZ(id, x, y, z));
  socket.on("bot:stopPath", (id) => bots.stopPath(id));

  // looking
  socket.on("bot:rotateStep", ({ id, dyaw, dpitch }) => bots.rotateStep(id, dyaw, dpitch));
  socket.on("bot:lookAngles", ({ id, yaw, pitch }) => bots.lookAtAngles(id, yaw, pitch));
  socket.on("bot:lookAt", ({ id, x, y, z }) => bots.lookAtCoord(id, x, y, z));

  // actions
  socket.on("bot:setAction", ({ id, action, mode, intervalGt, dropStack }) =>
    bots.setActionMode(id, action, mode, { intervalGt, dropStack })
  );

  // tweaks
  socket.on("bot:setTweaks", ({ id, toggles }) => bots.setTweaks(id, toggles));
  socket.on("bot:autoSleep", ({ id, on }) => bots.enableAutoSleep(id, on));

  // optional request for immediate state
  socket.on("bot:requestState", (id) => { /* telemetry is pushed periodically */ });
});

// start server
http.listen(PORT, () => {
  console.log(`Web Control running on http://localhost:${PORT}`);
  console.log(`Target server: ${SERVER_HOST}:${SERVER_PORT}`);
});
