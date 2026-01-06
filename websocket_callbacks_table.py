import json

DEFAULT_TABLE = "/project1/web_vars"

def _send(dat, obj):
    dat.sendText(json.dumps(obj))

def _unwrap(raw):
    # Node relay format: {type:"ui.toTd", payload:{...}}
    if isinstance(raw, dict) and raw.get("type") == "ui.toTd":
        p = raw.get("payload")
        return p if isinstance(p, dict) else None
    return raw if isinstance(raw, dict) else None

def _snapshot(tbl):
    return [[tbl[r, c].val for c in range(tbl.numCols)] for r in range(tbl.numRows)]

def onConnect(dat):
    print("[WS] Connected")
    _send(dat, {"type": "td.hello"})
    return

def onDisconnect(dat):
    print("[WS] Disconnected")
    return

def onReceiveText(dat, rowIndex, text):
    print("[WS] received:", text)

    try:
        raw = json.loads(text)
    except:
        print("[WS] Non-JSON:", text)
        return

    msg = _unwrap(raw)
    if not msg:
        return

    t = msg.get("type")
    table_path = msg.get("table") or DEFAULT_TABLE

    tbl = op(table_path)
    if tbl is None:
        _send(dat, {"type": "td.error", "msg": f"Table not found: {table_path}"})
        return



    # UI asks for snapshot
    if t == "get_table":
        _send(dat, {"type": "table_snapshot", "table": table_path, "rows": _snapshot(tbl)})
        return

    # UI edits any cell
    if t == "set_cell":
        try:
            r = int(msg.get("row"))
            c = int(msg.get("col"))
            v = "" if msg.get("value") is None else str(msg.get("value"))
            tbl[r, c] = v
            _send(dat, {"type": "td.ack", "cmd": "set_cell", "table": table_path, "row": r, "col": c})
        except Exception as e:
            _send(dat, {"type": "td.error", "msg": f"set_cell failed: {e}"})
        return

    # Keep your old key/value command if you still want it
    if t == "set_var":
        key = msg.get("key")
        value = msg.get("value")
        if not key:
            return
        if tbl.numRows == 0:
            tbl.appendRow(["key", "value"])
        for r in range(1, tbl.numRows):
            if tbl[r, 0].val == str(key):
                tbl[r, 1] = str(value)
                return
        tbl.appendRow([str(key), str(value)])
        return
