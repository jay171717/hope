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

app.get("/api/bots", (req, res) => res.json(bots.list()));

io.on("connection", (socket) => {
  socket.emit("bot:list", bots.list());

  socket.on("bot:add", ({ id, name }) => {
    try {
      socket.emit("bot:added", bots.addBot({ id, name }));
    } catch (e) {
      socket.emit("error:toast", e.message);
    }
  });
  socket.on("bot:remove", (id) => bots.removeBot(id));
  socket.on("bot:toggle", ({ id, on }) => bots.toggleConnection(id, !!on));
  socket.on("bot:desc", ({ id, text }) => bots.setDescription(id, text));

  socket.on("bot:chat", ({ id, text }) => bots.chat(id, text));
  socket.on("bot:respawn", (id) => bots.respawn(id));

  socket.on("bot:holdSlot", ({ id, index, hand }) =>
    bots.holdInventorySlot(id, index, hand)
  );
  socket.on("bot:unequipArmor", ({ id, part }) => bots.unequipArmor(id, part));

  socket.on("bot:moveContinuous", ({ id, dir, on }) =>
    bots.setContinuousMove(id, dir, on)
  );
  socket.on("bot:jumpOnce", (id) => bots.jumpOnce(id));
  socket.on("bot:sneakToggle", (id) => bots.toggleSneak(id));
  socket.on("bot:gotoXYZ", ({ id, x, y, z }) => bots.gotoXYZ(id, x, y, z));

  socket.on("bot:rotateStep", ({ id, dyaw, dpitch }) =>
    bots.rotateStep(id, dyaw, dpitch)
  );

  socket.on("bot:setAction", ({ id, action, mode, intervalGt, dropStack }) =>
    bots.setActionMode(id, action, mode, { intervalGt, dropStack })
  );

  socket.on("bot:setTweaks", ({ id, toggles }) =>
    bots.setTweaks(id, toggles)
  );
});

http.listen(PORT, () => {
  console.log(`Web Control running on http://localhost:${PORT}`);
  console.log(`Target server: ${SERVER_HOST}:${SERVER_PORT}`);
});
