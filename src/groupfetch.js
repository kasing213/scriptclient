const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME;

// Validate required environment variables
if (!TELEGRAM_TOKEN) {
  console.error('❌ TELEGRAM_TOKEN is required in .env file');
  process.exit(1);
}
if (!MONGO_URL) {
  console.error('❌ MONGO_URL is required in .env file');
  process.exit(1);
}
if (!DB_NAME) {
  console.error('❌ DB_NAME is required in .env file');
  process.exit(1);
}

const app = express();
app.use(bodyParser.json());

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per minute
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const bot = new TelegramBot(TELEGRAM_TOKEN);
const client = new MongoClient(MONGO_URL, {
  tls: true,
  tlsAllowInvalidCertificates: true, // Only for development/testing!
});

let collection;

async function startDB() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    collection = db.collection('groupMessages');
    console.log('✅ MongoDB connected to groupMessages');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('Error details:', { code: error.code, name: error.name });
    process.exit(1);
  }
}
startDB();

// Only handle group/supergroup messages on this path
const webhookPath = `/groupbot${TELEGRAM_TOKEN}`;
app.post(webhookPath, webhookLimiter, async (req, res) => {
  const update = req.body;
  // Uncomment to debug: console.log("🔵 Raw update:", JSON.stringify(update, null, 2));

  const message = update.message;
  if (!message) return res.sendStatus(200);

  const chatType = message.chat.type;
  if (chatType !== 'group' && chatType !== 'supergroup') {
    // Ignore non-group messages
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || null;
  const timestamp = new Date();
  const uniqueId = uuidv4();

  try {
    const record = {
      _id: uniqueId,
      chatId,
      chatType,
      userId,
      text,
      timestamp,
    };
    await collection.insertOne(record);
    await bot.sendMessage(chatId, `✅ Message saved.\nFrom user: ${userId}`);
  } catch (error) {
    console.error('❌ Error processing group message:', error.message);
    console.error('Error details:', { code: error.code, name: error.name });
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 groupfetch.js running on port ${PORT}`);

  // Webhook URL must be configured in .env
  const webhookBaseURL = process.env.WEBHOOK_BASE_URL;

  if (webhookBaseURL) {
    const webhookURL = `${webhookBaseURL}${webhookPath}`;
    try {
      await bot.setWebHook(webhookURL);
      console.log(`🔗 Webhook set successfully: ${webhookURL}`);
    } catch (err) {
      console.error('❌ Failed to set webhook:', err.message);
    }
  } else {
    console.log('⚠️ WEBHOOK_BASE_URL not set in .env - webhook not configured');
    console.log('💡 Set WEBHOOK_BASE_URL=https://your-domain.com in .env to enable webhook');
  }
});
