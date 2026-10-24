// FILE: apps/api/src/main.ts
/**
 * Process entry. Binds HOST (default 0.0.0.0) so LAN clients can reach the API.
 * /health is unauthenticated and returns no secrets.
 */
import express from "express";
import helmet from "helmet";

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "wss:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.get("/health", (_req, res) => res.json({ ok: true }));

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8080);
app.listen(port, host, () => {
  console.log(`api listening ${host}:${port}`);
});
