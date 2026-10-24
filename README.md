# sshtools 🚀

**sshtools** is a secure, web-based SSH terminal and server management platform built with Node.js, Express, TypeScript, React, Vite, and xterm.js. It delivers a full-featured, responsive terminal directly in the browser, enabling authorized users to manage multiple Linux hosts with real-time interactive shell sessions, encrypted credential storage, comprehensive audit logging, and seamless WebSocket streaming.

## 🌟 Key Features

- **🖥️ Interactive Web Terminal**  
  Full terminal experience powered by xterm.js and WebSocket streams. Supports ANSI colors, control keys (Ctrl+C, Tab, Vim/Nano), dynamic window resizing, and in-app Focus Mode (`Ctrl/Cmd+Shift+F`, Esc).

- **🔐 Military-Grade Security**  
  - SSH private keys and passwords encrypted at rest using AES-256-GCM with unique IVs, authentication tags, and host-bound AAD.  
  - Zero plaintext secret storage in databases or logs.  
  - Built-in SSRF guard blocks access to loopback, link-local, and cloud metadata addresses.  
  - Protected WebSocket connections with one-time tickets, strict Origin validation, and JWT authentication.  
  - TOFU host-key pinning, destination allow-listing, and hash-chained append-only audit logs.

- **🗂️ Host Management (CRUD)**  
  Add, edit, test connectivity, and manage multiple remote Linux servers with support for both password and private-key authentication (including optional passphrase).

- **👤 Multi-User Session Isolation & RBAC**  
  Role-based access (Admin, Auditor, Operator). Users can only view and access their own hosts and sessions. Shadow monitoring is read-only.

- **📊 Comprehensive Auditing**  
  Command records, output chunks, redaction of secrets, export to JSON/CSV/asciinema `.cast`, and live audit feed.

- **📱 Responsive UI**  
  Clean, modern interface built with React and TailwindCSS. Works seamlessly on desktop, tablet, and mobile browsers. Matches the reference dashboard layout with sidebar navigation, hosts table, active terminal, and audit dock.

- **🐳 Production-Ready Deployment**  
  Multi-stage Docker images, Docker Compose profiles for SQLite (default) and PostgreSQL, and Nginx reverse-proxy configuration with TLS and WebSocket upgrade headers.

## 📐 Architecture Overview

<div align="center">

# sshtools 🚀

**Secure, web-based SSH terminal & server management platform**

