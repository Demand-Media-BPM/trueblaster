const { authenticate } = require("../middleware/auth");
const authRoutes = require("./auth.routes");
const contactRoutes = require("./contact.routes");
const campaignRoutes = require("./campaign.routes");
const templateRoutes = require("./template.routes");
const blocklistRoutes = require("./blocklist.routes");
const unsubscribeRoutes = require("./unsubscribe.routes");

function registerRoutes(app) {
  app.use(authRoutes);
  app.use("/api/contact", authenticate, contactRoutes);
  app.use("/api/campaign", campaignRoutes);
  app.use("/api/template-images", templateRoutes.images);
  app.use("/api/preview", authenticate, templateRoutes);
  app.use("/api/blocklist", authenticate, blocklistRoutes);
  app.use("/api/unsubscribelist", authenticate, unsubscribeRoutes);
}

module.exports = registerRoutes;
