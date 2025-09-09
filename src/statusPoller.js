import { status } from "minecraft-server-util";
import { formatDuration } from "./utils.js";

export class ServerStatusPoller {
  constructor(io, host, port) {
    this.io = io;
    this.host = host;
    this.port = port;
    this._timer = null;
    this._onlineSince = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.poll(), 5000);
    this.poll();
  }
  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async poll() {
    try {
      const res = await status(this.host, this.port, { timeout: 2000 });
      if (!this._onlineSince) this._onlineSince = Date.now();
      const players = (res.players?.sample || []).map(p => ({
        name: p.name, headUrl: `https://minotar.net/helm/${encodeURIComponent(p.name)}/32`
      }));
      this.io.emit("server:status", {
        online: true,
        motd: res.motd?.clean || "",
        version: res.version?.name || "",
        players: { online: res.players?.online || 0, max: res.players?.max || 0, sample: players },
        favicon: res.favicon || null,
        uptime: formatDuration(Date.now() - this._onlineSince),
        host: this.host,
        port: this.port
      });
    } catch {
      this._onlineSince = null;
      this.io.emit("server:status", {
        online: false,
        motd: "",
        version: "",
        players: { online: 0, max: 0, sample: [] },
        favicon: null,
        uptime: "—",
        host: this.host,
        port: this.port
      });
    }
  }
}
