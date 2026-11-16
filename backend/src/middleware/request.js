class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const handlers = (object) =>
  Object.fromEntries(Object.entries(object).map(([name, fn]) => [name, asyncHandler(fn)]));
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function required(value, name, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, `${name} is required and must be at most ${max} characters`);
  return value.trim();
}

function normalizeEmail(value) {
  const email = required(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "A valid email address is required");
  return email;
}

// Normalize API errors without exposing internal server failures.
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500,
    message = error.message;
  if (error.code === 11000) {
    status = 409;
    message = "A record with that name or email already exists in this workspace";
  }
  if (["ValidationError", "CastError"].includes(error.name)) {
    status = 400;
    message = "Invalid request data";
  }
  if (error.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "Contact file exceeds 10 MB";
  }
  if (status >= 500) {
    console.error("API request failed:", error.name);
    message = error.status ? error.message : "An internal error occurred";
  }
  res.status(status).json({ success: false, error: message, message });
}

module.exports = { HttpError, asyncHandler, handlers, escapeRegex, required, normalizeEmail, errorHandler };