Node.js · Express · TypeScript · React · Vite · xterm.js

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Node](https://img.shields.io/badge/Node.js-22%2B-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)
![React](https://img.shields.io/badge/React-18-61DAFB.svg)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg)
![Prisma](https://img.shields.io/badge/ORM-Prisma-2D3748.svg)

</div>

---

**sshtools** delivers a full-featured, responsive terminal directly in the browser, enabling authorized users to manage multiple Linux hosts with real-time interactive shell sessions, encrypted credential storage, comprehensive audit logging, and seamless WebSocket streaming.

## 📸 Screenshot

![sshtools Dashboard](docs/7f1d9c13-0e4d-4982-9a64-9ddabc49a4b4.webp)

## 🌟 Key Features

### 🖥️ Interactive Web Terminal
Full terminal experience powered by **xterm.js** and WebSocket streams. Supports ANSI colors, control keys (`Ctrl+C`, `Tab`, Vim/Nano), dynamic window resizing, and in-app **Focus Mode** (`Ctrl/Cmd+Shift+F`, `Esc`).

### 🔐 Military-Grade Security
- SSH private keys and passwords encrypted at rest using **AES-256-GCM** with unique IVs, authentication tags, and host-bound AAD.
- **Zero plaintext secret storage** in databases or logs.
- Built-in **SSRF guard** blocks access to loopback, link-local, and cloud metadata addresses.
- Protected WebSocket connections with **one-time tickets**, strict Origin validation, and JWT authentication.
- **TOFU host-key pinning**, destination allow-listing, and **hash-chained append-only** audit logs.

### 🗂️ Host Management (CRUD)
Add, edit, test connectivity, and manage multiple remote Linux servers with support for both **password** and **private-key** authentication (including optional passphrase).

### 👤 Multi-User Session Isolation & RBAC
Role-based access (**Admin**, **Auditor**, **Operator**). Users can only view and access their own hosts and sessions. Shadow monitoring is read-only.

### 📊 Comprehensive Auditing
Command records, output chunks, redaction of secrets, export to **JSON / CSV / asciinema `.cast`**, and live audit feed.

### 📱 Responsive UI
Clean, modern interface built with **React** and **TailwindCSS**. Works seamlessly on desktop, tablet, and mobile browsers — sidebar navigation, hosts table, active terminal, and audit dock.

### 🐳 Production-Ready Deployment
Multi-stage Docker images, Docker Compose profiles for **SQLite** (default) and **PostgreSQL**, and Nginx reverse-proxy configuration with TLS and WebSocket upgrade headers.

## 📐 Architecture Overview

```text
                      ┌──────────────────────────────┐
                      │   Browser (React + xterm.js) │
                      └──────────────┬───────────────┘
                                     │  HTTPS / WSS
                                     ▼
                      ┌──────────────────────────────┐
                      │  Nginx (TLS termination,     │
                      │  HTTP/2, WebSocket Upgrade)  │
                      └──────┬───────────────┬───────┘
                             │               │
              /api/*         │               │   /ws
                             ▼               ▼
              ┌──────────────────────┐  ┌───────────────────────────┐
              │  Express REST API    │  │  WebSocket Gateway        │
              │  (Zod, RBAC, CSRF)   │  │  (one-time ticket,        │
              └──────────┬───────────┘  │   origin check)           │
                         │              └────────────┬──────────────┘
                         │                           │
                         │                           ├──► ssh2 PTY ──► Allow-listed Linux hosts
                         │                           │
                         ▼                           ▼
              ┌──────────────────────────────────────────────┐
              │  Forensics pipeline                          │
              │  (redact → hash-chain → Prisma)              │
              └──────────────────────┬───────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
             ┌────────────┐                   ┌──────────────┐
             │  SQLite    │                   │  PostgreSQL  │
             │  (default) │                   │  (optional)  │
             └────────────┘                   └──────────────┘
```

## 🛠️ Tech Stack

| Layer       | Technologies |
|-------------|--------------|
| **Backend** | Node.js, Express, TypeScript, ssh2, ws, Prisma ORM, Zod, Pino |
| **Frontend** | React, Vite, TailwindCSS, xterm.js (with fit addon), Focus Mode hook |
| **Database** | SQLite (default) or PostgreSQL via Prisma — zero-code-change switch |
| **Security** | AES-256-GCM encryption, one-time WebSocket tickets, SSRF guard, TOFU host keys, redaction engine, hash-chained audit logs |

## 🚀 Getting Started

### Prerequisites

- Node.js **22+**
- npm or pnpm
- Docker & Docker Compose (recommended for production)

### Local Development

```bash
# Clone the repository
git clone https://github.com/your-org/sshtools.git
cd sshtools

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and set DATABASE_URL, DATA_KEY_RING (32-byte base64 key), PUBLIC_ORIGIN, etc.

# Initialize database
npx prisma migrate dev --name init

# Start development servers (API on 8080, Web on 5173)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Docker Deployment (Recommended)

```bash
# SQLite profile (default)
docker compose --profile sqlite up -d --build

# PostgreSQL profile
docker compose --profile postgres up -d --build
```

Access the application at the configured host/port. Check logs with:

```bash
docker compose logs -f
```

## 🧪 Running Tests

```bash
# Unit & security tests
npm run test

# With coverage
npm run test:coverage
```

Playwright E2E tests cover the full flow:
**login → add host → connect → command execution → audit export → Focus Mode**.

## 🔒 Security Best Practices

- Keep the `DATA_KEY_RING` (master encryption key) **secret** and never commit it to source control. Loss of the key means encrypted credentials **cannot be recovered**.
- Always place a reverse proxy (Nginx, Caddy, or Cloudflare) in front of sshtools in production to enforce **HTTPS/WSS** and rate limiting.
- Configure destination allow-lists (`AllowCidr`) **before** adding hosts in production environments.
- Review and rotate encryption keys periodically using the built-in **key-ring support**.

## 📜 License

This project is licensed under the [Apache License 2.0](LICENSE).

---

<div align="center">

**sshtools** — Secure, auditable, and production-ready SSH management for your Linux fleet. 🚀

</div>
