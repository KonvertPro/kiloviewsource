import React, { useEffect, useMemo, useState } from "react";

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: text };
  }
}

function pillClasses(isOnline) {
  return isOnline
    ? "border-emerald-800 text-emerald-300 bg-emerald-950/40"
    : "border-slate-700 text-slate-300 bg-slate-950/40";
}

function summarizeCurrent(payload) {
  const d = payload?.data;
  if (!d) return null;

  return {
    online: !!d.online,
    name: d.name || "—",
    resolution: d.resolution || "—",
    fps: d.inst_frame_rate ?? "—",
    codec: d.codec || "—",
    ndi: d.ndi_connection || "—",
    url: d.url || "—",
    ip: d.ip || "—",
    warning: d.warning || "",
  };
}

export default function App() {
  const [serverOk, setServerOk] = useState(false);

  const [kitsInfo, setKitsInfo] = useState({ activeKitId: "", kits: [] });
  const [kit, setKit] = useState(null);

  const [filter, setFilter] = useState("");

  // Which accordion is open
  const [openId, setOpenId] = useState("");

  // Per-device caches
  const [currentById, setCurrentById] = useState({});
  const [presetsById, setPresetsById] = useState({});
  const [messagesById, setMessagesById] = useState({}); // { [id]: string[] }
  const [busyById, setBusyById] = useState({}); // { [id]: {current?:bool,presets?:bool,reboot?:bool} }

  const devices = useMemo(() => kit?.devices || [], [kit]);

  const filteredDevices = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => {
      const hay = `${d.name || ""} ${d.id || ""} ${d.host || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [devices, filter]);

  function push(deviceId, msg) {
    setMessagesById((prev) => {
      const cur = prev[deviceId] || [];
      return { ...prev, [deviceId]: [msg, ...cur].slice(0, 50) };
    });
  }

  function setBusy(deviceId, patch) {
    setBusyById((prev) => ({ ...prev, [deviceId]: { ...(prev[deviceId] || {}), ...patch } }));
  }

  async function checkServerConnection() {
    try {
      const r = await fetch("/health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setServerOk(true);
    } catch {
      setServerOk(false);
    }
  }

  async function loadKits() {
    const r = await fetch("/api/kits");
    const data = await r.json();
    setKitsInfo(data);
  }

  async function loadActiveKit() {
    const r = await fetch("/api/kit");
    const data = await r.json();
    setKit(data);

    // Open first device by default
    const firstId = data?.devices?.[0]?.id || "";
    setOpenId((v) => v || firstId);
  }

  async function setActiveKit(kitId) {
    const r = await fetch("/api/kit/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kitId }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) return;

    setKitsInfo((prev) => ({ ...prev, activeKitId: data.activeKitId }));
    // clear caches
    setCurrentById({});
    setPresetsById({});
    setMessagesById({});
    setBusyById({});
    setFilter("");
    setOpenId("");
    await loadActiveKit();
  }

  async function fetchCurrent(deviceId) {
    if (!deviceId) return;
    setBusy(deviceId, { current: true });
    push(deviceId, `Refreshing current…`);
    try {
      const r = await fetch(`/kiloview/${deviceId}/current`);
      const text = await r.text();
      const parsed = safeJsonParse(text);

      if (!r.ok) {
        push(deviceId, `Current failed: ${r.status}`);
        return;
      }
      if (!parsed.ok) {
        push(deviceId, `Current returned non-JSON: ${String(parsed.value).slice(0, 120)}`);
        return;
      }

      setCurrentById((prev) => ({ ...prev, [deviceId]: parsed.value }));
      push(deviceId, `Current updated.`);
    } catch (e) {
      push(deviceId, `Current error: ${String(e)}`);
    } finally {
      setBusy(deviceId, { current: false });
    }
  }

  async function fetchPresets(deviceId) {
    if (!deviceId) return;
    setBusy(deviceId, { presets: true });
    push(deviceId, `Refreshing presets…`);
    try {
      const r = await fetch(`/kiloview/${deviceId}/presets`);
      const text = await r.text();
      const parsed = safeJsonParse(text);

      if (!r.ok) {
        push(deviceId, `Presets failed: ${r.status}`);
        return;
      }
      if (!parsed.ok) {
        push(deviceId, `Presets returned non-JSON: ${String(parsed.value).slice(0, 120)}`);
        return;
      }

      setPresetsById((prev) => ({ ...prev, [deviceId]: parsed.value }));
      push(deviceId, `Presets updated.`);
    } catch (e) {
      push(deviceId, `Presets error: ${String(e)}`);
    } finally {
      setBusy(deviceId, { presets: false });
    }
  }

  async function reboot(deviceId) {
    if (!deviceId) return;
    setBusy(deviceId, { reboot: true });
    push(deviceId, `Rebooting… (~20s)`);
    try {
      const r = await fetch(`/kiloview/${deviceId}/reboot`, { method: "POST" });
      const text = await r.text();
      const parsed = safeJsonParse(text);

      if (!r.ok) {
        push(deviceId, `Reboot failed: ${r.status}`);
        return;
      }
      push(deviceId, `Reboot command sent.`);
      // Optional: clear cached current/presets so you don’t stare at stale info
      setCurrentById((p) => {
        const { [deviceId]: _, ...rest } = p;
        return rest;
      });
      setPresetsById((p) => {
        const { [deviceId]: _, ...rest } = p;
        return rest;
      });

      // After ~20s you can refresh manually
    } catch (e) {
      push(deviceId, `Reboot error: ${String(e)}`);
    } finally {
      setBusy(deviceId, { reboot: false });
    }
  }

  useEffect(() => {
    (async () => {
      await checkServerConnection();
      await loadKits();
      await loadActiveKit();
    })();
  }, []);

  function DeviceAccordion({ d }) {
    const isOpen = d.id === openId;
    const current = currentById[d.id];
    const presets = presetsById[d.id];
    const msgs = messagesById[d.id] || [];
    const busy = busyById[d.id] || {};

    const summary = summarizeCurrent(current);

    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-900/60 overflow-hidden">
        <button
          className="w-full px-4 py-4 flex items-center justify-between gap-3 hover:bg-slate-800/30"
          onClick={() => setOpenId((v) => (v === d.id ? "" : d.id))}
        >
          <div className="flex items-center gap-3">
            <div className="text-slate-100 font-semibold">{d.name || d.id}</div>
            <span className={`text-xs px-2 py-1 rounded-full border ${pillClasses(summary?.online)}`}>
              {summary ? (summary.online ? "LIVE" : "Offline") : "Not loaded"}
            </span>
          </div>
          <div className="text-xs text-slate-400">{d.host}</div>
        </button>

        {isOpen ? (
          <div className="p-4 space-y-4">
            {/* Quick Controls */}
            <div className="rounded-2xl border border-slate-700 bg-slate-950/30 p-4">
              <div className="text-lg font-semibold mb-3">Quick Controls</div>
              <button
                className="px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
                disabled={!!busy.reboot}
                onClick={() => reboot(d.id)}
              >
                Reboot Kiloview (~20s)
              </button>
            </div>

          {/* Presets */}
<div className="rounded-2xl border border-slate-700 bg-slate-950/30 p-4">
  <div className="flex items-center justify-between gap-3">
    <div>
      <div className="text-lg font-semibold">Presets</div>
      <div className="text-sm text-slate-400">
        {presets ? `Loaded (${presets?.data_size ?? presets?.data?.length ?? "?"})` : "Not loaded yet"}
      </div>
    </div>
    <button
      className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
      disabled={!!busy.presets}
      onClick={() => fetchPresets(d.id)}
    >
      Refresh
    </button>
  </div>

  {presets?.data?.length ? (
    <div className="mt-3 space-y-2">
      {presets.data
        // ignore the special/meta slot "0" if it has no url/name fields
        .filter((p) => {
          const hasRealFields = (p?.url && String(p.url).trim() !== "") || (p?.name && String(p.name).trim() !== "");
          return hasRealFields;
        })
        // Sort by numeric id if present
        .slice()
        .sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0))
        .map((p) => {
          const idNum = Number(p.id);
          const enabled = Number(p.enable) === 1;
          const online = String(p.online || "").toLowerCase() === "on";
          const warning = (p.warning || "").toString().trim();

          return (
            <div
              key={`${d.id}-preset-${p.id}`}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">
                      Preset {p.id}
                    </span>

                    <span
                      className={`text-xs px-2 py-1 rounded-full border ${
                        enabled
                          ? "border-emerald-800 text-emerald-300 bg-emerald-950/40"
                          : "border-slate-700 text-slate-300 bg-slate-950/40"
                      }`}
                    >
                      {enabled ? "Enabled" : "Disabled"}
                    </span>

                    <span
                      className={`text-xs px-2 py-1 rounded-full border ${
                        online
                          ? "border-emerald-800 text-emerald-300 bg-emerald-950/40"
                          : "border-rose-800 text-rose-300 bg-rose-950/40"
                      }`}
                    >
                      {online ? "Online" : "Offline"}
                    </span>

                    {warning ? (
                      <span className="text-xs px-2 py-1 rounded-full border border-amber-900/60 text-amber-200 bg-amber-950/30">
                        {warning}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 text-sm text-slate-200 truncate">
                    {p.device_name ? (
                      <>
                        <span className="text-slate-400">Device:</span>{" "}
                        <span className="text-slate-100">{p.device_name}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    {p.channel_name ? (
                      <>
                        {" "}
                        <span className="text-slate-500">•</span>{" "}
                        <span className="text-slate-300">{p.channel_name}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-1 text-xs text-slate-400 truncate">
                    {p.url ? p.url : "—"}
                  </div>
                </div>

                <button
                  className="shrink-0 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
                  disabled={!Number.isFinite(idNum) || busy.reboot || busy.current || busy.presets}
                  onClick={async () => {
                    push(d.id, `Switching to preset ${p.id}…`);
                    try {
                      setBusy(d.id, { switch: true });
                      const r = await fetch(`/kiloview/${d.id}/decode`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ presetId: idNum }),
                      });
                      const text = await r.text();
                      const parsed = safeJsonParse(text);

                      if (!r.ok) {
                        push(d.id, `Switch failed: ${r.status}`);
                        return;
                      }
                      if (!parsed.ok) {
                        push(d.id, `Switch returned non-JSON: ${String(parsed.value).slice(0, 120)}`);
                      } else {
                        push(d.id, `Switched to preset ${p.id}.`);
                      }
                      // refresh current so summary updates
                      await fetchCurrent(d.id);
                    } catch (e) {
                      push(d.id, `Switch error: ${String(e)}`);
                    } finally {
                      setBusy(d.id, { switch: false });
                    }
                  }}
                  title="Switch this Kiloview to this preset"
                >
                  Switch
                </button>
              </div>
            </div>
          );
        })}
    </div>
  ) : (
    <div className="mt-3 text-sm text-slate-400">Not loaded yet.</div>
  )}

  <details className="mt-3">
    <summary className="cursor-pointer text-sm text-slate-300 select-none">Show raw</summary>
    <pre className="mt-2 text-xs bg-slate-950/60 border border-slate-800 rounded-lg p-2 overflow-auto max-h-64">
      {presets ? JSON.stringify(presets, null, 2) : "—"}
    </pre>
  </details>
</div>


            {/* Current Decode */}
            <div className="rounded-2xl border border-slate-700 bg-slate-950/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">Current Decode</div>
                  <div className="text-sm text-slate-400">
                    {summary ? summary.name : "Not loaded yet"}
                  </div>
                </div>
                <button
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                  disabled={!!busy.current}
                  onClick={() => fetchCurrent(d.id)}
                >
                  Refresh
                </button>
              </div>

              {summary ? (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Online</span>
                    <span className="text-slate-100">{summary.online ? "Yes" : "No"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Resolution</span>
                    <span className="text-slate-100">{summary.resolution}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">FPS</span>
                    <span className="text-slate-100">{summary.fps}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">Codec</span>
                    <span className="text-slate-100">{summary.codec}</span>
                  </div>
                  <div className="flex justify-between gap-3 sm:col-span-2">
                    <span className="text-slate-400">NDI</span>
                    <span className="text-slate-100">{summary.ndi} • {summary.url}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">IP</span>
                    <span className="text-slate-100">{summary.ip}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-400">Not loaded yet.</div>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-slate-300 select-none">Show raw</summary>
                <pre className="mt-2 text-xs bg-slate-950/60 border border-slate-800 rounded-lg p-2 overflow-auto max-h-64">
                  {current ? JSON.stringify(current, null, 2) : "—"}
                </pre>
              </details>
            </div>

            {/* Messages */}
            <div className="rounded-2xl border border-slate-700 bg-slate-950/30 p-4">
              <div className="text-lg font-semibold mb-3">Messages</div>
              <div className="text-xs bg-slate-950/60 border border-slate-800 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                {msgs.length ? msgs.join("\n") : "—"}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-4">
        {/* Top bar */}
        <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="font-semibold">Active kit</div>
              <select
                className="bg-slate-800 border border-slate-700 text-slate-100 rounded-md px-2 py-1 text-sm"
                value={kitsInfo.activeKitId || ""}
                onChange={(e) => setActiveKit(e.target.value)}
              >
                {(kitsInfo.kits || []).map((k) => (
                  <option key={k.kitId} value={k.kitId}>
                    {k.kitName} ({k.count})
                  </option>
                ))}
              </select>

              <span className={`text-xs px-2 py-1 rounded-full border ${serverOk ? "border-emerald-800 text-emerald-300 bg-emerald-950/40" : "border-rose-800 text-rose-300 bg-rose-950/40"}`}>
                {serverOk ? "Server OK" : "Server offline"}
              </span>
            </div>

            <input
              className="bg-slate-950/40 border border-slate-700 text-slate-100 rounded-md px-2 py-1 text-sm w-72"
              placeholder="Search devices (vg-01, Kilo12, …)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="mt-2 text-xs text-slate-400">
            Showing {filteredDevices.length} / {devices.length}
          </div>
        </div>

        {/* Accordions */}
        {filteredDevices.map((d) => (
          <DeviceAccordion key={d.id} d={d} />
        ))}
      </div>
    </div>
  );
}
