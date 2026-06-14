const express = require("express");
const webhookController = require("./webhook.controller");

const router = express.Router();

// Webhook endpoint needs the raw body for Svix body verification
router.post(
  "/clerk",
  express.raw({ type: "application/json" }),
  webhookController.handleClerkWebhook,
);

module.exports = router;
