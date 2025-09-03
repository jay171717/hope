import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { BotManager } from "./botManager.js";
import { ServerStatusPoller } from "./statusPoller.js";

dotenv.config();

const PORT=process.env.PORT||3000;
const HOST=process.env.SERVER_HOST;
const PR=Number(process.env.SERVER_PORT);
const FIXED=process.env.MINECRAFT_VERSION||null;
const HEAD=process.env.HEAD_BASE||"https://minotar.net/helm";

const app=express();
const http=createServer(app);
const io=new Server(http,{cors:{origin:"*"}});
app.use(express.static("public"));

const bots=new BotManager(io,HOST,PR,FIXED,HEAD);
const poller=new ServerStatusPoller(io,HOST,PR); poller.start();

io.on("connection",socket=>{
  socket.emit("bot:list",bots.list());
  socket.on("bot:add",({name,auth})=>{try{socket.emit("bot:added",bots.addBot({name,auth}));}catch(e){socket.emit("error:toast",e.message);}});
  socket.on("bot:remove",id=>bots.removeBot(id));
  socket.on("bot:toggle",({id,on})=>bots.toggleConnection(id,on));
  socket.on("bot:desc",({id,text})=>bots.setDescription(id,text));
  socket.on("bot:chat",({id,text})=>bots.chat(id,text));
  socket.on("bot:respawn",id=>bots.respawn(id));
  socket.on("bot:swapHands",id=>bots.swapHands(id));
  socket.on("bot:holdSlot",({id,index})=>bots.holdInventorySlot(id,index));
  socket.on("bot:moveContinuous",({id,dir,on})=>bots.setContinuousMove(id,dir,on));
  socket.on("bot:jumpOnce",id=>bots.jumpOnce(id));
  socket.on("bot:gotoXYZ",({id,x,y,z})=>bots.gotoXYZ(id,x,y,z));
  socket.on("bot:rotateStep",({id,dyaw,dpitch})=>bots.rotateStep(id,dyaw,dpitch));
  socket.on("bot:lookAngles",({id,yaw,pitch})=>bots.lookAtAngles(id,yaw,pitch));
  socket.on("bot:setAction",({id,action,mode,intervalGt,dropStack})=>bots.setActionMode(id,action,mode,{intervalGt,dropStack}));
  socket.on("bot:setTweaks",({id,toggles})=>bots.setTweaks(id,toggles));
});

http.listen(PORT,()=>console.log(`Running at http://localhost:${PORT}`));
