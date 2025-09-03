import { status } from "minecraft-server-util";

export class ServerStatusPoller {
  constructor(io, host, port) {
    this.io = io; this.host = host; this.port = port;
  }
  start() { setInterval(()=>this.poll(),5000); this.poll(); }
  async poll() {
    try {
      const res = await status(this.host, this.port);
      this.io.emit("server:status", {
        online:true,
        motd:res.motd?.clean||"",
        version:res.version?.name||"",
        players:{ online:res.players.online, max:res.players.max, sample:res.players.sample.map(p=>({name:p.name,headUrl:`https://minotar.net/helm/${p.name}/32`})) },
        bots:[]
      });
    } catch {
      this.io.emit("server:status",{online:false,players:{online:0,max:0,sample:[]},bots:[]});
    }
  }
}
