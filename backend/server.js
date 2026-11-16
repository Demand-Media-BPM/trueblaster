const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const http = require("http");
const mongoose = require("mongoose");
const { connectDatabase } = require("./src/config/database");
const { startWorker } = require("./src/controller/delivery.controller");
const { errorHandler } = require("./src/middleware/request");
const express = require("express");
const cors = require("cors");
const corsOptions = require("./src/config/cors");
const registerRoutes = require("./src/routes");

// Shared HTTP middleware runs before the application routes.
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY || false);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "2mb" }));
app.get("/", (req, res) => res.send("Backend is running!"));
registerRoutes(app);
app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));
app.use(errorHandler);

// Connect to MongoDB before accepting requests or starting campaign delivery.
async function main() {
  if (
    !process.env.AUTH_SECRET ||
    process.env.AUTH_SECRET.length < 32 ||
    !process.env.TRACKING_SECRET ||
    process.env.TRACKING_SECRET.length < 32
  )
    throw new Error("Authentication and tracking secrets must be configured");
  await connectDatabase();
  const server = http.createServer(app);
  server.requestTimeout = 60000;
  const port = Number(process.env.PORT || 5000);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  const stopWorker =
    process.env.ENABLE_CAMPAIGN_WORKER === "true"
      ? startWorker()
      : async () => {};
  console.log(`Backend listening on port ${server.address().port}`);
  let stopping = false;
  // Stop accepting requests, finish active worker work, then close MongoDB.
  async function stop() {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 45000);
    timeout.unref();
    await new Promise((resolve) => server.close(resolve));
    await stopWorker();
    await mongoose.disconnect();
    clearTimeout(timeout);
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
// Importing server.js in tests exposes the app without starting a database or worker.
if (require.main === module) {
  main().catch((error) => {
    console.error(
      "Backend startup failed:",
      error.name,
      "Check database connectivity and environment configuration.",
    );
    mongoose.disconnect().finally(() => {
      process.exitCode = 1;
    });
  });
}

module.exports = app;
