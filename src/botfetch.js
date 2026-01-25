'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { MongoClient, GridFSBucket } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const https = require('https');
const path = require('path');
const XLSX = require('xlsx');
const archiver = require('archiver');
const express = require('express');
const { extractWithBankFormat, getBankFormatStats } = require('./bankFormatRecognizer');
const { extractWithEnhancedBankFormat, getEnhancedBankFormatStats } = require('./ml/enhancedBankFormatRecognizer');
process.on('unhandledRejection', (r)=>{console.error('UNHANDLED', r?.message, r?.stack)});
process.on('uncaughtException', (e)=>{console.error('UNCAUGHT', e?.message, e?.stack)});

// ---- Express Health Server for Railway/Docker ----
const app = express();
app.use(express.json()); // Parse JSON bodies
const PORT = process.env.PORT || 3000;
const SCREENSHOT_DOWNLOAD_TOKEN = process.env.SCREENSHOT_DOWNLOAD_TOKEN || null;
const ALLOWED_SCREENSHOT_STATUSES = new Set(['verified', 'rejected', 'pending']);

// 3-Chatbox System Configuration
const PENDING_CHAT_ID = process.env.PENDING_CHAT_ID || '-4855018606';  // Pending screenshots for manual review
const VERIFIED_CHAT_ID = process.env.VERIFIED_CHAT_ID || '-4857515257'; // Verified bank statements notification
const REJECTED_CHAT_ID = process.env.REJECTED_CHAT_ID || '-4944397913'; // Rejected bank statements notification

// Legacy support
const AUDIT_CHAT_ID = PENDING_CHAT_ID; // Backward compatibility

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
      bankFormat: getBankFormatStats(),
      enhancedBankFormat: getEnhancedBankFormatStats(),
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

// GridFS screenshot download endpoint (by screenshotId)
app.get('/screenshots/gridfs/:id', async (req, res) => {
  if (!SCREENSHOT_DOWNLOAD_TOKEN) {
    return res.status(503).json({ error: 'download_disabled' });
  }

  if (!isDownloadAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const screenshotId = req.params.id;
    const imageBuffer = await downloadScreenshotFromGridFS(screenshotId);

    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Disposition', `inline; filename="${screenshotId}.jpg"`);
    res.send(imageBuffer);
  } catch (error) {
    console.error('GridFS download error:', error.message);
    return res.status(404).json({ error: 'screenshot_not_found' });
  }
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

// ==== PAYMENT APPROVAL ENDPOINTS ====

// Helper: Clean error response with logging
function handleApiError(res, error, context, statusCode = 500) {
  const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = new Date().toISOString();

  console.error(`❌ [${timestamp}] ${context}`);
  console.error(`   Error ID: ${errorId}`);
  console.error(`   Message: ${error.message}`);
  if (error.stack) {
    console.error(`   Stack: ${error.stack.split('\n')[1]?.trim()}`);
  }

  return res.status(statusCode).json({
    success: false,
    error: error.message,
    errorId: errorId,
    timestamp: timestamp
  });
}

// Helper: Clean success log
function logSuccess(action, details) {
  const timestamp = new Date().toISOString();
  console.log(`✅ [${timestamp}] ${action}`);
  if (details) {
    Object.entries(details).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
  }
}

// Approve a pending payment manually
app.post('/api/payment/:paymentId/approve', async (req, res) => {
  const { paymentId } = req.params;
  const { approvedAmount, currency, reviewNotes, approvedBy } = req.body;

  try {
    // Validate required fields
    if (!approvedAmount || isNaN(approvedAmount) || approvedAmount <= 0) {
      console.log(`⚠️ [APPROVE] Invalid amount: ${approvedAmount} | Payment: ${paymentId}`);
      return res.status(400).json({
        success: false,
        error: 'approvedAmount is required and must be a positive number',
        received: approvedAmount
      });
    }

    // Find the payment
    const payment = await paymentsCollection.findOne({ _id: paymentId });
    if (!payment) {
      console.log(`⚠️ [APPROVE] Payment not found: ${paymentId}`);
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
        paymentId: paymentId
      });
    }

    if (payment.paymentLabel !== 'PENDING') {
      console.log(`⚠️ [APPROVE] Payment not pending: ${paymentId} | Status: ${payment.paymentLabel}`);
      return res.status(400).json({
        success: false,
        error: `Payment is not pending`,
        currentStatus: payment.paymentLabel,
        paymentId: paymentId
      });
    }

    // Get customer's current state before update
    const customerBefore = await customersCollection.findOne({ chatId: payment.chatId });
    const previousTotalPaid = customerBefore?.totalPaid || 0;

    // Calculate amount in KHR
    const USD_TO_KHR = parseFloat(process.env.USD_TO_KHR_RATE) || 4000;
    const amountInKHR = (currency === 'USD')
      ? approvedAmount * USD_TO_KHR
      : parseFloat(approvedAmount);

    // Update payment to PAID
    await paymentsCollection.updateOne(
      { _id: paymentId },
      {
        $set: {
          paymentLabel: 'PAID',
          verificationStatus: 'verified',
          paymentAmount: parseFloat(approvedAmount),
          amountInKHR: amountInKHR,
          currency: currency || 'KHR',
          isVerified: true,
          manuallyApproved: true,
          approvedAt: new Date(),
          approvedBy: approvedBy || 'admin',
          reviewNotes: reviewNotes || 'Manually approved'
        }
      }
    );

    // Recalculate customer totals
    await updateCustomerPaymentStatus(payment.chatId);

    // Get updated customer state
    const customerAfter = await customersCollection.findOne({ chatId: payment.chatId });

    logSuccess('PAYMENT APPROVED', {
      'Payment ID': paymentId,
      'Amount': `${amountInKHR.toLocaleString()} KHR`,
      'Chat ID': payment.chatId,
      'Customer': customerAfter?.customerName || 'Unknown',
      'Total Paid': `${previousTotalPaid.toLocaleString()} → ${customerAfter?.totalPaid?.toLocaleString()} KHR`,
      'Status': `${customerBefore?.paymentStatus || 'NOT_PAID'} → ${customerAfter?.paymentStatus}`,
      'Approved By': approvedBy || 'admin'
    });

    res.json({
      success: true,
      payment: {
        paymentId: paymentId,
        previousStatus: 'PENDING',
        newStatus: 'PAID',
        approvedAmount: parseFloat(approvedAmount),
        currency: currency || 'KHR',
        amountInKHR: amountInKHR
      },
      customer: {
        chatId: payment.chatId,
        customerName: customerAfter?.customerName,
        previousTotalPaid: previousTotalPaid,
        newTotalPaid: customerAfter?.totalPaid || 0,
        totalExpected: customerAfter?.totalExpected || 0,
        remainingBalance: customerAfter?.remainingBalance || 0,
        paymentStatus: customerAfter?.paymentStatus || 'NOT_PAID'
      }
    });
  } catch (error) {
    return handleApiError(res, error, `APPROVE PAYMENT | ID: ${paymentId}`);
  }
});

// List all pending payments for review
app.get('/api/payments/pending', async (req, res) => {
  try {
    const pendingPayments = await paymentsCollection.find({
      paymentLabel: 'PENDING'
    }).sort({ uploadedAt: -1 }).toArray();

    // Enrich with customer info
    const enrichedPayments = await Promise.all(pendingPayments.map(async (payment) => {
      const customer = await customersCollection.findOne({ chatId: payment.chatId });
      return {
        ...payment,
        customer: customer ? {
          customerName: customer.customerName,
          totalExpected: customer.totalExpected,
          totalPaid: customer.totalPaid,
          remainingBalance: customer.remainingBalance,
          paymentStatus: customer.paymentStatus
        } : null
      };
    }));

    console.log(`📋 [PENDING] Fetched ${enrichedPayments.length} pending payments`);

    res.json({
      success: true,
      count: enrichedPayments.length,
      payments: enrichedPayments
    });
  } catch (error) {
    return handleApiError(res, error, 'FETCH PENDING PAYMENTS');
  }
});

