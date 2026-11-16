const { checkMailConfig } = require("../controller/mail.controller");
const User = require("../models/user.model");
const Workspace = require("../models/workspace.model");
const { verifyPassword, sign, hashPassword } = require("../middleware/auth");
const { handlers, HttpError, normalizeEmail, required } = require("../middleware/request");
const mongoose = require("mongoose");
const crypto = require("crypto");

// Login, signup, session details, and logout.
const attempts = new Map();

// Limit login and signup attempts per IP within this server process.
function limit(req, action, maximum) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  if (attempts.size > 10000) throw new HttpError(429, "Please try again later");
  const key = action + ":" + req.ip;
  const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (attempt.count >= maximum) throw new HttpError(429, "Too many attempts; try again later");
  attempt.count++;
  attempts.set(key, attempt);
}

// Return public profile and sender readiness; never expose credentials to the browser.
function sessionDetails(user, workspace) {
  const senderEmail = workspace.senderEmail || process.env.FROM_EMAIL || "";
  let mailConfigured = false;
  try {
    checkMailConfig();
    normalizeEmail(senderEmail);
    mailConfigured = true;
  } catch { }
  return {
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
    },
    workspace: { id: workspace._id, name: workspace.name, senderEmail, mailConfigured },
  };
}

function sessionResponse(res, user, workspace, status = 200) {
  const token = sign(
    { userId: String(user._id), workspaceId: String(user.workspaceId), version: user.tokenVersion },
    "auth",
    12 * 60 * 60
  );
  return res.status(status).json({
    success: true,
    message: status === 201 ? "Account created" : "Login successful",
    token,
    ...sessionDetails(user, workspace),
  });
}

async function me(req, res) {
  const user = await User.findOne({ _id: req.auth.userId, workspaceId: req.auth.workspaceId });
  res
    .set("Cache-Control", "no-store")
    .json({ success: true, ...sessionDetails(user, req.workspace) });
}

async function login(req, res) {
  limit(req, "login", 30);
  const email = normalizeEmail(req.body.email);
  const user = await User.findOne({ email, active: true }).select("+passwordHash");
  const valid = user && (await verifyPassword(req.body.password, user.passwordHash));
  const workspace = valid && (await Workspace.findOne({ _id: user.workspaceId, active: true }));
  if (!valid || !workspace) throw new HttpError(401, "Invalid email or password");
  sessionResponse(res, user, workspace);
}

// Each new signup owns a separate workspace; legacy accounts are not imported here.
async function signup(req, res) {
  limit(req, "signup", 10);
  const { firstName, lastName, email, password } = req.body;
  let workspace;
  try {
    workspace = await createWorkspace({ firstName, lastName, email, password });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email)
      throw new HttpError(409, "An account with this email already exists");
    throw error;
  }
  const user = await User.findOne({ workspaceId: workspace._id, email: normalizeEmail(email) });
  sessionResponse(res, user, workspace, 201);
}

// Incrementing the version invalidates every previously issued token for this user.
async function logout(req, res) {
  await User.updateOne(
    { _id: req.auth.userId, workspaceId: req.auth.workspaceId },
    { $inc: { tokenVersion: 1 } }
  );
  res.json({ success: true });
}

// Create the workspace and owner atomically.
// Create the workspace and its hashed owner account in one database transaction.
async function createWorkspace({
  name,
  slug,
  firstName,
  lastName,
  email,
  password,
  senderEmail = "",
}) {
  firstName = required(firstName, "First name", 100);
  lastName = required(lastName, "Last name", 100);
  email = normalizeEmail(email);
  name = required(name || firstName + "'s workspace", "Workspace name", 150);
  slug = required(slug || "customer-" + crypto.randomUUID(), "Workspace slug", 100).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new HttpError(400, "Invalid workspace slug");
  if (typeof password !== "string" || password.length < 8 || password.length > 256)
    throw new HttpError(400, "Password must contain 8?256 characters");
  const passwordHash = await hashPassword(password);
  if (senderEmail) senderEmail = normalizeEmail(senderEmail);
  let workspace;
  await mongoose.connection.transaction(async (session) => {
    [workspace] = await Workspace.create([{ name, slug, senderEmail }], { session });
    await User.create(
      [{ workspaceId: workspace._id, firstName, lastName, email, passwordHash, role: "owner" }],
      { session }
    );
  });
  return workspace;
}

module.exports = { ...handlers({ login, signup, logout, me }), createWorkspace };
