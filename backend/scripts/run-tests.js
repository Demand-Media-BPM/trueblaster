const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// One owned, disposable replica set per run. Each test file uses its own database.
// Avoid repeatedly starting/stopping mongod between files on Windows.
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "trueblaster-tests-"));
  let replica, code = 1;
  try {
    const dataPath = path.join(directory, "data");
    await fs.mkdir(dataPath);
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 },
      instanceOpts: [{ dbPath: dataPath, launchTimeout: 60000 }] });
    const tests = (await fs.readdir(path.join(__dirname, "../test")))
      .filter(name => name.endsWith(".test.js")).sort().map(name => path.join("test", name));
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...tests], {
      cwd: path.join(__dirname, ".."), windowsHide: true, stdio: "inherit",
      env: { ...process.env, NODE_ENV: "test", ALLOW_PRODUCTION_DATABASE_LOCAL: "false", ENABLE_CAMPAIGN_WORKER: "false", IPINFO_TOKEN: "",
        TRUEBLASTER_TEST_MONGO_URI: replica.getUri(), TRUEBLASTER_OWNED_TEST_DB: "true" },
    });
    code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", value => resolve(value ?? 1)); });
  } finally {
    // Stop the process before retrying Windows file-lock cleanup; never delete arbitrary paths.
    if (replica) await replica.stop({ doCleanup: false });
    const resolved = path.resolve(directory);
    const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith("trueblaster-tests-"))
      throw new Error("Refusing unexpected test cleanup path");
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  process.exitCode = code;
}
main().catch(error => { console.error("Local test harness failed:", error.name, error.code || ""); process.exitCode = 1; });
