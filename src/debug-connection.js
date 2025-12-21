const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');
require('dotenv').config();

console.log('🔍 Telegram Connection Debug');
console.log('==========================');

// Check environment
console.log('\n📋 Environment Check:');
console.log('TELEGRAM_TOKEN:', process.env.TELEGRAM_TOKEN ? '✅ Set' : '❌ Missing');
console.log('Token length:', process.env.TELEGRAM_TOKEN ? process.env.TELEGRAM_TOKEN.length : 0);

if (!process.env.TELEGRAM_TOKEN) {
  console.error('❌ TELEGRAM_TOKEN is missing!');
  process.exit(1);
}

// Test basic internet connectivity
console.log('\n🌐 Testing internet connectivity...');
https.get('https://api.telegram.org', (res) => {
  console.log('✅ Telegram API is reachable');
  console.log('Status:', res.statusCode);
}).on('error', (err) => {
  console.error('❌ Cannot reach Telegram API:', err.message);
});

// Test DNS resolution
console.log('\n🔍 Testing DNS resolution...');
const dns = require('dns');
dns.resolve('api.telegram.org', (err, addresses) => {
  if (err) {
    console.error('❌ DNS resolution failed:', err.message);
  } else {
    console.log('✅ DNS resolution successful:', addresses);
  }
});

// Test bot token format
console.log('\n🔑 Testing bot token format...');
const token = process.env.TELEGRAM_TOKEN;
if (token && token.includes(':')) {
  const parts = token.split(':');
  if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
    console.log('✅ Token format looks correct');
    console.log('Bot ID:', parts[0]);
  } else {
    console.error('❌ Token format is invalid');
  }
} else {
  console.error('❌ Token format is invalid (should be "BOT_ID:BOT_TOKEN")');
}

// Test direct API call
async function testDirectAPI() {
  console.log('\n📡 Testing direct API call...');
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();
    
    if (data.ok) {
      console.log('✅ Direct API call successful');
      console.log('Bot info:', data.result);
    } else {
      console.error('❌ API call failed:', data);
    }
  } catch (error) {
    console.error('❌ Direct API call error:', error.message);
  }
}

// Test bot library with different options
async function testBotLibrary() {
  console.log('\n🤖 Testing bot library connection...');
  
  const options = [
    { polling: false },
    { polling: false, request: { timeout: 10000 } },
    { polling: false, request: { proxy: null } },
    { polling: false, request: { timeout: 30000 } }
  ];

  for (let i = 0; i < options.length; i++) {
    console.log(`\n--- Test ${i + 1} with options:`, options[i]);
    try {
      const bot = new TelegramBot(token, options[i]);
      const botInfo = await bot.getMe();
      console.log('✅ Connection successful:', botInfo.username);
      break;
    } catch (error) {
      console.error(`❌ Test ${i + 1} failed:`, error.message);
      if (error.name === 'AggregateError') {
        console.error('AggregateError details:', error.errors);
      }
    }
  }
}

// Run tests
async function runTests() {
  await testDirectAPI();
  await testBotLibrary();
  
  console.log('\n📊 Summary:');
  console.log('If you see AggregateError, it usually means:');
  console.log('1. Network connectivity issues');
  console.log('2. Firewall blocking connections');
  console.log('3. DNS resolution problems');
  console.log('4. Invalid bot token');
  console.log('5. Rate limiting from Telegram');
}

runTests(); 