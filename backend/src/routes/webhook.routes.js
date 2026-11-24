const express = require("express");
const controller = require("../controller/sendgrid.controller");
const router = express.Router();

// Mount before express.json: verification requires the exact signed bytes.
router.post("/sendgrid", express.raw({ type: "application/json", limit: "2mb", inflate: false }), controller.receiveEvents);

module.exports = router;
