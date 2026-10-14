const express = require("express"), http = require("http"), { Server } = require("socket.io");
const app = express(); app.use(express.static("public"));
const srv = http.createServer(app), io = new Server(srv);
const rooms = {};
const view = r => ({ code: r.code, host: r.host, phase: r.phase, items: r.items, idx: r.idx, bid: r.bid,
  bidder: r.bidder, bidderName: r.bidder ? r.players[r.bidder].name : "", left: Math.max(0, r.endsAt - Date.now()),
  last: r.last, players: r.players });
const push = r => io.to(r.code).emit("state", view(r));
function arm(r, ms) { clearTimeout(r.t); r.endsAt = Date.now() + ms; r.t = setTimeout(() => resolve(r), ms); }
function resolve(r) {
  const it = r.items[r.idx];
  if (r.bidder) { const p = r.players[r.bidder]; p.purse -= r.bid; p.squad.push({ n: it.n, p: r.bid });
    r.last = `SOLD: ${it.n} to ${p.name} for ₹${r.bid}L`; } else r.last = "UNSOLD: " + it.n;
  r.bid = 0; r.bidder = ""; r.idx++;
  if (r.idx >= r.items.length) { r.phase = "done"; r.endsAt = 0; } else arm(r, 20000);
  push(r);
}
io.on("connection", s => {
  let r = null, pid = null;
  const enter = (room, id, name) => { r = room; pid = id; s.join(r.code);
    if (!r.players[id]) r.players[id] = { name: String(name || "Guest").slice(0, 20), purse: 100, squad: [] }; push(r); };
  s.on("create", d => {
    const code = Math.random().toString(36).slice(2, 7).toUpperCase();
    rooms[code] = { code, host: d.pid, phase: "lobby", items: [], idx: 0, bid: 0, bidder: "", endsAt: 0, last: "", players: {}, made: Date.now() };
    enter(rooms[code], d.pid, d.name);
  });
  s.on("join", (d, cb) => {
    const room = rooms[String(d.code || "").toUpperCase()];
    if (!room) return cb && cb("Room not found");
    enter(room, d.pid, d.name); cb && cb(null);
  });
  s.on("add", d => { if (r && pid === r.host && r.phase === "lobby" && r.items.length < 60 && d.n)
    { r.items.push({ n: String(d.n).slice(0, 24), b: Math.max(1, +d.b || 5) }); push(r); } });
  s.on("start", () => { if (r && pid === r.host && r.phase === "lobby" && r.items.length)
    { r.phase = "live"; r.idx = 0; arm(r, 20000); push(r); } });
  s.on("bid", amt => {
    if (!r || r.phase !== "live" || r.bidder === pid) return;
    const p = r.players[pid], it = r.items[r.idx]; amt = Math.floor(+amt);
    if (!p || !(amt > r.bid) || amt < it.b || amt > p.purse) return;
    r.bid = amt; r.bidder = pid; arm(r, 15000); push(r);
  });
});
setInterval(() => { for (const c in rooms) if (Date.now() - rooms[c].made > 12 * 36e5) delete rooms[c]; }, 36e5);
srv.listen(process.env.PORT || 3000, () => console.log("Auction running on port " + (process.env.PORT || 3000)));
