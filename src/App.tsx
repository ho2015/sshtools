import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
// @ts-expect-error Vite resolves the xterm CSS side-effect import; no TS module declaration is shipped.
import '@xterm/xterm/css/xterm.css'
import {
  listHosts,
  createHost,
  deleteHost,
  createTerminalTicket,
  type Host,
  type HostInput,
} from './api'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type TabStatus = 'connecting' | 'open' | 'closed' | 'error'

type TermTab = {
  sessionId: string
  hostId: string
  host: Host
  title: string
  password: string
  usePrivateKey: boolean
}

type AuditRow = {
  id: string
  timestamp: string
  user: string
  command: string
  sessionId: string
  host: string
  result: string
}

type PendingClose = { sessionId: string; title: string }

type AddFormState = {
  name: string
  address: string
  port: string
  user: string
  auth: 'password' | 'privateKey'
  password: string
  passphrase: string
  saveEncrypted: boolean
}

const MAX_TABS = 32

const NAV_ITEMS = [
  'Dashboard',
  'Hosts',
  'Sessions',
  'Keys & Secrets',
  'Audit Log',
  'Settings',
] as const

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function createSessionId(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* fall through */
    }
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toAuditRow(raw: Record<string, unknown>, index: number): AuditRow {
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null) return raw[key]
    }
    return undefined
  }
  const sessionId = pick('sessionId', 'session_id', 'sid')
  const command = pick('command', 'cmd')
  return {
    id: String(pick('id') ?? `event-${index}`),
    timestamp: String(pick('timestamp', 'time', 'createdAt', 'created_at') ?? ''),
    user: String(pick('user', 'username') ?? '—'),
    command: String(command ?? '—'),
    sessionId: String(sessionId ?? '—'),
    host: String(pick('host', 'hostName', 'hostname') ?? '—'),
    result: String(pick('result', 'status') ?? 'unknown'),
  }
}

function normalizeEvents(input: unknown): AuditRow[] {
  let list: unknown[] = []
  if (Array.isArray(input)) {
    list = input
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const inner = obj.events ?? obj.data ?? obj.items ?? obj.audit
    if (Array.isArray(inner)) list = inner
  }
  const rows = list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index) => toAuditRow(item, index))

  const parse = (value: string): number => {
    const t = Date.parse(value)
    return Number.isNaN(t) ? Number.NaN : t
  }
  const allParseable = rows.every((row) => !Number.isNaN(parse(row.timestamp)))
  if (allParseable && rows.length > 1) {
    rows.sort((a, b) => parse(b.timestamp) - parse(a.timestamp))
  }
  return rows
}

function resultTone(result: string): 'ok' | 'bad' | 'neutral' {
  const value = result.toLowerCase()
  if (value === 'success' || value === 'ok' || value === 'passed') return 'ok'
  if (value === 'failed' || value === 'failure' || value === 'error') return 'bad'
  return 'neutral'
}

function hostTone(status: string | undefined): 'ok' | 'warn' | 'bad' | 'neutral' {
  const value = (status ?? '').toLowerCase()
  if (value === 'online') return 'ok'
  if (value === 'offline') return 'bad'
  if (value === 'warning') return 'warn'
  return 'neutral'
}

function statusLabel(status: string | undefined): string {
  const value = (status ?? '').trim()
  if (!value) return 'Unknown'
  const lower = value.toLowerCase()
  if (lower === 'online') return 'Online'
  if (lower === 'offline') return 'Offline'
  if (lower === 'warning') return 'Warning'
  return value
}

function rawHost(host: Host): Record<string, unknown> {
  return host as unknown as Record<string, unknown>
}

function hostTags(host: Host): string[] {
  const source = rawHost(host)
  const raw = source.tags ?? source.Tags
  if (Array.isArray(raw)) {
    const tags = raw.map((tag) => String(tag).trim()).filter(Boolean)
    if (tags.length) return tags
  }
  if (typeof raw === 'string') {
    const tags = raw.split(',').map((tag) => tag.trim()).filter(Boolean)
    if (tags.length) return tags
  }
  return ['host']
}

function hostAddress(host: Host): string {
  const source = rawHost(host)
  return String(source.address ?? source.host ?? source.ip ?? source.hostname ?? '')
}

function hostName(host: Host): string {
  const source = rawHost(host)
  return String(source.name ?? source.hostname ?? hostAddress(host) ?? host.id)
}

/* ------------------------------------------------------------------ */
/* Icons                                                              */
/* ------------------------------------------------------------------ */

function Icon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'Dashboard':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      )
    case 'Hosts':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="7" rx="2" />
          <rect x="3" y="13" width="18" height="7" rx="2" />
          <path d="M7 7.5h.01M7 16.5h.01" />
        </svg>
      )
    case 'Sessions':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3M13 15h4" />
        </svg>
      )
    case 'Keys & Secrets':
      return (
        <svg {...common}>
          <circle cx="8" cy="12" r="4" />
          <path d="M12 12h9M17 12v3M20 12v2" />
        </svg>
      )
    case 'Audit Log':
      return (
        <svg {...common}>
          <path d="M8 4h8a2 2 0 0 1 2 2v14l-6-3-6 3V6a2 2 0 0 1 2-2Z" />
          <path d="M9 9h6M9 12h4" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
        </svg>
      )
  }
}

/* ------------------------------------------------------------------ */
/* TerminalView                                                       */
/* ------------------------------------------------------------------ */

