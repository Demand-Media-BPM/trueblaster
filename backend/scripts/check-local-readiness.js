const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const axios = require("axios");
const { MongoClient } = require("mongoose").mongo;
const safety = require("../src/config/local-safety");

// Read-only diagnostics: no Mail Send request, index creation, data writes or account changes.
async function main() {
  const results = [];
  const report = (name, status, detail) => results.push({ name, status, detail });
  try { safety.testSettings(); report("Test safety", "READY", "Allowlist, maximum and run ID validated"); }
  catch (error) { report("Test safety", "BLOCKED", error.message); }
  report("Worker", process.env.ENABLE_CAMPAIGN_WORKER === "true" ? "BLOCKED" : "READY", "Must remain disabled until manually enabled");
  try { require("../src/controller/sendgrid.controller").verificationKeys(); report("Webhook key", "READY", "Valid ECDSA public key; local webhook association must be checked manually"); }
  catch { report("Webhook key", "BLOCKED", "Configure the dedicated local webhook public key"); }
  try {
    const mail = require("../src/controller/mail.controller");
    const config = mail.complianceConfig();
    try { mail.validateTemplateCompliance("<p>Read-only diagnostic</p>", "", config); report("Sender postal compliance", "PARTIALLY READY", "Central fallback passes placeholder checks; actual sender address ownership must be verified by administrator"); }
    catch { report("Sender postal compliance", config.approvedPostalAddresses.length ? "PARTIALLY READY" : "BLOCKED", "Selected template must contain a centrally approved address or use a valid central fallback"); }
  } catch { report("Sender postal compliance", "BLOCKED", "Central compliance configuration is invalid"); }
  const frontendEnv = require("dotenv").parse(fs.readFileSync(path.join(__dirname, "../../frontend/.env")));
  report("Frontend API base", /^http:\/\/(?:localhost|127\.0\.0\.1):5000\/?$/.test(frontendEnv.REACT_APP_API_URL || "") ? "READY" : "BLOCKED", "Local frontend must use the local API on port 5000");
  let client;
  try {
    safety.assertLocalDatabase(process.env.MONGO_URI);
    client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    await client.connect(); await client.db().command({ ping: 1 });
    report("MongoDB", "READY", safety.usingSharedDatabaseLocally() ? "Shared production trueblaster is reachable; local application changes affect production data" : "Read-only ping succeeded on isolated configured database");
  } catch { report("MongoDB", "BLOCKED", safety.usingSharedDatabaseLocally() ? "Check Atlas connectivity, database permissions and IP access" : "Start the isolated local replica set and initialize it"); }
  finally { if (client) await client.close(); }
  try {
    const response = await axios.get("https://api.sendgrid.com/v3/scopes", {
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY || ""}` }, timeout: 10000, maxRedirects: 0, validateStatus: () => true,
    });
    report("SendGrid connectivity", response.status === 200 ? "PARTIALLY READY" : "BLOCKED",
      `Read-only API HTTP ${response.status}; no email sent. Mail Send permission requires manual verification/controlled send.`);
  } catch { report("SendGrid connectivity", "BLOCKED", "Read-only API request failed; no email sent"); }
  try {
    const { enrichIp } = require("../src/controller/tracking.controller");
    const geo = await enrichIp("8.8.8.8");
    report("IPinfo connectivity", geo.geoStatus === "available" ? "READY" : "BLOCKED",
      `Public diagnostic IP only; status=${geo.geoStatus}; available fields: ${["country", "region", "city", "organization", "asn"].filter(k => geo[k]).join(", ") || "none"}`);
  } catch { report("IPinfo connectivity", "BLOCKED", "Diagnostic request failed"); }
  try {
    const url = new URL(process.env.PUBLIC_API_URL);
    const publicHttps = url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname);
    report("Public email links", publicHttps ? "PARTIALLY READY" : "BLOCKED", publicHttps ? "Verify the tunnel and local webhook manually" : "Set PUBLIC_API_URL to the ngrok HTTPS origin");
  } catch { report("Public email links", "BLOCKED", "Configure PUBLIC_API_URL"); }
  console.log(JSON.stringify(results, null, 2));
  if (results.some(r => r.status === "BLOCKED")) process.exitCode = 1;
}
main().catch(error => { console.error("Readiness diagnostics failed:", error.name); process.exitCode = 1; });
