import express from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { ClientChannel, ConnectConfig, Client } from 'ssh2'

const require = createRequire(import.meta.url)
const { Client } = require('ssh2') as typeof import('ssh2')

const port = Number(process.env.PORT ?? 3000)
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const dataFile = path.join(dataDir, 'hosts.json')
const knownFile = path.join(dataDir, 'known_hosts.json')

type HostStatus = 'online' | 'offline' | 'unknown'
type Host = { id: string; name: string; address: string; port: number; user: string; status: HostStatus }
type Ticket = { hostId: string; password?: string; useServerKey: boolean; expires: number }

const tickets = new Map<string, Ticket>()
const knownHosts = new Map<string, string>()

const namePattern = /^[\w .@-]{1,64}$/u
const userPattern = /^[a-zA-Z0-9._-]{1,32}$/
const addressPattern = /^[a-zA-Z0-9.-]{1,253}$/
const uuidPattern = /^[0-9a-f-]{36}$/i

async function readHosts(): Promise<Host[]> {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8')) as Host[]
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, file)
}

async function loadKnownHosts(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(knownFile, 'utf8')) as Record<string, string>
    for (const [host, fingerprint] of Object.entries(parsed)) {
      if (typeof fingerprint === 'string') knownHosts.set(host, fingerprint)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function verifyHost(address: string, portNumber: number, key: Buffer): boolean {
  const id = `${address}:${portNumber}`
  const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`
  const known = knownHosts.get(id)
  if (!known) {
    knownHosts.set(id, fingerprint)
    void writeJson(knownFile, Object.fromEntries(knownHosts))
    console.log(`[SSH] Trusted first host key for ${id}: ${fingerprint}`)
    return true
  }
  if (known !== fingerprint) {
    console.error(`[SSH] Host key changed for ${id}`)
    return false
  }
  return true
}

function parseHost(body: unknown): Omit<Host, 'id' | 'status'> | null {
  if (!body || typeof body !== 'object') return null
  const input = body as Record<string, unknown>
  const name = String(input.name ?? '').trim()
  const address = String(input.address ?? '').trim()
  const user = String(input.user ?? '').trim()
  const portNumber = Number(input.port)

  if (!namePattern.test(name)) return null
  if (!addressPattern.test(address) || address.includes('..')) return null
  if (!userPattern.test(user)) return null
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return null
  return { name, address, port: portNumber, user }
}

function textMessage(socket: WebSocket, type: 'status' | 'error' | 'debug' | 'info', message: string): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type, message }))
  }
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

async function sshConfig(host: Host, ticket: Ticket): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: host.address,
    port: host.port,
    username: host.user,
    readyTimeout: 15000,
    tryKeyboard: true,
    hostVerifier: (key) => verifyHost(host.address, host.port, key),
  }

  if (ticket.useServerKey) {
    const keyFile = process.env.SSH_PRIVATE_KEY_FILE
    if (!keyFile) throw new Error('SSH_PRIVATE_KEY_FILE is not set')
    config.privateKey = await readFile(path.resolve(keyFile))
    if (process.env.SSH_KEY_PASSPHRASE) config.passphrase = process.env.SSH_KEY_PASSPHRASE
  } else {
    if (!ticket.password || ticket.password.length === 0) {
      throw new Error('Password is required for SSH connection')
    }
    config.password = ticket.password
  }
  return config
}

function connectSSH(socket: WebSocket, host: Host, ticket: Ticket, config: ConnectConfig): void {
  const conn = new Client()
  let channel: ClientChannel | undefined
  let finished = false

  const finish = () => {
    if (finished) return
    finished = true
    channel?.end()
    conn.end()
  }

  socket.on('close', finish)
  socket.on('error', finish)

  // Authentication handler
  conn.on('authentication', (context) => {
    textMessage(socket, 'info', `[SSH] Authentication method requested: ${context.methods.join(', ')}`)
    return false // از keyboard-interactive استفاده می‌کنیم (ساده و قابل اشکال‌یابی)
  })

  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (error, stream) => {
      if (error || finished) {
        const errMsg = error?.message ?? 'Shell failed'
        textMessage(socket, 'error', errMsg)
        socket.close(1011)
        finish()
        return
      }

      channel = stream
      textMessage(socket, 'status', `Connected to ${host.user}@${host.address}:${host.port}`)
      textMessage(socket, 'debug', `SSH ready: ${host.user}@${host.address}:${host.port} - PID: ${stream.pid ?? 'N/A'}`)

      stream.on('data', (data: Buffer) => {
        if (socket.readyState === socket.OPEN) socket.send(data)
      })
      stream.stderr.on('data', (data: Buffer) => {
        if (socket.readyState === socket.OPEN) socket.send(data)
      })
      stream.on('close', () => {
        textMessage(socket, 'status', 'SSH session closed')
        socket.close(1000)
        finish()
      })

      socket.on('message', (data, isBinary) => {
        if (finished || isBinary) return
        let message: { type?: string; data?: string; cols?: number; rows?: number }
        try {
          message = JSON.parse(rawText(data)) as typeof message
        } catch {
          return
        }

        if (message.type === 'data' && typeof message.data === 'string' && message.data.length <= 65536) {
          stream.write(message.data)
        }
        if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows) && message.cols! >= 1 && message.cols! <= 500 && message.rows! >= 1 && message.rows! <= 200) {
          stream.setWindow(message.rows!, message.cols!, 0, 0)
        }
      })
    })
  })

  conn.on('error', (error: Error) => {
    console.error(`[SSH] Connection failed: ${host.user}@${host.address}:${host.port} - ${error.message}`)
    textMessage(socket, 'error', error.message)
    socket.close(1011)
    finish()
  })

  // Keyboard-interactive for password (دقیقاً همان چیزی که در log می‌خواهی)
  conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finishAuth) => {
    textMessage(socket, 'debug', `[SSH] Keyboard-interactive prompts: ${prompts.map(p => p.prompt).join(', ')}`)
    finishAuth(prompts.map(() => ticket.password || ''))
  })

  conn.connect(config)
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/hosts', async (_req, res) => res.json(await readHosts()))

app.post('/api/hosts', async (req, res) => {
  const input = parseHost(req.body)
  if (!input) return res.status(400).json({ error: 'Invalid host. Check name, address, port, and user.' })

  const hosts = await readHosts()
  const host: Host = { id: randomUUID(), ...input, status: 'unknown' }
  hosts.unshift(host)
  await writeJson(dataFile, hosts)
  res.status(201).json(host)
})

app.delete('/api/hosts/:id', async (req, res) => {
  const id = String(req.params.id)
  if (!uuidPattern.test(id)) return res.status(400).json({ error: 'Invalid id.' })

  const hosts = await readHosts()
  const next = hosts.filter((h) => h.id !== id)
  if (next.length === hosts.length) return res.status(404).json({ error: 'Host not found.' })

  await writeJson(dataFile, next)
  res.status(204).end()
})

app.post('/api/terminal/ticket', async (req, res) => {
  const body = req.body as { hostId?: unknown; password?: unknown; useServerKey?: unknown }
  const hostId = String(body.hostId ?? '')
  const useServerKey = body.useServerKey === true
  const password = typeof body.password === 'string' ? body.password : ''

  if (!uuidPattern.test(hostId)) return res.status(400).json({ error: 'Invalid host id.' })
  if (!useServerKey && (password.length < 1 || password.length > 1024)) {
    return res.status(400).json({ error: 'Password must be 1-1024 characters.' })
  }

  const host = (await readHosts()).find((item) => item.id === hostId)
  if (!host) return res.status(404).json({ error: 'Host not found.' })

  const now = Date.now()
  for (const [id, t] of tickets) if (t.expires <= now) tickets.delete(id)

  const ticketId = randomUUID()
  tickets.set(ticketId, { hostId, password: useServerKey ? undefined : password, useServerKey, expires: now + 20000 })
  res.json({ ticket: ticketId })
})

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/api/terminal', maxPayload: 1024 * 1024 })

wss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const ticketId = url.searchParams.get('ticket') ?? ''
  const ticket = tickets.get(ticketId)
  tickets.delete(ticketId)

  if (!ticket || ticket.expires <= Date.now()) {
    textMessage(socket, 'error', 'Invalid or expired ticket')
    socket.close(1008)
    return
  }

  void (async () => {
    const host = (await readHosts()).find((item) => item.id === ticket.hostId)
    if (!host) {
      textMessage(socket, 'error', 'Host not found')
      socket.close(1008)
      return
    }

    textMessage(socket, 'info', `Preparing SSH connection to ${host.user}@${host.address}:${host.port}...`)

    try {
      const config = await sshConfig(host, ticket)
      connectSSH(socket, host, ticket, config)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'SSH setup failed'
      textMessage(socket, 'error', msg)
      socket.close(1011)
    }
  })()
})

async function main(): Promise<void> {
  await loadKnownHosts()
  server.listen(port, '127.0.0.1', () => {
    console.log(`API + WebSocket listening on http://127.0.0.1:${port}`)
  })
}

main().catch((error: unknown) => {
  console.error('[Server] Fatal:', error)
  process.exit(1)
})
