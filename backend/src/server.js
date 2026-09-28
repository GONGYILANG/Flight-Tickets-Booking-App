import "dotenv/config";
import app from "./app.js";
import {
  connectDatabase,
  disconnectDatabase,
} from "./config/database.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}

let httpServer;
let shuttingDown = false;

async function startServer() {
  const connection = await connectDatabase();

  httpServer = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log(`MongoDB database: ${connection.name}`);
  });

  // Must stay longer than the dev proxy's agent timeout (5s, see frontend/vite.config.ts)
  // so the client is always the side that closes an idle connection first.
  httpServer.keepAliveTimeout = 65_000;
  // headersTimeout must stay greater than keepAliveTimeout.
  httpServer.headersTimeout = 66_000;
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received. Shutting down...`);

  try {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }

    await disconnectDatabase();
    process.exit(exitCode);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
  void shutdown("unhandledRejection", 1);
});

// Log before exiting instead of dying silently, so a crash can never look like "nothing happened".
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  void shutdown("uncaughtException", 1);
});

try {
  await startServer();
} catch (error) {
  console.error("Server startup failed:", error);
  await disconnectDatabase();
  process.exit(1);
}
