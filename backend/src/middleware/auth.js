const crypto = require("crypto");
const { promisify } = require("util");
const User = require("../models/user.model");
const Workspace = require("../models/workspace.model");
const { HttpError, asyncHandler } = require("./request");

// Password hashing and signed session/tracking tokens.
const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 256)
    throw new Error("Password must contain 8–256 characters");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || password.length > 256 || typeof encoded !== "string")
    return false;
  const [salt, hex] = encoded.split(":");
  if (!salt || !/^[a-f0-9]{128}$/.test(hex || "")) return false;
  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hex, "hex"));
}

function secret(purpose) {
  const value = purpose === "auth" ? process.env.AUTH_SECRET : process.env.TRACKING_SECRET;
  if (!value || value.length < 32)
    throw new Error(
      `${purpose === "auth" ? "AUTH_SECRET" : "TRACKING_SECRET"} must have at least 32 characters`
    );
  return value;
}

function sign(payload, purpose, seconds) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      purpose,
      ...(seconds ? { exp: Math.floor(Date.now() / 1000) + seconds } : {}),
    })
  ).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret(purpose)).update(body).digest("base64url")}`;
}

function verify(token, purpose) {
  if (typeof token !== "string" || token.length > 4096) throw new Error("Invalid token");
  const pieces = token.split(".");
  if (pieces.length !== 2) throw new Error("Invalid token");
  const [body, supplied] = pieces;
  const expected = crypto.createHmac("sha256", secret(purpose)).update(body).digest();
  const signature = Buffer.from(supplied, "base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected))
    throw new Error("Invalid token");
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (data.purpose !== purpose || (data.exp && data.exp <= Math.floor(Date.now() / 1000)))
    throw new Error("Expired token");
  return data;
}

// Authenticate requests and derive workspace ownership.
const authenticate = asyncHandler(async (req, res, next) => {
  let token;
  try {
    const header = req.get("Authorization") || "";
    if (!header.startsWith("Bearer ")) throw new Error("Missing token");
    token = verify(header.slice(7), "auth");
  } catch {
    throw new HttpError(401, "Please log in");
  }
  const user = await User.findOne({
    _id: token.userId,
    workspaceId: token.workspaceId,
    active: true,
    tokenVersion: token.version,
  });
  const workspace = user && (await Workspace.findOne({ _id: user.workspaceId, active: true }));
  if (!user || !workspace) throw new HttpError(401, "Session is no longer valid");
  req.auth = { userId: user._id, workspaceId: user.workspaceId, role: user.role };
  req.workspace = workspace;
  next();
});

module.exports = { authenticate, hashPassword, verifyPassword, sign, verify };
