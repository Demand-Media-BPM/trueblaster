const Suppression = require("../models/suppression.model");
const { handlers, escapeRegex, HttpError } = require("../middleware/request");
const { profile, legacyContact } = require("./contact.controller");

function controllerFor(reason) {
  const scope = (req) => ({ workspaceId: req.auth.workspaceId, reason });
  return handlers({
    async add(req, res) {
      const data = profile(req.body);
      const doc = await Suppression.findOneAndUpdate(
        { ...scope(req), email: data.email },
        {
          $set: {
            ...data,
            campaignName: String(req.body.CampaignName || req.body.CampaignId || "").slice(0, 150),
          },
          $setOnInsert: scope(req),
        },
        { new: true, upsert: true, runValidators: true }
      );
      res.status(reason === "blocked" ? 201 : 200).json(legacyContact(doc));
    },
    async list(req, res) {
      res.json(
        (await Suppression.find(scope(req)).sort({ createdAt: -1 }).lean()).map(legacyContact)
      );
    },
    async search(req, res) {
      if (!req.query.email) return res.json([]);
      const docs = await Suppression.find({
        ...scope(req),
        email: { $regex: `^${escapeRegex(req.query.email)}`, $options: "i" },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      res.json(docs.map(legacyContact));
    },
    async remove(req, res) {
      const doc = await Suppression.findOneAndDelete({ ...scope(req), _id: req.params.id });
      if (!doc) throw new HttpError(404, "Contact not found");
      res.json({ success: true });
    },
  });
}

module.exports = { blocked: controllerFor("blocked"), unsubscribed: controllerFor("unsubscribed") };
