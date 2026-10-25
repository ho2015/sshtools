export type HostStatus = 'online' | 'offline' | 'unknown'

export type Host = {
  id: string
  name: string
  address: string
  port: number
  user: string
  status: HostStatus
}

export type HostInput = {
  name: string
  address: string
  port: number
  user: string
}

export type AuditEvent = {
  id?: string
  timestamp?: string
  time?: string
  createdAt?: string
  created_at?: string
  user?: string
  username?: string
  command?: string
  cmd?: string
  sessionId?: string
  host?: string
  hostName?: string
  hostname?: string
  result?: string
  status?: string
}

async function parseError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json()
    if (body && typeof body.error === 'string') {
      return new Error(body.error)
    }
  } catch {
    // ignore
  }
  return new Error(`${fallback} (${response.status})`)
}

export async function listHosts(): Promise<Host[]> {
  const res = await fetch('/api/hosts')
  if (!res.ok) throw await parseError(res, 'Failed to load hosts')
  return res.json()
}

export async function createHost(input: HostInput): Promise<Host> {
  const res = await fetch('/api/hosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw await parseError(res, 'Failed to add host')
  return res.json()
}

export async function deleteHost(id: string): Promise<void> {
  const res = await fetch(`/api/hosts/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw await parseError(res, 'Failed to delete host')
}

export async function createTerminalTicket(
  hostId: string,
  password: string,
  useKey: boolean
): Promise<string> {
  const res = await fetch('/api/terminal/ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostId,
      useKey: useKey,
      password: useKey ? undefined : password,
    }),
  })
  if (!res.ok) throw await parseError(res, 'Failed to create terminal ticket')

  const data = await res.json()
  if (!data?.ticket) {
    throw new Error('Invalid response from server')
  }
  return data.ticket
}

export async function listAudit(): Promise<AuditEvent[]> {
  const res = await fetch('/api/audit')
  if (!res.ok) throw await parseError(res, 'Failed to load audit')
  return res.json()
}
