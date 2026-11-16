const mongoose = require("mongoose");

// ListMembership documents retain their existing collection and indexes.
const listMembershipSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    listId: { type: mongoose.Schema.Types.ObjectId, ref: "ContactList", required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true },
  },
  { timestamps: true, collection: "list_memberships" }
);

listMembershipSchema.index({ workspaceId: 1, listId: 1, contactId: 1 }, { unique: true });
listMembershipSchema.index({ workspaceId: 1, contactId: 1 });

module.exports = mongoose.model("ListMembership", listMembershipSchema);
