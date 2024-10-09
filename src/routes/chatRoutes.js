// src/routes/chatRoutes.js
const express = require("express");
const router = express.Router();
const {
  sendMessage,
  startConversation,
} = require("../controllers/chatController");

// This will handle POST requests to /api/chat
router.post("/", sendMessage);
router.post("/start-conversation", startConversation);

module.exports = router;
