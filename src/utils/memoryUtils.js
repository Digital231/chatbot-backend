const User = require("../models/User");
const mongoose = require("mongoose");
const { ObjectId } = mongoose.Types;

// Enhanced keywords for better extraction in Lithuanian
const MEMORY_PATTERNS = {
  preferences: {
    keywords: [
      "myliu",
      "patinka",
      "dievinu",
      "mėgstu",
      "teikiu pirmenybę",
      "favoritas",
      "nekenčiu",
      "nepatinka",
    ],
    negativeKeywords: ["ne", "niekada", "nenoriu"],
    patterns: [
      /(?:mano favoritas|aš teikiu pirmenybę) (.+)/i,
      /(?:man )?(?:labai )?(?:patinka|mėgstu) (.+)/i,
      /aš (?:labai )?(?:nekenčiu|nemėgstu) (.+)/i,
      /man nepatinka (.+)/i,
    ],
  },
  facts: {
    patterns: [
      /Aš (?:esu iš|gyvenu) (.+)/i,
      /Mano (?:amžius|vardas) (?:yra)? (.+)/i,
      /Aš dirbu (?:kaip)? (.+)/i,
      /Aš turiu (.+)/i,
    ],
  },
  relationships: {
    patterns: [
      /Mano (?:brolis|sesuo|mama|tėtis|partneris|draugas) (?:yra|buvo) (.+)/i,
    ],
  },
};

// Sentiment analysis helper
const analyzeSentiment = (message, pattern, negativeKeywords) => {
  const hasNegation = negativeKeywords.some((keyword) =>
    message.toLowerCase().includes(keyword)
  );
  return {
    isPositive: !hasNegation,
    content: pattern,
  };
};

// Enhanced context extraction
const extractContext = (message) => {
  const timestamp = new Date();
  const words = message.split(" ").length;
  return {
    timestamp,
    messageLength: words,
    timeOfDay:
      timestamp.getHours() < 12
        ? "rytas"
        : timestamp.getHours() < 18
        ? "diena"
        : "vakaras",
  };
};

const updateShortTermMemory = async (userId, newMessage) => {
  try {
    // Check if the userId is a valid ObjectId
    if (!ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID format");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Add the new message to the short-term memory
    user.shortTermMemory.push(newMessage);

    // Keep only the last 3 messages
    if (user.shortTermMemory.length > 3) {
      user.shortTermMemory.shift(); // Remove the oldest message
    }

    await user.save();
  } catch (error) {
    console.error("Error updating short-term memory:", error);
  }
};

const updateLongTermMemory = async (userId, userMessage) => {
  try {
    // Check if the userId is a valid ObjectId
    if (!ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID format");
    }

    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    // (Remaining code for updating long-term memory...)
    const context = extractContext(userMessage);
    const extractedMemories = {
      preferences: [],
      facts: [],
      relationships: [],
    };

    for (const [type, config] of Object.entries(MEMORY_PATTERNS)) {
      for (const pattern of config.patterns) {
        const match = userMessage.match(pattern);
        if (match) {
          if (type === "preferences") {
            const sentiment = analyzeSentiment(
              userMessage,
              match[1],
              config.negativeKeywords || []
            );
            extractedMemories[type].push({
              content: sentiment.content,
              isPositive: sentiment.isPositive,
              context,
            });
          } else {
            extractedMemories[type].push({
              content: match[1],
              context,
            });
          }
        }
      }
    }

    for (const [type, memories] of Object.entries(extractedMemories)) {
      if (memories.length > 0) {
        user.longTermMemory[type] = [
          ...(user.longTermMemory[type] || []),
          ...memories,
        ].filter(
          (memory, index, self) =>
            index === self.findIndex((m) => m.content === memory.content)
        );
      }
    }

    const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;
    for (const type of Object.keys(user.longTermMemory)) {
      if (Array.isArray(user.longTermMemory[type])) {
        user.longTermMemory[type] = user.longTermMemory[type].filter(
          (memory) =>
            new Date() - new Date(memory.context.timestamp) < ONE_MONTH
        );
      }
    }

    await user.save();
    return extractedMemories;
  } catch (error) {
    console.error("Error updating long-term memory:", error);
    throw error;
  }
};

const retrieveRelevantMemories = async (userId, currentMessage) => {
  try {
    // Check if the userId is a valid ObjectId
    if (!ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID format");
    }

    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const relevantMemories = {
      preferences: [],
      facts: [],
      relationships: [],
    };

    for (const [type, memories] of Object.entries(user.longTermMemory)) {
      if (Array.isArray(memories)) {
        relevantMemories[type] = memories
          .filter((memory) =>
            currentMessage.toLowerCase().includes(memory.content.toLowerCase())
          )
          .sort(
            (a, b) =>
              new Date(b.context.timestamp) - new Date(a.context.timestamp)
          );
      }
    }

    return relevantMemories;
  } catch (error) {
    console.error("Error retrieving relevant memories:", error);
    throw error;
  }
};

module.exports = {
  updateLongTermMemory,
  retrieveRelevantMemories,
  updateShortTermMemory,
};
