const mongoose = require("mongoose");

// ContactList documents retain their existing collection and indexes.
const contactListSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
  },
  { timestamps: true, collection: "contact_lists" }
);

contactListSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("ContactList", contactListSchema);
