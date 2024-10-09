const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  updateShortTermMemory,
  updateLongTermMemory,
  retrieveRelevantMemories,
} = require("../utils/memoryUtils");
const User = require("../models/User");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Global rules for every AI response
const GLOBAL_RULES = `
  Speak Lithuanian language only, refuse to speak any other language.
  Answer short and simple like a friend.
  Keep conversation alive and intereseting, but don't push it too much.
`;

// Define an array of prompt templates
const prompts = [
  `Username: {username}, asking: "{message}". Answer short and in a funny style. Keep conversation alive.`,
  `User {username} says: "{message}". Reply humorously, keep it light and fun.`,
  `{username} has a question: "{message}". Make the answer funny, keep it brief and entertaining.`,
  `Here's what {username} asked: "{message}". Give a funny and witty reply, don't make it too long.`,
];

exports.sendMessage = async (req, res) => {
  try {
    const { message, username } = req.body;
    if (!message || !username) {
      return res
        .status(400)
        .json({ error: "Būtina nurodyti žinutę ir vartotojo vardą." });
    }

    // Retrieve the user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: "Vartotojas nerastas" });
    }

    // Update memories
    const extractedMemories = await updateLongTermMemory(user._id, message);
    const relevantMemories = await retrieveRelevantMemories(user._id, message);

    // Create context for AI response
    const memoryContext = Object.entries(relevantMemories)
      .filter(([_, memories]) => memories.length > 0)
      .map(([type, memories]) => {
        return `${type.toUpperCase()}: ${memories
          .map((m) => `${m.isPositive ? "Patinka" : "Nepatinka"}: ${m.content}`)
          .join(", ")}`;
      })
      .join("\n");

    // Select a random prompt and personalize it
    const randomPromptTemplate =
      prompts[Math.floor(Math.random() * prompts.length)];
    const personalizedPrompt = randomPromptTemplate
      .replace("{username}", username)
      .replace("{message}", message);

    // Combine all context for AI
    const prompt = `
${GLOBAL_RULES}
VARTOTOJO KONTEKSTAS:
${memoryContext}

POKALBIO ISTORIJA:
${user.shortTermMemory
  .map(
    (entry) => `${entry.sender === "user" ? "Vartotojas" : "AI"}: ${entry.text}`
  )
  .join("\n")}

${personalizedPrompt}
    `.trim();

    // Generate response
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Update short-term memory with AI response
    user.shortTermMemory.push({ sender: "AI", text: response });
    if (user.shortTermMemory.length > 5) {
      user.shortTermMemory.shift();
    }
    await user.save();

    res.json({ response, extractedMemories, relevantMemories });
  } catch (error) {
    console.error("Klaida:", error);
    res.status(500).json({ error: "Nepavyko gauti atsakymo iš AI" });
  }
};

exports.startConversation = async (req, res) => {
  try {
    const { mood, username } = req.body;

    if (!username || !mood) {
      return res.status(400).json({ error: "Username and mood are required." });
    }

    // Find the user by username first
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = user._id; // Get the ObjectId of the user

    // Create a mood-specific prompt
    let moodPrompt = "";
    if (mood === "happy") {
      moodPrompt = `${username} is feeling really good today. Greet them with positivity and ask how you can contribute to their great day!`;
    } else if (mood === "sad") {
      moodPrompt = `${username} is feeling a bit sad today. Greet them warmly and offer friendly support to lift their spirits.`;
    } else if (mood === "normal") {
      moodPrompt = `${username} is feeling normal today. Greet them and ask how you can assist!`;
    }

    // Combine global rules with mood-specific prompt
    const prompt = `${GLOBAL_RULES} ${moodPrompt}`;

    // Initialize the model
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Generate response
    const result = await model.generateContent(prompt, {
      maxTokens: 50,
    });
    const initialMessage = result.response.text();

    // Update short-term memory with AI response using ObjectId
    await updateShortTermMemory(userId, { sender: "AI", text: initialMessage });

    res.json({ initialMessage });
  } catch (error) {
    console.error("Error generating initial message:", error);
    res.status(500).json({ error: "Failed to generate initial message." });
  }
};
