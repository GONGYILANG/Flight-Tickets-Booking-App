import { Router } from "express";
import mongoose from "mongoose";

const router = Router();
const connectionStates = [
  "disconnected",
  "connected",
  "connecting",
  "disconnecting",
];

router.get("/", (_request, response) => {
  const connected = mongoose.connection.readyState === 1;
  response.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "unavailable",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: connectionStates[mongoose.connection.readyState] ?? "unknown",
      name: mongoose.connection.name || null,
    },
  });
});

export default router;
