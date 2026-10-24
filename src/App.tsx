import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  listHosts,
  createHost,
  deleteHost,
  createTerminalTicket,
  type Host,
  type HostInput,
} from './api'

type TabStatus = 'connecting' | 'open' | 'closed' | 'error'

type TermTab = {
  sessionId: string
  hostId: string
  host: Host
  title: string
  password: string
  usePrivateKey: boolean
}

const MAX_TABS = 32

function createSessionId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // HTTP on a LAN address is not a secure context; fall through.
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export default function App() {
  const [hosts, setHosts] = useState<Host[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState(22)
  const [user, setUser] = useState('root')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [usePrivateKey, setUsePrivateKey] = useState(false)

  const [tabs, setTabs] = useState<TermTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const terminalPanelRef = useRef<HTMLElement>(null)

  const selected = hosts.find((host) => host.id === selectedId) ?? null

  const loadHosts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listHosts()
      setHosts(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load hosts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHosts()
  }, [loadHosts])

  useEffect(() => {
    if (activeTabId && tabs.some((tab) => tab.sessionId === activeTabId)) return
    setActiveTabId(tabs.length > 0 ? tabs[tabs.length - 1].sessionId : null)
  }, [tabs, activeTabId])

  const updateHostStatus = useCallback((hostId: string, status: Host['status']) => {
    setHosts((prev) => prev.map((host) => (host.id === hostId ? { ...host, status } : host)))
  }, [])

  async function handleAddHost(event: FormEvent) {
    event.preventDefault()
    const nextName = name.trim()
    const nextAddress = address.trim()
    const nextUser = user.trim()
    const nextPort = Number(port)

    if (!nextName || !nextAddress || !nextUser) {
      setError('Name, address and user are required.')
      return
    }
    if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      setError('Port must be between 1 and 65535.')
      return
    }

    const input: HostInput = {
      name: nextName,
      address: nextAddress,
      port: nextPort,
      user: nextUser,
    }

    try {
      setError(null)
      const created = await createHost(input)
      setHosts((prev) => [created, ...prev.filter((host) => host.id !== created.id)])
      setSelectedId(created.id)
      setName('')
      setAddress('')
      setPort(22)
      setUser('root')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add host')
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this host?')) return
    try {
      await deleteHost(id)
      setHosts((prev) => prev.filter((host) => host.id !== id))
      setTabs((prev) => prev.filter((tab) => tab.hostId !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete host')
    }
  }

  function handleOpenTerminal(event: FormEvent) {
    event.preventDefault()
    if (!selected) {
      setError('Select a host first.')
      return
    }
    if (!usePrivateKey && password.length === 0) {
      setError('Password is required.')
      return
    }

    const openCount = tabs.length
    if (openCount >= MAX_TABS) {
      setError(`Session limit reached (${MAX_TABS}). Close a tab first.`)
      return
    }

    const sessionId = createSessionId()
    const passwordForTab = usePrivateKey ? '' : password

    setTabs((prev) => {
      const n = prev.filter((tab) => tab.hostId === selected.id).length + 1
      const title = n > 1 ? `${selected.name} #${n}` : selected.name
      return [
        ...prev,
        {
          sessionId,
          hostId: selected.id,
          host: selected,
          title,
          password: passwordForTab,
          usePrivateKey,
        },
      ]
    })
    setActiveTabId(sessionId)
    setPassword('')
    setError(null)
    requestAnimationFrame(() => {
      terminalPanelRef.current?.scrollIntoView({ block: 'nearest' })
    })
  }

  function closeTab(sessionId: string) {
    setTabs((prev) => prev.filter((tab) => tab.sessionId !== sessionId))
  }

  return (
    <div className="sx-app">
      <style>{styles}</style>

      <header className="sx-header">
        <div>
          <h1>sshtools</h1>
          <p>Server management</p>
        </div>
        <button type="button" onClick={() => void loadHosts()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="sx-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="sx-grid">
        <section className="sx-panel sx-hosts">
          <h2>Hosts</h2>
          <div className="sx-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>User</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hosts.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="sx-empty">
                      No hosts yet
                    </td>
                  </tr>
                )}
                {hosts.map((host) => (
                  <tr
                    key={host.id}
                    className={host.id === selectedId ? 'is-selected' : undefined}
                    onClick={() => setSelectedId(host.id)}
                  >
                    <td>{host.name}</td>
                    <td>
                      {host.address}:{host.port}
                    </td>
                    <td>{host.user}</td>
                    <td>
                      <span className={`sx-status is-${host.status}`}>{host.status}</span>
                    </td>
                    <td className="sx-actions">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedId(host.id)
                        }}
                      >
                        Select
                      </button>
                      <button
                        type="button"
                        className="sx-danger"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDelete(host.id)
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sx-panel sx-side">
          <h2>Add host</h2>
          <form className="sx-form" onSubmit={handleAddHost}>
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="master02" required />
            </label>
            <label>
              Address
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="172.17.1.101"
                required
              />
            </label>
            <div className="sx-row">
              <label>
                Port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(Number(event.target.value))}
                  required
                />
              </label>
              <label>
                User
                <input value={user} onChange={(event) => setUser(event.target.value)} required />
              </label>
            </div>
            <button type="submit">Add host</button>
          </form>

          <h2 className="sx-connect-title">Connect</h2>
          <form className="sx-form" onSubmit={handleOpenTerminal}>
            <p className="sx-hint">
              {selected
                ? `Connect to ${selected.user}@${selected.address}:${selected.port}`
                : 'Select a host, then enter credentials.'}
            </p>
            <label className="sx-check">
              <input
                type="checkbox"
                checked={usePrivateKey}
                onChange={(event) => setUsePrivateKey(event.target.checked)}
              />
              Use SSH private key from the server
            </label>
            {!usePrivateKey && (
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  spellCheck={false}
                />
              </label>
            )}
            <button type="submit" disabled={!selected}>
              Connect
            </button>
          </form>
        </section>

        <section className="sx-panel sx-terminal-panel" ref={terminalPanelRef}>
          <div className="sx-terminal-header">
            <h2>Terminal</h2>
            <span className="sx-hint">{tabs.length === 0 ? 'No sessions' : `${tabs.length} open`}</span>
          </div>

          {tabs.length > 0 && (
            <div className="sx-tabs" role="tablist">
              {tabs.map((tab) => (
                <div key={tab.sessionId} className={tab.sessionId === activeTabId ? 'sx-tab is-active' : 'sx-tab'}>
                  <button type="button" role="tab" onClick={() => setActiveTabId(tab.sessionId)}>
                    {tab.title}
                  </button>
                  <button type="button" className="sx-tab-close" onClick={() => closeTab(tab.sessionId)} aria-label={`Close ${tab.title}`}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="sx-terminal-stage">
            {tabs.length === 0 && <div className="sx-terminal-empty">Connect to a host to open a terminal.</div>}
            {tabs.map((tab) => (
              <TerminalView
                key={tab.sessionId}
                tab={tab}
                active={tab.sessionId === activeTabId}
                onState={updateHostStatus}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function TerminalView({
  tab,
  active,
  onState,
}: {
  tab: TermTab
  active: boolean
  onState: (hostId: string, status: Host['status']) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const onStateRef = useRef(onState)
  const [status, setStatus] = useState<TabStatus>('connecting')
  const [detail, setDetail] = useState('Connecting...')

  useEffect(() => {
    onStateRef.current = onState
  }, [onState])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: {
        background: '#07111f',
        foreground: '#d7e3f4',
        cursor: '#7dd3fc',
      },
    })
    const fitAddon = new FitAddon()
    fitRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.open(container)

    const safeFit = () => {
      if (disposed || !container.offsetParent) return
      try {
        fitAddon.fit()
      } catch {
        // Container is not measurable yet.
      }
    }

    const sendResize = () => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    const connect = async () => {
      try {
        const ticket = await createTerminalTicket(tab.host.id, tab.password, tab.usePrivateKey)
        if (disposed) return

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const socket = new WebSocket(
          `${protocol}//${window.location.host}/api/terminal?ticket=${encodeURIComponent(ticket)}`,
        )
        socket.binaryType = 'arraybuffer'
        socketRef.current = socket

        socket.onopen = () => {
          setStatus('open')
          setDetail('Connected')
          onStateRef.current(tab.host.id, 'online')
          safeFit()
          sendResize()
          term.focus()
        }

        socket.onmessage = (event) => {
          if (typeof event.data === 'string') {
            try {
              const message = JSON.parse(event.data) as { type?: string; message?: string }
              if (message.message) {
                setDetail(message.message)
                if (message.type === 'error') {
                  setStatus('error')
                  onStateRef.current(tab.host.id, 'offline')
                  term.writeln(`\r\n${message.message}`)
                }
                if (message.type === 'status' && message.message.startsWith('Connected')) {
                  setStatus('open')
                  onStateRef.current(tab.host.id, 'online')
                }
                return
              }
            } catch {
              term.write(event.data)
              return
            }
          }
          if (event.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(event.data))
          }
        }

        socket.onerror = () => {
          setStatus('error')
          setDetail('WebSocket error')
        }

        socket.onclose = () => {
          if (disposed) return
          setStatus('closed')
          setDetail('Disconnected')
          onStateRef.current(tab.host.id, 'offline')
        }

        term.onData((data) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'data', data }))
          }
        })

        term.onResize(({ cols, rows }) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'resize', cols, rows }))
          }
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Connect failed'
        setStatus('error')
        setDetail(message)
        onStateRef.current(tab.host.id, 'offline')
        term.writeln(`\r\n${message}`)
      }
    }

    void connect()
    const observer = new ResizeObserver(() => {
      safeFit()
      sendResize()
    })
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      socketRef.current?.close()
      socketRef.current = null
      fitRef.current = null
      term.dispose()
    }
  }, [tab.sessionId, tab.host.id, tab.password, tab.usePrivateKey])

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        // Ignore until the pane is visible.
      }
      const socket = socketRef.current
      const term = fitRef.current
      if (socket && socket.readyState === WebSocket.OPEN && term) {
        const cols = containerRef.current?.querySelector('.xterm')
        void cols
        socket.send(
          JSON.stringify({
            type: 'resize',
            cols: 80,
            rows: 24,
          }),
        )
      }
    })
    return () => cancelAnimationFrame(id)
  }, [active])

  return (
    <div className={active ? 'sx-terminal is-active' : 'sx-terminal'} hidden={!active}>
      <div className="sx-terminal-bar">
        <span>
          {tab.host.user}@{tab.host.address}:{tab.host.port} — {detail}
        </span>
        <span className={`sx-status is-${status}`}>{status}</span>
      </div>
      <div className="sx-terminal-body" ref={containerRef} />
    </div>
  )
}

