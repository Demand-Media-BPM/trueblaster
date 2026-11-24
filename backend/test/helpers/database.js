const { MongoMemoryReplSet } = require("mongodb-memory-server");

async function testDatabase(name) {
  if (!/^[a-z_]+_tests$/.test(name)) throw new Error("Expected an isolated test database name");
  const shared = process.env.TRUEBLASTER_TEST_MONGO_URI;
  if (shared) {
    if (process.env.TRUEBLASTER_OWNED_TEST_DB !== "true" || !/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(shared))
      throw new Error("Refusing an unowned or remote test database");
    return { getUri(database = name) {
      if (!/^[a-z_]+_tests$/.test(database)) throw new Error("Expected test database");
      const url = new URL(shared); url.pathname = "/" + database; return url.toString();
    }, stop: async () => {} };
  }
  // Standalone file execution remains supported; the npm runner owns normal lifecycle/cleanup.
  return MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }] });
}

module.exports = { testDatabase };
