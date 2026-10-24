// apps/web/src/terminal/types.ts
export type TabStatus = "connecting" | "open" | "closed" | "error";

export type TermTab = {
  sessionId: string;
  hostId: string;
  title: string;
  status: TabStatus;
  error?: string;
};

export type ServerMsg =
  | { type: "status"; status: TabStatus }
  | { type: "error"; message: string };