// Get customer payment history with summary
app.get('/api/customer/:chatId/payments', async (req, res) => {
  const chatId = parseInt(req.params.chatId);

  // Validate chatId
  if (isNaN(chatId)) {
    console.log(`⚠️ [CUSTOMER] Invalid chatId: ${req.params.chatId}`);
    return res.status(400).json({
      success: false,
      error: 'Invalid chatId - must be a number',
      received: req.params.chatId
    });
  }

  try {
    const payments = await paymentsCollection.find({
      chatId: chatId
    }).sort({ uploadedAt: -1 }).toArray();

    const customer = await customersCollection.findOne({ chatId: chatId });

    // Calculate summary
    const paidPayments = payments.filter(p => p.paymentLabel === 'PAID');
    const pendingPayments = payments.filter(p => p.paymentLabel === 'PENDING');
    const rejectedPayments = payments.filter(p => p.paymentLabel === 'UNPAID');

    console.log(`👤 [CUSTOMER] Chat ${chatId} | Paid: ${paidPayments.length} | Pending: ${pendingPayments.length} | Total: ${customer?.totalPaid?.toLocaleString() || 0} KHR`);

    res.json({
      success: true,
      customer: customer || { chatId: chatId, paymentStatus: 'NOT_PAID' },
      payments: payments,
      summary: {
        totalPaid: customer?.totalPaid || 0,
        totalUnverified: customer?.totalUnverified || 0,
        totalExpected: customer?.totalExpected || 0,
        remainingBalance: customer?.remainingBalance || 0,
        paymentStatus: customer?.paymentStatus || 'NOT_PAID',
        counts: {
          paid: paidPayments.length,
          pending: pendingPayments.length,
          rejected: rejectedPayments.length,
          total: payments.length
        },
        paidBreakdown: paidPayments.map(p => ({
          paymentId: p._id,
          amount: p.amountInKHR,
          date: p.uploadedAt,
          transactionId: p.transactionId,
          manuallyApproved: p.manuallyApproved || false
        }))
      }
    });
  } catch (error) {
    return handleApiError(res, error, `FETCH CUSTOMER PAYMENTS | Chat: ${chatId}`);
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

// ==== Export API Endpoints ====

// Helper: Convert MongoDB documents to Excel-friendly format
function flattenDocument(doc) {
  const flat = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value instanceof Date) {
      flat[key] = value.toISOString();
    } else if (typeof value === 'object' && value !== null) {
      flat[key] = JSON.stringify(value);
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

// Helper: Create Excel buffer from data
function createExcelBuffer(data, sheetName) {
  const flatData = data.map(flattenDocument);
  const ws = XLSX.utils.json_to_sheet(flatData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Export payments to Excel
app.get('/export/payments', async (req, res) => {
  try {
    const token = req.query.token;
    if (SCREENSHOT_DOWNLOAD_TOKEN && token !== SCREENSHOT_DOWNLOAD_TOKEN) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const payments = await paymentsCollection.find({}).toArray();
    if (payments.length === 0) {
      return res.status(404).json({ error: 'No payments found' });
    }

    const buffer = createExcelBuffer(payments, 'Payments');
    const filename = `payments_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export customers to Excel
app.get('/export/customers', async (req, res) => {
  try {
    const token = req.query.token;
    if (SCREENSHOT_DOWNLOAD_TOKEN && token !== SCREENSHOT_DOWNLOAD_TOKEN) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const customers = await customersCollection.find({}).toArray();
    if (customers.length === 0) {
      return res.status(404).json({ error: 'No customers found' });
    }

    const buffer = createExcelBuffer(customers, 'Customers');
    const filename = `customers_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export fraud alerts to Excel
app.get('/export/fraud', async (req, res) => {
  try {
    const token = req.query.token;
    if (SCREENSHOT_DOWNLOAD_TOKEN && token !== SCREENSHOT_DOWNLOAD_TOKEN) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const fraudAlerts = await fraudAlertsCollection.find({}).toArray();
    if (fraudAlerts.length === 0) {
      return res.status(404).json({ error: 'No fraud alerts found' });
    }

    const buffer = createExcelBuffer(fraudAlerts, 'FraudAlerts');
    const filename = `fraud_alerts_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export invoice readings to Excel
app.get('/export/invoices', async (req, res) => {
  try {
    const token = req.query.token;
    if (SCREENSHOT_DOWNLOAD_TOKEN && token !== SCREENSHOT_DOWNLOAD_TOKEN) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const invoices = await excelReadingsCollection.find({}).toArray();
    if (invoices.length === 0) {
      return res.status(404).json({ error: 'No invoice readings found' });
    }

    const buffer = createExcelBuffer(invoices, 'InvoiceReadings');
    const filename = `invoice_readings_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export all data to Excel (multiple sheets)
app.get('/export/all', async (req, res) => {
  try {
    const token = req.query.token;
    if (SCREENSHOT_DOWNLOAD_TOKEN && token !== SCREENSHOT_DOWNLOAD_TOKEN) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const wb = XLSX.utils.book_new();

    // Add payments sheet
    const payments = await paymentsCollection.find({}).toArray();
    if (payments.length > 0) {
      const ws = XLSX.utils.json_to_sheet(payments.map(flattenDocument));
      XLSX.utils.book_append_sheet(wb, ws, 'Payments');
    }

    // Add customers sheet
    const customers = await customersCollection.find({}).toArray();
    if (customers.length > 0) {
      const ws = XLSX.utils.json_to_sheet(customers.map(flattenDocument));
      XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    }

    // Add fraud alerts sheet
    const fraudAlerts = await fraudAlertsCollection.find({}).toArray();
    if (fraudAlerts.length > 0) {
      const ws = XLSX.utils.json_to_sheet(fraudAlerts.map(flattenDocument));
      XLSX.utils.book_append_sheet(wb, ws, 'FraudAlerts');
    }

    // Add invoice readings sheet
    const invoices = await excelReadingsCollection.find({}).toArray();
    if (invoices.length > 0) {
      const ws = XLSX.utils.json_to_sheet(invoices.map(flattenDocument));
      XLSX.utils.book_append_sheet(wb, ws, 'InvoiceReadings');
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `export_all_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export screenshots as ZIP (organized by status)
app.get('/export/screenshots', async (req, res) => {
  try {
    const token = req.query.token;
    if (SCREENSHOT_DOWNLOAD_TOKEN && token !== SCREENSHOT_DOWNLOAD_TOKEN) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const status = req.query.status; // Optional: 'verified', 'pending', 'rejected', or 'all'
    const source = req.query.source || 'both'; // 'local', 'gridfs', or 'both'

    const filename = `screenshots_${status || 'all'}_${new Date().toISOString().split('T')[0]}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      res.status(500).json({ error: 'Archive failed' });
    });

    archive.pipe(res);

    const statuses = status && status !== 'all'
      ? [status]
      : ['verified', 'pending', 'rejected'];

    // Add local files
    if (source === 'local' || source === 'both') {
      for (const s of statuses) {
        const statusDir = path.resolve(SCREENSHOT_DIR, s);
        try {
          const files = await fs.promises.readdir(statusDir);
          for (const file of files) {
            if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg')) {
              const filePath = path.join(statusDir, file);
              archive.file(filePath, { name: `${s}/${file}` });
            }
          }
          console.log(`📦 Added ${files.length} files from ${s}/`);
        } catch (err) {
          if (err.code !== 'ENOENT') console.error(`Error reading ${s}:`, err.message);
        }
      }
    }

    // Add GridFS files
    if (source === 'gridfs' || source === 'both') {
      const db = client.db(DB_NAME);
      const filesCollection = db.collection('screenshots.files');

      for (const s of statuses) {
        const gridfsFiles = await filesCollection.find({
          'metadata.verificationStatus': s
        }).toArray();

        for (const file of gridfsFiles) {
          try {
            const buffer = await downloadScreenshotFromGridFS(file._id.toString());
            archive.append(buffer, { name: `gridfs_${s}/${file.filename}` });
          } catch (err) {
            console.error(`Failed to download GridFS file ${file._id}:`, err.message);
          }
        }
        console.log(`📦 Added ${gridfsFiles.length} GridFS files from ${s}`);
      }
    }

    await archive.finalize();
    console.log(`✅ Screenshot export completed: ${filename}`);

  } catch (error) {
    console.error('Screenshot export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== REJECTION AUDIT ENDPOINTS =====

// Get rejection summary statistics
app.get('/api/rejections/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = {
      verificationStatus: 'rejected',
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
    };

    // Aggregate rejection statistics
    const stats = await paymentsCollection.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$rejectionReason',
          count: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: '$amountInKHR' } },
          avgConfidence: { $avg: { $cond: [
            { $and: [
              { $ne: ['$confidence', null] },
              { $ne: ['$confidence', 'high'] },
              { $ne: ['$confidence', 'medium'] },
              { $ne: ['$confidence', 'low'] }
            ]},
            { $toDouble: '$confidence' },
            0.5
          ]}},
          recentDate: { $max: '$createdAt' }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Get total counts
    const totalRejected = await paymentsCollection.countDocuments(matchStage);
    const totalPayments = await paymentsCollection.countDocuments({
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
    });

    // Calculate rejection rate
    const rejectionRate = totalPayments > 0 ? ((totalRejected / totalPayments) * 100).toFixed(2) : 0;

    res.json({
      summary: {
        totalRejected,
        totalPayments,
        rejectionRate: parseFloat(rejectionRate)
      },
      byReason: stats,
      dateRange: { startDate, endDate }
    });

  } catch (error) {
    console.error('Rejection summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get detailed rejection list with pagination
app.get('/api/rejections/detailed', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      reason,
      customer,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = -1
    } = req.query;

    // Build filter
    const filter = { verificationStatus: 'rejected' };

    if (reason) filter.rejectionReason = reason;
    if (customer) filter.chatId = parseInt(customer);

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const rejections = await paymentsCollection
      .find(filter)
      .sort({ [sortBy]: parseInt(sortOrder) })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const total = await paymentsCollection.countDocuments(filter);

    // Add screenshot URLs if available
    const enrichedRejections = rejections.map(rejection => ({
      ...rejection,
      screenshotUrl: rejection.screenshotId
        ? `/screenshots/gridfs/${rejection.screenshotId}`
        : null,
      localScreenshotPath: rejection.localScreenshotPath || null
    }));

    res.json({
      data: enrichedRejections,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Detailed rejections error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get rejection history for specific customer
app.get('/api/rejections/customer/:chatId', async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);

    const rejections = await paymentsCollection
      .find({
        chatId,
        verificationStatus: 'rejected'
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Get rejection pattern analysis
    const reasonCounts = {};
    let totalRejected = 0;

    rejections.forEach(rejection => {
      const reason = rejection.rejectionReason || 'UNKNOWN';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      totalRejected++;
    });

    // Get customer's total payment attempts
    const totalAttempts = await paymentsCollection.countDocuments({ chatId });
    const rejectionRate = totalAttempts > 0 ? ((totalRejected / totalAttempts) * 100).toFixed(2) : 0;

    // Check for suspicious patterns
    const suspiciousPatterns = [];
    if (reasonCounts.OLD_SCREENSHOT >= 2) {
      suspiciousPatterns.push('Multiple old screenshots');
    }
    if (reasonCounts.DUPLICATE_TRANSACTION >= 2) {
      suspiciousPatterns.push('Multiple duplicate attempts');
    }
    if (rejectionRate > 50) {
      suspiciousPatterns.push('High rejection rate');
    }

    res.json({
      chatId,
      rejections,
      analysis: {
        totalRejected,
        totalAttempts,
        rejectionRate: parseFloat(rejectionRate),
        reasonBreakdown: reasonCounts,
        suspiciousPatterns
      }
    });

  } catch (error) {
    console.error('Customer rejection history error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual review endpoint for rejected payments
app.post('/api/rejections/:paymentId/review', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { action, notes, reviewedBy } = req.body;

    if (!['approve', 'confirm_rejection'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "confirm_rejection"' });
    }

    const payment = await paymentsCollection.findOne({ _id: paymentId });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.verificationStatus !== 'rejected') {
      return res.status(400).json({ error: 'Payment is not in rejected status' });
    }

    // Update payment with review
    const updateData = {
      reviewedAt: new Date(),
      reviewedBy: reviewedBy || 'auditor',
      reviewNotes: notes || '',
      reviewAction: action
    };

    if (action === 'approve') {
      // Override rejection and approve payment
      updateData.verificationStatus = 'verified';
      updateData.paymentLabel = 'PAID';
      updateData.verificationNotes = `${payment.verificationNotes || ''} | MANUAL APPROVAL: ${notes || 'Approved by auditor'}`;

      // Notify customer of approval
      if (payment.chatId) {
        try {
          await bot.sendMessage(payment.chatId,
            `✅ ការទូទាត់របស់អ្នកត្រូវបានអនុម័ត\nYour payment has been approved after manual review.\n\n` +
            `💰 Amount: ${payment.amountInKHR?.toLocaleString()} KHR`
          );
        } catch (notifyErr) {
          console.error('Failed to notify customer of approval:', notifyErr.message);
        }
      }
    }

    await paymentsCollection.updateOne(
      { _id: paymentId },
      { $set: updateData }
    );

    res.json({
      success: true,
      action,
      paymentId,
      updatedFields: updateData
    });

  } catch (error) {
    console.error('Payment review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rejection analytics dashboard data
app.get('/api/rejections/analytics', async (req, res) => {
  try {
    const { period = '7d' } = req.query;

    // Calculate date range based on period
    const now = new Date();
    const periodMap = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365
    };

    const daysBack = periodMap[period] || 7;
    const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

    // Daily rejection trend
    const dailyTrend = await paymentsCollection.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          verificationStatus: 'rejected'
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: '$amountInKHR' } }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]).toArray();

    // Top rejected customers
    const topRejectedCustomers = await paymentsCollection.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          verificationStatus: 'rejected'
        }
      },
      {
        $group: {
          _id: '$chatId',
          count: { $sum: 1 },
          reasons: { $addToSet: '$rejectionReason' },
          totalAmount: { $sum: { $toDouble: '$amountInKHR' } },
          lastRejection: { $max: '$createdAt' }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]).toArray();

    // Hourly pattern analysis
    const hourlyPattern = await paymentsCollection.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          verificationStatus: 'rejected'
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]).toArray();

    // False positive rate (manual approvals after rejection)
    const manualApprovals = await paymentsCollection.countDocuments({
      createdAt: { $gte: startDate },
      reviewAction: 'approve',
      reviewedAt: { $exists: true }
    });

    const totalRejections = await paymentsCollection.countDocuments({
      createdAt: { $gte: startDate },
      verificationStatus: 'rejected'
    });

    const falsePositiveRate = totalRejections > 0 ?
      ((manualApprovals / totalRejections) * 100).toFixed(2) : 0;

    res.json({
      period,
      dateRange: { startDate, endDate: now },
      dailyTrend,
      topRejectedCustomers,
      hourlyPattern,
      metrics: {
        totalRejections,
        manualApprovals,
        falsePositiveRate: parseFloat(falsePositiveRate)
      }
    });

  } catch (error) {
    console.error('Rejection analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export rejections to Excel
app.get('/api/rejections/export', async (req, res) => {
  try {
    const { startDate, endDate, reason, format = 'xlsx' } = req.query;

    // Build filter
    const filter = { verificationStatus: 'rejected' };

    if (reason) filter.rejectionReason = reason;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const rejections = await paymentsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    // Prepare data for export
    const exportData = rejections.map(rejection => ({
      'Payment ID': rejection._id.toString(),
      'Customer Chat ID': rejection.chatId,
      'Customer Name': rejection.fullName || rejection.username,
      'Amount (KHR)': rejection.amountInKHR || 0,
      'Rejection Reason': rejection.rejectionReason || 'UNKNOWN',
      'Confidence': rejection.confidence || 'N/A',
      'Bank Name': rejection.bankName || 'Unknown',
      'Transaction Date': rejection.transactionDate ? new Date(rejection.transactionDate).toLocaleDateString() : 'N/A',
      'Created At': new Date(rejection.createdAt).toLocaleString(),
      'Rejected At': rejection.rejectedAt ? new Date(rejection.rejectedAt).toLocaleString() : 'N/A',
      'Reviewed By': rejection.reviewedBy || 'N/A',
      'Review Action': rejection.reviewAction || 'N/A',
      'Review Notes': rejection.reviewNotes || '',
      'Verification Notes': rejection.verificationNotes || '',
      'Screenshot Available': rejection.screenshotId ? 'Yes' : 'No'
    }));

    if (format === 'json') {
      res.json({
        data: exportData,
        meta: {
          total: exportData.length,
          exported: new Date().toISOString(),
          filters: { startDate, endDate, reason }
        }
      });
    } else {
      // Excel export
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportData);

      // Auto-size columns
      const colWidths = Object.keys(exportData[0] || {}).map(key => ({
        wch: Math.max(key.length, 15)
      }));
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Rejected Payments');

      const filename = `rejected_payments_${new Date().toISOString().split('T')[0]}.xlsx`;
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    }

  } catch (error) {
    console.error('Rejection export error:', error);
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
  console.log(`📥 Export data: http://localhost:${PORT}/export/all`);
  console.log(`🖼️ Export screenshots: http://localhost:${PORT}/export/screenshots`);
  console.log(`❌ Rejection audit endpoints:`);
  console.log(`  📊 Summary: http://localhost:${PORT}/api/rejections/summary`);
  console.log(`  📋 Detailed: http://localhost:${PORT}/api/rejections/detailed`);
  console.log(`  👤 Customer: http://localhost:${PORT}/api/rejections/customer/:chatId`);
  console.log(`  🔍 Analytics: http://localhost:${PORT}/api/rejections/analytics`);
  console.log(`  📤 Export: http://localhost:${PORT}/api/rejections/export`);
  console.log(`  ✏️ Review: POST http://localhost:${PORT}/api/rejections/:paymentId/review`);
  console.log(`📱 3-Chatbox System:`);
  console.log(`  ⏳ Pending: ${PENDING_CHAT_ID} (manual review required)`);
  console.log(`  ✅ Verified: ${VERIFIED_CHAT_ID} (successful payments)`);
  console.log(`  ❌ Rejected: ${REJECTED_CHAT_ID} (failed bank statements)`);
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
let screenshotsBucket;

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

    // Create index on transactionId for fast duplicate detection (security)
    await paymentsCollection.createIndex({ transactionId: 1 });
    console.log('✅ Transaction ID index created (duplicate detection)');

    // Initialize GridFS bucket for screenshots
    screenshotsBucket = new GridFSBucket(db, { bucketName: 'screenshots' });
    console.log('✅ GridFS bucket initialized: screenshots');

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

// ==== GridFS Screenshot Storage ====

/**
 * Upload screenshot to GridFS
 * @param {Buffer} buffer - Image buffer
 * @param {string} filename - Filename
 * @param {object} metadata - Additional metadata
 * @returns {Promise<string>} - GridFS file ID
 */
async function uploadScreenshotToGridFS(buffer, filename, metadata = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = screenshotsBucket.openUploadStream(filename, {
      metadata: {
        ...metadata,
        uploadedAt: new Date(),
        contentType: 'image/jpeg'
      }
    });

    uploadStream.on('finish', () => {
      console.log(`📦 GridFS: Uploaded ${filename} (${uploadStream.id})`);
      resolve(uploadStream.id.toString());
    });

    uploadStream.on('error', reject);
    uploadStream.end(buffer);
  });
}

/**
 * Download screenshot from GridFS
 * @param {string} fileId - GridFS file ID
 * @returns {Promise<Buffer>} - Image buffer
 */
async function downloadScreenshotFromGridFS(fileId) {
  const { ObjectId } = require('mongodb');
  return new Promise((resolve, reject) => {
    const chunks = [];
    const downloadStream = screenshotsBucket.openDownloadStream(new ObjectId(fileId));

    downloadStream.on('data', chunk => chunks.push(chunk));
    downloadStream.on('end', () => resolve(Buffer.concat(chunks)));
    downloadStream.on('error', reject);
  });
}

/**
 * Get screenshot info from GridFS
 * @param {string} fileId - GridFS file ID
 * @returns {Promise<object>} - File metadata
 */
async function getScreenshotInfo(fileId) {
  const { ObjectId } = require('mongodb');
  const db = client.db(DB_NAME);
  return db.collection('screenshots.files').findOne({ _id: new ObjectId(fileId) });
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

// Khmer numeral to Arabic numeral mapping (extended to handle various Unicode representations)
const KHMER_NUMERALS = {
  // Standard Khmer digits (U+17E0-U+17E9)
  '០': '0', '១': '1', '២': '2', '៣': '3', '៤': '4',
  '៥': '5', '៦': '6', '៧': '7', '៨': '8', '៩': '9',
  // Thai digits (U+0E50-U+0E59) - visually similar, GPT-4 may confuse
  '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4',
  '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9',
  // Lao digits (U+0ED0-U+0ED9) - similar script family
  '໐': '0', '໑': '1', '໒': '2', '໓': '3', '໔': '4',
  '໕': '5', '໖': '6', '໗': '7', '໘': '8', '໙': '9',
  // Myanmar digits (U+1040-U+1049)
  '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4',
  '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9',
  // Fullwidth digits (U+FF10-U+FF19)
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
};

/**
 * Debug function to log Unicode character codes
 * @param {string} str - String to analyze
 * @param {string} label - Label for the log
 */
function debugCharCodes(str, label = 'DEBUG') {
  if (!str) return;
  const chars = [...str];
  const charInfo = chars.map(char => {
    const code = char.codePointAt(0);
    return `"${char}"=U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }).join(' ');
  console.log(`[${label}] ${charInfo}`);
}

// Khmer month names to month number (1-12)
const KHMER_MONTHS = {
  'មករា': 1,      // January
  'កុម្ភៈ': 2,     // February
  'មីនា': 3,      // March
  'មេសា': 4,      // April
  'ឧសភា': 5,      // May
  'មិថុនា': 6,    // June
  'កក្កដា': 7,    // July
  'សីហា': 8,      // August
  'កញ្ញា': 9,     // September
  'តុលា': 10,     // October
  'វិច្ឆិកា': 11,  // November
  'ធ្នូ': 12       // December
};

// Alternative Khmer month spellings
const KHMER_MONTHS_ALT = {
  'មករ': 1,       // January (short)
  'កុម្ភ': 2,      // February (short)
  'មិនា': 3,      // March (alt spelling)
  'មេសorg': 4,    // April (alt)
  'ឧសភorg': 5,    // May (alt)
  'មិថorg': 6,    // June (alt)
  'កក្កorg': 7,   // July (alt)
  'សីorg': 8,     // August (alt)
  'កញorg': 9,     // September (alt)
  'តorg': 10,     // October (alt)
  'វorg': 11,     // November (alt)
  'ធorg': 12      // December (alt)
};

/**
 * Converts Khmer numerals to Arabic numerals
 * @param {string} str - String containing Khmer numerals
 * @returns {string} - String with Arabic numerals
 */
function convertKhmerNumerals(str) {
  if (!str) return str;

  // Debug: Log input character codes to identify unknown numerals
  debugCharCodes(str, 'NUMERAL-INPUT');

  let result = str;
  for (const [khmer, arabic] of Object.entries(KHMER_NUMERALS)) {
    result = result.replace(new RegExp(khmer, 'g'), arabic);
  }

  // Check if conversion happened
  if (result !== str) {
    console.log(`[NUMERAL-CONVERT] "${str}" → "${result}"`);
  } else {
    // If no conversion, log warning - might have unknown characters
    const hasNonAsciiDigits = /[^\x00-\x7F0-9\s]/.test(str);
    if (hasNonAsciiDigits) {
      console.log(`[NUMERAL-WARN] No conversion for: "${str}" - may contain unmapped characters`);
    }
  }

  return result;
}

/**
 * Normalizes Khmer text by removing zero-width characters and extra spaces
 * @param {string} str - String to normalize
 * @returns {string} - Normalized string
 */
function normalizeKhmerText(str) {
  if (!str) return str;
  return str
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '') // Remove zero-width chars and non-breaking spaces
    .replace(/\s+/g, ' ')                         // Normalize multiple spaces to single
    .trim();
}

/**
 * Finds Khmer month name in a string and returns the month number
 * Uses normalized matching to handle Unicode variations
 * @param {string} str - String to search
 * @returns {object|null} - { month: number, match: string } or null
 */
function findKhmerMonth(str) {
  if (!str) return null;

  const normalized = normalizeKhmerText(str);

  // Try exact match first with primary month names
  for (const [khmerMonth, monthNum] of Object.entries(KHMER_MONTHS)) {
    if (normalized.includes(khmerMonth)) {
      return { month: monthNum, match: khmerMonth };
    }
  }

  // Try alternative spellings
  for (const [khmerMonth, monthNum] of Object.entries(KHMER_MONTHS_ALT)) {
    if (normalized.includes(khmerMonth)) {
      return { month: monthNum, match: khmerMonth };
    }
  }

  return null;
}

/**
 * Checks if string contains Khmer script characters (U+1780-U+17FF)
 */
function containsKhmerScript(str) {
  if (!str) return false;
  return /[\u1780-\u17FF]/.test(str);
}

/**
 * Parse English date formats (no Khmer characters)
 * Supports: ISO, "Jan 8, 2026", "08/01/2026", etc.
 */
function parseEnglishDate(dateStr) {
  if (!dateStr) return null;

  console.log(`[DATE-PARSE] Input: "${dateStr}"`);

  // 1. Try ISO format FIRST: "YYYY-MM-DDTHH:MM" (expected from GPT-4)
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]) - 1; // JS months are 0-indexed
    const day = parseInt(isoMatch[3]);
    const hour = isoMatch[4] ? parseInt(isoMatch[4]) : 0;
    const minute = isoMatch[5] ? parseInt(isoMatch[5]) : 0;

    if (year >= 2020 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const date = new Date(year, month, day, hour, minute);
      console.log(`[DATE-PARSE] ISO format: ${year}-${month+1}-${day} ${hour}:${minute} → ${date.toISOString()}`);
      return date;
    }
  }

  // 2. Handle pipe separator (legacy: "8 January 2026 | 10:04")
  let datePart = dateStr;
  let timePart = null;
  if (dateStr.includes('|')) {
    const parts = dateStr.split('|').map(p => p.trim());
    datePart = parts[0];
    timePart = parts[1];
  }

  // 3. Try "DD Month YYYY" format (e.g., "8 January 2026")
  const ENGLISH_MONTHS = {
    'january': 0, 'february': 1, 'march': 2, 'april': 3,
    'may': 4, 'june': 5, 'july': 6, 'august': 7,
    'september': 8, 'october': 9, 'november': 10, 'december': 11,
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  };

  const ddMonthYYYY = datePart.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (ddMonthYYYY) {
    const day = parseInt(ddMonthYYYY[1]);
    const monthName = ddMonthYYYY[2].toLowerCase();
    const year = parseInt(ddMonthYYYY[3]);
    const month = ENGLISH_MONTHS[monthName];

    if (month !== undefined && day >= 1 && day <= 31 && year >= 2020) {
      const date = new Date(year, month, day);
      if (timePart) {
        const timeMatch = timePart.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]));
      }
      console.log(`[DATE-PARSE] DD Month YYYY: ${day} ${monthName} ${year} → ${date.toISOString()}`);
      return date;
    }
  }

  // 4. Try DD/MM/YYYY format (Cambodia standard)
  const ddmmyyyy = datePart.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmmyyyy) {
    let day = parseInt(ddmmyyyy[1]);
    let month = parseInt(ddmmyyyy[2]);
    const year = parseInt(ddmmyyyy[3]);

    // Swap if month > 12 (must be DD/MM/YYYY)
    if (month > 12 && day <= 12) [day, month] = [month, day];

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020) {
      const date = new Date(year, month - 1, day);
      console.log(`[DATE-PARSE] DD/MM/YYYY: ${day}/${month}/${year} → ${date.toISOString()}`);
      return date;
    }
  }

  console.log(`[ENGLISH] Failed to parse: "${dateStr}"`);
  return null;
}

/**
 * Parse Khmer date formats (contains Khmer characters)
 * Handles: "org org org org org org org org org", "org org org org org org org | org org:org org", etc.
 */
function parseKhmerDateOnly(dateStr) {
  if (!dateStr) return null;

  // Normalize and convert Khmer numerals to Arabic
  let normalized = normalizeKhmerText(dateStr);
  normalized = convertKhmerNumerals(normalized);
  console.log(`[KHMER] Normalized: "${normalized}"`);

  // Handle pipe separator - split date and time parts
  let datePart = normalized;
  let timePart = '';
  if (normalized.includes('|')) {
    const parts = normalized.split('|');
    datePart = parts[0].trim();
    timePart = parts[1]?.trim() || '';
    console.log(`[KHMER] Date: "${datePart}", Time: "${timePart}"`);
  }

  // Find Khmer month name
  const monthResult = findKhmerMonth(datePart);
  if (!monthResult) {
    console.log(`[KHMER] No month found in: "${datePart}"`);
    return null;
  }

  const month = monthResult.month;
  const monthMatch = monthResult.match;
  console.log(`[KHMER] Month: ${monthMatch} -> ${month}`);

  // Extract numbers from date part (excluding month name)
  const withoutMonth = datePart.replace(monthMatch, ' ');
  const dateNumbers = withoutMonth.match(/\d+/g) || [];
  console.log(`[KHMER] Date numbers: ${JSON.stringify(dateNumbers)}`);

  // Extract time from time part
  let hour = 0, minute = 0;
  if (timePart) {
    const timeNumbers = timePart.match(/\d+/g) || [];
    if (timeNumbers.length >= 2) {
      hour = parseInt(timeNumbers[0]) || 0;
      minute = parseInt(timeNumbers[1]) || 0;
      if (hour > 23) hour = 0;
      if (minute > 59) minute = 0;
    }
  }

  if (dateNumbers.length < 2) {
    console.log(`[KHMER] Not enough numbers for day/year`);
    return null;
  }

  // Find year (4-digit number or > 31)
  let day, year;
  for (const num of dateNumbers) {
    const n = parseInt(num);
    if (num.length === 4 || n > 31) {
      year = n < 100 ? n + 2000 : n;
      break;
    }
  }

  // Find day (1-31, not the year)
  for (const num of dateNumbers) {
    const n = parseInt(num);
    if (n >= 1 && n <= 31 && n !== year) {
      day = n;
      break;
    }
  }

  console.log(`[KHMER] Extracted: day=${day}, month=${month}, year=${year}, time=${hour}:${minute}`);

  // Validate and create date
  if (day && month && year && day >= 1 && day <= 31 && year >= 2020 && year <= 2100) {
    const date = new Date(year, month - 1, day, hour, minute);
    if (!isNaN(date.getTime())) {
      console.log(`[KHMER] Success: ${date.toISOString()}`);
      return date;
    }
  }

  console.log(`[KHMER] Validation failed`);
  return null;
}

/**
 * Main date parser - detects English vs Khmer and routes accordingly
 * Supports formats:
 * - "០៦ មករា ២០២៦" (pure Khmer)
 * - "06 មករា 2026" (mixed)
 * - "៦ មករorg ២០២៦ ១៣:៣៥" (with time)
 * - "06/01/2026" or "06-01-2026" (standard with Khmer numerals)
 *
 * @param {string} dateStr - Date string potentially containing Khmer
 * @returns {Date|null} - Parsed Date object or null if failed
 */
function parseKhmerDate(dateStr) {
  if (!dateStr) return null;

  try {
    // Detect if string contains Khmer script
    const hasKhmer = containsKhmerScript(dateStr);
    console.log(`[DATE-PARSE] Input: "${dateStr}" | Type: ${hasKhmer ? 'KHMER' : 'ENGLISH'}`);

    if (!hasKhmer) {
      // ========== ENGLISH PATH ==========
      const englishDate = parseEnglishDate(dateStr);
      if (englishDate) {
        console.log(`[DATE-PARSE] ✅ English: ${englishDate.toISOString()}`);
        return englishDate;
      }
      console.log(`[DATE-PARSE] ❌ English parsing failed`);
      return null;
    }

    // ========== KHMER PATH ==========
    const khmerDate = parseKhmerDateOnly(dateStr);
    if (khmerDate) {
      console.log(`[DATE-PARSE] ✅ Khmer: ${khmerDate.toISOString()}`);
      return khmerDate;
    }

    // Fallback: convert numerals and try English parsing
    const normalized = convertKhmerNumerals(normalizeKhmerText(dateStr));
    const fallbackDate = parseEnglishDate(normalized);
    if (fallbackDate) {
      console.log(`[DATE-PARSE] ✅ Fallback: ${fallbackDate.toISOString()}`);
      return fallbackDate;
    }

    console.log(`[DATE-PARSE] ❌ All parsing failed`);
    return null;
  } catch (error) {
    console.error(`[DATE-PARSE] ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Validates transaction date and checks for screenshot age fraud
 * @param {string} transactionDateStr - Transaction date from OCR
 * @param {Date} uploadedAt - When screenshot was uploaded
 * @param {number} maxAgeDays - Maximum allowed age in days
 * @returns {object} - { isValid, fraudType, ageDays, parsedDate, reason }
 */
function validateTransactionDate(transactionDateStr, uploadedAt, maxAgeDays = 7, paymentData = null) {
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

  // NEW: Month/Year only validation (more reliable for Khmer dates)
  // If we have transactionMonth and transactionYear from Claude/GPT-4, use those
  if (paymentData && paymentData.transactionMonth && paymentData.transactionYear) {
    const txMonth = paymentData.transactionMonth;
    const txYear = paymentData.transactionYear;
    const currentMonth = uploadedAt.getMonth() + 1; // 1-12
    const currentYear = uploadedAt.getFullYear();

    console.log(`📅 Validating month/year: ${txMonth}/${txYear} vs current ${currentMonth}/${currentYear}`);

    // Calculate months difference
    const monthsDiff = (currentYear - txYear) * 12 + (currentMonth - txMonth);

    // Allow current month and previous month only
    if (monthsDiff < 0) {
      result.isValid = false;
      result.fraudType = 'FUTURE_DATE';
      result.reason = `Transaction date ${txMonth}/${txYear} is in the future`;
      return result;
    }

    if (monthsDiff > 1) {
      result.isValid = false;
      result.fraudType = 'OLD_SCREENSHOT';
      result.ageDays = monthsDiff * 30; // Approximate
      result.reason = `Screenshot is from ${txMonth}/${txYear} (${monthsDiff} months old)`;
      return result;
    }

    // Valid: same month or previous month
    result.parsedDate = new Date(txYear, txMonth - 1, 1);
    result.ageDays = monthsDiff * 30;
    return result;
  }

  // Fallback: Parse full date if month/year not available
  let transactionDate;
  try {
    transactionDate = parseKhmerDate(transactionDateStr);

    if (!transactionDate || isNaN(transactionDate.getTime())) {
      result.isValid = false;
      result.fraudType = 'INVALID_DATE';
      result.reason = `Invalid date format: ${transactionDateStr}`;
      return result;
    }

    result.parsedDate = transactionDate;
    console.log(`📅 Parsed date: "${transactionDateStr}" → ${transactionDate.toISOString()}`);
  } catch (error) {
    result.isValid = false;
    result.fraudType = 'INVALID_DATE';
    result.reason = `Failed to parse date: ${transactionDateStr}`;
    return result;
  }

  // Future date check
  if (transactionDate > uploadedAt) {
    const futureDays = Math.ceil((transactionDate - uploadedAt) / (1000 * 60 * 60 * 24));
    result.isValid = false;
    result.fraudType = 'FUTURE_DATE';
    result.ageDays = -futureDays;
    result.reason = `Transaction date is ${futureDays} days in the future`;
    return result;
  }

  // Old screenshot check
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

// ==== OpenAI Rate Limiter (Enhanced with Sequential Processing) ====
class OpenAIRateLimiter {
  constructor(maxRequestsPerMinute = 10, minDelayMs = 2000) {
    this.maxRequests = maxRequestsPerMinute;
    this.minDelay = minDelayMs; // Minimum delay between requests
    this.requests = [];
    this.lastRequestTime = 0;
    this.queue = [];
    this.processing = false;
  }

  async waitForSlot() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove requests older than 1 minute
    this.requests = this.requests.filter(time => time > oneMinuteAgo);

    // Check rate limit per minute
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = oldestRequest + 60000 - now + 100;
      console.log(`⏳ Rate limit reached (${this.requests.length}/${this.maxRequests}). Waiting ${Math.ceil(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForSlot();
    }

    // Enforce minimum delay between requests for accurate processing
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minDelay) {
      const delayNeeded = this.minDelay - timeSinceLastRequest;
      console.log(`⏳ Spacing requests: waiting ${delayNeeded}ms for accurate OCR...`);
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }

    this.lastRequestTime = Date.now();
    this.requests.push(this.lastRequestTime);
    console.log(`📊 Rate limiter: ${this.requests.length}/${this.maxRequests} requests in last minute (${this.minDelay}ms spacing)`);
  }

  getStatus() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.requests = this.requests.filter(time => time > oneMinuteAgo);
    return {
      currentRequests: this.requests.length,
      maxRequests: this.maxRequests,
      available: this.maxRequests - this.requests.length,
      minDelay: this.minDelay
    };
  }
}

// Rate limiter configuration from environment
const OCR_RATE_LIMIT = parseInt(process.env.OCR_RATE_LIMIT_PER_MINUTE) || 10;
const OCR_MIN_DELAY = parseInt(process.env.OCR_MIN_DELAY_MS) || 2000; // 2 seconds between requests
const openaiRateLimiter = new OpenAIRateLimiter(OCR_RATE_LIMIT, OCR_MIN_DELAY);

// ==== Claude Haiku for Khmer Date OCR ====
const anthropic = process.env.CLAUDE_API_KEY
  ? new Anthropic.default({ apiKey: process.env.CLAUDE_API_KEY })
  : null;

/**
 * Extract date from bank screenshot using Claude Haiku (better for Khmer script)
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {object|null} - { day, month, year, hour, minute } or null
 */
async function extractKhmerDateWithClaude(imageBuffer) {
  if (!anthropic) {
    console.log('[CLAUDE-OCR] Skipped: CLAUDE_API_KEY not set');
    return null;
  }

  try {
    console.log('[CLAUDE-OCR] Extracting date with Claude Haiku...');

    const response = await anthropic.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageBuffer.toString('base64')
            }
          },
          {
            type: "text",
            text: (() => {
              const now = new Date();
              const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
              const currentMonth = monthNames[now.getMonth()];
              const currentYear = now.getFullYear();
              return `Khmer bank screenshot. Current date is ${currentMonth} ${currentYear}. Find the transaction MONTH and YEAR in Khmer script. The month is likely ${currentMonth} (month ${now.getMonth() + 1}). Return MM/YYYY only. If unclear: UNCLEAR`;
            })()
          }
        ]
      }]
    });

    const responseText = response.content[0].text.trim();
    console.log(`[CLAUDE-OCR] Raw response: ${responseText}`);

    // Check for UNCLEAR
    if (responseText.toUpperCase().includes('UNCLEAR')) {
      console.log('[CLAUDE-OCR] Date unclear');
      return null;
    }

    // Parse MM/YYYY format
    const dateMatch = responseText.match(/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const dateData = {
        month: parseInt(dateMatch[1]),
        year: parseInt(dateMatch[2])
      };
      console.log(`[CLAUDE-OCR] Extracted: ${dateData.month}/${dateData.year}`);
      return dateData;
    }

    return null;
  } catch (error) {
    console.error(`[CLAUDE-OCR] Error: ${error.message}`);
    return null;
  }
}

// ==== Retry Logic with Exponential Backoff ====
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = parseInt(process.env.OCR_MAX_RETRIES) || 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'rate_limit', '429', '500', '502', '503']
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorMessage = error.message || error.toString();
      const errorCode = error.code || error.status || '';

      // Check if error is retryable
      const isRetryable = retryableErrors.some(e =>
        errorMessage.includes(e) || errorCode.toString().includes(e)
      );

      if (!isRetryable || attempt === maxRetries) {
        console.error(`❌ OCR failed after ${attempt} attempt(s): ${errorMessage}`);
        throw error;
      }

      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt - 1) + Math.random() * 1000,
        maxDelay
      );

      console.log(`⚠️ OCR attempt ${attempt}/${maxRetries} failed: ${errorMessage}`);
      console.log(`🔄 Retrying in ${Math.ceil(delay / 1000)}s...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

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
async function analyzePaymentScreenshot(imagePath, chatId, userId, username, fullName, groupName = null) {
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

    // Call GPT-4o Vision API with retry logic and rate limiting (upgraded from 4o-mini for accuracy)
    const openaiTimeout = parseInt(process.env.OCR_TIMEOUT_MS) || 60000;

    const response = await retryWithBackoff(async () => {
      // Wait for rate limiter slot before each attempt
      await openaiRateLimiter.waitForSlot();

      console.log(`🔍 Calling GPT-4o Vision API for Bank Statement OCR...`);

      return await Promise.race([
        openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are a BANK STATEMENT VERIFICATION OCR system for Cambodian banks.

STEP 1: IDENTIFY IMAGE TYPE
First, determine if this image is from a BANKING APP at all.

Set isBankStatement=FALSE if:
- This is a chat screenshot (Telegram, WhatsApp, Messenger, LINE, etc.)
- This is an invoice, bill, receipt, or QR code (NOT payment confirmation)
- This is a random photo, meme, selfie, or non-banking image
- This is text/numbers without a banking app interface
- You cannot identify any banking app UI elements

Set isBankStatement=TRUE if:
- This shows a banking app interface (ABA Bank, Wing, ACLEDA, Canadia, Prince Bank, Sathapana)
- Even if blurry, cropped, or partially visible - if it's clearly FROM a bank app

STEP 2: VERIFY PAYMENT (only if isBankStatement=TRUE)
If this IS a bank statement, determine if it's a valid payment proof:

Set isPaid=TRUE if this is a COMPLETED TRANSFER. Look for:

ABA Bank format (IMPORTANT - no "Success" text!):
- CT logo with minus amount (e.g., "-28,000 KHR" or "-6.99 USD")
- Shows "Trx. ID:", "To account:", "From account:"
- Minus sign = money was sent = completed transfer
- Has Transaction ID and Reference number

ACLEDA/Wing format:
- Shows "រួចរាល់" (completed) or checkmark ✓
- Green success screen with amount

Other banks:
- "Success", "Completed", "ជោគជ័យ" text
- Checkmark or green confirmation

A transfer IS PAID if you can see:
1. Amount (even with minus sign like -28,000)
2. Transaction ID or Reference number
3. Recipient info (account number OR name like "CHAN K. & THOEURN T.")

Set isPaid=FALSE but keep isBankStatement=TRUE if:
- Image is too blurry to read
- Image is cropped/partial - missing key fields
- Shows "Pending", "Failed", or "Processing" status

KHMER NUMERAL REFERENCE (CRITICAL - use this to read dates accurately):
០ = 0    ១ = 1    ២ = 2    ៣ = 3    ៤ = 4
៥ = 5    ៦ = 6    ៧ = 7    ៨ = 8    ៩ = 9

KHMER MONTHS:
មករា = January (1)      កុម្ភៈ = February (2)
មីនា = March (3)        មេសា = April (4)
ឧសភា = May (5)          មិថុនា = June (6)
កក្កដា = July (7)       សីហា = August (8)
កញ្ញា = September (9)   តុលា = October (10)
វិច្ឆិកា = November (11) ធ្នូ = December (12)

YEAR VALIDATION: Current year is 2026. Bank screenshots should show 2024-2026.
If you read a year like 2022 or 2023, RECHECK each digit against the chart above!

STEP 3: EXTRACT PAYMENT DATA (only if isPaid=TRUE)
Extract ALL fields carefully:
- toAccount: The recipient account number (CRITICAL for security)
- amount: CRITICAL - Read the MAIN/HEADER amount (large text, usually colored/highlighted):
  * Look for the PRIMARY amount displayed prominently (e.g., "34,000 org" in header)
  * DO NOT calculate or convert from USD to KHR yourself
  * If screen shows both USD and KHR, use the KHR amount displayed
  * If only USD shown, return USD amount and set currency="USD"
  * ACLEDA: Read the green header amount (e.g., "34,000 org")
  * ABA: Read the main amount after minus sign (e.g., "-28,000 KHR" → 28000)
  * Remove commas, return as number (34,000 → 34000)
- transactionId: The Trx. ID or Transaction ID
- DATE FIELDS: Return date as SEPARATE components (more accurate for Khmer):
  Use the Khmer numeral and month charts above carefully.
  * dateDay: The day number (1-31)
  * dateMonth: The month number (1-12). Use chart: មករorg org org org=1, កorg org org org org org org org=2, org org org org org org org org=3, org org org org org org org org=4, org org org org org org org org=5, org org org org org org org org org org=6, org org org org org org org org org org=7, org org org org org org org org=8, org org org org org org org org=9, org org org org org org org org=10, org org org org org org org org org org org org org org=11, org org org org org org org org=12
  * dateYear: The 4-digit year (2024, 2025, 2026)
  * dateHour: Hour (0-23)
  * dateMinute: Minute (0-59)

Return JSON format:
{
  "isBankStatement": true/false,
  "isPaid": true/false,
  "amount": number (HEADER amount, POSITIVE, no commas: 34000 not 33840),
  "currency": "KHR" or "USD",
  "transactionId": "string",
  "referenceNumber": "string",
  "fromAccount": "string (sender account/name)",
  "toAccount": "string (recipient account number)",
  "bankName": "string",
  "dateDay": number (1-31),
  "dateMonth": number (1-12),
  "dateYear": number (2024-2026),
  "dateHour": number (0-23),
  "dateMinute": number (0-59),
  "remark": "string",
  "recipientName": "string",
  "confidence": "high/medium/low"
}

RULES:
1. isBankStatement is about IMAGE TYPE (is it from a bank app?)
2. isPaid is about PAYMENT VALIDITY (can we verify the transfer?)
3. Random photo → isBankStatement=false, isPaid=false, confidence=low
4. Blurry bank statement → isBankStatement=true, isPaid=false, confidence=low
5. Clear bank statement → isBankStatement=true, isPaid=true, confidence=high/medium
6. Amount MUST be positive (if shows -28,000 KHR, return 28000)`
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
          max_tokens: 1500
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenAI API timeout')), openaiTimeout)
        )
      ]);
    });

    console.log(`✅ OCR completed successfully`);

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

    // Use Claude Haiku for accurate Khmer date extraction (GPT-4 is unreliable for Khmer)
    const claudeDate = await extractKhmerDateWithClaude(imageBuffer);

    if (claudeDate && claudeDate.year && claudeDate.month) {
      const year = parseInt(claudeDate.year);
      const month = parseInt(claudeDate.month);

      // Validate month/year only (day is unreliable with Khmer OCR)
      if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12) {
        // Store month/year for validation, use day 1 as placeholder
        const date = new Date(year, month - 1, 1, 0, 0);
        paymentData.transactionDate = date.toISOString();
        paymentData.transactionMonth = month;
        paymentData.transactionYear = year;
        console.log(`📅 [DATE] Claude Haiku: ${month}/${year} → ${paymentData.transactionDate}`);
      } else {
        console.log(`⚠️ [DATE] Invalid Claude components: year=${year}, month=${month}`);
        paymentData.transactionDate = null;
      }
    } else if (paymentData.dateYear && paymentData.dateMonth) {
      // Fallback to GPT-4 date fields if Claude fails (month/year only)
      const year = parseInt(paymentData.dateYear);
      const month = parseInt(paymentData.dateMonth);

      if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12) {
        const date = new Date(year, month - 1, 1, 0, 0);
        paymentData.transactionDate = date.toISOString();
        paymentData.transactionMonth = month;
        paymentData.transactionYear = year;
        console.log(`📅 [DATE] GPT-4 fallback: ${month}/${year} → ${paymentData.transactionDate}`);
      } else {
        console.log(`⚠️ [DATE] Invalid GPT-4 components: year=${year}, month=${month}`);
        paymentData.transactionDate = null;
      }
    } else {
      console.log(`⚠️ [DATE] No date extracted from Claude or GPT-4`);
      paymentData.transactionDate = null;
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

    // ==== BANK FORMAT ENHANCEMENT ====
    // Try enhanced ML bank format extraction
    console.log(`📋 Original OCR: ${paymentData.recipientName} / ${paymentData.toAccount}`);

    let enhancedResult = null;
    let toAccount = paymentData.toAccount || '';
    let recipientName = paymentData.recipientName || '';

    try {
      enhancedResult = await extractWithEnhancedBankFormat(aiResponse);
      console.log(`🤖 Enhanced ML result:`, {
        bank: enhancedResult.bank,
        success: enhancedResult.success,
        confidence: enhancedResult.confidence.toFixed(3),
        method: enhancedResult.method
      });

      // Use enhanced results if they're confident
      if (enhancedResult.success && enhancedResult.confidence > 0.4) {
        if (enhancedResult.recipientName && !recipientName) {
          recipientName = enhancedResult.recipientName;
          console.log(`🤖 Enhanced ML recipient: "${recipientName}" (${enhancedResult.bank})`);
        }

        if (enhancedResult.toAccount && !toAccount) {
          toAccount = enhancedResult.toAccount;
          console.log(`🤖 Enhanced ML account: "${toAccount}" (${enhancedResult.bank})`);
        }

        // Store enhanced metadata
        paymentData.bankFormatEnhancement = {
          detected: true,
          bank: enhancedResult.bank,
          confidence: enhancedResult.confidence,
          method: enhancedResult.method,
          mlEnhancement: enhancedResult.mlEnhancement
        };
      } else {
        paymentData.bankFormatEnhancement = {
          detected: false,
          reason: enhancedResult.reason || 'low_confidence',
          method: enhancedResult.method
        };
      }
    } catch (error) {
      console.warn(`⚠️ Enhanced ML extraction failed, using fallback: ${error.message}`);

      // Fallback to traditional bank format extraction
      const bankFormatResult = extractWithBankFormat(aiResponse);

      if (bankFormatResult.success && bankFormatResult.confidence > 0.7) {
        if (bankFormatResult.recipientName && !recipientName) {
          recipientName = bankFormatResult.recipientName;
        }
        if (bankFormatResult.toAccount && !toAccount) {
          toAccount = bankFormatResult.toAccount;
        }

        paymentData.bankFormatEnhancement = {
          detected: true,
          bank: bankFormatResult.bank,
          confidence: bankFormatResult.confidence,
          method: 'fallback_traditional'
        };
      } else {
        paymentData.bankFormatEnhancement = {
          detected: false,
          reason: 'fallback_failed',
          method: 'fallback_traditional'
        };
      }
    }

    // ==== ENHANCED SECURITY: ML-Powered Recipient Verification ====
    let recipientVerified = false;
    let recipientVerificationDetails = null;

    try {
      // Try ML-enhanced recipient validation if available
      if (enhancedResult?.mlEnhancement?.recipientValidation) {
        const mlValidation = enhancedResult.mlEnhancement.recipientValidation;
        recipientVerificationDetails = mlValidation;

        if (mlValidation.finalResult) {
          recipientVerified = mlValidation.finalResult.isValid;
          const confidence = mlValidation.finalResult.confidence;

          if (recipientVerified && confidence > 0.7) {
            console.log(`✅ SECURITY: ML recipient verified | Chat ${chatId} | Account: ${toAccount} | Name: ${recipientName} | Confidence: ${confidence.toFixed(3)} | Method: ${mlValidation.finalResult.method}`);
          } else if (recipientVerified && confidence > 0.4) {
            console.log(`⚡ SECURITY: ML recipient verified (medium confidence) | Chat ${chatId} | Confidence: ${confidence.toFixed(3)}`);
          } else {
            console.log(`🚨 SECURITY: ML recipient validation failed | Chat ${chatId} | Confidence: ${confidence.toFixed(3)} | Method: ${mlValidation.finalResult.method}`);
          }
        }
      }

      // Fallback to rule-based validation if ML didn't run or has low confidence
      if (!recipientVerified || (recipientVerificationDetails?.finalResult?.confidence || 0) < 0.6) {
        console.log('📋 Using fallback rule-based recipient validation...');

        // Traditional verification logic
        const combinedText = (toAccount + ' ' + recipientName).toLowerCase();
        const normalizedAccount = toAccount.replace(/\s/g, '').toLowerCase();

        const ruleBasedVerified = (
          normalizedAccount.includes('086228226') ||     // account no spaces
          combinedText.includes('086 228 226') ||        // account with spaces
          combinedText.includes('chan k') ||             // "CHAN K." initials
          combinedText.includes('thoeurn t') ||          // "THOEURN T." initials
          combinedText.includes('chan kasing') ||        // full name
          combinedText.includes('thoeurn theary')        // full name
        );

        // Use rule-based result if ML confidence is low
        if (!recipientVerified || (recipientVerificationDetails?.finalResult?.confidence || 0) < 0.4) {
          recipientVerified = ruleBasedVerified;
          console.log(`📝 Rule-based verification: ${ruleBasedVerified} | Chat ${chatId}`);
        }
      }

    } catch (error) {
      console.warn(`⚠️ ML recipient validation error: ${error.message}`);

      // Fallback to traditional verification
      const combinedText = (toAccount + ' ' + recipientName).toLowerCase();
      const normalizedAccount = toAccount.replace(/\s/g, '').toLowerCase();

      recipientVerified = (
        normalizedAccount.includes('086228226') ||
        combinedText.includes('086 228 226') ||
        combinedText.includes('chan k') ||
        combinedText.includes('thoeurn t') ||
        combinedText.includes('chan kasing') ||
        combinedText.includes('thoeurn theary')
      );

      console.log(`📝 Fallback verification: ${recipientVerified} | Chat ${chatId}`);
    }

    // Log final verification result
    if (recipientVerified) {
      console.log(`✅ SECURITY: Final recipient verification PASSED | Chat ${chatId} | Account: ${toAccount} | Name: ${recipientName}`);
    } else if (!toAccount && !recipientName) {
      console.log(`⚠️ SECURITY: No recipient info found | Chat ${chatId}`);
    } else {
      console.log(`🚨 SECURITY: Final recipient verification FAILED | Chat ${chatId} | Got: ${toAccount} / ${recipientName}`);
    }

    // Store recipient verification details for analytics
    if (recipientVerificationDetails) {
      paymentData.mlRecipientValidation = recipientVerificationDetails;
    }

    // ==== 3-STAGE VERIFICATION PIPELINE ====
    let finalVerificationStatus = 'pending';
    let paymentLabel = 'PENDING';
    let rejectionReason = null;

    // STAGE 1: Is it a bank statement?
    if (paymentData.isBankStatement === false) {
      finalVerificationStatus = 'rejected';
      rejectionReason = 'NOT_BANK_STATEMENT';
      paymentLabel = 'UNPAID';
      console.log(`🔇 Stage 1: NOT a bank statement | Chat ${chatId}`);
    }
    // STAGE 2: Confidence check (blurry?)
    else if (paymentData.confidence !== 'high') {
      finalVerificationStatus = 'pending';
      rejectionReason = 'BLURRY';
      paymentLabel = 'PENDING';
      console.log(`⏳ Stage 2: Blurry/unclear (${paymentData.confidence} confidence) | Chat ${chatId}`);
    }
    // STAGE 3: Security verification (HIGH confidence only)
    else {
      // Check 3a: Recipient
      if (!recipientVerified && (toAccount || recipientName)) {
        finalVerificationStatus = 'rejected';
        rejectionReason = 'WRONG_RECIPIENT';
        paymentLabel = 'UNPAID';
        verificationNotes += ` | SECURITY: Wrong recipient - got ${toAccount} / ${recipientName}`;
        console.log(`❌ Stage 3a: Wrong recipient | Chat ${chatId}`);
      }
      // Check 3b: Amount
      else if (!isVerified) {
        finalVerificationStatus = 'pending';
        rejectionReason = 'AMOUNT_MISMATCH';
        paymentLabel = 'PENDING';
        console.log(`⏳ Stage 3b: Amount mismatch | Chat ${chatId} | Expected: ${expectedAmountKHR} | Got: ${amountInKHR}`);
      }
      // All checks pass
      else {
        finalVerificationStatus = 'verified';
        rejectionReason = null;
        paymentLabel = 'PAID';
        console.log(`✅ Stage 3: All checks passed | Chat ${chatId}`);
      }
    }

    // ==== FRAUD DETECTION: Old Screenshot Check ====
    // Only check for OLD_SCREENSHOT fraud if date is successfully extracted
    // Skip fraud check for MISSING_DATE or INVALID_DATE (Khmer dates cause GPT-4 to return null)
    const MAX_SCREENSHOT_AGE_DAYS = parseInt(process.env.MAX_SCREENSHOT_AGE_DAYS) || 7;

    if (paymentData.transactionDate && paymentData.transactionDate !== 'null') {
      const dateValidation = validateTransactionDate(
        paymentData.transactionDate,
        new Date(), // uploadedAt
        MAX_SCREENSHOT_AGE_DAYS,
        paymentData // Pass paymentData for month/year validation
      );

      // Only flag fraud for OLD_SCREENSHOT (date is readable but too old)
      // Skip MISSING_DATE, INVALID_DATE, FUTURE_DATE (likely Khmer date extraction issues)
      if (!dateValidation.isValid && dateValidation.fraudType === 'OLD_SCREENSHOT') {
        console.log(`🚨 FRAUD DETECTED: ${dateValidation.fraudType} | ${dateValidation.reason}`);

        // Log to fraudAlerts collection
        const alertId = await logFraudAlert({
          fraudType: dateValidation.fraudType,
          severity: 'HIGH',
          chatId: chatId,
          userId: userId,
          username: username,
          fullName: fullName,
          groupName: groupName,
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

        // Override verification status → REJECTED (fraud)
        finalVerificationStatus = 'rejected';
        rejectionReason = 'OLD_SCREENSHOT';
        paymentLabel = 'UNPAID';

        // Update verification notes
        verificationNotes += ` | FRAUD: ${dateValidation.reason} | Alert: ${alertId}`;
      }
    }

    // ==== SECURITY: Transaction ID Uniqueness Check (Prevent Duplicate Fraud) ====
    // Check if transaction ID has already been used by another customer
    if (paymentData.transactionId && paymentData.transactionId.trim() !== '') {
      const existingPayment = await paymentsCollection.findOne({
        transactionId: paymentData.transactionId,
        paymentLabel: { $in: ['PAID', 'PENDING'] } // Only check verified/pending payments
      });

      if (existingPayment) {
        // Duplicate transaction detected!
        console.log(`🚨 DUPLICATE TRANSACTION DETECTED | Trx ID: ${paymentData.transactionId} | Chat ${chatId} | Original: ${existingPayment.chatId}`);

        // Log to fraudAlerts collection
        const alertId = await logFraudAlert({
          fraudType: 'DUPLICATE_TRANSACTION',
          severity: 'CRITICAL',
          chatId: chatId,
          userId: userId,
          username: username,
          fullName: fullName,
          groupName: groupName,
          transactionDate: paymentData.transactionDate,
          uploadedAt: new Date(),
          screenshotAgeDays: null,
          maxAllowedAgeDays: null,
          transactionId: paymentData.transactionId,
          referenceNumber: paymentData.referenceNumber,
          amount: amountInKHR,
          currency: paymentData.currency,
          bankName: paymentData.bankName,
          screenshotPath: imagePath,
          verificationNotes: `DUPLICATE: Transaction ${paymentData.transactionId} already used by chatId ${existingPayment.chatId}`,
          confidence: paymentData.confidence,
          aiAnalysis: aiResponse,
          actionTaken: 'REJECTED_DUPLICATE'
        });

        // Override to REJECTED
        finalVerificationStatus = 'rejected';
        rejectionReason = 'DUPLICATE_TRANSACTION';
        paymentLabel = 'UNPAID';

        verificationNotes += ` | FRAUD: Duplicate transaction ID (already used by another customer) | Alert: ${alertId}`;
      }
    }

    // ==== MESSAGE LOGIC based on rejectionReason ====
    let userMessage = null;

    if (rejectionReason === 'NOT_BANK_STATEMENT') {
      // SILENT - no message for non-bank images
      console.log(`🔇 Silent rejection - not a bank statement | Chat ${chatId}`);
    } else if (rejectionReason === 'BLURRY') {
      // Bank statement but blurry - ask for clearer image
      userMessage = `⏳ រូបភាពមិនច្បាស់

សូមផ្ញើរូបភាពច្បាស់ជាងនេះសម្រាប់ការផ្ទៀងផ្ទាត់។

(Image unclear. Please send a clearer photo for verification.)`;
    } else if (rejectionReason === 'WRONG_RECIPIENT') {
      // Wrong account - tell them
      userMessage = `❌ គណនីមិនត្រឹមត្រូវ

សូមផ្ទេរប្រាក់ទៅគណនីត្រឹមត្រូវ។

(Wrong account. Please transfer to the correct account.)`;
    } else if (rejectionReason === 'OLD_SCREENSHOT') {
      // Old screenshot - fraud alert
      userMessage = `❌ រូបភាពចាស់ពេក

សូមផ្ញើបង្កាន់ដៃថ្មី។

(Screenshot too old. Please send a recent receipt.)`;
    } else if (rejectionReason === 'DUPLICATE_TRANSACTION') {
      // Duplicate transaction - fraud alert (silent or message?)
      userMessage = `❌ បង្កាន់ដៃនេះត្រូវបានប្រើរួចហើយ

សូមផ្ញើបង្កាន់ដៃផ្សេង។

(This receipt has already been used. Please send a different receipt.)`;
    } else if (rejectionReason === 'AMOUNT_MISMATCH') {
      // Amount mismatch - show what they paid
      userMessage = `⏳ បានទទួល ${amountInKHR || 0} KHR

ចំនួនទឹកប្រាក់មិនត្រូវគ្នា។ សូមរង់ចាំការពិនិត្យ។

(Received ${amountInKHR || 0} KHR. Amount mismatch - under review.)`;
    } else if (finalVerificationStatus === 'verified') {
      // VERIFIED - success message
      userMessage = buildVerificationMessage(
        paymentData,
        expectedAmountKHR,
        amountInKHR,
        isVerified,
        finalVerificationStatus
      );
    }

    // Send message if not silent
    if (userMessage) {
      try {
        await bot.sendMessage(chatId, userMessage);
        console.log(`📤 Message sent | ${rejectionReason || 'VERIFIED'} | Chat ${chatId}`);
      } catch (notifyErr) {
        console.error('❌ Failed to send message:', notifyErr.message);
      }
    }

    // Organize screenshot into appropriate folder
    const organizedPath = await organizeScreenshot(imagePath, finalVerificationStatus);

    // Upload screenshot to GridFS
    let screenshotId = null;
    let imageBufferForAudit = null;
    try {
      imageBufferForAudit = await fs.promises.readFile(organizedPath);
      const filename = path.basename(organizedPath);
      screenshotId = await uploadScreenshotToGridFS(imageBufferForAudit, filename, {
        chatId,
        userId,
        username,
        verificationStatus: finalVerificationStatus,
        transactionId: paymentData.transactionId || null
      });
    } catch (gridfsErr) {
      console.error('⚠️ GridFS upload failed (keeping local file):', gridfsErr.message);
    }

    // Send pending screenshots to pending chat for review
    if (finalVerificationStatus === 'pending' && PENDING_CHAT_ID && imageBufferForAudit) {
      try {
        // Get customer's current total paid
        const customer = await customersCollection.findOne({ chatId: chatId });
        const totalPaid = customer?.totalPaid || 0;
        const remaining = expectedAmountKHR ? expectedAmountKHR - totalPaid : null;

        const auditCaption = `🔍 PENDING REVIEW

 Customer: ${fullName || username || 'Unknown'}
 Group: ${groupName || 'Unknown'}
 Chat ID: ${chatId}
 This Payment: ${amountInKHR?.toLocaleString() || 0} KHR
 Total Expected: ${expectedAmountKHR?.toLocaleString() || 'N/A'} KHR
 Already Paid: ${totalPaid.toLocaleString()} KHR
 Remaining: ${remaining !== null ? remaining.toLocaleString() : 'N/A'} KHR

 Bank: ${paymentData.bankName || 'Unknown'}
 Reason: ${rejectionReason || 'Amount mismatch'}
 Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}`;

        await bot.sendPhoto(PENDING_CHAT_ID, imageBufferForAudit, {
          caption: auditCaption,
          filename: `pending_${chatId}_${Date.now()}.jpg`
        });
        console.log(`📤 [PENDING] Sent pending screenshot to pending chat | Customer: ${fullName || username}`);
      } catch (auditErr) {
        console.error('⚠️ [AUDIT] Failed to send to audit chat:', auditErr.message);
      }
    }

    // Store in payments collection
    const paymentRecord = {
      _id: uuidv4(),
      chatId,
      userId,
      username,
      fullName,
      groupName,
      screenshotPath: organizedPath,
      screenshotId: screenshotId,
      uploadedAt: new Date(),
      createdAt: new Date(), // Ensure createdAt exists for date filtering

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
      verificationStatus: finalVerificationStatus,
      rejectionReason: rejectionReason,
      isBankStatement: paymentData.isBankStatement !== false,

      // Enhanced audit fields for rejection tracking
      ...(finalVerificationStatus === 'rejected' && {
        rejectedAt: new Date(),
        rejectedBy: 'auto_verification',
        rejectionMetadata: {
          confidenceScore: paymentData.confidence || 'low',
          extractedData: {
            amount: paymentData.amount,
            bankName: paymentData.bankName,
            transactionId: paymentData.transactionId,
            toAccount: paymentData.toAccount,
            recipientName: paymentData.recipientName
          },
          verificationChecks: {
            recipientVerified: recipientVerified,
            amountVerified: isVerified,
            duplicateCheck: rejectionReason === 'DUPLICATE_TRANSACTION',
            timestampCheck: rejectionReason === 'OLD_SCREENSHOT'
          },
          userAgent: msg.from ? {
            id: msg.from.id,
            username: msg.from.username,
            firstName: msg.from.first_name,
            lastName: msg.from.last_name
          } : null
        }
      }),

      // Enhanced audit fields for pending verification
      ...(finalVerificationStatus === 'pending' && {
        pendingAt: new Date(),
        pendingReason: rejectionReason, // BLURRY or AMOUNT_MISMATCH
        requiresManualReview: true
      })
    };

    try {
      await paymentsCollection.insertOne(paymentRecord);

      // Update customer payment status in real-time
      await updateCustomerPaymentStatus(chatId, paymentRecord);

      // Clean output with clear status label and user info
      const statusIcon = paymentLabel === 'PAID' ? '✅' : paymentLabel === 'UNPAID' ? '❌' : '⏳';
      const userInfo = groupName ? `${groupName} | @${username || 'unknown'}` : `@${username || 'unknown'} | ${fullName}`;
      console.log(`${statusIcon} ${paymentLabel} | ${amountInKHR || 0} KHR | ${finalVerificationStatus.toUpperCase()} | ${userInfo} | Chat: ${chatId}`);

    } catch (dbError) {
      console.error('❌ Failed to save payment record to database:', dbError);
      throw dbError;
    }

    // ===== 3-CHATBOX NOTIFICATION SYSTEM =====
    // Send notifications to appropriate chat groups based on verification status
    // Only for actual bank statements (exclude NOT_BANK_STATEMENT)

    const isBankStatement = paymentData.isBankStatement !== false;

    try {
      if (finalVerificationStatus === 'verified' && isBankStatement && VERIFIED_CHAT_ID) {
        // Send verified notification to VERIFIED_CHAT_ID
        const verifiedCaption = `✅ VERIFIED PAYMENT

👤 Customer: ${fullName || username || 'Unknown'}
💰 Amount: ${(amountInKHR || 0).toLocaleString()} KHR
🏦 Bank: ${paymentData.bankName || 'Unknown'}
📞 Chat ID: ${chatId}
🆔 Transaction ID: ${paymentData.transactionId || 'N/A'}
⏰ Verified: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}
🔗 Group: ${groupName || 'Direct Message'}

${verificationNotes || 'Payment successfully verified.'}`;

        if (imageBufferForAudit) {
          await bot.sendPhoto(VERIFIED_CHAT_ID, imageBufferForAudit, {
            caption: verifiedCaption,
            filename: `verified_${chatId}_${Date.now()}.jpg`
          });
        } else {
          await bot.sendMessage(VERIFIED_CHAT_ID, verifiedCaption);
        }
        console.log(`✅ [VERIFIED] Notification sent to verified chat | Customer: ${fullName || username}`);
      }

      else if (finalVerificationStatus === 'rejected' && isBankStatement && REJECTED_CHAT_ID) {
        // Send rejection notification to REJECTED_CHAT_ID (only for bank statements)
        const rejectedCaption = `❌ REJECTED PAYMENT

👤 Customer: ${fullName || username || 'Unknown'}
💰 Amount: ${(amountInKHR || 0).toLocaleString()} KHR
🏦 Bank: ${paymentData.bankName || 'Unknown'}
📞 Chat ID: ${chatId}
🚫 Rejection Reason: ${rejectionReason || 'Unknown'}
🔍 Confidence: ${paymentData.confidence || 'N/A'}
⏰ Rejected: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}
🔗 Group: ${groupName || 'Direct Message'}

${verificationNotes || 'Payment failed verification checks.'}`;

        if (imageBufferForAudit && rejectionReason !== 'NOT_BANK_STATEMENT') {
          await bot.sendPhoto(REJECTED_CHAT_ID, imageBufferForAudit, {
            caption: rejectedCaption,
            filename: `rejected_${chatId}_${Date.now()}.jpg`
          });
        } else if (rejectionReason !== 'NOT_BANK_STATEMENT') {
          await bot.sendMessage(REJECTED_CHAT_ID, rejectedCaption);
        }
        console.log(`❌ [REJECTED] Notification sent to rejected chat | Reason: ${rejectionReason} | Customer: ${fullName || username}`);
      }

    } catch (notificationError) {
      console.error('⚠️ [3-CHATBOX] Failed to send notification:', notificationError.message);
      // Don't throw - notification failure shouldn't break payment processing
    }

    return paymentRecord;

  } catch (error) {
    console.error('❌ Payment OCR analysis failed:', error);
    return null;
  }
}

// ==== Audit Commands Setup (called after bot initialization) ====
function setupAuditCommands() {
  // /verify chatid - Approve pending payment as partial pay
  bot.onText(/\/verify\s+(-?\d+)/, async (msg, match) => {
  const fromChatId = msg.chat.id.toString();
  const targetChatId = match[1];

  // Only allow command from audit chat
  if (fromChatId !== AUDIT_CHAT_ID) {
    console.log(`⚠️ [VERIFY] Unauthorized: Command from ${fromChatId}, expected ${AUDIT_CHAT_ID}`);
    return;
  }

  try {
    // Find most recent pending payment for this chat
    const pendingPayment = await paymentsCollection.findOne(
      { chatId: targetChatId, paymentLabel: 'PENDING' },
      { sort: { uploadedAt: -1 } }
    );

    if (!pendingPayment) {
      await bot.sendMessage(AUDIT_CHAT_ID, `❌ No pending payment found for chat ID: ${targetChatId}`);
      return;
    }

    // Update payment to PAID (partial payment approved)
    await paymentsCollection.updateOne(
      { _id: pendingPayment._id },
      {
        $set: {
          paymentLabel: 'PAID',
          verificationStatus: 'verified',
          verificationNotes: `${pendingPayment.verificationNotes || ''} | Manually approved as partial payment by auditor`,
          approvedAt: new Date(),
          approvedBy: msg.from.username || msg.from.id
        }
      }
    );

    // Update customer total
    await customersCollection.updateOne(
      { chatId: targetChatId },
      {
        $inc: { totalPaid: pendingPayment.amountInKHR || 0 },
        $set: { lastUpdated: new Date() }
      }
    );

    // Send confirmation to audit chat
    await bot.sendMessage(AUDIT_CHAT_ID,
      `✅ APPROVED as partial payment\n\n` +
      `👤 Customer: ${pendingPayment.fullName || pendingPayment.username}\n` +
      `💰 Amount: ${pendingPayment.amountInKHR?.toLocaleString()} KHR\n` +
      `🏦 Bank: ${pendingPayment.bankName}\n` +
      `🆔 Payment ID: ${pendingPayment._id}`
    );

    // Notify customer
    await bot.sendMessage(targetChatId,
      `✅ ការទូទាត់របស់អ្នកត្រូវបានអនុម័ត!\nYour payment has been approved!\n\n` +
      `💰 Amount: ${pendingPayment.amountInKHR?.toLocaleString()} KHR`
    );

    console.log(`✅ [VERIFY] Approved pending payment for chat ${targetChatId} | Amount: ${pendingPayment.amountInKHR} KHR`);
  } catch (error) {
    console.error('❌ [VERIFY] Error:', error.message);
    await bot.sendMessage(AUDIT_CHAT_ID, `❌ Error approving payment: ${error.message}`);
  }
});

bot.onText(/\/reject\s+(-?\d+)/, async (msg, match) => {
  const fromChatId = msg.chat.id.toString();
  const targetChatId = match[1];

  // Only allow command from audit chat
  if (fromChatId !== AUDIT_CHAT_ID) {
    console.log(`⚠️ [REJECT] Unauthorized: Command from ${fromChatId}, expected ${AUDIT_CHAT_ID}`);
    return;
  }

  try {
    // Find most recent pending payment for this chat
    const pendingPayment = await paymentsCollection.findOne(
      { chatId: targetChatId, paymentLabel: 'PENDING' },
      { sort: { uploadedAt: -1 } }
    );

    if (!pendingPayment) {
      await bot.sendMessage(AUDIT_CHAT_ID, `❌ No pending payment found for chat ID: ${targetChatId}`);
      return;
    }

    // Update payment to UNPAID (rejected) with enhanced audit tracking
    await paymentsCollection.updateOne(
      { _id: pendingPayment._id },
      {
        $set: {
          paymentLabel: 'UNPAID',
          verificationStatus: 'rejected',
          verificationNotes: `${pendingPayment.verificationNotes || ''} | Manually rejected by auditor - bad screenshot`,
          rejectedAt: new Date(),
          rejectedBy: msg.from.username || msg.from.id,
          rejectionReason: 'MANUAL_REJECTION',
          // Enhanced audit tracking for manual rejections
          reviewedAt: new Date(),
          reviewedBy: msg.from.username || msg.from.id,
          reviewNotes: 'Manual rejection via Telegram command - bad screenshot',
          reviewAction: 'confirm_rejection',
          rejectionMetadata: {
            manualReview: true,
            reviewerId: msg.from.id,
            reviewerUsername: msg.from.username,
            reviewerName: `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim(),
            originalReason: pendingPayment.rejectionReason || 'PENDING_REVIEW',
            reviewTimestamp: new Date().toISOString()
          }
        }
      }
    );

    // Send confirmation to audit chat
    await bot.sendMessage(AUDIT_CHAT_ID,
      `❌ REJECTED\n\n` +
      `👤 Customer: ${pendingPayment.fullName || pendingPayment.username}\n` +
      `💰 Amount: ${pendingPayment.amountInKHR?.toLocaleString()} KHR\n` +
      `🏦 Bank: ${pendingPayment.bankName}\n` +
      `🆔 Payment ID: ${pendingPayment._id}`
    );

    // Notify customer
    await bot.sendMessage(targetChatId,
      `❌ ការទូទាត់របស់អ្នកត្រូវបានបដិសេធ។\nYour payment was rejected.\n\n` +
      `សូមផ្ញើរូបថតថ្មីម្តងទៀត។\nPlease submit a new screenshot.`
    );

    console.log(`❌ [REJECT] Rejected pending payment for chat ${targetChatId} | Reason: Bad screenshot`);
  } catch (error) {
    console.error('❌ [REJECT] Error:', error.message);
    await bot.sendMessage(AUDIT_CHAT_ID, `❌ Error rejecting payment: ${error.message}`);
  }
  });
}

// ==== Queue System (Rate Limited) ====
const messageQueue = [];
let processing = false;
let lastMessageTime = 0;
const BOT_MIN_DELAY = parseInt(process.env.BOT_MIN_DELAY_MS) || 1000; // 1 second between messages
const BOT_MAX_QUEUE = parseInt(process.env.BOT_MAX_QUEUE_SIZE) || 50; // Max queue size

async function setupMessageHandler() {
  bot.on('message', (message) => {
    if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') {
      return;
    }

    // Prevent queue overflow
    if (messageQueue.length >= BOT_MAX_QUEUE) {
      console.log(`⚠️ [QUEUE] Queue full (${BOT_MAX_QUEUE}), dropping message from ${message.chat.id}`);
      return;
    }

    messageQueue.push(message);
    console.log(`📥 [QUEUE] Message added. Queue size: ${messageQueue.length}/${BOT_MAX_QUEUE}`);
    processQueue();
  });
}

async function processQueue() {
  if (processing || messageQueue.length === 0) return;
  processing = true;

  // Enforce minimum delay between message processing
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;
  if (timeSinceLastMessage < BOT_MIN_DELAY && lastMessageTime > 0) {
    const delayNeeded = BOT_MIN_DELAY - timeSinceLastMessage;
    console.log(`⏳ [QUEUE] Spacing: waiting ${delayNeeded}ms before next message...`);
    await new Promise(resolve => setTimeout(resolve, delayNeeded));
  }

  lastMessageTime = Date.now();
  const message = messageQueue.shift();
  console.log(`📤 [QUEUE] Processing message. Remaining: ${messageQueue.length}`);

  try {
    await handleMessage(message);
  } catch (err) {
    console.error('[QUEUE ERROR]', err);
  }

  processing = false;
  if (messageQueue.length > 0) {
    setTimeout(processQueue, 100); // Small delay to check queue again
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
  const groupName = message.chat.title || null; // Group/channel name (null for private chats)
  const chatType = message.chat.type; // 'private', 'group', 'supergroup', 'channel'
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
      await analyzePaymentScreenshot(localFilePath, chatId, userId, username, fullName, groupName);

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
    setupAuditCommands();

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
