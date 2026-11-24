const mongoose = require("mongoose");
const models = {
  Workspace: require("../models/workspace.model"),
  User: require("../models/user.model"),
  Contact: require("../models/contact.model"),
  ContactList: require("../models/contactList.model"),
  ListMembership: require("../models/listMembership.model"),
  Template: require("../models/template.model"),
  Campaign: require("../models/campaign.model"),
  CampaignRecipient: require("../models/campaignRecipient.model"),
  CampaignEvent: require("../models/campaignEvent.model"),
  Suppression: require("../models/suppression.model"),
};

async function connectDatabase() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  require("./local-safety").assertLocalDatabase(process.env.MONGO_URI);
  const shared = require("./local-safety").usingSharedDatabaseLocally();
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000, autoIndex: !shared, autoCreate: !shared,
  });
  // Shared production data uses its existing collections/indexes; local startup must not migrate them.
  if (!shared) for (const model of Object.values(models)) await model.init();
}

module.exports = { connectDatabase };
