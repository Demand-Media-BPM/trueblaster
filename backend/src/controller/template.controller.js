const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const Template = require("../models/template.model");
const { handlers, required, HttpError, escapeRegex } = require("../middleware/request");
const owned = (req) => ({ workspaceId: req.auth.workspaceId, _id: req.params.id });

async function searchTemplates(req, res) {
  const query = { workspaceId: req.auth.workspaceId };
  if (req.query.q) query.name = { $regex: escapeRegex(req.query.q), $options: "i" };
  res.json((await Template.find(query).sort({ createdAt: -1 }).lean()).map(legacyTemplate));
}

async function createTemplate(req, res) {
  const doc = await Template.create({
    workspaceId: req.auth.workspaceId,
    name: required(req.body.name, "Template name", 150),
    html: String(req.body.html || ""),
    css: String(req.body.css || ""),
  });
  res.json(legacyTemplate(doc));
}

async function updateTemplate(req, res) {
  const doc = await Template.findOneAndUpdate(
    owned(req),
    { $set: {
      html: String(req.body.html || ""),
      css: String(req.body.css || ""),
      ...(req.body.name !== undefined ? { name: required(req.body.name, "Template name", 150) } : {}),
    } },
    { new: true, runValidators: true }
  );
  if (!doc) throw new HttpError(404, "Template not found");
  res.json(legacyTemplate(doc));
}

async function duplicateTemplate(req, res) {
  const original = await Template.findOne(owned(req));
  if (!original) throw new HttpError(404, "Template not found");
  const doc = await Template.create({
    workspaceId: req.auth.workspaceId,
    name: req.body.name ? required(req.body.name, "Name", 150) : `${original.name}-copy`,
    html: original.html,
    css: original.css,
  });
  res.json(legacyTemplate(doc));
}

async function deleteTemplate(req, res) {
  const doc = await Template.findOneAndDelete(owned(req));
  if (!doc) throw new HttpError(404, "Template not found");
  res.json({ message: "Template deleted" });
}

async function renameTemplate(req, res) {
  const doc = await Template.findOneAndUpdate(
    owned(req),
    { $set: { name: required(req.body.name, "Name", 150) } },
    { new: true, runValidators: true }
  );
  if (!doc) throw new HttpError(404, "Template not found");
  res.json(legacyTemplate(doc));
}

// Keep template responses compatible with the frontend.
function legacyTemplate(doc) {
  return {
    _id: doc._id,
    name: doc.name,
    html: doc.html,
    css: doc.css,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}


// Email images are public assets with unguessable names, not authenticated API downloads.
const imageDirectory = path.join(__dirname, "../../uploads/template-images");
const imageTypes = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

async function uploadImage(req, res) {
  try {
    if (!req.file) throw new HttpError(400, "Choose an image to upload");
    const bytes = await fs.readFile(req.file.path);
    const extension = imageExtension(bytes);
    if (!extension) throw new HttpError(400, "Choose a PNG, JPG, GIF, or WebP image");
    let origin;
    try { origin = new URL(process.env.PUBLIC_API_URL || ""); } catch {
      throw new HttpError(503, "The public image URL is not configured");
    }
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
      throw new HttpError(503, "The public image URL must use HTTP or HTTPS");
    }
    const filename = crypto.randomUUID() + "." + extension;
    await fs.mkdir(imageDirectory, { recursive: true });
    await fs.rename(req.file.path, path.join(imageDirectory, filename));
    const base = process.env.PUBLIC_API_URL.replace(/\/+$/, "");
    res.status(201).json({ url: base + "/api/template-images/" + filename });
  } finally {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
  }
}

async function getImage(req, res, next) {
  const filename = req.params.filename;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|gif|webp)$/.test(filename)) {
    throw new HttpError(404, "Image not found");
  }
  const extension = filename.split(".").pop();
  res.set({ "Content-Type": imageTypes[extension], "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" });
  res.sendFile(path.join(imageDirectory, filename), error => {
    if (error && !res.headersSent) next(new HttpError(error.status === 404 ? 404 : 500, "Image could not be loaded"));
  });
}

module.exports = handlers({
  uploadImage,
  getImage,
  searchTemplates,
  listTemplates: searchTemplates,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  deleteTemplate,
  renameTemplate,
});

