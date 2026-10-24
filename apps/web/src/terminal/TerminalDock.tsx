// apps/web/src/terminal/TerminalDock.tsx
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ServerMsg, TermTab } from "./types";

const MAX = Number(import.meta.env.VITE_MAX_SESSIONS_PER_USER ?? 32);

type Live = { term: Terminal; fit: FitAddon; ws: WebSocket; ro: ResizeObserver };

export function TerminalDock({ apiBase, wsBase }: { apiBase: string; wsBase: string }) {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const live = useRef(new Map<string, Live>());
  const hostRefs = useRef(new Map<string, HTMLDivElement>());

  function patch(id: string, p: Partial<TermTab>) {
    setTabs((xs) => xs.map((t) => (t.sessionId === id ? { ...t, ...p } : t)));
  }

  async function connect(host: { id: string; name: string }) {
    if (tabs.some((t) => t.hostId === host.id && t.status !== "closed" && t.status !== "error")) {
      setActive(tabs.find((t) => t.hostId === host.id)!.sessionId);
      return;
    }
    const open = tabs.filter((t) => t.status === "connecting" || t.status === "open").length;
    if (open >= MAX) {
      patch(active ?? "", {});
      alert(`Session limit reached (${MAX}). Close a tab first.`);
      return;
    }

    const ticketRes = await fetch(`${apiBase}/api/terminal/ticket`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostId: host.id }),
    });
    if (!ticketRes.ok) throw new Error(await ticketRes.text());
    const { ticket, sessionId } = await ticketRes.json();

    const tab: TermTab = { sessionId, hostId: host.id, title: host.name, status: "connecting" };
    setTabs((xs) => [...xs, tab]);
    setActive(sessionId);

    requestAnimationFrame(() => mount(tab, ticket));
  }

  function mount(tab: TermTab, ticket: string) {
    const el = hostRefs.current.get(tab.sessionId);
    if (!el) return;
    const term = new Terminal({ cursorBlink: true, fontSize: 13, convertEol: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const ws = new WebSocket(`${wsBase}/api/terminal?ticket=${encodeURIComponent(ticket)}`);
    ws.binaryType = "arraybuffer";

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    const ro = new ResizeObserver(() => {
      if (document.visibilityState === "hidden") return;
      fit.fit();
      sendResize();
    });
    ro.observe(el);

    ws.onopen = () => {
      patch(tab.sessionId, { status: "open" });
      sendResize();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.type === "error") patch(tab.sessionId, { status: "error", error: msg.message });
        if (msg.type === "status") patch(tab.sessionId, { status: msg.status });
        return;
      }
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => patch(tab.sessionId, { status: "closed" });
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "data", data }));
    });

    live.current.set(tab.sessionId, { term, fit, ws, ro });
  }

  function closeTab(sessionId: string) {
    const s = live.current.get(sessionId);
    s?.ws.close();
    s?.ro.disconnect();
    s?.term.dispose();
    live.current.delete(sessionId);
    setTabs((xs) => xs.filter((t) => t.sessionId !== sessionId));
    setActive((cur) => (cur === sessionId ? null : cur));
  }

  useEffect(() => {
    const s = active ? live.current.get(active) : undefined;
    if (!s) return;
    requestAnimationFrame(() => {
      s.fit.fit();
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(JSON.stringify({ type: "resize", cols: s.term.cols, rows: s.term.rows }));
      }
    });
  }, [active]);

  useEffect(() => () => {
    for (const s of live.current.values()) {
      s.ws.close();
      s.ro.disconnect();
      s.term.dispose();
    }
  }, []);

  return { tabs, active, setActive, connect, closeTab, hostRefs, limit: MAX };
}
