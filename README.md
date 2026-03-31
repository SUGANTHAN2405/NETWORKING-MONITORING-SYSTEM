# NetWatch 🖥️

**Real-time network device monitoring dashboard** built with React + FastAPI + WebSockets.

Monitor every device on your network — track latency, uptime, traffic patterns, and get instant alerts when devices go offline or degrade.

![NetWatch Dashboard](https://img.shields.io/badge/status-active-brightgreen) ![Python](https://img.shields.io/badge/Python-3.11+-blue) ![React](https://img.shields.io/badge/React-18-61DAFB) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688) ![WebSocket](https://img.shields.io/badge/WebSocket-real--time-orange)

---

## Features

- **Live Device Monitoring** — Pings all registered devices every 10 seconds via ICMP
- **Real-Time WebSocket Updates** — Dashboard auto-refreshes without page reload
- **Automatic Alerting** — Detects device going down, coming back up, and high latency spikes
- **Traffic Visualization** — Live inbound/outbound bandwidth chart with Recharts
- **Network Topology Map** — Visual SVG map of device relationships on your subnet
- **Device Management** — Add or remove devices via the UI or REST API
- **Persistent Storage** — All ping history and alerts stored in SQLite
- **Filter & Search** — Filter devices by status (UP / WARN / DOWN)

---

## Tech Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Frontend  | React 18, Recharts, Vite          |
| Backend   | Python, FastAPI, asyncio          |
| Real-Time | WebSockets (native browser + FastAPI) |
| Database  | SQLite (via Python sqlite3)       |
| Networking| subprocess ping (ICMP), ipaddress |

---

## Architecture

```
Browser (React)
    │
    ├── REST API calls  ──► FastAPI (/devices, /alerts, /stats)
    │                           │
    └── WebSocket ──────────► FastAPI (/ws)
                                    │
                              Monitor Loop (asyncio)
                                    │
                              ping_host() ──► subprocess ping
                                    │
                              SQLite DB (devices, ping_results, alerts)
```

**Data flow:**
1. FastAPI starts a background `asyncio` task that pings all devices every 10 seconds
2. Ping results are written to SQLite
3. Status changes trigger alert creation
4. All connected WebSocket clients receive updated data as a JSON payload
5. React frontend renders the update instantly

---

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- Network access to the devices you want to monitor (same subnet or routable)

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
python main.py
# API running at http://localhost:8000
```

Or with uvicorn directly:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
# Dashboard at http://localhost:3000
```

---

## REST API Reference

| Method | Endpoint        | Description                        |
|--------|-----------------|------------------------------------|
| GET    | `/devices`      | List all devices with latest status|
| POST   | `/devices`      | Add a new device                   |
| DELETE | `/devices/{id}` | Remove a device                    |
| GET    | `/alerts`       | Get recent alerts (last 20)        |
| GET    | `/stats`        | Aggregate stats (online, avg latency)|
| WS     | `/ws`           | WebSocket stream for live updates  |

### Add Device (POST /devices)
```json
{
  "name": "My Router",
  "ip": "192.168.1.1",
  "mac": "AA:BB:CC:DD:EE:FF",
  "type": "Router",
  "port": 80
}
```

---

## Database Schema

```sql
-- Registered devices
devices (id, name, ip, mac, device_type, port, added_at)

-- Ping history
ping_results (id, device_id, latency, status, timestamp)

-- Auto-generated alerts
alerts (id, device_id, alert_type, message, severity, timestamp, resolved)
```

---

## How It Works

### Ping Mechanism
Uses Python's `subprocess` to run the system `ping` command:
- Linux/Mac: `ping -c 1 -W 1 <ip>`
- Windows: `ping -n 1 -w 1000 <ip>`

Parses the response with regex to extract round-trip time (RTT).

### Alert Rules
| Condition                        | Severity  |
|----------------------------------|-----------|
| Device status: up → down         | Critical  |
| Device status: down → up         | Info      |
| Latency > 100ms                  | Warning   |

### WebSocket Protocol
```json
{
  "type": "update",
  "devices": [
    {
      "id": 1,
      "name": "Gateway Router",
      "ip": "192.168.1.1",
      "status": "up",
      "latency": 2.4,
      "history": [1.2, 2.1, 1.8, 2.4]
    }
  ],
  "alerts": [...]
}
```

---

## Project Structure

```
netwatch/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket, monitor loop
│   ├── requirements.txt
│   └── netwatch.db          # SQLite (auto-created on first run)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main dashboard component
│   │   ├── App.css          # Dashboard styles
│   │   ├── useWebSocket.js  # WebSocket hook with auto-reconnect
│   │   ├── main.jsx         # React entry point
│   │   └── index.css        # Global styles
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
└── README.md
```

---

## Resume Bullet Points

Use these in your resume under this project:

- Built a full-stack real-time network monitoring system using **React, FastAPI, and WebSockets** that tracks device health across a subnet
- Implemented **async ICMP ping engine** in Python using subprocess and asyncio to concurrently monitor multiple hosts every 10 seconds
- Designed **SQLite schema** for storing ping history and auto-generated alerts based on latency thresholds and status transitions
- Built **WebSocket broadcast system** to push live updates to all connected clients without polling
- Created interactive topology map, sparkline charts, and traffic visualization using **Recharts and SVG**

---

## License

MIT — free to use, modify, and showcase.
