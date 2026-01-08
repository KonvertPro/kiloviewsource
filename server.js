import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import express from "express";
import { constants } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const PORT = Number(process.env.PORT || 9980);

const KILOVIEW_USER = process.env.KILOVIEW_USER || "admin";
const KILOVIEW_PASS = process.env.KILOVIEW_PASS || "Livewire2025";

const TLS_KEY_PATH = process.env.TLS_KEY_PATH || "10.0.20.34-key.pem";
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || "10.0.20.34.pem";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GENERATE_PATH = process.env.GENERATE_PATH || path.join(__dirname, "generate.json");
const STATE_PATH = process.env.STATE_PATH || path.join(__dirname, "state.json");

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJsonSafe(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

const generateSpec = readJsonSafe(GENERATE_PATH, { kits: [] });
let state = readJsonSafe(STATE_PATH, { activeKitId: null });

function pad2(n) { return String(n).padStart(2, "0"); }

function listKits() {
  return (generateSpec.kits || []).map((k) => ({
    kitId: k.kitId,
    kitName: k.kitName || k.kitId,
    count: Number(k.count ?? 25),
    vgStart: Number(k.vgStart ?? 1),
  }));
}
function getKitSpec(kitId) {
  return (generateSpec.kits || []).find((k) => k.kitId === kitId) || null;
}
function getActiveKitId() {
  if (state.activeKitId && getKitSpec(state.activeKitId)) return state.activeKitId;
  return (generateSpec.kits || [])[0]?.kitId || null;
}
function setActiveKitId(kitId) {
  if (!getKitSpec(kitId)) throw new Error(`Unknown kitId: ${kitId}`);
  state.activeKitId = kitId;
  writeJsonSafe(STATE_PATH, state);
}
function expandKit(kitSpec) {
  const kitId = kitSpec.kitId;
  const kitNumberMatch = String(kitId).match(/(\d+)/);
  const kitNumber = kitNumberMatch ? kitNumberMatch[1] : kitId;

  const count = Number(kitSpec.count ?? 25);
  const vgStart = Number(kitSpec.vgStart ?? 1);
  const hostPrefix = kitSpec.hostPrefix ?? "vg-";
  const hostSuffix = kitSpec.hostSuffix ?? ".local";
  const scheme = kitSpec.scheme ?? "http";
  const namePrefix = kitSpec.namePrefix ?? "LW-AMGF1-VG";

  const devices = [];
  for (let i = 0; i < count; i++) {
    const vgNum = vgStart + i;
    const vgStr = pad2(vgNum);
    const kiloNum = pad2(i + 1);

    const host = `${hostPrefix}${vgStr}${hostSuffix}`;
    const base = `${scheme}://${host}`;

    const id = `kit${kitNumber}-k${kiloNum}`;
    const name = `${namePrefix}-Kit${kitNumber}-Kilo${kiloNum}`;

    devices.push({ id, name, host, base, vgNum, kiloNum: Number(i + 1) });
  }

  return { kitId, kitName: kitSpec.kitName || kitId, devices };
}
function getActiveKitExpanded() {
  const kitId = getActiveKitId();
  if (!kitId) return { kitId: null, kitName: "No kits configured", devices: [] };
  return expandKit(getKitSpec(kitId));
}
function getDevicesById(expandedKit) {
  return new Map((expandedKit.devices || []).map((d) => [d.id, d]));
}

// Token cache per base URL
const tokenByBase = new Map();

async function getTokenForBase(base) {
  const cached = tokenByBase.get(base);
  if (cached) return cached;

  const url = `${base}/api/user/authorize.json?user=${encodeURIComponent(KILOVIEW_USER)}&password=${encodeURIComponent(KILOVIEW_PASS)}`;
  const r = await fetch(url, { method: "GET" });
  const data = await r.json();

  if (data?.result !== "ok" || !data?.data?.token) {
    throw new Error(`Kiloview authorize failed for ${base}: ${JSON.stringify(data)}`);
  }

  tokenByBase.set(base, data.data.token);
  return data.data.token;
}

async function kiloviewRequestBase(base, apiPath, { method = "GET", query = {}, jsonBody = null } = {}) {
  const token = await getTokenForBase(base);

  const qs = new URLSearchParams(query).toString();
  const url = `${base}${apiPath}${qs ? `?${qs}` : ""}`;

  const headers = { Cookie: `token=${token}` };
  let body;

  if (jsonBody !== null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(jsonBody);
  }

  const r = await fetch(url, { method, headers, body });
  const data = await r.json();

  if (data?.result === "auth-failed") tokenByBase.delete(base);

  return { status: r.status, ok: r.ok, data };
}

// HTTPS
// const httpsOptions = {
//   key: fs.readFileSync(TLS_KEY_PATH),
//   cert: fs.readFileSync(TLS_CERT_PATH),
//   minVersion: "TLSv1.2",
//   secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_TLSv1 | constants.SSL_OP_NO_TLSv1_1,
// };

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/kits", (req, res) => {
  res.json({ activeKitId: getActiveKitId(), kits: listKits() });
});

app.get("/api/kit", (req, res) => {
  res.json(getActiveKitExpanded());
});

