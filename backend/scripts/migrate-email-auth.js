const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const { connectDatabase } = require("../src/config/database");
const User = require("../src/models/user.model");
async function migrate() {
  await connectDatabase();
  const missing = await User.collection.countDocuments({
    $or: [{ email: { $exists: false } }, { email: null }],
  });
  if (missing)
    throw new Error("Existing accounts require an explicit email mapping before this migration");
  const indexes = await User.collection.indexes();
  if (indexes.some((index) => index.name === "username_1"))
    await User.collection.dropIndex("username_1");
  console.log("Email authentication indexes are ready; existing accounts were not modified.");
}
if (require.main === module)
  migrate()
    .catch((error) => {
      console.error("Email index migration failed:", error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
module.exports = { migrate };
