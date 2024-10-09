const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  updateShortTermMemory,
  updateLongTermMemory,
  retrieveRelevantMemories,
} = require("../utils/memoryUtils");
const User = require("../models/User");
const slangDictionary = require("../utils/slengas.json");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Global rules for every AI response
const GLOBAL_RULES = `
  Speak Lithuanian language only, refuse to speak any other language.
  Answer short and simple like a friend.
  Keep conversation alive and interesting, but don't push it too much.
`;

// Define an array of prompt templates
const prompts = [
  `Username: {username}, asking: "{message}". Answer short and in a funny style. Keep conversation alive.`,
  `User {username} says: "{message}". Reply humorously, keep it light and fun.`,
  `{username} has a question: "{message}". Make the answer funny, keep it brief and entertaining.`,
  `Here's what {username} asked: "{message}". Give a funny and witty reply, don't make it too long.`,
];

const roastPrompts = [
  `User {username} says: "{message}". Respond with a witty and sarcastic comment, keep it light-hearted.`,
  `{username} asked: "{message}". Give a clever, playful roast but don't make it mean.`,
  `Here's what {username} asked: "{message}". Tease them gently with a funny comeback.`,
  `{username} says: "{message}". Respond with humor and a hint of sarcasm, keep it entertaining.`,
  `{username} has a question: "{message}". Make the answer sharp and playful, but keep it friendly.`,
  `User {username} says: "{message}". Give a humorous response with a touch of roast, but keep it fun.`,
  `{username} just said: "{message}". Roast them a bit, but in a light and joking manner.`,
  `{username} asks: "{message}". Come back with a funny, sarcastic reply that isn't too harsh.`,
  `{username} says: "{message}". Respond with a clever jab that's still light-hearted and amusing.`,
  `{username} asked: "{message}". Playfully roast them, but keep it friendly and fun.`,
];

// Safety settings configuration
const safetySettings = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

function replaceWithSlang(response) {
  const words = response.split(" ");
  const replacedWords = words.map((word) => {
    // Remove punctuation for accurate matching
    const cleanedWord = word
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
    const slangWord = Object.keys(slangDictionary).find(
      (key) => slangDictionary[key] === cleanedWord
    );

    // If a slang match is found, replace the word; otherwise, keep the original
    return slangWord ? slangWord : word;
  });

  return replacedWords.join(" ");
}

const MAX_RETRIES = 3;

exports.sendMessage = async (req, res) => {
  try {
    const { message, username, mood } = req.body;
    if (!message || !username) {
      return res
        .status(400)
        .json({ error: "Būtina nurodyti žinutę ir vartotojo vardą." });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: "Vartotojas nerastas" });
    }

    const extractedMemories = await updateLongTermMemory(user._id, message);
    const relevantMemories = await retrieveRelevantMemories(user._id, message);
    const memoryContext = createMemoryContext(relevantMemories);

    let response;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const model = genAI.getGenerativeModel({
          model: "gemini-pro",
          safetySettings: safetySettings,
        });

        const promptTemplates = mood === "roast" ? roastPrompts : prompts;
        const randomPromptTemplate =
          promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
        const personalizedPrompt = createPersonalizedPrompt(
          randomPromptTemplate,
          username,
          message,
          user,
          memoryContext
        );

        const result = await model.generateContent(personalizedPrompt);
        response = result.response.text();

        // Replace standard words with slang if available
        response = replaceWithSlang(response);

        break; // If successful, exit the retry loop
      } catch (error) {
        attempt++;
        if (
          error.message.includes("SAFETY") ||
          error.toString().includes("SAFETY")
        ) {
          console.log(
            `Safety block encountered, attempt ${attempt} of ${MAX_RETRIES}`
          );
          if (attempt === MAX_RETRIES) {
            response =
              "Atsiprašau, nesupratau. Gal galėtum perfrazuoti kitaip?";
          }
        } else {
          throw error;
        }
      }
    }

    updateUserShortTermMemory(user, response);
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
    } else if (mood === "roast") {
      moodPrompt = `${username} wants to be roasted today. Give them a witty and sarcastic greeting to set the tone!`;
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

function createMemoryContext(relevantMemories) {
  return Object.entries(relevantMemories)
    .filter(([_, memories]) => memories.length > 0)
    .map(([type, memories]) => {
      return `${type.toUpperCase()}: ${memories
        .map((m) => `${m.isPositive ? "Patinka" : "Nepatinka"}: ${m.content}`)
        .join(", ")}`;
    })
    .join("\n");
}

function createPersonalizedPrompt(
  template,
  username,
  message,
  user,
  memoryContext
) {
  const personalizedTemplate = template
    .replace("{username}", username)
    .replace("{message}", message);

  return `
${GLOBAL_RULES}
VARTOTOJO KONTEKSTAS:
${memoryContext}
POKALBIO ISTORIJA:
${user.shortTermMemory
  .map(
    (entry) => `${entry.sender === "user" ? "Vartotojas" : "AI"}: ${entry.text}`
  )
  .join("\n")}
${personalizedTemplate}
  `.trim();
}

function updateUserShortTermMemory(user, response) {
  user.shortTermMemory.push({ sender: "AI", text: response });
  if (user.shortTermMemory.length > 5) {
    user.shortTermMemory.shift();
  }
}
