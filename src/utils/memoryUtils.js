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
      "labai mėgstu",
      "negaliu pakęsti",
      "esate puikus",
    ],
    negativeKeywords: [
      "ne",
      "niekada",
      "nenoriu",
      "nemėgstu",
      "nekenčiu",
      "nepatinka",
    ],
    patterns: [
      /(?:mano favoritas|aš teikiu pirmenybę|mano pasirinkimas yra) (.+)/i,
      /(?:man )?(?:labai )?(?:patinka|mėgstu|dievinu|esu didelis gerbėjas|esate nuostabūs|esate puikus|esate mano favoritas) (.+)/i,
      /aš (?:absoliučiai )?(?:myliu|dievinau|nekenčiu|nemėgstu|niekada nemėgčiau) (.+)/i,
      /man (?:visiškai )?nepatinka (.+)/i,
      /negalėčiau įsivaizduoti gyvenimo be (.+)/i,
      /mano mėgstamiausias dalykas yra (.+)/i,
      /negaliu pakęsti (.+)/i,
      /aš norėčiau daugiau (.+)/i,
    ],
  },
  facts: {
    patterns: [
      /Aš (?:esu iš|gyvenu|šiuo metu esu) (.+)/i,
      /Mano (?:amžius|vardas|gimtadienis) (?:yra)? (.+)/i,
      /Aš dirbu (?:kaip|pagal profesiją) (.+)/i,
      /Aš turiu (.+)/i,
      /Mano mėgstamiausia spalva (?:yra)? (.+)/i,
      /Man patinka (.+)/i,
      /Mano hobis (?:yra|yra hobis) (.+)/i,
      /Aš užsiimu (.+)/i,
    ],
  },
  relationships: {
    patterns: [
      /Mano (?:brolis|sesuo|mama|tėtis|partneris|draugas|kolegė|žmona|vyras) (?:yra|buvo)? ?(.+)/i,
      /Mano (?:brolis|sesuo|mama|tėtis|partneris|draugas|kolega|šeimos narys) (?:vardu)? (.+)/i,
      /(?:Turiu|Yra) (?:brolį|seserį|mamą|tėtį|partnerį|draugą|kolegos) (?:vardu )?(.+)/i,
      /mano artimas žmogus (?:yra|vardu) (.+)/i,
      /mano draugas (?:yra|vardu)? (.+)/i,
      /mano komandos narys (?:yra)? (.+)/i,
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

const testMemoryPatterns = (message) => {
  const results = {};

  for (const [type, config] of Object.entries(MEMORY_PATTERNS)) {
    results[type] = [];
    for (const pattern of config.patterns) {
      const match = message.match(pattern);
      if (match) {
        results[type].push({
          pattern: pattern.toString(),
          matched: match[0],
          captured: match[1],
        });
      }
    }
  }

  return results;
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

// Modified updateLongTermMemory function
const updateLongTermMemory = async (userId, userMessage) => {
  try {
    // Validate userId format
    if (!ObjectId.isValid(userId)) {
      throw new Error("Invalid user ID format");
    }

    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const context = extractContext(userMessage);
    const extractedMemories = {
      preferences: [],
      facts: [],
      relationships: [],
    };

    // Log for debugging
    // console.log("Processing message:", userMessage);

    // Pattern matching logic
    for (const [type, config] of Object.entries(MEMORY_PATTERNS)) {
      for (const pattern of config.patterns) {
        const match = userMessage.match(pattern);
        if (match) {
          // console.log(`Matched ${type} pattern:`, pattern.toString());
          // console.log("Captured content:", match[1]);

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
              content: match[1].trim(),
              context,
            });
          }
        }
      }
    }

    // Log extracted memories before saving
    // console.log(
    //   "Extracted memories:",
    //   JSON.stringify(extractedMemories, null, 2)
    // );

    // Updated memory saving logic
    for (const [type, memories] of Object.entries(extractedMemories)) {
      if (memories.length > 0) {
        // Initialize the array if it doesn't exist
        if (!user.longTermMemory[type]) {
          user.longTermMemory[type] = [];
        }

        // Add new memories
        user.longTermMemory[type] = [...user.longTermMemory[type], ...memories];

        // Remove duplicates based on content
        user.longTermMemory[type] = user.longTermMemory[type].filter(
          (memory, index, self) =>
            index === self.findIndex((m) => m.content === memory.content)
        );
      }
    }

    await user.migrateMemories(); // Migrate any old format memories
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
  testMemoryPatterns,
  MEMORY_PATTERNS,
};
