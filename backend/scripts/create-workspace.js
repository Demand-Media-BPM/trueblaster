const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const readline = require("readline/promises");
const { Writable } = require("stream");
const mongoose = require("mongoose");
const { connectDatabase } = require("../src/config/database");
const { createWorkspace } = require("../src/controller/auth.controller");
async function main() {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output,
    terminal: !!process.stdin.isTTY,
  });
  let input;
  try {
    input = {
      name: await rl.question("Workspace name: "),
      slug: await rl.question("Workspace slug: "),
      firstName: await rl.question("Owner first name: "),
      lastName: await rl.question("Owner last name: "),
      email: await rl.question("Owner email: "),
      senderEmail: await rl.question("Verified SES sender email (blank for platform default): "),
    };
    process.stdout.write("Owner password (8–256 characters): ");
    muted = true;
    input.password = await rl.question("");
    muted = false;
    process.stdout.write("\n");
  } finally {
    muted = false;
    rl.close();
  }
  await connectDatabase();
  await createWorkspace(input);
  console.log("Workspace and hashed owner account created.");
}
main()
  .catch((error) => {
    console.error(
      "Workspace creation failed:",
      error.code === 11000 ? "Account or workspace already exists" : error.message
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