app.post("/api/kit/active", (req, res) => {
  try {
    const { kitId } = req.body || {};
    if (!kitId) return res.status(400).json({ ok: false, error: "kitId required" });
    setActiveKitId(String(kitId));
    tokenByBase.clear();
    res.json({ ok: true, activeKitId: getActiveKitId() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

function requireDevice(req, res) {
  const kit = getActiveKitExpanded();
  const devicesById = getDevicesById(kit);
  const device = devicesById.get(req.params.deviceId);
  if (!device) {
    res.status(404).json({ result: "error", msg: "Unknown deviceId for active kit" });
    return null;
  }
  return device;
}

app.post("/kiloview/:deviceId/reboot", async (req, res) => {
  try {
    const device = requireDevice(req, res);
    if (!device) return;
    const out = await kiloviewRequestBase(device.base, "/api/sys/reboot.json", { method: "POST" });
    tokenByBase.delete(device.base);
    res.json(out.data);
  } catch (err) {
    console.error("Kiloview reboot error:", err);
    res.status(500).json({ result: "error", msg: String(err?.message || err) });
  }
});

app.get("/kiloview/:deviceId/presets", async (req, res) => {
  try {
    const device = requireDevice(req, res);
    if (!device) return;
    const out = await kiloviewRequestBase(device.base, "/api/decoder/preset/status.json", { method: "GET" });
    res.json(out.data);
  } catch (err) {
    console.error("Preset status error:", err);
    res.status(500).json({ result: "error", msg: String(err?.message || err) });
  }
});

app.get("/kiloview/:deviceId/current", async (req, res) => {
  try {
    const device = requireDevice(req, res);
    if (!device) return;
    const out = await kiloviewRequestBase(device.base, "/api/decoder/current/status.json", { method: "GET" });
    res.json(out.data);
  } catch (err) {
    console.error("Current status error:", err);
    res.status(500).json({ result: "error", msg: String(err?.message || err) });
  }
});

app.post("/kiloview/:deviceId/decode", async (req, res) => {
  try {
    const device = requireDevice(req, res);
    if (!device) return;

    const { presetId, source } = req.body || {};

    if (presetId !== undefined && presetId !== null) {
      const id = Number(presetId);
      if (!Number.isInteger(id) || id < 0 || id > 9) {
        return res.status(400).json({ result: "error", msg: "presetId must be an integer 0–9" });
      }
      const out = await kiloviewRequestBase(device.base, "/api/decoder/current/set.json", {
        method: "POST",
        query: { id: String(id) },
      });
      return res.json(out.data);
    }

    if (!source?.name || !source?.url) {
      return res.status(400).json({ result: "error", msg: "Provide presetId OR source:{name,url}" });
    }

    const out = await kiloviewRequestBase(device.base, "/api/decoder/current/set.json", {
      method: "POST",
      query: { name: source.name, url: source.url },
    });

    res.json(out.data);
  } catch (err) {
    console.error("Decode switch error:", err);
    res.status(500).json({ result: "error", msg: String(err?.message || err) });
  }
});

// Static UI (dist/)
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/kiloview/") || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}



// HTTP server + WebSocket 

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/td" });


let tdSocket = null;


const uiSockets = new Set();

function isOpen(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function safeSend(ws, obj) {
  if (!isOpen(ws)) return false;
  ws.send(JSON.stringify(obj));
  return true;
}

function broadcastToUI(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of uiSockets) {
    if (isOpen(ws)) ws.send(msg);
  }
}

function setTdSocket(ws) {
 
  if (tdSocket && tdSocket !== ws) {
    try { tdSocket.terminate(); } catch {}
  }
  tdSocket = ws;
  broadcastToUI({ type: "td.status", connected: true });
}

function clearTdSocket(ws) {
  if (ws === tdSocket) {
    tdSocket = null;
    broadcastToUI({ type: "td.status", connected: false });
  }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString("utf8"));
    } catch {
      safeSend(ws, { type: "error", msg: "Invalid JSON" });
      return;
    }

    // Identify TD
    if (msg?.type === "td.hello") {
      ws.isTD = true;
      uiSockets.delete(ws);
      setTdSocket(ws);
      safeSend(ws, { type: "td.ack" });
      return;
    }

    // Identify UI
    if (msg?.type === "ui.hello") {
      ws.isUI = true;
      uiSockets.add(ws);
      safeSend(ws, { type: "ui.ack", tdConnected: isOpen(tdSocket) });
      return;
    }

    // TD -> UI passthrough
    if (ws === tdSocket) {
      broadcastToUI({ type: "td.event", payload: msg });
      return;
    }

    // UI -> TD forwarding
    if (!isOpen(tdSocket)) {
      safeSend(ws, { type: "error", msg: "TD not connected" });
      return;
    }

    safeSend(tdSocket, { type: "ui.toTd", payload: msg });

    
    safeSend(ws, { type: "ok" });
  });

  ws.on("close", () => {
    uiSockets.delete(ws);
    clearTdSocket(ws);
  });

  ws.on("error", () => {
    uiSockets.delete(ws);
    clearTdSocket(ws);
  });
});

// Heartbeat: ping UIs AND TD to avoid stale "connected" state
setInterval(() => {
  const all = [...uiSockets];

  for (const ws of all) {
    if (!ws) continue;

    if (ws.isAlive === false) {
      uiSockets.delete(ws);
      clearTdSocket(ws);
      try { ws.terminate(); } catch {}
      continue;
    }

    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/td`);
  console.log(`Loaded generate spec: ${GENERATE_PATH}`);
  console.log(`Active kit: ${getActiveKitId()}`);
});
