const express = require("express"), http = require("http"), { Server } = require("socket.io");
const app = express(); app.use(express.static("public"));
app.get("/health", (q, s) => s.send("ok"));
const srv = http.createServer(app), io = new Server(srv);
const rooms = {}, T0 = 20000, TB = 15000;
const lg = (r, t) => { r.log.unshift(t); r.log.length = Math.min(r.log.length, 10); };
const view = r => ({ code: r.code, host: r.host, phase: r.phase, items: r.items, idx: r.idx, bid: r.bid, purse: r.purse,
  bidder: r.bidder, bidderName: r.bidder ? r.players[r.bidder].name : "", paused: r.paused,
  left: r.paused ? r.pl : Math.max(0, r.endsAt - Date.now()), dur: r.dur, last: r.last, log: r.log, un: r.un,
  online: [...r.on], players: r.players });
const push = r => io.to(r.code).emit("state", view(r));
function arm(r, ms) { clearTimeout(r.t); r.dur = ms; r.endsAt = Date.now() + ms; r.t = setTimeout(() => resolve(r), ms); }
function resolve(r) {
  clearTimeout(r.t); r.paused = false;
  const it = r.items[r.idx];
  if (r.bidder) { const p = r.players[r.bidder]; p.purse -= r.bid; p.squad.push({ n: it.n, p: r.bid });
    r.last = `SOLD: ${it.n} to ${p.name} for ₹${r.bid}L`; }
  else { r.last = "UNSOLD: " + it.n; r.un.push(it.n); if (!it.again) r.items.push({ n: it.n, b: it.b, again: true }); }
  lg(r, r.last); r.bid = 0; r.bidder = ""; r.idx++;
  if (r.idx >= r.items.length) { r.phase = "done"; r.endsAt = 0; } else arm(r, T0);
  push(r);
}
io.on("connection", s => {
  let r = null, pid = null;
  const host = () => r && pid === r.host;
  const enter = (room, id, name, e) => { r = room; pid = id; s.join(r.code); r.on.add(id);
    if (!r.players[id]) r.players[id] = { name: String(name || "Guest").slice(0, 20), purse: r.purse, squad: [], e: String(e || "").slice(0, 4) }; push(r); };
  s.on("create", d => {
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    rooms[code] = { code, host: d.pid, phase: "lobby", items: [], idx: 0, bid: 0, bidder: "", endsAt: 0, dur: 0, last: "",
      log: [], purse: 100, players: {}, on: new Set(), paused: false, pl: 0, un: [], made: Date.now() };
    enter(rooms[code], d.pid, d.name, d.e);
  });
  s.on("join", (d, cb) => {
    const room = rooms[String(d.code || "").toUpperCase().trim()];
    if (!room) return cb && cb("Room not found. Check the code and try again.");
    enter(room, d.pid, d.name, d.e); cb && cb(null);
  });
  s.on("disconnect", () => { if (r && pid) { r.on.delete(pid); push(r); } });
  s.on("cfg", v => { if (host() && r.phase === "lobby") { r.purse = Math.min(1000, Math.max(10, Math.floor(+v) || 100));
    for (const k in r.players) r.players[k].purse = r.purse; push(r); } });
  s.on("add", d => { if (!host() || r.phase !== "lobby") return;
    String(d.n || "").split(/[\n,]/).map(x => x.trim()).filter(Boolean).forEach(n => {
      if (r.items.length < 60) { const [a, t] = n.split("|"); r.items.push({ n: a.trim().slice(0, 24), t: (t || "").trim().slice(0, 14), b: Math.max(1, Math.floor(+d.b) || 5) }); } });
    push(r); });
  s.on("del", i => { if (host() && r.phase === "lobby" && r.items[i]) { r.items.splice(i, 1); push(r); } });
  s.on("start", () => { if (host() && r.phase === "lobby" && r.items.length) { r.phase = "live"; r.idx = 0; arm(r, T0); push(r); } });
  s.on("skip", () => { if (host() && r.phase === "live") resolve(r); });
  s.on("end", () => { if (host() && r.phase === "live") { clearTimeout(r.t); r.phase = "done"; lg(r, "Auction ended by host"); push(r); } });
  s.on("pause", () => { if (!host() || r.phase !== "live") return;
    if (r.paused) { r.paused = false; arm(r, r.pl); } else { r.paused = true; r.pl = Math.max(0, r.endsAt - Date.now()); clearTimeout(r.t); }
    push(r); });
  s.on("bid", amt => {
    if (!r || r.phase !== "live" || r.paused || r.bidder === pid) return;
    const p = r.players[pid], it = r.items[r.idx]; amt = Math.floor(+amt);
    if (!p || !(amt > r.bid) || amt < it.b || amt > p.purse) return;
    r.bid = amt; r.bidder = pid; lg(r, `${p.name} bid ₹${amt}L`); arm(r, TB); push(r);
  });
});
setInterval(() => { for (const c in rooms) if (Date.now() - rooms[c].made > 12 * 36e5) delete rooms[c]; }, 36e5);
srv.listen(process.env.PORT || 3000, () => console.log("Auction running"));
