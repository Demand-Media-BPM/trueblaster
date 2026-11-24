const { MongoClient } = require("mongoose").mongo;

// Intentionally fixed to a loopback-only local instance. This cannot initialize Atlas or production.
async function main() {
  const client = new MongoClient("mongodb://127.0.0.1:27018/admin?directConnection=true", { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const admin = client.db("admin");
    try {
      const status = await admin.command({ replSetGetStatus: 1 });
      if (status.set !== "trueblaster-local") throw new Error("Port 27018 belongs to a different replica set; stop and inspect it");
      console.log("TrueBlaster local replica set already initialized; no changes made.");
    } catch (error) {
      if (error.code !== 94) throw error;
      await admin.command({ replSetInitiate: { _id: "trueblaster-local", members: [{ _id: 0, host: "127.0.0.1:27018" }] } });
      console.log("Initialized trueblaster-local on 127.0.0.1:27018. No database was cleared.");
    }
  } finally { await client.close(); }
}
main().catch(error => { console.error("Local MongoDB initialization failed:", error.name, error.code || "Check the local mongod process"); process.exitCode = 1; });
