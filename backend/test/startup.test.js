const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { testDatabase } = require("./helpers/database");

test("node server.js connects MongoDB and serves the frontend API over HTTP", { timeout: 120000 }, async () => {
  const replica = await testDatabase("startup_tests");
  let child;

  try {
    child = spawn(process.execPath, ["server.js"], {
      cwd: path.join(__dirname, ".."),
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "test",
        MONGO_URI: replica.getUri("startup_tests"),
        PORT: "0",
        AUTH_SECRET: "a".repeat(64),
        TRACKING_SECRET: "t".repeat(64),
        PUBLIC_API_URL: "http://localhost:5000",
        // Disable campaign delivery so startup verification cannot send any email.
        ENABLE_CAMPAIGN_WORKER: "false",
        SENDGRID_API_KEY: "",
        AWS_ACCESS_KEY_ID: "",
        AWS_SECRET_ACCESS_KEY: "",
        FORCE_SES_REGION: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const port = await new Promise((resolve, reject) => {
      let output = "";
      let errors = "";
      const timer = setTimeout(() => finish(new Error("Server did not start in time")), 45000);
      const onError = (error) => finish(error);
      const onExit = () => finish(new Error("Server exited before listening: " + errors));
      const onData = (chunk) => {
        output += chunk.toString();
        const match = output.match(/Backend listening on port (\d+)/);
        if (match) finish(null, Number(match[1]));
      };
      const onStderr = (chunk) => { errors += chunk.toString(); };
      function finish(error, value) {
        clearTimeout(timer);
        child.off("error", onError);
        child.off("exit", onExit);
        child.stdout.off("data", onData);
        child.stderr.off("data", onStderr);
        if (error) reject(error);
        else resolve(value);
      }
      child.on("error", onError);
      child.on("exit", onExit);
      child.stdout.on("data", onData);
      child.stderr.on("data", onStderr);
    });

    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(base + "/", { signal: AbortSignal.timeout(10000) });
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "Backend is running!");

    const session = await fetch(base + "/me", { signal: AbortSignal.timeout(10000) });
    assert.equal(session.status, 401);

    const preflight = await fetch(base + "/api/preview/example", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PATCH" },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
    assert.match(preflight.headers.get("access-control-allow-methods"), /PATCH/);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill();
      });
    }
    await replica.stop();
  }
});
