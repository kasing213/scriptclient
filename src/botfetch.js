'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { OpenAI } = require('openai');
const fs = require('fs');
const https = require('https');
const path = require('path');
const express = require('express');
process.on('unhandledRejection', (r)=>{console.error('UNHANDLED', r?.message, r?.stack)});
process.on('uncaughtException', (e)=>{console.error('UNCAUGHT', e?.message, e?.stack)});

// ---- Express Health Server for Railway/Docker ----
const app = express();
const PORT = process.env.PORT || 3000;
const SCREENSHOT_DOWNLOAD_TOKEN = process.env.SCREENSHOT_DOWNLOAD_TOKEN || null;
const ALLOWED_SCREENSHOT_STATUSES = new Set(['verified', 'rejected', 'pending']);

function getDownloadToken(req) {
  return req.get('x-download-token') || req.query.token;
}

function isDownloadAuthorized(req) {
  return SCREENSHOT_DOWNLOAD_TOKEN && getDownloadToken(req) === SCREENSHOT_DOWNLOAD_TOKEN;
}

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    bot: bot ? 'connected' : 'initializing',
    mongo: collection ? 'connected' : 'initializing'
  };
  res.status(200).json(health);
});

// Status endpoint for monitoring
app.get('/status', async (req, res) => {
  try {
    const stats = {
      bot: {
        status: bot ? 'running' : 'initializing',
        strategy: connectionStrategies[currentStrategy]?.name || 'unknown'
      },
      database: {
        customerDB: collection ? 'connected' : 'disconnected',
        invoiceDB: excelReadingsCollection ? 'connected' : 'disconnected'
      },
      queues: {
        messageQueue: messageQueue.length,
        processing: processing
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Payment Verification Bot',
    version: '1.0.0',
    status: 'running'
  });
});

// Screenshot listing endpoint (protected by SCREENSHOT_DOWNLOAD_TOKEN)
app.get('/screenshots/:status', async (req, res) => {
  if (!SCREENSHOT_DOWNLOAD_TOKEN) {
    return res.status(503).json({ error: 'download_disabled' });
  }

  if (!isDownloadAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const status = req.params.status;
  if (!ALLOWED_SCREENSHOT_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  const statusDir = path.resolve(SCREENSHOT_DIR, status);
  let entries = [];
  try {
    entries = await fs.promises.readdir(statusDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.json({ status, count: 0, files: [] });
    }
    return res.status(500).json({ error: 'list_failed' });
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  return res.json({ status, count: files.length, files });
});

// Screenshot download endpoint (protected by SCREENSHOT_DOWNLOAD_TOKEN)
app.get('/screenshots/:status/:name', async (req, res) => {
  if (!SCREENSHOT_DOWNLOAD_TOKEN) {
    return res.status(503).json({ error: 'download_disabled' });
  }

  if (!isDownloadAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const status = req.params.status;
  if (!ALLOWED_SCREENSHOT_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  const name = req.params.name;
  if (name !== path.basename(name)) {
    return res.status(400).json({ error: 'invalid_name' });
  }

  const statusDir = path.resolve(SCREENSHOT_DIR, status);
  const requestedPath = path.resolve(statusDir, name);
  if (!requestedPath.startsWith(statusDir + path.sep)) {
    return res.status(400).json({ error: 'invalid_path' });
  }

  try {
    await fs.promises.access(requestedPath, fs.constants.R_OK);
  } catch (error) {
    return res.status(404).json({ error: 'not_found' });
  }

  return res.sendFile(requestedPath);
});

// Customer payment status endpoint
app.get('/customer/:chatId/status', async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
      return res.status(400).json({ error: 'Invalid chatId' });
    }

    const customer = await getCustomerStatus(chatId);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all customers with payment status summary
app.get('/customers/summary', async (req, res) => {
  try {
    const status = req.query.status; // Optional filter by status

    let customers;
    if (status) {
      customers = await getCustomersByStatus(status);
    } else {
      customers = await customersCollection.find({}).toArray();
    }

    // Calculate summary statistics
    const summary = {
      total: customers.length,
      fullyPaid: customers.filter(c => c.paymentStatus === 'FULLY_PAID').length,
      partialPaid: customers.filter(c => c.paymentStatus === 'PARTIAL_PAID').length,
      notPaid: customers.filter(c => c.paymentStatus === 'NOT_PAID').length,
      overpaid: customers.filter(c => c.paymentStatus === 'OVERPAID').length,
      totalExpected: customers.reduce((sum, c) => sum + (c.totalExpected || 0), 0),
      totalPaid: customers.reduce((sum, c) => sum + (c.totalPaid || 0), 0),
      totalRemaining: customers.reduce((sum, c) => sum + (c.remainingBalance || 0), 0),
      customers: customers
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get overdue customers (default 3 days)
app.get('/customers/overdue', async (req, res) => {
  try {
    const daysOverdue = parseInt(req.query.days) || 3;
    const customers = await getOverdueCustomers(daysOverdue);

    res.json({
      daysOverdue,
      count: customers.length,
      customers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==== Fraud Detection API Endpoints ====

// Get all fraud alerts (filterable by status and type)
app.get('/fraud/alerts', async (req, res) => {
  try {
    const reviewStatus = req.query.status; // PENDING, CONFIRMED_FRAUD, FALSE_POSITIVE, APPROVED
    const fraudType = req.query.type;      // OLD_SCREENSHOT, INVALID_DATE, FUTURE_DATE, MISSING_DATE

    let query = {};
    if (reviewStatus) query.reviewStatus = reviewStatus;
    if (fraudType) query.fraudType = fraudType;

    const alerts = await fraudAlertsCollection
      .find(query)
      .sort({ detectedAt: -1 })
      .toArray();

    const summary = {
      total: alerts.length,
      pending: alerts.filter(a => a.reviewStatus === 'PENDING').length,
      confirmedFraud: alerts.filter(a => a.reviewStatus === 'CONFIRMED_FRAUD').length,
      falsePositives: alerts.filter(a => a.reviewStatus === 'FALSE_POSITIVE').length,
      approved: alerts.filter(a => a.reviewStatus === 'APPROVED').length,
      alerts: alerts
    };

    res.json(summary);
  } catch (error) {
    console.error('❌ Error fetching fraud alerts:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get fraud alert by ID
app.get('/fraud/alert/:alertId', async (req, res) => {
  try {
    const alert = await fraudAlertsCollection.findOne({
      alertId: req.params.alertId
    });

    if (!alert) {
      return res.status(404).json({ error: 'Fraud alert not found' });
    }

    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Review fraud alert (approve/reject)
app.post('/fraud/alert/:alertId/review', async (req, res) => {
  try {
    const { alertId } = req.params;
    const { reviewStatus, reviewedBy, reviewNotes } = req.body;

    // Validate reviewStatus
    const validStatuses = ['PENDING', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE', 'APPROVED'];
    if (!validStatuses.includes(reviewStatus)) {
      return res.status(400).json({
        error: `Invalid reviewStatus. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const result = await fraudAlertsCollection.updateOne(
      { alertId: alertId },
      {
        $set: {
          reviewStatus: reviewStatus,
          reviewedBy: reviewedBy || 'admin',
          reviewedAt: new Date(),
          reviewNotes: reviewNotes || '',
          resolutionDate: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Fraud alert not found' });
    }

    // If approved as FALSE_POSITIVE, update the payment record
    if (reviewStatus === 'FALSE_POSITIVE' || reviewStatus === 'APPROVED') {
      const alert = await fraudAlertsCollection.findOne({ alertId });

      if (alert.paymentId) {
        await paymentsCollection.updateOne(
          { _id: alert.paymentId },
          {
            $set: {
              paymentLabel: 'PAID',
              verificationStatus: 'verified',
              isVerified: true,
              verificationNotes: `${alert.verificationNotes} | Fraud alert resolved: ${reviewStatus}`
            }
          }
        );

        // Update customer status
        const payment = await paymentsCollection.findOne({ _id: alert.paymentId });
        if (payment) {
          await updateCustomerPaymentStatus(payment.chatId, payment);
        }
      }
    }

    res.json({
      success: true,
      message: `Fraud alert ${alertId} updated to ${reviewStatus}`,
      alertId: alertId
    });
  } catch (error) {
    console.error('❌ Error reviewing fraud alert:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get fraud detection statistics
app.get('/fraud/stats', async (req, res) => {
  try {
    const totalAlerts = await fraudAlertsCollection.countDocuments({});
    const pendingReview = await fraudAlertsCollection.countDocuments({ reviewStatus: 'PENDING' });

    // Group by fraud type
    const byType = await fraudAlertsCollection.aggregate([
      { $group: { _id: '$fraudType', count: { $sum: 1 } } }
    ]).toArray();

    // Recent alerts (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentAlerts = await fraudAlertsCollection.countDocuments({
      detectedAt: { $gte: sevenDaysAgo }
    });

    res.json({
      totalAlerts,
      pendingReview,
      recentAlerts,
      byType: byType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Health server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Status endpoint: http://localhost:${PORT}/status`);
  console.log(`👥 Customer status: http://localhost:${PORT}/customer/:chatId/status`);
  console.log(`📋 Customers summary: http://localhost:${PORT}/customers/summary`);
  console.log(`⏰ Overdue customers: http://localhost:${PORT}/customers/overdue`);
  console.log(`🚨 Fraud alerts: http://localhost:${PORT}/fraud/alerts`);
  console.log(`🔍 Fraud stats: http://localhost:${PORT}/fraud/stats`);
});

// ---- WSL-safe FS helpers (expects fs-safe.js). If you don't have it yet,
// create fs-safe.js from our previous message or inline a minimal fallback.
let normalizePath, preferLinuxHome, ensureDir;
try {
  ({ normalizePath, preferLinuxHome, ensureDir } = require('./fs-safe'));
} catch {
  const fsp = fs.promises;
  const os = require('os');
  function isWSL() {
    const r = os.release().toLowerCase();
    return r.includes('microsoft') || r.includes('wsl');
  }
  normalizePath = (p) => {
    if (/^[A-Za-z]:\\/.test(p)) {
      const drive = p[0].toLowerCase();
      const rest = p.slice(2).replace(/\\/g, '/');
      return `/mnt/${drive}${rest.startsWith('/') ? '' : '/'}${rest}`;
    }
    return path.resolve((p || '').replace(/\\/g, '/'));
  };
  preferLinuxHome = (p) => {
    if (!isWSL()) return p;
    if (p.startsWith('/mnt/')) return p;
    if (path.isAbsolute(p)) return p;
    const home = process.env.HOME || os.homedir() || '/tmp';
    return path.join(home, p);
  };
  ensureDir = async (dir) => { await fsp.mkdir(dir, { recursive: true }); };
}

const SCREENSHOT_DIR = preferLinuxHome(
  normalizePath(process.env.SCREENSHOT_DIR || './screenshots')
);

// Screenshot organization folders
const SCREENSHOT_VERIFIED_DIR = path.join(SCREENSHOT_DIR, 'verified');
const SCREENSHOT_REJECTED_DIR = path.join(SCREENSHOT_DIR, 'rejected');
const SCREENSHOT_PENDING_DIR = path.join(SCREENSHOT_DIR, 'pending');

// ---- Debug environment variables
console.log('🔍 Environment Check:');
console.log('TELEGRAM_TOKEN:', process.env.TELEGRAM_TOKEN ? '✅ Set' : '❌ Missing');
console.log('MONGO_URL:', process.env.MONGO_URL ? '✅ Set' : '❌ Missing');
console.log('DB_NAME:', process.env.DB_NAME ? '✅ Set' : '❌ Missing');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME;

// ---- Validate required env
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
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required in .env file');
  process.exit(1);
}

// ---- Connection strategies (from botfetch.js) :contentReference[oaicite:2]{index=2}
const connectionStrategies = [
  {
    name: 'Standard IPv4',
    options: {
      polling: true,
      request: { timeout: 30000, proxy: null, family: 4 }
    }
  },
  {
    name: 'Extended Timeout',
    options: {
      polling: true,
      request: { timeout: 60000, proxy: null, family: 4 }
    }
  },
  {
    name: 'No Family Restriction',
    options: {
      polling: true,
      request: { timeout: 30000, proxy: null }
    }
  },
  {
    name: 'Minimal Options',
    options: { polling: true }
  }
];

let bot;
let currentStrategy = 0;

async function initializeBot() {
  console.log('🚀 Initializing Telegram Bot...');
  for (let i = 0; i < connectionStrategies.length; i++) {
    const strategy = connectionStrategies[i];
    console.log(`\n🔄 Trying strategy ${i + 1}: ${strategy.name}`);
    try {
      bot = new TelegramBot(TELEGRAM_TOKEN, strategy.options);
      const botInfo = await bot.getMe(); // test connection
      console.log(`✅ Bot connected successfully with ${strategy.name}:`, botInfo.username);
      currentStrategy = i;
      break;
    } catch (error) {
      console.error(`❌ Strategy ${strategy.name} failed:`, error.message);
      if (error.name === 'AggregateError') {
        console.error('AggregateError details:', error.errors.map(e => e.message));
      }
      if (i === connectionStrategies.length - 1) {
        console.error('\n💥 All connection strategies failed!');
        console.error('🔧 Try these solutions:');
        console.error('1. Check your internet connection');
        console.error('2. Try using a VPN');
        console.error('3. Check if Telegram is blocked in your region');
        console.error('4. Run: node src/network-test.js');
        process.exit(1);
      }
    }
  }

  // Centralized error logging
  bot.on('error', (error) => {
    console.error('❌ Bot Error:', error);
    if (error.name === 'AggregateError') {
      console.error('AggregateError in bot:', error.errors);
    }
  });
  bot.on('polling_error', (error) => {
    console.error('❌ Polling Error:', error);
    if (error.name === 'AggregateError') {
      console.error('AggregateError in polling:', error.errors);
    }
  });
  bot.on('webhook_error', (error) => {
    console.error('❌ Webhook Error:', error);
  });
}

// ---- Mongo
const client = new MongoClient(MONGO_URL, {
  tls: true,
  tlsAllowInvalidCertificates: true,
});

// Connect to invoiceDB for excelreadings
const MONGO_URL_INVOICE = process.env.MONGO_URL_INVOICE || MONGO_URL;
const DB_NAME_INVOICE = process.env.DB_NAME_INVOICE || 'invoiceDB';
const invoiceClient = new MongoClient(MONGO_URL_INVOICE, {
  tls: true,
  tlsAllowInvalidCertificates: true,
});

let collection;
let paymentsCollection;
let customersCollection;
let fraudAlertsCollection;
let excelReadingsCollection;

async function startDB() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    collection = db.collection('messages');
    paymentsCollection = db.collection('payments');
    customersCollection = db.collection('customers');
    fraudAlertsCollection = db.collection('fraudAlerts');
    console.log('✅ MongoDB connected (customerDB)');
    console.log('✅ Payments collection ready');
    console.log('✅ Customers collection ready');
    console.log('✅ FraudAlerts collection ready');

    // Connect to invoiceDB
    await invoiceClient.connect();
    const invoiceDB = invoiceClient.db(DB_NAME_INVOICE);
    excelReadingsCollection = invoiceDB.collection('excelreadings');
    console.log('✅ MongoDB connected (invoiceDB)');
    console.log('✅ ExcelReadings collection ready');

    // Set up MongoDB error handlers
    client.on('error', (error) => {
      console.error('❌ MongoDB client error:', error.message);
    });

    client.on('close', () => {
      console.log('⚠️ MongoDB connection closed');
    });

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('Error details:', { code: error.code, name: error.name });
    process.exit(1);
  }
}

// ==== Currency Conversion Helper ====
function convertToKHR(amount, currency) {
  const USD_TO_KHR = parseFloat(process.env.USD_TO_KHR_RATE) || 4000;

  if (!amount) return null;

  if (currency === 'USD' || currency === 'usd') {
    return amount * USD_TO_KHR;
  } else if (currency === 'KHR' || currency === 'khmer riel' || currency === 'riel') {
    return amount;
  }

  // Default: assume KHR if currency not recognized
  return amount;
}

// ==== Currency Formatting Helper ====
function formatCurrency(amount) {
  if (!amount) return '0';
  return Math.round(amount).toLocaleString('en-US');
}

// ==== Customer Payment Status Update ====
async function updateCustomerPaymentStatus(chatId, paymentRecord) {
  try {
    // 1. Get expected amount from excelreadings
    const bill = await excelReadingsCollection.findOne({ chatId });
    const totalExpected = bill?.amount || 0;

    // 2. Aggregate all VERIFIED payments for this customer
    const verifiedPayments = await paymentsCollection.find({
      chatId: chatId,
      isVerified: true,
      paymentLabel: 'PAID'
    }).toArray();

    const totalPaid = verifiedPayments.reduce((sum, p) => sum + (p.amountInKHR || 0), 0);
    const paymentCount = verifiedPayments.length;

    // 3. Aggregate PENDING payments
    const pendingPayments = await paymentsCollection.find({
      chatId: chatId,
      paymentLabel: 'PENDING'
    }).toArray();

    const totalUnverified = pendingPayments.reduce((sum, p) => sum + (p.amountInKHR || 0), 0);

    // 4. Calculate status
    let paymentStatus;
    let remainingBalance = totalExpected - totalPaid;
    let excessAmount = 0;

    if (totalPaid === 0) {
      paymentStatus = 'NOT_PAID';
    } else if (totalPaid >= totalExpected) {
      paymentStatus = 'FULLY_PAID';
      if (totalPaid > totalExpected) {
        paymentStatus = 'OVERPAID';
        excessAmount = totalPaid - totalExpected;
      }
    } else {
      paymentStatus = 'PARTIAL_PAID';
    }

    // 5. Get payment dates
    const paymentDates = verifiedPayments.map(p => p.uploadedAt).sort();
    const firstPaymentDate = paymentDates[0] || null;
    const lastPaymentDate = paymentDates[paymentDates.length - 1] || null;

    // 6. Upsert to customers collection
    await customersCollection.updateOne(
      { chatId: chatId },
      {
        $set: {
          chatId: chatId,
          customerName: bill?.customer || paymentRecord.fullName,
          username: paymentRecord.username,
          totalExpected: totalExpected,
          totalPaid: totalPaid,
          totalUnverified: totalUnverified,
          paymentCount: paymentCount,
          paymentStatus: paymentStatus,
          excessAmount: excessAmount,
          remainingBalance: remainingBalance,
          lastPaymentDate: lastPaymentDate,
          firstPaymentDate: firstPaymentDate,
          lastUpdated: new Date(),
          paymentIds: verifiedPayments.map(p => p._id)
        }
      },
      { upsert: true }
    );

    console.log(`📊 Customer status updated: ${paymentStatus} | Paid ${formatCurrency(totalPaid)}/${formatCurrency(totalExpected)} KHR`);

    return {
      paymentStatus,
      totalPaid,
      totalExpected,
      remainingBalance,
      excessAmount
    };
  } catch (error) {
    console.error('❌ Failed to update customer status:', error.message);
    return null;
  }
}

// ==== Customer Status Query Helpers ====
async function getCustomerStatus(chatId) {
  try {
    return await customersCollection.findOne({ chatId });
  } catch (error) {
    console.error('❌ Failed to get customer status:', error.message);
    return null;
  }
}

async function getCustomersByStatus(status) {
  try {
    return await customersCollection.find({ paymentStatus: status }).toArray();
  } catch (error) {
    console.error('❌ Failed to get customers by status:', error.message);
    return [];
  }
}

async function getOverdueCustomers(daysOverdue = 3) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOverdue);

    return await customersCollection.find({
      paymentStatus: { $in: ['NOT_PAID', 'PARTIAL_PAID'] },
      lastUpdated: { $lt: cutoffDate }
    }).toArray();
  } catch (error) {
    console.error('❌ Failed to get overdue customers:', error.message);
    return [];
  }
}

// ==== Enhanced Verification Message Builder ====
function buildVerificationMessage(paymentData, expectedAmount, amountInKHR, isVerified, verificationStatus) {
  const paidAmount = amountInKHR || 0;
  const expected = expectedAmount || 0;
  const difference = paidAmount - expected;

  // Scenario 1: Verified full payment (within tolerance)
  if (isVerified && paymentData.confidence === 'high' && paymentData.isPaid) {
    return `✅ ការទូទាត់បានបញ្ជាក់ ✅\n` +
           `💰 បានទទួល: ${formatCurrency(paidAmount)} KHR\n` +
           `📋 ចំនួនត្រូវបង់: ${formatCurrency(expected)} KHR\n` +
           `សូមអរគុណ! 🙏`;
  }

  // Scenario 2: Partial payment (paid less than expected)
  if (expected > 0 && paidAmount < expected && difference < 0) {
    return `⚠️ ការទូទាត់មិនពេញលេញ\n` +
           `💰 បានទទួល: ${formatCurrency(paidAmount)} KHR\n` +
           `📋 ចំនួនត្រូវបង់: ${formatCurrency(expected)} KHR`;
  }

  // Scenario 3: Overpayment (paid more than expected)
  if (expected > 0 && difference > 0 && isVerified) {
    return `✅ ការទូទាត់បានបញ្ជាក់ ✅\n` +
           `💰 បានទទួល: ${formatCurrency(paidAmount)} KHR\n` +
           `📋 ចំនួនត្រូវបង់: ${formatCurrency(expected)} KHR\n` +
           `💵 លើស: ${formatCurrency(difference)} KHR\n` +
           `សូមអរគុណ! 🙏`;
  }

  // Scenario 4: Low/Medium confidence - needs manual review
  if (paymentData.confidence === 'low' || paymentData.confidence === 'medium') {
    return `⏳ សូមរង់ចាំការពិនិត្យ\n` +
           `💰 ចំនួនដែលរកឃើញ: ${formatCurrency(paidAmount)} KHR\n` +
           `សូមរង់ចាំការបញ្ជាក់`;
  }

  // Default fallback message
  return `✅ បានទទួលការទូទាត់ ${formatCurrency(paidAmount)} KHR សូមអរគុណ`;
}

// ==== Fraud Detection Helper Functions ====

/**
 * Validates transaction date and checks for screenshot age fraud
 * @param {string} transactionDateStr - Transaction date from OCR
 * @param {Date} uploadedAt - When screenshot was uploaded
 * @param {number} maxAgeDays - Maximum allowed age in days
 * @returns {object} - { isValid, fraudType, ageDays, parsedDate, reason }
 */
function validateTransactionDate(transactionDateStr, uploadedAt, maxAgeDays = 7) {
  const result = {
    isValid: true,
    fraudType: null,
    ageDays: null,
    parsedDate: null,
    reason: null
  };

  // Check 1: Missing transaction date
  if (!transactionDateStr || transactionDateStr === 'null' || transactionDateStr === 'undefined') {
    result.isValid = false;
    result.fraudType = 'MISSING_DATE';
    result.reason = 'Transaction date not found in screenshot';
    return result;
  }

  // Check 2: Parse transaction date
  let transactionDate;
  try {
    transactionDate = new Date(transactionDateStr);

    // Check if date is valid
    if (isNaN(transactionDate.getTime())) {
      result.isValid = false;
      result.fraudType = 'INVALID_DATE';
      result.reason = `Invalid date format: ${transactionDateStr}`;
      return result;
    }

    result.parsedDate = transactionDate;
  } catch (error) {
    result.isValid = false;
    result.fraudType = 'INVALID_DATE';
    result.reason = `Failed to parse date: ${transactionDateStr}`;
    return result;
  }

  // Check 3: Future date detection
  if (transactionDate > uploadedAt) {
    const futureDays = Math.ceil((transactionDate - uploadedAt) / (1000 * 60 * 60 * 24));
    result.isValid = false;
    result.fraudType = 'FUTURE_DATE';
    result.ageDays = -futureDays; // Negative to indicate future
    result.reason = `Transaction date is ${futureDays} days in the future`;
    return result;
  }

  // Check 4: Old screenshot detection
  const ageDays = (uploadedAt - transactionDate) / (1000 * 60 * 60 * 24);
  result.ageDays = Math.floor(ageDays);

  if (ageDays > maxAgeDays) {
    result.isValid = false;
    result.fraudType = 'OLD_SCREENSHOT';
    result.reason = `Screenshot is ${Math.floor(ageDays)} days old (max allowed: ${maxAgeDays} days)`;
    return result;
  }

  return result;
}

/**
 * Creates fraud alert record in fraudAlerts collection
 * @param {object} fraudData - Fraud detection data
 * @returns {string|null} - Alert ID or null if failed
 */
async function logFraudAlert(fraudData) {
  try {
    const alertId = `FA-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;

    const fraudAlert = {
      _id: uuidv4(),
      alertId: alertId,

      // Fraud details
      fraudType: fraudData.fraudType,
      detectedAt: new Date(),
      severity: fraudData.severity || 'MEDIUM',

      // Payment reference
      paymentId: fraudData.paymentId || null,
      chatId: fraudData.chatId,
      userId: fraudData.userId,
      username: fraudData.username,
      fullName: fraudData.fullName,

      // Evidence
      transactionDate: fraudData.transactionDate,
      uploadedAt: fraudData.uploadedAt,
      screenshotAgeDays: fraudData.screenshotAgeDays,
      maxAllowedAgeDays: fraudData.maxAllowedAgeDays || 7,

      transactionId: fraudData.transactionId || null,
      referenceNumber: fraudData.referenceNumber || null,
      amount: fraudData.amount || null,
      currency: fraudData.currency || null,
      bankName: fraudData.bankName || null,

      screenshotPath: fraudData.screenshotPath,

      // Review status
      reviewStatus: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,

      // Additional context
      verificationNotes: fraudData.verificationNotes,
      confidence: fraudData.confidence,
      aiAnalysis: fraudData.aiAnalysis,

      // Resolution
      actionTaken: fraudData.actionTaken || 'HELD_FOR_REVIEW',
      resolutionDate: null
    };

    await fraudAlertsCollection.insertOne(fraudAlert);

    console.log(`🚨 FRAUD ALERT LOGGED: ${alertId} - ${fraudData.fraudType} | Chat ${fraudData.chatId}`);

    return alertId;
  } catch (error) {
    console.error('❌ Failed to log fraud alert:', error.message);
    return null;
  }
}

// ==== OpenAI Rate Limiter ====
class OpenAIRateLimiter {
  constructor(maxRequestsPerMinute = 10) {
    this.maxRequests = maxRequestsPerMinute;
    this.requests = [];
  }

  async waitForSlot() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove requests older than 1 minute
    this.requests = this.requests.filter(time => time > oneMinuteAgo);

    if (this.requests.length >= this.maxRequests) {
      // Wait until the oldest request is older than 1 minute
      const oldestRequest = this.requests[0];
      const waitTime = oldestRequest + 60000 - now;
      console.log(`⏳ Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForSlot(); // Retry after waiting
    }

    this.requests.push(now);
  }
}

const openaiRateLimiter = new OpenAIRateLimiter(10); // 10 requests per minute

// ==== Screenshot Organization Helper ====
async function organizeScreenshot(originalPath, verificationStatus) {
  try {
    let targetDir;

    // Determine target directory based on verification status
    if (verificationStatus === 'verified') {
      targetDir = SCREENSHOT_VERIFIED_DIR;
    } else if (verificationStatus === 'rejected') {
      targetDir = SCREENSHOT_REJECTED_DIR;
    } else {
      targetDir = SCREENSHOT_PENDING_DIR;
    }

    // Ensure target directory exists
    await ensureDir(targetDir);

    // Get filename from original path
    const filename = path.basename(originalPath);
    const targetPath = normalizePath(path.join(targetDir, filename));

    // Move file to appropriate folder
    await fs.promises.rename(originalPath, targetPath);
    console.log(`📁 Moved screenshot to ${verificationStatus} folder: ${targetPath}`);

    return targetPath;
  } catch (error) {
    console.error(`❌ Failed to organize screenshot: ${error.message}`);
    return originalPath; // Return original path if move fails
  }
}

// ==== Payment OCR Analysis Function ====
async function analyzePaymentScreenshot(imagePath, chatId, userId, username, fullName) {
  try {
    // Get customer's expected payment amount from excelreadings (invoiceDB)
    const excelReading = await excelReadingsCollection.findOne({ chatId: chatId });
    let expectedAmountKHR = null;
    if (excelReading && excelReading.amount) {
      expectedAmountKHR = excelReading.amount;
    }

    // Read image and convert to base64
    const imageBuffer = await fs.promises.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Wait for rate limiter slot before calling OpenAI API
    await openaiRateLimiter.waitForSlot();

    // Call GPT-4o Vision API with timeout
    const openaiTimeout = 60000; // 60 second timeout
    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this payment screenshot and extract the following information in JSON format:
{
  "isPaid": true/false (whether this is a valid payment confirmation),
  "amount": number (the payment amount, use positive number),
  "currency": "string (USD, KHR, etc)",
  "transactionId": "string",
  "referenceNumber": "string",
  "fromAccount": "string (sender account number or name)",
  "toAccount": "string (recipient account number)",
  "bankName": "string (e.g., ABA Bank)",
  "transactionDate": "string (ISO format if possible)",
  "remark": "string (any notes or remarks)",
  "recipientName": "string (if visible)",
  "confidence": "high/medium/low (your confidence in the extraction)"
}

If this is NOT a payment screenshot, set isPaid to false. Only mark isPaid as true if you can clearly identify it as a valid payment/transfer confirmation.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OpenAI API timeout')), openaiTimeout)
      )
    ]);

    const aiResponse = response.choices[0].message.content;

    // Parse JSON response
    let paymentData;
    try {
      // Extract JSON from response (GPT might wrap it in markdown code blocks)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        paymentData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('❌ Failed to parse AI response as JSON:', parseError);
      paymentData = {
        isPaid: false,
        confidence: 'low',
        rawResponse: aiResponse
      };
    }

    // Convert payment to KHR for verification
    const amountInKHR = convertToKHR(paymentData.amount, paymentData.currency);

    // Verify payment amount against expected amount
    let isVerified = false;
    let verificationNotes = '';

    if (expectedAmountKHR && amountInKHR) {
      const tolerance = parseFloat(process.env.PAYMENT_TOLERANCE_PERCENT) || 5;
      const toleranceAmount = (expectedAmountKHR * tolerance) / 100;
      const minAcceptable = expectedAmountKHR - toleranceAmount;
      const maxAcceptable = expectedAmountKHR + toleranceAmount;

      if (amountInKHR >= minAcceptable && amountInKHR <= maxAcceptable) {
        isVerified = true;
        verificationNotes = `Amount verified within ${tolerance}% tolerance`;
      } else {
        isVerified = false;
        verificationNotes = `Amount mismatch: Expected ${expectedAmountKHR} KHR, got ${amountInKHR} KHR`;
      }
    } else {
      verificationNotes = 'Cannot verify - missing expected amount or extracted amount';
    }

    // Verify recipient account (only if EXPECTED_RECIPIENT_ACCOUNT is set)
    const expectedAccount = process.env.EXPECTED_RECIPIENT_ACCOUNT;
    if (expectedAccount && expectedAccount.trim() !== '' && paymentData.toAccount) {
      const accountMatch = paymentData.toAccount.replace(/\s/g, '') === expectedAccount.replace(/\s/g, '');
      if (!accountMatch) {
        isVerified = false;
        verificationNotes += ` | Account mismatch: Expected ${expectedAccount}, got ${paymentData.toAccount}`;
      }
    }

    // Determine final verification status and payment label
    let finalVerificationStatus = 'pending';
    let paymentLabel = 'PENDING';

    if (isVerified && paymentData.confidence === 'high' && paymentData.isPaid) {
      finalVerificationStatus = 'verified';
      paymentLabel = 'PAID';
    } else if (!paymentData.isPaid || paymentData.confidence === 'low') {
      finalVerificationStatus = 'rejected';
      paymentLabel = 'UNPAID';
    } else if (paymentData.isPaid && !isVerified) {
      finalVerificationStatus = 'pending';
      paymentLabel = 'PENDING';
    }

    // ==== FRAUD DETECTION: Old Screenshot Check ====
    const MAX_SCREENSHOT_AGE_DAYS = parseInt(process.env.MAX_SCREENSHOT_AGE_DAYS) || 7;

    const dateValidation = validateTransactionDate(
      paymentData.transactionDate,
      new Date(), // uploadedAt
      MAX_SCREENSHOT_AGE_DAYS
    );

    if (!dateValidation.isValid) {
      console.log(`🚨 FRAUD DETECTED: ${dateValidation.fraudType} | ${dateValidation.reason}`);

      // Log to fraudAlerts collection
      const alertId = await logFraudAlert({
        fraudType: dateValidation.fraudType,
        severity: dateValidation.fraudType === 'OLD_SCREENSHOT' ? 'HIGH' : 'MEDIUM',
        chatId: chatId,
        userId: userId,
        username: username,
        fullName: fullName,
        transactionDate: paymentData.transactionDate,
        uploadedAt: new Date(),
        screenshotAgeDays: dateValidation.ageDays,
        maxAllowedAgeDays: MAX_SCREENSHOT_AGE_DAYS,
        transactionId: paymentData.transactionId,
        referenceNumber: paymentData.referenceNumber,
        amount: amountInKHR,
        currency: paymentData.currency,
        bankName: paymentData.bankName,
        screenshotPath: imagePath, // Will be updated after organization
        verificationNotes: verificationNotes,
        confidence: paymentData.confidence,
        aiAnalysis: aiResponse,
        actionTaken: 'HELD_FOR_REVIEW'
      });

      // Override verification status
      finalVerificationStatus = 'rejected';
      paymentLabel = 'FRAUD_PENDING';

      // Update verification notes
      verificationNotes += ` | FRAUD: ${dateValidation.reason} | Alert: ${alertId}`;

      // Send fraud notification to user (Khmer)
      try {
        const fraudMessage =
          `⚠️ ការទូទាត់ត្រូវបានបដិសេធ\n` +
          `💰 ចំនួនដែលរកឃើញ: ${formatCurrency(amountInKHR)} KHR\n` +
          `❌ មូលហេតុ: រូបថតចាស់ពេក (${dateValidation.ageDays} ថ្ងៃ)\n` +
          `⏳ សូមបង្ហាញរូបថតថ្មី`;

        await bot.sendMessage(chatId, fraudMessage);
      } catch (notifyErr) {
        console.error('❌ Failed to send fraud notification:', notifyErr.message);
      }
    }

    // Send enhanced verification message to user
    if (paymentData.isPaid) {
      const message = buildVerificationMessage(
        paymentData,
        expectedAmountKHR,
        amountInKHR,
        isVerified,
        finalVerificationStatus
      );

      try {
        await bot.sendMessage(chatId, message);
      } catch (notifyErr) {
        console.error('❌ Failed to send verification message:', notifyErr.message);
      }
    }

    // Organize screenshot into appropriate folder
    const organizedPath = await organizeScreenshot(imagePath, finalVerificationStatus);

    // Store in payments collection
    const paymentRecord = {
      _id: uuidv4(),
      chatId,
      userId,
      username,
      fullName,
      screenshotPath: organizedPath,
      uploadedAt: new Date(),

      // Payment Status Label
      paymentLabel: paymentLabel,

      // OCR Results
      isPaid: paymentData.isPaid || false,
      paymentAmount: paymentData.amount || null,
      currency: paymentData.currency || null,
      amountInKHR: amountInKHR,
      transactionId: paymentData.transactionId || null,
      referenceNumber: paymentData.referenceNumber || null,
      fromAccount: paymentData.fromAccount || null,
      toAccount: paymentData.toAccount || null,
      bankName: paymentData.bankName || null,
      transactionDate: paymentData.transactionDate || null,
      remark: paymentData.remark || null,
      recipientName: paymentData.recipientName || null,

      // Verification
      expectedAmountKHR: expectedAmountKHR,
      isVerified: isVerified,
      verificationNotes: verificationNotes,

      // Analysis metadata
      confidence: paymentData.confidence || 'low',
      aiAnalysis: aiResponse,
      verificationStatus: finalVerificationStatus
    };

    try {
      await paymentsCollection.insertOne(paymentRecord);

      // Update customer payment status in real-time
      await updateCustomerPaymentStatus(chatId, paymentRecord);

      // Clean output with clear status label
      const statusIcon = paymentLabel === 'PAID' ? '✅' : paymentLabel === 'UNPAID' ? '❌' : '⏳';
      console.log(`${statusIcon} ${paymentLabel} | ${amountInKHR || 0} KHR | ${finalVerificationStatus.toUpperCase()}`);

    } catch (dbError) {
      console.error('❌ Failed to save payment record to database:', dbError);
      throw dbError;
    }

    return paymentRecord;

  } catch (error) {
    console.error('❌ Payment OCR analysis failed:', error);
    return null;
  }
}

// ==== Queue System ====
const messageQueue = [];
let processing = false;

async function setupMessageHandler() {
  bot.on('message', (message) => {
    if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') {
      return;
    }

    messageQueue.push(message);
    processQueue();
  });
}

async function processQueue() {
  if (processing || messageQueue.length === 0) return;
  processing = true;
  const message = messageQueue.shift();
  try {
    await handleMessage(message);
  } catch (err) {
    console.error('[QUEUE ERROR]', err);
  }
  processing = false;
  if (messageQueue.length > 0) {
    setTimeout(processQueue, 200);
  }
}

// ==== Actual message handler ====
async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const username = message.from.username || null;
  const firstName = message.from.first_name || '';
  const lastName = message.from.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const text = message.text || message.caption || null;
  const timestamp = new Date();
  const uniqueId = uuidv4();
  let filePath = null;

  // ---- PHOTO HANDLING (WSL2-safe; from resilient version) :contentReference[oaicite:3]{index=3}
  if (message.photo) {
    const photo = message.photo[message.photo.length - 1];
    const fileId = photo.file_id;
    try {
      await ensureDir(SCREENSHOT_DIR);
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const localFilePath = normalizePath(path.join(SCREENSHOT_DIR, `${uniqueId}.jpg`));

      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(localFilePath);
        https.get(fileUrl, (response) => {
          if (response.statusCode !== 200) {
            fileStream.destroy();
            return reject(new Error(`HTTP ${response.statusCode} for ${fileUrl}`));
          }
          response.pipe(fileStream);
          fileStream.on('finish', () => fileStream.close(resolve));
        }).on('error', (err) => {
          fs.unlink(localFilePath, () => reject(err));
        });
      });

      filePath = localFilePath;

      // ---- ANALYZE PAYMENT SCREENSHOT WITH OCR ----
      await analyzePaymentScreenshot(localFilePath, chatId, userId, username, fullName);

    } catch (err) {
      console.error('Error downloading file:', err);
    }
  }

  // ---- SAVE TO DB (Only if there's a photo/file)
  if (filePath) {
    try {
      const record = {
        _id: uniqueId,
        chatId,
        userId,
        username,
        fullName,
        text,
        filePath,
        timestamp,
      };
      await collection.insertOne(record);
    } catch (error) {
      console.error('❌ Database save failed:', error.message);
    }
  }
}

// ---- Main
async function main() {
  try {
    await initializeBot();
    await startDB();
    await setupMessageHandler();

    console.log('🎯 Bot is ready and listening for messages...');
    console.log(`📡 Using connection strategy: ${connectionStrategies[currentStrategy].name}`);
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
}

// ---- Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down bot...');
  await client.close();
  await invoiceClient.close();
  process.exit(0);
});

main();
