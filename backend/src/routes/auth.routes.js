const express = require("express");
const controller = require("../controller/auth.controller");
const { authenticate } = require("../middleware/auth");
const router = express.Router();
router.post("/login", controller.login);
router.post("/signup", controller.signup);
router.post("/logout", authenticate, controller.logout);
router.get("/me", authenticate, controller.me);

module.exports = router;
