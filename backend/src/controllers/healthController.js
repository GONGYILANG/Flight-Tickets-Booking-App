import mongoose from "mongoose";

const connectionStates = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export function getHealth(_request, response) {
  const databaseState =
    connectionStates[mongoose.connection.readyState] ?? "unknown";
  const healthy = mongoose.connection.readyState === 1;

  response.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "unavailable",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: databaseState,
      name: mongoose.connection.name || null,
    },
  });
}
