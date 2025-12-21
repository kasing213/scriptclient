const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

console.log('🧪 Bot Connection Test');
console.log('=====================');

// Check environment variables
console.log('\n📋 Environment Variables:');
console.log('TELEGRAM_TOKEN:', process.env.TELEGRAM_TOKEN ? '✅ Set' : '❌ Missing');
console.log('MONGO_URL:', process.env.MONGO_URL ? '✅ Set' : '❌ Missing');
console.log('DB_NAME:', process.env.DB_NAME ? '✅ Set' : '❌ Missing');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');

if (!process.env.TELEGRAM_TOKEN) {
  console.error('\n❌ TELEGRAM_TOKEN is missing! Please check your .env file');
  process.exit(1);
}

// Test bot connection
async function testBot() {
  try {
    console.log('\n🔗 Testing bot connection...');
    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
    
    const botInfo = await bot.getMe();
    console.log('✅ Bot connected successfully!');
    console.log('Bot Username:', botInfo.username);
    console.log('Bot Name:', botInfo.first_name);
    console.log('Bot ID:', botInfo.id);
    
    // Test sending a message to yourself (if you have your chat ID)
    if (process.env.TEST_CHAT_ID) {
      console.log('\n📤 Testing message sending...');
      await bot.sendMessage(process.env.TEST_CHAT_ID, '🧪 Bot test message - If you see this, your bot is working!');
      console.log('✅ Test message sent successfully!');
    } else {
      console.log('\n💡 To test message sending, add TEST_CHAT_ID to your .env file');
    }
    
  } catch (error) {
    console.error('\n❌ Bot connection failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

testBot(); 