import { useState, useEffect, useRef } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useWebSocket } from './useWebSocket'
import './App.css'

const WS_URL = `ws://${window.location.hostname}:8000/ws`
const API_URL = `http://${window.location.hostname}:8000`

function StatusBadge({ status }) {
  const map = {
    up:      { label: '● UP',    cls: 'badge-up' },
    down:    { label: '● DOWN',  cls: 'badge-down' },
    warn:    { label: '⚠ WARN',  cls: 'badge-warn' },
    unknown: { label: '? UNK',   cls: 'badge-unk' },
  }
  const { label, cls } = map[status] || map.unknown
  return <span className={`badge ${cls}`}>{label}</span>
}

function Sparkline({ data, status }) {
  if (!data || data.length === 0) return <span style={{ color: 'var(--muted)' }}>—</span>
  const max = Math.max(...data, 1)
  return (
    <div className="sparkline">
      {data.slice(-10).map((v, i) => {
        const h = Math.max(3, Math.round((v / max) * 24))
        const cls = status === 'down' ? 'danger' : v > 80 ? 'warn' : ''
        return <div key={i} className={`spark-bar ${cls}`} style={{ height: h + 'px' }} />
      })}
    </div>
  )
}

function KpiCard({ label, value, unit, sub, colorClass, topColor }) {
  return (
    <div className="kpi-card" style={{ '--top-color': topColor }}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${colorClass}`}>
        {value}<span className="kpi-unit">{unit}</span>
      </div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

function AddDeviceModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ name: '', ip: '', mac: '', type: 'Endpoint', port: '' })
  const [error, setError] = useState('')

  const submit = async () => {
    if (!form.name || !form.ip) { setError('Name and IP are required'); return }
    const res = await fetch(`${API_URL}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, port: form.port ? parseInt(form.port) : null })
    })
    const data = await res.json()
    if (data.error) { setError(data.error); return }
    onAdd()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="panel-title">Add Device</span>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}
          {[
            { key: 'name', placeholder: 'Device name' },
            { key: 'ip', placeholder: 'IP Address (e.g. 192.168.1.1)' },
            { key: 'mac', placeholder: 'MAC Address (optional)' },
            { key: 'port', placeholder: 'Port (optional)' },
          ].map(({ key, placeholder }) => (
            <input key={key} className="input" placeholder={placeholder}
              value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
          ))}
          <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {['Router','Switch','Server','AP','IoT','Storage','Endpoint'].map(t =>
              <option key={t}>{t}</option>
            )}
          </select>
          <button className="btn btn-primary" onClick={submit}>Add Device</button>
        </div>
      </div>
    </div>
  )
}

function TopologyMap({ devices }) {
  const nodePositions = {
    'Router':   { x: 280, y: 30, color: 'var(--accent)' },
    'Switch':   { x: 280, y: 110, color: 'var(--accent)' },
    'Server':   [{ x: 100, y: 185 }, { x: 210, y: 185 }],
    'Storage':  { x: 320, y: 185, color: 'var(--accent2)' },
    'AP':       { x: 430, y: 185, color: 'var(--accent2)' },
    'IoT':      { x: 510, y: 185, color: 'var(--warn)' },
    'Endpoint': { x: 50,  y: 185, color: 'var(--muted)' },
  }

  const placed = []
  const typeCount = {}
  devices.forEach(d => {
    const pos = nodePositions[d.type]
    if (!pos) return
    if (Array.isArray(pos)) {
      const idx = typeCount[d.type] || 0
      typeCount[d.type] = idx + 1
      const p = pos[idx % pos.length]
      placed.push({ ...d, x: p.x, y: p.y, color: d.status === 'down' ? 'var(--danger)' : 'var(--accent2)' })
    } else {
      placed.push({ ...d, x: pos.x, y: pos.y, color: d.status === 'down' ? 'var(--danger)' : pos.color })
    }
  })

  const router = placed.find(d => d.type === 'Router')
  const sw = placed.find(d => d.type === 'Switch')

  return (
    <svg viewBox="0 0 560 220" style={{ width: '100%', height: '200px' }}>
      {router && sw && (
        <>
          <line x1={280} y1={20} x2={280} y2={30} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3,2" />
          <text x={280} y={12} textAnchor="middle" fill="var(--muted)" fontSize="8" fontFamily="JetBrains Mono">INTERNET</text>
          <line x1={router.x} y1={router.y} x2={sw.x} y2={sw.y} stroke="var(--border)" strokeWidth="1.5" />
        </>
      )}
      {sw && placed.filter(d => !['Router','Switch'].includes(d.type)).map((d, i) => (
        <line key={i} x1={sw.x} y1={sw.y} x2={d.x} y2={d.y}
          stroke={d.status === 'down' ? 'rgba(255,69,96,0.3)' : 'var(--border)'}
          strokeWidth="1.5"
          strokeDasharray={d.status === 'down' ? '4,3' : 'none'} />
      ))}
      {placed.map((d, i) => (
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={18} fill={d.color} opacity="0.08" />
          <circle cx={d.x} cy={d.y} r={14} fill="var(--surface2)" stroke={d.color} strokeWidth="1.5" />
          <text x={d.x} y={d.y + 1} textAnchor="middle" dominantBaseline="middle"
            fill={d.color} fontSize="6" fontFamily="JetBrains Mono" fontWeight="500">
            {d.name.split(' ')[0].substring(0, 7)}
          </text>
          <text x={d.x} y={d.y + 24} textAnchor="middle"
            fill="var(--muted)" fontSize="6" fontFamily="JetBrains Mono">
            {d.ip}
          </text>
        </g>
      ))}
    </svg>
  )
}