const styles = `
.sx-app {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24px;
  background: #0b1220;
  color: #d7e3f4;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.sx-app * { box-sizing: border-box; }
.sx-header, .sx-terminal-bar, .sx-terminal-header, .sx-actions, .sx-row, .sx-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sx-header h1, .sx-panel h2 { margin: 0; }
.sx-header p, .sx-hint, .sx-empty, .sx-terminal-empty { color: #93a4bd; }
.sx-error {
  margin: 16px 0;
  padding: 10px 12px;
  border: 1px solid #7f1d1d;
  border-radius: 10px;
  background: #3f1212;
  color: #fecaca;
}
.sx-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  grid-template-areas:
    "hosts side"
    "term term";
  gap: 16px;
  align-items: start;
  margin-top: 16px;
}
.sx-hosts { grid-area: hosts; }
.sx-side { grid-area: side; }
.sx-terminal-panel { grid-area: term; }
.sx-panel {
  padding: 16px;
  border: 1px solid #1e293b;
  border-radius: 14px;
  background: #111827;
  min-width: 0;
}
.sx-panel h2 { margin-bottom: 12px; font-size: 16px; }
.sx-connect-title { margin-top: 20px; }
.sx-table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid #1e293b; white-space: nowrap; }
tr.is-selected { background: #172033; }
.sx-form, .sx-terminal { display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #b6c3d6; }
.sx-check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #334155;
  border-radius: 8px;
  background: #0b1220;
  color: #d7e3f4;
}
input[type="checkbox"] {
  width: 16px;
  height: 16px;
  padding: 0;
  flex: 0 0 auto;
}
button {
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: #0ea5e9;
  color: #041018;
  font-weight: 700;
  cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
.sx-danger { background: #b91c1c; color: #fff; }
.sx-status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: #334155;
  font-size: 12px;
  text-transform: lowercase;
}
.sx-status.is-online, .sx-status.is-open { background: #166534; }
.sx-status.is-offline, .sx-status.is-error, .sx-status.is-closed { background: #991b1b; }
.sx-status.is-connecting, .sx-status.is-unknown { background: #334155; }
.sx-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin-bottom: 12px;
  padding-bottom: 4px;
}
.sx-tab {
  display: inline-flex;
  align-items: center;
  border: 1px solid #334155;
  border-radius: 8px;
  overflow: hidden;
  flex: 0 0 auto;
}
.sx-tab button {
  border-radius: 0;
  background: transparent;
  color: #d7e3f4;
  font-weight: 600;
}
.sx-tab.is-active { background: #0c4a6e; border-color: #0ea5e9; }
.sx-tab-close { padding-inline: 10px; }
.sx-terminal-stage { min-height: 460px; }
.sx-terminal { min-height: 460px; }
.sx-terminal-empty {
  height: 460px;
  display: grid;
  place-items: center;
  border: 1px dashed #334155;
  border-radius: 10px;
}
.sx-terminal-body {
  height: 420px;
  overflow: hidden;
  border-radius: 10px;
  background: #07111f;
}
@media (max-width: 960px) {
  .sx-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      "hosts"
      "side"
      "term";
  }
}
`