type TerminalViewProps = {
  tab: TermTab
  active: boolean
  onStatus: (sessionId: string, status: TabStatus) => void
  onError: (message: string) => void
}

function TerminalView({ tab, active, onStatus, onError }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      scrollback: 4000,
      theme: {
        background: '#0f172a',
        foreground: '#4ade80',
        cursor: '#86efac',
        cursorAccent: '#0f172a',
        selectionBackground: 'rgba(134, 239, 172, 0.25)',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term
    fitRef.current = fit
    let disposed = false
    let socket: WebSocket | null = null
    onStatus(tab.sessionId, 'connecting')

    const fitNow = () => {
      // skip fitting while the terminal is hidden (inactive tab)
      if (!active || container.hidden || container.offsetParent === null) return
      try {
        fit.fit()
      } catch {
        return
      }
    }
    const sendResize = () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    const dataListener = term.onData((data) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'data', data }))
      }
    })
    const resizeListener = term.onResize(({ cols, rows }) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })
    const observer = new ResizeObserver(() => {
      if (active) requestAnimationFrame(fitNow)
    })
    observer.observe(container)

    const boot = async () => {
      try {
        const ticketResponse = await createTerminalTicket(tab.hostId, tab.password, tab.usePrivateKey)
        if (disposed) return
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const ticketValue =
          typeof ticketResponse === 'string'
            ? ticketResponse
            : (ticketResponse as { ticket?: string }).ticket
        if (!ticketValue) throw new Error('Terminal ticket missing')
        const ticket = encodeURIComponent(ticketValue)
        socket = new WebSocket(`${scheme}://${window.location.host}/api/terminal?ticket=${ticket}`)
        socket.binaryType = 'arraybuffer'
        socketRef.current = socket
        socket.onopen = () => {
          if (disposed) return
          onStatus(tab.sessionId, 'open')
          term.writeln('\u001b[38;5;245m*** connected ***\u001b[0m')
          requestAnimationFrame(() => {
            fitNow()
            sendResize()
          })
          term.focus()
        }
        socket.onmessage = (event: MessageEvent) => {
          if (disposed) return
          if (typeof event.data === 'string') {
            const text = event.data
            const trimmed = text.trim()
            if (trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed) as { type?: string; message?: string }
                if (parsed.type === 'status' || parsed.type === 'error') {
                  const message = String(parsed.message ?? '')
                  if (parsed.type === 'error') onError(message || 'Terminal error')
                  term.writeln(`\u001b[38;5;${parsed.type === 'error' ? 203 : 245}m*** ${message} ***\u001b[0m`)
                  return
                }
              } catch {
                /* treat non-control JSON as terminal text */
              }
            }
            term.write(text)
          } else if (event.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(event.data))
          } else if (event.data instanceof Blob) {
            void event.data.arrayBuffer().then((buffer) => {
              if (!disposed) term.write(new Uint8Array(buffer))
            })
          }
        }
        socket.onerror = () => {
          if (disposed) return
          onStatus(tab.sessionId, 'error')
          term.writeln('\u001b[38;5;203m*** connection error ***\u001b[0m')
        }
        socket.onclose = () => {
          if (disposed) return
          onStatus(tab.sessionId, 'closed')
          term.writeln('\u001b[38;5;245m*** session closed ***\u001b[0m')
        }
      } catch (cause) {
        if (disposed) return
        const message = cause instanceof Error ? cause.message : 'Failed to open terminal session'
        onStatus(tab.sessionId, 'error')
        onError(message)
        term.writeln(`\u001b[38;5;203m*** ${message} ***\u001b[0m`)
      }
    }
    void boot()
    return () => {
      disposed = true
      dataListener.dispose()
      resizeListener.dispose()
      observer.disconnect()
      try { socket?.close() } catch { /* ignore */ }
      socketRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // Terminal lifecycle is keyed to the session; active changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sessionId])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      const term = termRef.current
      const fit = fitRef.current
      const container = containerRef.current
      // skip fit when the container is hidden or not laid out
      if (!term || !fit || !container || container.hidden || container.offsetParent === null) return
      try { fit.fit() } catch { return }
      const socket = socketRef.current
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
      term.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [active])

  // One instance per tab; inactive tabs stay mounted (hidden) so websocket/xterm state is preserved.
  // hidden attribute + is-active class control visibility: only the active terminal is shown.
  return (
    <div
      className={`sx-terminal${active ? " is-active" : ""}`}
      ref={containerRef}
      hidden={!active}
      aria-hidden={!active}
    />
  )
}

/* ------------------------------------------------------------------ */
/* App                                                                */
/* ------------------------------------------------------------------ */

const ADD_FORM_EMPTY: AddFormState = {
  name: '',
  address: '',
  port: '22',
  user: 'root',
  auth: 'password',
  password: '',
  passphrase: '',
  saveEncrypted: true,
}

