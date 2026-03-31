import asyncio
import json
import sqlite3
import subprocess
import platform
import re
import ipaddress
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import threading

DB_PATH = "netwatch.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ip TEXT UNIQUE NOT NULL,
            mac TEXT,
            device_type TEXT DEFAULT 'Unknown',
            port INTEGER,
            added_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS ping_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER,
            latency REAL,
            status TEXT,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_id) REFERENCES devices(id)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER,
            alert_type TEXT,
            message TEXT,
            severity TEXT DEFAULT 'info',
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            resolved INTEGER DEFAULT 0
        )
    """)
    seed = [
        ("Gateway Router",  "192.168.1.1",  "A4:11:6B:3C:2E:01", "Router",   80),
        ("Core Switch",     "192.168.1.2",  "B8:27:EB:4F:1A:02", "Switch",   22),
        ("Web Server",      "192.168.1.10", "DC:A6:32:5B:9C:03", "Server",  443),
        ("DB Server",       "192.168.1.11", "E4:5F:01:2C:7D:04", "Server", 5432),
        ("NAS Storage",     "192.168.1.20", "30:9C:23:7F:0E:07", "Storage",  445),
        ("WiFi Access Point","192.168.1.3", "AC:84:C6:AB:2D:08", "AP",        80),
        ("Dev Workstation", "192.168.1.50", "F0:18:98:6E:3B:05", "Endpoint", None),
        ("IP Camera 01",    "192.168.1.80", "00:1B:44:11:3A:06", "IoT",      554),
    ]
    for name, ip, mac, dtype, port in seed:
        c.execute("INSERT OR IGNORE INTO devices (name,ip,mac,device_type,port) VALUES (?,?,?,?,?)",
                  (name, ip, mac, dtype, port))
    conn.commit()
    conn.close()

def ping_host(ip: str) -> tuple[str, float | None]:
    system = platform.system().lower()
    try:
        if system == "windows":
            cmd = ["ping", "-n", "1", "-w", "1000", ip]
        else:
            cmd = ["ping", "-c", "1", "-W", "1", ip]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
        if result.returncode == 0:
            output = result.stdout
            match = re.search(r"time[=<]([\d.]+)\s*ms", output, re.IGNORECASE)
            latency = float(match.group(1)) if match else 1.0
            return "up", round(latency, 2)
        return "down", None
    except Exception:
        return "down", None

def get_db():
    return sqlite3.connect(DB_PATH)

def get_all_devices():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, name, ip, mac, device_type, port FROM devices")
    rows = c.fetchall()
    conn.close()
    return [{"id":r[0],"name":r[1],"ip":r[2],"mac":r[3],"type":r[4],"port":r[5]} for r in rows]

def save_ping(device_id, status, latency):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO ping_results (device_id,latency,status) VALUES (?,?,?)",
              (device_id, latency, status))
    conn.commit()
    conn.close()

def create_alert(device_id, msg, severity="warning"):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO alerts (device_id,message,severity,alert_type) VALUES (?,?,?,?)",
              (device_id, msg, severity, "auto"))
    conn.commit()
    conn.close()

def get_recent_alerts(limit=10):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT a.id, d.name, a.message, a.severity, a.timestamp
        FROM alerts a LEFT JOIN devices d ON a.device_id=d.id
        ORDER BY a.timestamp DESC LIMIT ?
    """, (limit,))
    rows = c.fetchall()
    conn.close()
    return [{"id":r[0],"device":r[1],"message":r[2],"severity":r[3],"time":r[4]} for r in rows]