export default function App() {
  const { data, connected } = useWebSocket(WS_URL)
  const [filter, setFilter] = useState('ALL')
  const [showAdd, setShowAdd] = useState(false)
  const [time, setTime] = useState(new Date())
  const [trafficHistory, setTrafficHistory] = useState(
    Array.from({ length: 20 }, (_, i) => ({
      t: i, in: Math.random() * 50 + 20, out: Math.random() * 30 + 10
    }))
  )
  const tickRef = useRef(0)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!data) return
    tickRef.current += 1
    const tick = tickRef.current
    setTrafficHistory(prev => {
      const last = prev[prev.length - 1]
      const newEntry = {
        t: tick,
        in: Math.max(1, last.in + (Math.random() - 0.5) * 15),
        out: Math.max(1, last.out + (Math.random() - 0.5) * 10),
      }
      return [...prev.slice(-19), newEntry]
    })
  }, [data])

  const devices = data?.devices || []
  const alerts = data?.alerts || []

  const online = devices.filter(d => d.status === 'up').length
  const offline = devices.filter(d => d.status === 'down').length
  const warned = devices.filter(d => d.status === 'warn').length
  const latencies = devices.filter(d => d.latency).map(d => d.latency)
  const avgLat = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0

  const filtered = filter === 'ALL' ? devices
    : devices.filter(d => d.status === filter.toLowerCase())

  const latClass = v => !v ? '' : v > 50 ? 'crit' : v > 20 ? 'high' : ''

  return (
    <div className="app">
      <header>
        <div className="logo">
          <div className={`logo-dot ${connected ? 'live' : 'offline'}`} />
          <span className="logo-text">NetWatch</span>
          <span className="logo-sub"> / Dashboard</span>
        </div>
        <div className="header-right">
          <div className={`status-pill ${connected ? '' : 'disconnected'}`}>
            <div className="status-dot" />
            {connected ? 'MONITORING ACTIVE' : 'RECONNECTING...'}
          </div>
          <div className="timestamp">{time.toLocaleTimeString()}</div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Device</button>
        </div>
      </header>

      <div className="main">
        <div className="kpi-row">
          <KpiCard label="Devices Online" value={online} sub={`of ${devices.length} total`}
            colorClass="color-up" topColor="var(--accent2)" />
          <KpiCard label="Offline / Degraded" value={offline + warned}
            sub={`${offline} down · ${warned} degraded`} colorClass="color-down" topColor="var(--danger)" />
          <KpiCard label="Avg Latency" value={avgLat} unit="ms"
            sub="across active nodes" colorClass="color-accent" topColor="var(--accent)" />
          <KpiCard label="Active Alerts" value={alerts.length}
            sub={`${alerts.filter(a => a.severity === 'critical').length} critical`}
            colorClass="color-warn" topColor="var(--warn)" />
        </div>

        <div className="mid-row">
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Device Inventory</span>
              <div className="toolbar">
                {['ALL', 'UP', 'WARN', 'DOWN'].map(f => (
                  <button key={f} className={`btn ${filter === f ? 'active' : ''}`}
                    onClick={() => setFilter(f)}>{f}</button>
                ))}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Device</th><th>Type</th><th>Status</th>
                    <th>Latency</th><th>Traffic</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px' }}>
                      No devices found
                    </td></tr>
                  )}
                  {filtered.map(d => (
                    <tr key={d.id}>
                      <td>
                        <div className="device-name">{d.name}</div>
                        <div className="device-ip">{d.ip} · {d.mac || '—'}</div>
                      </td>
                      <td><span className="type-tag">{d.type}</span></td>
                      <td><StatusBadge status={d.status} /></td>
                      <td>
                        {d.latency
                          ? <span className={`latency-val ${latClass(d.latency)}`}>{d.latency}ms</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td><Sparkline data={d.history} status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Alerts</span>
              <span className="panel-badge">LIVE</span>
            </div>
            <div className="alerts-list">
              {alerts.length === 0 && (
                <div style={{ padding: '20px 16px', color: 'var(--muted)', fontSize: '12px' }}>
                  No alerts — all systems nominal
                </div>
              )}
              {alerts.map((a, i) => (
                <div key={i} className="alert-item">
                  <div className={`alert-icon ${a.severity}`}>
                    {a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵'}
                  </div>
                  <div>
                    <div className="alert-msg">{a.message}</div>
                    <div className="alert-time">{a.device} · {new Date(a.time).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bottom-row">
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Network Traffic</span>
              <div style={{ display: 'flex', gap: 14, fontSize: 10, color: 'var(--muted)' }}>
                <span style={{ color: 'var(--accent)' }}>▬ Inbound</span>
                <span style={{ color: 'var(--accent2)' }}>▬ Outbound</span>
              </div>
            </div>
            <div className="chart-area">
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={trafficHistory} margin={{ top: 5, right: 10, left: -30, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent2)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--accent2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" hide />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--muted)', fontFamily: 'JetBrains Mono' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    labelStyle={{ color: 'var(--muted)' }}
                    formatter={(v) => [v.toFixed(1) + ' Mbps']}
                  />
                  <Area type="monotone" dataKey="in" stroke="var(--accent)" strokeWidth={1.5} fill="url(#gIn)" dot={false} />
                  <Area type="monotone" dataKey="out" stroke="var(--accent2)" strokeWidth={1.5} fill="url(#gOut)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Topology Map</span>
              <span className="panel-badge">192.168.1.0/24</span>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <TopologyMap devices={devices} />
            </div>
          </div>
        </div>
      </div>

      {showAdd && <AddDeviceModal onClose={() => setShowAdd(false)} onAdd={() => {}} />}
    </div>
  )
}