export default function App() {
  const [hosts, setHosts] = useState<Host[]>([])
  const [hostsLoading, setHostsLoading] = useState(true)
  const [tabs, setTabs] = useState<TermTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [tabStatus, setTabStatus] = useState<Record<string, TabStatus>>({})
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<string>('Dashboard')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [auditError, setAuditError] = useState<string | null>(null)

  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Host | null>(null)
  const [connectTarget, setConnectTarget] = useState<Host | null>(null)
  const [connectPassword, setConnectPassword] = useState('')
  const [connectUseKey, setConnectUseKey] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addForm, setAddForm] = useState<AddFormState>(ADD_FORM_EMPTY)

  /* ---------------- data loading ---------------- */

  const loadHosts = useCallback(async () => {
    setHostsLoading(true)
    try {
      const response = await listHosts()
      if (Array.isArray(response)) {
        setHosts(response)
      } else if (response && Array.isArray((response as { hosts?: Host[] }).hosts)) {
        setHosts((response as { hosts: Host[] }).hosts)
      } else {
        setHosts([])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load hosts')
    } finally {
      setHostsLoading(false)
    }
  }, [])

  const loadAudit = useCallback(async () => {
    setAuditRows([])
    setAuditError('Audit API unavailable')
  }, [])

  useEffect(() => {
    void loadHosts()
  }, [loadHosts])

  useEffect(() => {
    void loadAudit()
    const timer = window.setInterval(() => {
      void loadAudit()
    }, 15000)
    return () => window.clearInterval(timer)
  }, [loadAudit])

  /* ---------------- terminal sessions ---------------- */

  const openConnectModal = useCallback((host: Host | null) => {
    if (!host) {
      setError('Select a host first.')
      return
    }
    setError(null)
    setConnectPassword('')
    setConnectUseKey(false)
    setConnectTarget(host)
  }, [])

  const addTab = useCallback((host: Host, password: string, usePrivateKey: boolean) => {
    const sessionId = createSessionId()
    const tab: TermTab = {
      sessionId,
      hostId: String(host.id),
      host,
      title: hostName(host),
      password,
      usePrivateKey,
    }
    setTabs((prev) => (prev.length >= MAX_TABS ? prev : [...prev, tab]))
    setTabStatus((prev) => ({ ...prev, [sessionId]: 'connecting' }))
    setActiveTabId(sessionId)
  }, [])

  const handleConnectSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!connectTarget) return
    if (tabs.length >= MAX_TABS) {
      setError(`Maximum of ${MAX_TABS} sessions reached. Close a session first.`)
      return
    }
    // Password is kept only on the tab object; it is never persisted via createHost.
    addTab(connectTarget, connectPassword, connectUseKey)
    setConnectPassword('')
    setConnectUseKey(false)
    setConnectTarget(null)
  }

  const requestClose = useCallback((sessionId: string, title: string) => {
    setPendingClose({ sessionId, title })
  }, [])

  const confirmClosePending = () => {
    if (!pendingClose) return
    const { sessionId } = pendingClose
    setPendingClose(null)
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.sessionId !== sessionId)
      setActiveTabId((current) =>
        current === sessionId ? (next.length ? next[next.length - 1].sessionId : null) : current,
      )
      return next
    })
    setTabStatus((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }

  const handleTabStatus = useCallback((sessionId: string, status: TabStatus) => {
    setTabStatus((prev) => (prev[sessionId] === status ? prev : { ...prev, [sessionId]: status }))
  }, [])

  const handleTerminalError = useCallback((message: string) => {
    setError((prev) => prev ?? message)
  }, [])

  /* ---------------- add / delete host ---------------- */

  const handleAddHost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = addForm.name.trim()
    const address = addForm.address.trim()
    const user = addForm.user.trim()
    const port = Number(addForm.port)
    if (!name) { setError('Name is required.'); return }
    if (!address) { setError('Host is required.'); return }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Port must be an integer between 1 and 65535.')
      return
    }
    if (!user) { setError('Username is required.'); return }
    const input: HostInput = { name, address, port, user }
    setAddSaving(true)
    try {
      await createHost(input)
      setAddOpen(false)
      setAddForm(ADD_FORM_EMPTY)
      await loadHosts()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create host')
    } finally {
      setAddSaving(false)
    }
  }

  const handleDeleteHost = async () => {
    if (!pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    try {
      await deleteHost(String(target.id))
      setTabs((prev) => {
        const next = prev.filter((tab) => tab.hostId !== String(target.id))
        setActiveTabId((current) =>
          current && !next.some((tab) => tab.sessionId === current)
            ? (next.length ? next[next.length - 1].sessionId : null)
            : current,
        )
        return next
      })
      await loadHosts()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete host')
    }
  }

  /* ---------------- escape closes modals ---------------- */

  useEffect(() => {
    if (!pendingClose && !pendingDelete && !connectTarget && !addOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPendingClose(null)
      setPendingDelete(null)
      setConnectTarget(null)
      setAddOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingClose, pendingDelete, connectTarget, addOpen])

  /* ---------------- derived ---------------- */

  const filteredHosts = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return hosts
    return hosts.filter((host) => {
      const source = rawHost(host)
      return [source.name, source.hostname, hostAddress(host), source.user, source.username]
        .map((value) => String(value ?? '').toLowerCase())
        .some((value) => value.includes(needle))
    })
  }, [hosts, search])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.sessionId === activeTabId) ?? null,
    [tabs, activeTabId],
  )
  const selectedHost = useMemo(
    () => hosts.find((host) => String(host.id) === selectedHostId) ?? null,
    [hosts, selectedHostId],
  )
  const sessionCount = tabs.length
  const showDashboard = activeNav === 'Dashboard'

  /* ---------------- render ---------------- */

  return (
    <div className="sx-root">
      <style>{styles}</style>

      <aside className="sx-sidebar">
        <div className="sx-brand">
          <span className="sx-logo" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h10M4 18h7" />
              <circle cx="18" cy="17" r="3" />
            </svg>
          </span>
          <span className="sx-brand-text">
            <strong>sshtools</strong>
            <small>Secure shell manager</small>
          </span>
        </div>
        <nav className="sx-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              className={`sx-nav-item${activeNav === item ? ' is-active' : ''}`}
              aria-current={activeNav === item ? 'page' : undefined}
              onClick={() => setActiveNav(item)}
            >
              <Icon name={item} />
              <span>{item}</span>
              {item === 'Sessions' && sessionCount > 0 ? (
                <span className="sx-nav-count">{sessionCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sx-sidebar-footer">
          <p>Secure · Manage · Connect</p>
          <p className="sx-muted">sshtools v1.0.0</p>
        </div>
      </aside>

      <div className="sx-main">
        <header className="sx-topbar">
          <div className="sx-topbar-left">
            <span className="sx-topbar-title">sshtools</span>
            <label className="sx-search" aria-label="Global search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search hosts, users, or commands..."
              />
            </label>
          </div>
          <div className="sx-topbar-right">
            <span className="sx-status-ok">
              <span className="sx-dot sx-dot-green" />
              All Systems Operational
            </span>
            <button type="button" className="sx-icon-btn" aria-label="Notifications, 3 unread">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              <span className="sx-bell-badge">3</span>
            </button>
            <span className="sx-debug">
              Debug Mode: ON (default)
              <button type="button" className="sx-switch is-on" aria-pressed="true" aria-label="Debug mode (on by default)">
                <span />
              </button>
            </span>
            <button type="button" className="sx-btn sx-btn-ghost" disabled title="Not wired yet">
              Export Logs
            </button>
            <div className="sx-user">
              <span className="sx-avatar">JD</span>
              <span className="sx-user-name">John Doe</span>
            </div>
          </div>
        </header>

        <div className="sx-body">
          {error ? (
            <div className="sx-banner sx-banner-error" role="alert">
              <span>{error}</span>
              <button type="button" className="sx-banner-close" aria-label="Dismiss error" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          ) : null}

          {showDashboard ? (
            <div className="sx-grid">
              {/* ---------------- Hosts ---------------- */}
              <section className="sx-card sx-hosts-card" aria-labelledby="sx-hosts-title">
                <div className="sx-card-head">
                  <h2 id="sx-hosts-title">Hosts</h2>
                  <div className="sx-card-head-actions">
                    <span className="sx-muted">{filteredHosts.length} shown</span>
                    <button type="button" className="sx-btn sx-btn-primary" onClick={() => setAddOpen(true)}>
                      + Add Host
                    </button>
                  </div>
                </div>
                <div className="sx-table-wrap">
                  <table className="sx-table">
                    <thead>
                      <tr>
                        <th className="sx-col-check"><span className="sx-check" aria-hidden /></th>
                        <th>Name</th>
                        <th>IP</th>
                        <th>Tags</th>
                        <th>Status</th>
                        <th>Last Seen</th>
                        <th className="sx-col-actions">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hostsLoading ? (
                        <tr><td colSpan={7} className="sx-empty">Loading hosts…</td></tr>
                      ) : filteredHosts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="sx-empty">
                            {search.trim() ? 'No matching hosts' : 'No hosts yet. Use “+ Add Host”.'}
                          </td>
                        </tr>
                      ) : (
                        filteredHosts.map((host) => {
                          const id = String(host.id)
                          const source = rawHost(host)
                          const tone = hostTone(source.status as string | undefined)
                          const lastSeen = source.lastSeen ?? source.last_seen
                          return (
                            <tr
                              key={id}
                              className={`sx-host-row${selectedHostId === id ? ' is-selected' : ''}`}
                              onClick={() => setSelectedHostId(id)}
                            >
                              <td className="sx-col-check"><span className="sx-check" aria-hidden /></td>
                              <td className="sx-host-name">{hostName(host)}</td>
                              <td className="sx-mono">{hostAddress(host) || '—'}</td>
                              <td>
                                <span className="sx-tags">
                                  {hostTags(host).map((tag) => (
                                    <span key={tag} className="sx-tag">{tag}</span>
                                  ))}
                                </span>
                              </td>
                              <td>
                                <span className={`sx-badge sx-badge-${tone}`}>
                                  <span className="sx-dot" />
                                  {statusLabel(source.status as string | undefined)}
                                </span>
                              </td>
                              <td className="sx-muted">{lastSeen ? String(lastSeen) : '—'}</td>
                              <td className="sx-col-actions">
                                <div className="sx-row-actions" onClick={(event) => event.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="sx-btn sx-btn-primary sx-btn-xs"
                                    onClick={() => {
                                      setSelectedHostId(id)
                                      openConnectModal(host)
                                    }}
                                  >
                                    Connect
                                  </button>
                                  <button type="button" className="sx-btn sx-btn-ghost sx-btn-xs" disabled title="Not wired yet">
                                    Test
                                  </button>
                                  <button
                                    type="button"
                                    className="sx-btn sx-btn-ghost sx-btn-xs"
                                    aria-label={`More actions for ${hostName(host)}`}
                                    onClick={() => { /* no-op */ }}
                                  >
                                    …
                                  </button>
                                  <button
                                    type="button"
                                    className="sx-btn sx-btn-danger-ghost sx-btn-xs"
                                    onClick={() => setPendingDelete(host)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ---------------- Right stack ---------------- */}
              <div className="sx-stack">
                <section className="sx-card sx-sessions-card" aria-labelledby="sx-sessions-title">
                  <div className="sx-card-head">
                    <h2 id="sx-sessions-title">Active Sessions</h2>
                    <div className="sx-card-head-actions">
                      <button
                        type="button"
                        className="sx-btn sx-btn-ghost sx-btn-sm"
                        aria-label="New session"
                        onClick={() => openConnectModal(selectedHost)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="sx-btn sx-btn-danger-outline sx-btn-xs"
                        disabled={!activeTab}
                        onClick={() => {
                          if (activeTab) requestClose(activeTab.sessionId, activeTab.title)
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {tabs.length > 0 ? (
                    <div className="sx-tabs" role="tablist" aria-label="Terminal sessions">
                      {tabs.map((tab) => (
                        <div
                          key={tab.sessionId}
                          role="tab"
                          tabIndex={0}
                          aria-selected={tab.sessionId === activeTabId}
                          className={`sx-tab${tab.sessionId === activeTabId ? ' is-active' : ''}`}
                          onClick={() => setActiveTabId(tab.sessionId)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setActiveTabId(tab.sessionId)
                            }
                          }}
                        >
                          <span
                            className={`sx-dot sx-dot-${(tabStatus[tab.sessionId] ?? 'connecting') === 'open' ? 'green' : 'blue'}`}
                          />
                          <span className="sx-tab-title">{tab.title}</span>
                          <button
                            type="button"
                            className="sx-tab-close"
                            aria-label={`Close session ${tab.title}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              requestClose(tab.sessionId, tab.title)
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* All tabs are mounted here; only the active tab's terminal is visible. */}
                  <div className="sx-terminal-stage">
                    {tabs.length === 0 ? (
                      <div className="sx-terminal-empty">Connect to a host to open a terminal.</div>
                    ) : (
                      tabs.map((tab) => (
                        <TerminalView
                          key={tab.sessionId}
                          tab={tab}
                          active={tab.sessionId === activeTabId}
                          onStatus={handleTabStatus}
                          onError={handleTerminalError}
                        />
                      ))
                    )}
                  </div>
                </section>

                {/* ---------------- Audit ---------------- */}
                <section className="sx-card sx-audit-card" aria-labelledby="sx-audit-title">
                  <div className="sx-card-head">
                    <h2 id="sx-audit-title">Command History &amp; Audit</h2>
                    <div className="sx-card-head-actions">
                      {auditError ? <span className="sx-audit-error">{auditError}</span> : null}
                      <span className="sx-muted">{auditRows.length} events</span>
                    </div>
                  </div>
                  <div className="sx-table-wrap sx-audit-wrap">
                    <table className="sx-table sx-table-sm">
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>User</th>
                          <th>Command</th>
                          <th>Session ID</th>
                          <th>Host</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditRows.length === 0 ? (
                          <tr><td colSpan={6} className="sx-empty">No audit events.</td></tr>
                        ) : (
                          auditRows.map((row) => (
                            <tr key={row.id}>
                              <td className="sx-mono sx-nowrap">{row.timestamp || '—'}</td>
                              <td>{row.user}</td>
                              <td className="sx-mono sx-cmd" title={row.command}>{row.command}</td>
                              <td className="sx-mono sx-nowrap">{row.sessionId}</td>
                              <td>{row.host}</td>
                              <td>
                                <span className={`sx-badge sx-badge-${resultTone(row.result)}`}>
                                  {row.result}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <div className="sx-card sx-placeholder">
              <h2>{activeNav}</h2>
              <p className="sx-muted">This section is not built yet. The dashboard is the live view.</p>
              <button type="button" className="sx-btn sx-btn-primary" onClick={() => setActiveNav('Dashboard')}>
                Back to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Connect modal ---------------- */}
      {connectTarget ? (
        <div className="sx-backdrop" onClick={() => setConnectTarget(null)}>
          <div
            className="sx-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sx-connect-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sx-modal-head">
              <h3 id="sx-connect-title">Connect to {hostName(connectTarget)}</h3>
              <button type="button" className="sx-modal-x" aria-label="Close dialog" onClick={() => setConnectTarget(null)}>×</button>
            </div>
            <form onSubmit={handleConnectSubmit}>
              <div className="sx-modal-body">
                <p className="sx-modal-sub">
                  {hostAddress(connectTarget)} · port {String(rawHost(connectTarget).port ?? 22)} · user {String(rawHost(connectTarget).user ?? rawHost(connectTarget).username ?? 'root')}
                </p>
                <label className="sx-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={connectPassword}
                    onChange={(event) => setConnectPassword(event.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                  />
                </label>
                <label className="sx-checkline">
                  <input
                    type="checkbox"
                    checked={connectUseKey}
                    onChange={(event) => setConnectUseKey(event.target.checked)}
                  />
                  <span>Use SSH private key from the server</span>
                </label>
                <p className="sx-helper">Credentials are used for this session only and are not stored.</p>
              </div>
              <div className="sx-modal-foot">
                <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setConnectTarget(null)}>
                  Cancel
                </button>
                <button type="submit" className="sx-btn sx-btn-primary">Connect</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ---------------- Add Host modal ---------------- */}
      {addOpen ? (
        <div className="sx-backdrop" onClick={() => setAddOpen(false)}>
          <div
            className="sx-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sx-add-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sx-modal-head">
              <h3 id="sx-add-title">Add Host</h3>
              <button type="button" className="sx-modal-x" aria-label="Close dialog" onClick={() => setAddOpen(false)}>×</button>
            </div>
            <form onSubmit={handleAddHost}>
              <div className="sx-modal-body">
                <div className="sx-field-row">
                  <label className="sx-field">
                    <span>Name *</span>
                    <input
                      value={addForm.name}
                      onChange={(event) => setAddForm({ ...addForm, name: event.target.value })}
                      placeholder="e.g. web-01"
                      required
                    />
                  </label>
                  <label className="sx-field">
                    <span>Host *</span>
                    <input
                      value={addForm.address}
                      onChange={(event) => setAddForm({ ...addForm, address: event.target.value })}
                      placeholder="e.g. 192.168.1.10"
                      required
                    />
                  </label>
                </div>
                <div className="sx-field-row">
                  <label className="sx-field">
                    <span>Port</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={addForm.port}
                      onChange={(event) => setAddForm({ ...addForm, port: event.target.value })}
                    />
                  </label>
                  <label className="sx-field">
                    <span>Username *</span>
                    <input
                      value={addForm.user}
                      onChange={(event) => setAddForm({ ...addForm, user: event.target.value })}
                      placeholder="e.g. ubuntu"
                      required
                    />
                  </label>
                </div>

                <fieldset className="sx-radios">
                  <legend>Auth method</legend>
                  <label className="sx-checkline">
                    <input
                      type="radio"
                      name="sx-auth"
                      checked={addForm.auth === 'password'}
                      onChange={() => setAddForm({ ...addForm, auth: 'password' })}
                    />
                    <span>Password</span>
                  </label>
                  <label className="sx-checkline">
                    <input
                      type="radio"
                      name="sx-auth"
                      checked={addForm.auth === 'privateKey'}
                      onChange={() => setAddForm({ ...addForm, auth: 'privateKey' })}
                    />
                    <span>Private Key</span>
                  </label>
                  {addForm.auth === 'privateKey' ? (
                    <p className="sx-note">Private key upload is not wired yet. The host is saved without a key.</p>
                  ) : null}
                </fieldset>

                {addForm.auth === 'password' ? (
                  <div className="sx-field-row">
                    <label className="sx-field">
                      <span>Password</span>
                      <input
                        type="password"
                        value={addForm.password}
                        onChange={(event) => setAddForm({ ...addForm, password: event.target.value })}
                        placeholder="Enter password"
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="sx-field">
                      <span>Passphrase</span>
                      <input
                        type="password"
                        value={addForm.passphrase}
                        onChange={(event) => setAddForm({ ...addForm, passphrase: event.target.value })}
                        placeholder="Passphrase (optional)"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                ) : null}

                <label className="sx-checkline">
                  <input
                    type="checkbox"
                    checked={addForm.saveEncrypted}
                    onChange={(event) => setAddForm({ ...addForm, saveEncrypted: event.target.checked })}
                  />
                  <span>Save encrypted</span>
                </label>
                <p className="sx-helper">Credentials in this dialog are not stored yet.</p>
              </div>
              <div className="sx-modal-foot">
                <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setAddOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="sx-btn sx-btn-primary" disabled={addSaving}>
                  {addSaving ? 'Saving…' : 'Add Host'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ---------------- Close session confirm ---------------- */}
      {pendingClose ? (
        <div className="sx-backdrop" onClick={() => setPendingClose(null)}>
          <div
            className="sx-modal sx-modal-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sx-close-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sx-modal-head">
              <h3 id="sx-close-title">Close session?</h3>
              <button type="button" className="sx-modal-x" aria-label="Close dialog" onClick={() => setPendingClose(null)}>×</button>
            </div>
            <div className="sx-modal-body">
              <p>Disconnect {pendingClose.title}? The SSH session will end.</p>
            </div>
            <div className="sx-modal-foot">
              <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setPendingClose(null)}>
                Cancel
              </button>
              <button type="button" className="sx-btn sx-btn-danger" onClick={confirmClosePending}>
                Disconnect
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------- Delete host confirm ---------------- */}
      {pendingDelete ? (
        <div className="sx-backdrop" onClick={() => setPendingDelete(null)}>
          <div
            className="sx-modal sx-modal-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sx-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sx-modal-head">
              <h3 id="sx-delete-title">Delete host?</h3>
              <button type="button" className="sx-modal-x" aria-label="Close dialog" onClick={() => setPendingDelete(null)}>×</button>
            </div>
            <div className="sx-modal-body">
              <p>Delete {hostName(pendingDelete)}? Open sessions to this host will close.</p>
            </div>
            <div className="sx-modal-foot">
              <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className="sx-btn sx-btn-danger" onClick={handleDeleteHost}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = `
:root {
  --sx-bg: #F8FAFC;
  --sx-card: #FFFFFF;
  --sx-border: #E2E8F0;
  --sx-text: #0F172A;
  --sx-muted: #64748B;
  --sx-primary: #2563EB;
  --sx-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

.sx-root {
  min-height: 100vh;
  display: flex;
  background: var(--sx-bg);
  color: var(--sx-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.5;
}

.sx-root h2, .sx-root h3 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
.sx-root button { font: inherit; color: inherit; }
.sx-muted { color: var(--sx-muted); }
.sx-mono { font-family: var(--sx-mono); font-size: 12px; }
.sx-nowrap { white-space: nowrap; }
.sx-cmd { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------------- Sidebar ---------------- */

.sx-sidebar {
  width: 224px;
  flex: 0 0 224px;
  background: var(--sx-card);
  border-right: 1px solid var(--sx-border);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sx-brand { display: flex; align-items: center; gap: 10px; padding: 16px 14px; border-bottom: 1px solid var(--sx-border); }
.sx-logo {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--sx-primary);
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 32px;
}
.sx-brand-text { display: flex; flex-direction: column; line-height: 1.2; }
.sx-brand-text strong { font-size: 14px; }
.sx-brand-text small { color: var(--sx-muted); font-size: 11px; }

.sx-nav { display: flex; flex-direction: column; gap: 2px; padding: 10px 8px; flex: 1; overflow-y: auto; }
.sx-nav-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 8px 10px;
  background: transparent; border: none; border-radius: 8px;
  color: var(--sx-muted); cursor: pointer; text-align: left;
}
.sx-nav-item:hover { background: #F1F5F9; color: var(--sx-text); }
.sx-nav-item.is-active { background: #EFF6FF; color: var(--sx-primary); font-weight: 600; }
.sx-nav-count {
  margin-left: auto; background: #EFF6FF; color: var(--sx-primary);
  border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 18px;
}

.sx-sidebar-footer { padding: 12px 14px; border-top: 1px solid var(--sx-border); color: var(--sx-muted); font-size: 11px; }
.sx-sidebar-footer p { margin: 2px 0; }

/* ---------------- Top bar ---------------- */

.sx-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

.sx-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 18px;
  background: var(--sx-card);
  border-bottom: 1px solid var(--sx-border);
  position: sticky; top: 0; z-index: 20;
}
.sx-topbar-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.sx-topbar-title { font-weight: 700; letter-spacing: -0.01em; }
.sx-search {
  display: flex; align-items: center; gap: 8px;
  background: #F1F5F9; border: 1px solid var(--sx-border);
  border-radius: 8px; padding: 6px 10px; width: 340px; max-width: 40vw;
}
.sx-search input { border: none; background: transparent; outline: none; width: 100%; font: inherit; color: var(--sx-text); }
.sx-search input::placeholder { color: #94A3B8; }

.sx-topbar-right { display: flex; align-items: center; gap: 12px; }
.sx-status-ok { display: inline-flex; align-items: center; gap: 7px; color: #166534; font-weight: 600; font-size: 12px; }
.sx-dot { width: 8px; height: 8px; border-radius: 999px; background: #94A3B8; display: inline-block; }
.sx-dot-green { background: #22C55E; }
.sx-dot-blue { background: var(--sx-primary); }

.sx-icon-btn {
  position: relative; width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--sx-border); border-radius: 8px; cursor: pointer;
}
.sx-bell-badge {
  position: absolute; top: -6px; right: -6px;
  background: #EF4444; color: #fff; border-radius: 999px;
  font-size: 10px; line-height: 16px; padding: 0 4px; font-weight: 700;
}

.sx-debug {
  display: inline-flex; align-items: center; gap: 8px;
  background: #FEF9C3; color: #854D0E;
  border: 1px solid #FDE68A; border-radius: 999px;
  padding: 4px 8px 4px 10px; font-size: 11px; font-weight: 600;
}
.sx-switch {
  width: 30px; height: 16px; border-radius: 999px; border: none; cursor: pointer;
  background: #CBD5E1; position: relative; padding: 0;
}
.sx-switch.is-on { background: #22C55E; }
.sx-switch span {
  position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  background: #fff; border-radius: 999px; transition: left 0.15s ease;
}
.sx-switch.is-on span { left: 16px; }

.sx-user { display: flex; align-items: center; gap: 8px; }
.sx-avatar {
  width: 28px; height: 28px; border-radius: 999px;
  background: #1E293B; color: #fff; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}
.sx-user-name { font-weight: 600; }

/* ---------------- Layout ---------------- */

.sx-body { padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 12px; }
.sx-grid { display: grid; grid-template-columns: 1.05fr 1fr; gap: 14px; align-items: start; }
.sx-stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

@media (max-width: 1100px) { .sx-grid { grid-template-columns: 1fr; } }

.sx-card { background: var(--sx-card); border: 1px solid var(--sx-border); border-radius: 12px; overflow: hidden; }
.sx-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--sx-border);
}
.sx-card-head-actions { display: flex; align-items: center; gap: 8px; }

.sx-placeholder { padding: 20px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

/* ---------------- Banner ---------------- */

.sx-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  border-radius: 10px; padding: 9px 12px; font-weight: 500;
}
.sx-banner-error { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }
.sx-banner-close {
  background: transparent; border: none; cursor: pointer;
  font-size: 16px; line-height: 1; padding: 0 4px; color: inherit;
}

/* ---------------- Tables ---------------- */

.sx-table-wrap { overflow: auto; max-height: 560px; }
.sx-audit-wrap { max-height: 240px; }
.sx-table { width: 100%; border-collapse: collapse; }
.sx-table th, .sx-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--sx-border); white-space: nowrap; }
.sx-table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sx-muted); background: #F8FAFC; position: sticky; top: 0; z-index: 1; }
.sx-table td { color: var(--sx-text); }
.sx-table-sm th, .sx-table-sm td { padding: 6px 10px; }
.sx-table .sx-empty { color: var(--sx-muted); text-align: center; padding: 22px 10px; }
.sx-host-row { cursor: pointer; }
.sx-host-row:hover { background: #F8FAFC; }
.sx-host-row.is-selected { background: #EFF6FF; }
.sx-host-name { font-weight: 600; }
.sx-col-check { width: 36px; }
.sx-col-actions { text-align: right; }
.sx-row-actions { display: inline-flex; gap: 6px; justify-content: flex-end; }

.sx-check { width: 14px; height: 14px; border: 1.5px solid #CBD5E1; border-radius: 4px; display: inline-block; vertical-align: middle; background: #fff; }

.sx-tags { display: inline-flex; gap: 5px; flex-wrap: wrap; }
.sx-tag {
  background: #EFF6FF; color: #1D4ED8;
  border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 600;
}

.sx-badge {
  display: inline-flex; align-items: center; gap: 6px;
  border-radius: 999px; padding: 2px 9px; font-size: 11px; font-weight: 600;
}
.sx-badge .sx-dot { width: 6px; height: 6px; }
.sx-badge-ok { background: #DCFCE7; color: #166534; }
.sx-badge-ok .sx-dot { background: #22C55E; }
.sx-badge-warn { background: #FEF9C3; color: #854D0E; }
.sx-badge-warn .sx-dot { background: #EAB308; }
.sx-badge-bad { background: #FEE2E2; color: #991B1B; }
.sx-badge-bad .sx-dot { background: #EF4444; }
.sx-badge-neutral { background: #F1F5F9; color: #475569; }
.sx-badge-neutral .sx-dot { background: #94A3B8; }

/* ---------------- Buttons ---------------- */

.sx-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: 8px; border: 1px solid transparent;
  padding: 7px 12px; font-weight: 600; cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.sx-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.sx-btn-primary { background: var(--sx-primary); color: #fff; }
.sx-btn-primary:hover:not(:disabled) { background: #1D4ED8; }
.sx-btn-ghost { background: #fff; border-color: var(--sx-border); color: var(--sx-text); }
.sx-btn-ghost:hover:not(:disabled) { background: #F1F5F9; }
.sx-btn-danger { background: #DC2626; color: #fff; }
.sx-btn-danger:hover:not(:disabled) { background: #B91C1C; }
.sx-btn-danger-outline { background: #fff; border-color: #FCA5A5; color: #B91C1C; }
.sx-btn-danger-outline:hover:not(:disabled) { background: #FEF2F2; }
.sx-btn-danger-ghost { background: transparent; color: #B91C1C; border-color: transparent; }
.sx-btn-danger-ghost:hover:not(:disabled) { background: #FEF2F2; }
.sx-btn-xs { padding: 4px 9px; font-size: 12px; border-radius: 7px; }
.sx-btn-sm { padding: 5px 10px; font-size: 12px; }

/* ---------------- Sessions & terminal ---------------- */

.sx-tabs { display: flex; align-items: center; gap: 6px; padding: 10px 12px 0; flex-wrap: wrap; }
.sx-tabs-empty { color: var(--sx-muted); font-size: 12px; padding: 8px 12px 0; }
.sx-tab {
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid var(--sx-border); border-bottom: none;
  border-radius: 8px 8px 0 0; background: #F1F5F9;
  padding: 6px 8px 6px 10px; cursor: pointer; user-select: none;
}
.sx-tab.is-active { background: #fff; border-color: var(--sx-primary); color: var(--sx-primary); font-weight: 600; }
.sx-tab-title { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sx-tab-close {
  background: transparent; border: none; cursor: pointer;
  color: inherit; font-size: 14px; line-height: 1; padding: 0 2px; border-radius: 4px;
}
.sx-tab-close:hover { background: #FEE2E2; color: #991B1B; }

/* Terminal visibility: every tab stays mounted, only the active one is displayed */
.sx-terminal-stage { position: relative; height: 420px; overflow: hidden; background: #0f172a; }
.sx-terminal {
  position: absolute; inset: 0;
  display: none !important;
  visibility: hidden; pointer-events: none;
}
.sx-terminal.is-active {
  display: block !important;
  visibility: visible; pointer-events: auto; z-index: 1;
}
.sx-terminal[hidden], .sx-terminal[hidden] .xterm { display: none !important; }
.sx-terminal.is-active .xterm { display: block; height: 100%; }
.sx-terminal-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #94A3B8; font-size: 13px;
}

.sx-audit-error { color: #991B1B; font-size: 11px; }

/* ---------------- Modals ---------------- */

.sx-backdrop {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.sx-modal {
  width: 520px; max-width: 100%; max-height: 90vh; overflow: auto;
  background: var(--sx-card); border-radius: 14px;
  border: 1px solid var(--sx-border);
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
}
.sx-modal-sm { width: 400px; }
.sx-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--sx-border);
}
.sx-modal-x {
  background: transparent; border: none; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--sx-muted); padding: 0 4px;
}
.sx-modal-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.sx-modal-sub { margin: 0; color: var(--sx-muted); font-size: 12px; }
.sx-modal-body p { margin: 0; }
.sx-modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px; border-top: 1px solid var(--sx-border);
}

.sx-field { display: flex; flex-direction: column; gap: 5px; flex: 1; }
.sx-field > span { font-size: 12px; font-weight: 600; color: var(--sx-text); }
.sx-field input {
  border: 1px solid var(--sx-border); border-radius: 8px;
  padding: 8px 10px; font: inherit; color: var(--sx-text); background: #fff; outline: none;
}
.sx-field input:focus { border-color: var(--sx-primary); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
.sx-field-row { display: flex; gap: 10px; }

.sx-checkline { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.sx-checkline input { accent-color: var(--sx-primary); width: 15px; height: 15px; }

.sx-radios { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sx-radios legend { font-size: 12px; font-weight: 600; padding: 0 0 6px; }
.sx-note { background: #FEF9C3; color: #854D0E; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.sx-helper { color: var(--sx-muted); font-size: 11.5px; }
`