def get_latency_history(device_id, limit=20):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT latency, timestamp FROM ping_results
        WHERE device_id=? AND latency IS NOT NULL
        ORDER BY timestamp DESC LIMIT ?
    """, (device_id, limit))
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in reversed(rows)]

previous_status = {}

async def monitor_loop(manager):
    while True:
        devices = get_all_devices()
        results = []
        for d in devices:
            status, latency = ping_host(d["ip"])
            save_ping(d["id"], status, latency)
            prev = previous_status.get(d["id"])
            if prev and prev != status:
                if status == "down":
                    create_alert(d["id"], f"{d['name']} ({d['ip']}) went offline", "critical")
                elif status == "up":
                    create_alert(d["id"], f"{d['name']} ({d['ip']}) is back online", "info")
            if status == "up" and latency and latency > 100:
                create_alert(d["id"], f"{d['name']} high latency: {latency}ms", "warning")
            previous_status[d["id"]] = status
            history = get_latency_history(d["id"])
            results.append({
                **d,
                "status": status,
                "latency": latency,
                "history": history
            })
        alerts = get_recent_alerts()
        payload = json.dumps({"type": "update", "devices": results, "alerts": alerts})
        await manager.broadcast(payload)
        await asyncio.sleep(10)

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, msg: str):
        for ws in list(self.active):
            try:
                await ws.send_text(msg)
            except Exception:
                self.disconnect(ws)

manager = ConnectionManager()
monitor_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global monitor_task
    init_db()
    monitor_task = asyncio.create_task(monitor_loop(manager))
    yield
    if monitor_task:
        monitor_task.cancel()

app = FastAPI(title="NetWatch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "NetWatch API running", "version": "1.0.0"}

@app.get("/devices")
def list_devices():
    devices = get_all_devices()
    enriched = []
    for d in devices:
        conn = get_db()
        c = conn.cursor()
        c.execute("""
            SELECT status, latency FROM ping_results
            WHERE device_id=? ORDER BY timestamp DESC LIMIT 1
        """, (d["id"],))
        row = c.fetchone()
        conn.close()
        history = get_latency_history(d["id"])
        enriched.append({
            **d,
            "status": row[0] if row else "unknown",
            "latency": row[1] if row else None,
            "history": history
        })
    return enriched

@app.get("/alerts")
def list_alerts():
    return get_recent_alerts(20)

@app.get("/stats")
def get_stats():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM devices")
    total = c.fetchone()[0]
    c.execute("""
        SELECT d.id, pr.status FROM devices d
        LEFT JOIN ping_results pr ON pr.device_id=d.id
        WHERE pr.id=(SELECT MAX(id) FROM ping_results WHERE device_id=d.id)
    """)
    statuses = c.fetchall()
    up = sum(1 for s in statuses if s[1]=="up")
    down = sum(1 for s in statuses if s[1]=="down")
    c.execute("""
        SELECT AVG(latency) FROM ping_results
        WHERE timestamp > datetime('now','-5 minutes') AND latency IS NOT NULL
    """)
    avg_lat = c.fetchone()[0]
    conn.close()
    return {
        "total": total,
        "online": up,
        "offline": down,
        "avg_latency": round(avg_lat, 2) if avg_lat else 0
    }

@app.post("/devices")
def add_device(data: dict):
    try:
        ipaddress.ip_address(data["ip"])
    except ValueError:
        return JSONResponse({"error": "Invalid IP address"}, status_code=400)
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO devices (name,ip,mac,device_type,port) VALUES (?,?,?,?,?)",
              (data.get("name","Unknown"), data["ip"], data.get("mac",""), data.get("type","Endpoint"), data.get("port")))
    conn.commit()
    conn.close()
    return {"message": "Device added"}

@app.delete("/devices/{device_id}")
def delete_device(device_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM devices WHERE id=?", (device_id,))
    conn.commit()
    conn.close()
    return {"message": "Device removed"}

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        devices = get_all_devices()
        enriched = []
        for d in devices:
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT status, latency FROM ping_results WHERE device_id=? ORDER BY timestamp DESC LIMIT 1", (d["id"],))
            row = c.fetchone()
            conn.close()
            history = get_latency_history(d["id"])
            enriched.append({**d, "status": row[0] if row else "unknown", "latency": row[1] if row else None, "history": history})
        alerts = get_recent_alerts()
        await ws.send_text(json.dumps({"type": "update", "devices": enriched, "alerts": alerts}))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
