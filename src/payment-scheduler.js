/**
 * Payment Reminder Scheduler
 *
 * Automated scheduler for sending payment reminders:
 * - PENDING payments: 5-day warning to pay full amount
 * - UNPAID payments: Immediate notification
 *
 * Usage: node src/payment-scheduler.js
 */

const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
require('dotenv').config();

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME;
const MONGO_URL_INVOICE = process.env.MONGO_URL_INVOICE || MONGO_URL;
const DB_NAME_INVOICE = process.env.DB_NAME_INVOICE || 'invoiceDB';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Reminder settings
const PENDING_WARNING_DAYS = parseInt(process.env.PENDING_WARNING_DAYS) || 5;
const CHECK_INTERVAL_HOURS = parseInt(process.env.CHECK_INTERVAL_HOURS) || 24;

// Initialize clients
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const client = new MongoClient(MONGO_URL, {
  tls: true,
  tlsAllowInvalidCertificates: true,
});

const invoiceClient = new MongoClient(MONGO_URL_INVOICE, {
  tls: true,
  tlsAllowInvalidCertificates: true,
});

let paymentsCollection;
let excelReadingsCollection;
let remindersCollection;

// ==== AI Message Generator ====
async function generatePaymentReminder(paymentStatus, customerName, amount, daysOverdue) {
  const prompt = paymentStatus === 'UNPAID'
    ? `Generate a polite but firm payment reminder message in Khmer for a customer named ${customerName} who has an UNPAID bill of ${amount} KHR. Keep it professional and concise (2-3 sentences).`
    : `Generate a friendly reminder message in Khmer for a customer named ${customerName} who has a PENDING payment of ${amount} KHR for ${daysOverdue} days. Remind them to complete the full payment. Keep it polite and brief (2-3 sentences).`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful payment reminder assistant. Generate polite, professional payment reminders in Khmer language.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 200,
      temperature: 0.7
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('❌ AI message generation failed:', error.message);

    // Fallback messages
    if (paymentStatus === 'UNPAID') {
      return `សូមជូនដំណឹង: លោក/លោកស្រី ${customerName} មានវិក័យប័ត្រមិនទាន់បង់ ${amount} រៀល។ សូមបង់ភ្លាមៗ។`;
    } else {
      return `សូមជូនដំណឹង: លោក/លោកស្រី ${customerName} មានការទូទាត់មិនពេញលេញ ${amount} រៀល អស់រយៈពេល ${daysOverdue} ថ្ងៃហើយ។ សូមបង់ពេញលេញ។`;
    }
  }
}

// ==== Check and Send Reminders ====
async function checkAndSendReminders() {
  try {
    console.log('🔍 Checking for payments requiring reminders...\n');

    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - (PENDING_WARNING_DAYS * 24 * 60 * 60 * 1000));

    // Find all pending and unpaid payments
    const paymentsToRemind = await paymentsCollection.find({
      paymentLabel: { $in: ['PENDING', 'UNPAID'] }
    }).toArray();

    console.log(`Found ${paymentsToRemind.length} payment(s) to review\n`);

    for (const payment of paymentsToRemind) {
      const { chatId, paymentLabel, uploadedAt, amountInKHR, fullName, _id } = payment;

      // Check if we already sent a reminder recently
      const recentReminder = await remindersCollection.findOne({
        paymentId: _id,
        sentAt: { $gte: new Date(now.getTime() - (24 * 60 * 60 * 1000)) }
      });

      if (recentReminder) {
        console.log(`⏭️  Skipping ${paymentLabel} - Reminder already sent today for ${fullName}`);
        continue;
      }

      // Get customer details from excelreadings
      const customerBill = await excelReadingsCollection.findOne({ chatId });
      const customerName = customerBill?.customer || fullName;
      const expectedAmount = customerBill?.amount || amountInKHR;

      let shouldSendReminder = false;
      let reminderType = '';

      if (paymentLabel === 'UNPAID') {
        shouldSendReminder = true;
        reminderType = 'UNPAID';
      } else if (paymentLabel === 'PENDING' && uploadedAt < fiveDaysAgo) {
        shouldSendReminder = true;
        reminderType = 'PENDING_OVERDUE';
      }

      if (shouldSendReminder) {
        const daysOverdue = Math.floor((now - uploadedAt) / (1000 * 60 * 60 * 24));

        // Generate AI message
        const message = await generatePaymentReminder(
          paymentLabel,
          customerName,
          expectedAmount,
          daysOverdue
        );

        // Send message via Telegram
        try {
          await bot.sendMessage(chatId, message);

          const statusIcon = paymentLabel === 'UNPAID' ? '❌' : '⏳';
          console.log(`${statusIcon} ${paymentLabel} | Sent to ${customerName} (${chatId}) | ${daysOverdue}d overdue`);

          // Log reminder in database
          await remindersCollection.insertOne({
            paymentId: _id,
            chatId,
            paymentLabel,
            customerName,
            amount: expectedAmount,
            daysOverdue,
            message,
            sentAt: now,
            reminderType
          });

        } catch (sendError) {
          console.error(`❌ Failed to send reminder to ${chatId}:`, sendError.message);
        }

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('\n✅ Reminder check completed');
  } catch (error) {
    console.error('❌ Error checking reminders:', error.message);
  }
}

// ==== Database Connection ====
async function connectDB() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    paymentsCollection = db.collection('payments');
    remindersCollection = db.collection('reminders');
    console.log('✅ Connected to customerDB');

    await invoiceClient.connect();
    const invoiceDB = invoiceClient.db(DB_NAME_INVOICE);
    excelReadingsCollection = invoiceDB.collection('excelreadings');
    console.log('✅ Connected to invoiceDB\n');

  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

// ==== Main Scheduler ====
async function main() {
  console.log('🤖 Payment Reminder Scheduler Started\n');
  console.log(`⏰ Checking every ${CHECK_INTERVAL_HOURS} hours`);
  console.log(`⚠️  PENDING payment warning: ${PENDING_WARNING_DAYS} days\n`);

  await connectDB();

  // Run immediately on start
  await checkAndSendReminders();

  // Schedule recurring checks
  const intervalMs = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(async () => {
    console.log(`\n⏰ [${new Date().toLocaleString()}] Running scheduled reminder check...\n`);
    await checkAndSendReminders();
  }, intervalMs);

  console.log(`\n🎯 Scheduler is running. Next check in ${CHECK_INTERVAL_HOURS} hour(s)...`);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down scheduler...');
  await client.close();
  await invoiceClient.close();
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Scheduler failed:', error);
    process.exit(1);
  });
}

module.exports = { checkAndSendReminders, generatePaymentReminder };
