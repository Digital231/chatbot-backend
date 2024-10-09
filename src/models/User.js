// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Define memory item schema
const memoryItemSchema = new mongoose.Schema({
  content: String,
  isPositive: Boolean,
  context: {
    timestamp: Date,
    messageLength: Number,
    timeOfDay: String,
  },
});

// Define User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  shortTermMemory: [
    {
      sender: String,
      text: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  longTermMemory: {
    preferences: [memoryItemSchema],
    facts: [memoryItemSchema],
    relationships: [memoryItemSchema], // Added relationships
    personality: String, // Kept as is
  },
});

// Middleware to hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Method to match password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Migration helper method
userSchema.methods.migrateMemories = async function () {
  // Migrate each memory type
  for (const type of ["preferences", "facts"]) {
    if (Array.isArray(this.longTermMemory[type])) {
      this.longTermMemory[type] = this.longTermMemory[type].map((item) => {
        if (typeof item === "string") {
          return {
            content: item,
            isPositive: true, // default value
            context: {
              timestamp: new Date(),
              messageLength: item.split(" ").length,
              timeOfDay:
                new Date().getHours() < 12
                  ? "rytas"
                  : new Date().getHours() < 18
                  ? "diena"
                  : "vakaras",
            },
          };
        }
        return item; // if it's already in the correct format
      });
    }
  }
};

const User = mongoose.model("User", userSchema);

module.exports = User;
