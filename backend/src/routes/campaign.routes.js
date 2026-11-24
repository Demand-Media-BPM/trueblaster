const { authenticate } = require("../middleware/auth");
const express = require("express");
const controller = require("../controller/campaign.controller");

const tracking = require("../controller/tracking.controller");
const webhook = require("../controller/webhook.controller");
const mail = require("../controller/mail.controller");

const router = express.Router();

router.get("/track-pixel", tracking.trackPixel);
router.get("/track-click", tracking.trackClick);
router.post("/send-campaign", authenticate, controller.sendCampaign);
router.get("/send-campaign-progress", authenticate, controller.getCampaignProgress);
router.post("/mark-bounce", authenticate, controller.markBounce);
router.post("/ses-webhook", express.text({ type: "*/*" }), webhook.handleSesWebhook);
router.get("/campaign-analytics", authenticate, controller.getCampaignAnalytics);
router.get("/campaign-details", authenticate, controller.getCampaignDetails);
router.get("/campaign-ids", authenticate, controller.listCampaignIds);
router.get("/contact-lists", authenticate, controller.listContactLists);
router.get("/track-unsubscribe", tracking.trackUnsubscribe);
router.post("/track-unsubscribe", express.urlencoded({ extended: false, limit: "2kb" }), tracking.trackUnsubscribe);
router.post("/send-test-mail", authenticate, mail.sendTestMail);
router.get("/campaign-csv", authenticate, controller.exportCampaignCsv);

module.exports = router;
