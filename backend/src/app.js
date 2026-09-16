import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import adminRoutes from "./routes/adminRoutes.js";
import airportRoutes from "./routes/airportRoutes.js";
import airlineRoutes from "./routes/airlineRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import flightRoutes from "./routes/flightRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";

const app = express();

app.disable("x-powered-by");
// Full tool results and reasoning can exceed the ordinary request limit.
app.use("/api/sessions", express.json({ limit: "2mb" }));
app.use(express.json({ limit: "100kb" }));

app.use("/api/health", healthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/airports", airportRoutes);
app.use("/api/airlines", airlineRoutes);
app.use("/api/flights", flightRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/sessions", sessionRoutes);

app.use((request, response) => {
  response.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route not found: ${request.method} ${request.originalUrl}`,
    },
  });
});
app.use(errorHandler);

export default app;
