# websocket_callbacks (TD WebSocket DAT callbacks)
# Expects JSON messages like:
# {
#   "type": "set_var",
#   "key": "show_debug",
#   "value": "1",
#   "table": "/project1/web_vars"   # optional
# }

import json

DEFAULT_TABLE_PATH = "/project1/web_vars"


def onConnect(dat):
    debug("WS: Connected")
    return


def onDisconnect(dat):
    debug("WS: Disconnected")
    return


def onReceiveText(dat, rowIndex, text):
    """Main entry for text messages from Node/React."""
    debug(f"WS: Received text: {text}")

    
    try:
        data = json.loads(text)
    except Exception:
        data = None

    if isinstance(data, dict):
        msg_type = data.get("type")

        if msg_type == "set_var":
            handle_set_var(data)
            
            return

    # Fallback for non-JSON messages (optional)
    # cmd = text.strip()
    # if cmd == "ping":
    #     op('websocket1').sendText("TD: pong")

    return


def handle_set_var(data):
    """
    Handle set_var messages.
    data = {
      "type": "set_var",
      "key": "show_debug",
      "value": "1",
      "table": "/project1/web_vars"   # optional
    }
    """
    key = data.get("key")
    value = data.get("value")
    table_path = data.get("table") or DEFAULT_TABLE_PATH

    if not key:
        debug("set_var: no key provided")
        return

    tbl = op(table_path)
    if tbl is None:
        debug(f"set_var: table not found: {table_path}")
        return

    # We assume:
    # - row 0 is header: [key, value]
    # - row 1+ contain data
    target_row = None
    for row in tbl.rows()[1:]:  # skip header
        if row[0].val == key:
            target_row = row
            break

    if target_row is None:
        # Key not found -> append new row
        debug(f"set_var: key not found, adding row: {key} = {value}")
        tbl.appendRow([key, str(value)])
    else:
        # Update existing row
        old = target_row[1].val
        debug(f"set_var: updating {key} from {old} to {value}")
        target_row[1].val = str(value)
