'use strict';

/**
 * Rejection Analytics Module
 * Provides detailed analytics and reporting for rejected bank statements
 * Used by the main botfetch.js application
 */

const XLSX = require('xlsx');

// Rejection reason mappings with descriptions
const REJECTION_REASONS = {
  'NOT_BANK_STATEMENT': {
    description: 'Image is not a bank statement',
    category: 'invalid_document',
    severity: 'low',
    userMessage: 'Silent rejection - no message sent'
  },
  'BLURRY': {
    description: 'Image is unclear or blurry',
    category: 'image_quality',
    severity: 'medium',
    userMessage: 'Ask for clearer image'
  },
  'WRONG_RECIPIENT': {
    description: 'Payment to wrong account/recipient',
    category: 'verification_failed',
    severity: 'high',
    userMessage: 'Tell user to pay correct account'
  },
  'OLD_SCREENSHOT': {
    description: 'Screenshot timestamp is too old',
    category: 'fraud_prevention',
    severity: 'high',
    userMessage: 'Warn user about old receipt'
  },
  'DUPLICATE_TRANSACTION': {
    description: 'Transaction already used by another customer',
    category: 'fraud_prevention',
    severity: 'critical',
    userMessage: 'Alert about duplicate usage'
  },
  'AMOUNT_MISMATCH': {
    description: 'Payment amount does not match expected',
    category: 'verification_failed',
    severity: 'medium',
    userMessage: 'Show received amount'
  },
  'MANUAL_REJECTION': {
    description: 'Manually rejected by auditor',
    category: 'manual_review',
    severity: 'high',
    userMessage: 'Generic rejection message'
  }
};

/**
 * Calculate rejection statistics for a given time period
 * @param {Collection} paymentsCollection - MongoDB payments collection
 * @param {Object} options - Query options
 * @returns {Object} Rejection statistics
 */
async function calculateRejectionStats(paymentsCollection, options = {}) {
  const { startDate, endDate, customerId } = options;

  // Build base filter
  const filter = { verificationStatus: 'rejected' };

  if (customerId) filter.chatId = customerId;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  // Get rejection breakdown by reason
  const reasonBreakdown = await paymentsCollection.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$rejectionReason',
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: '$amountInKHR' } },
        avgConfidence: { $avg: { $toDouble: '$confidence' } },
        latestDate: { $max: '$createdAt' },
        customers: { $addToSet: '$chatId' }
      }
    },
    { $sort: { count: -1 } }
  ]).toArray();

  // Enhance with reason metadata
  const enhancedReasons = reasonBreakdown.map(reason => ({
    ...reason,
    reasonCode: reason._id,
    reasonInfo: REJECTION_REASONS[reason._id] || {
      description: 'Unknown reason',
      category: 'other',
      severity: 'unknown'
    },
    uniqueCustomers: reason.customers.length,
    avgAmount: reason.totalAmount / reason.count
  }));

  // Calculate totals
  const totalRejected = reasonBreakdown.reduce((sum, r) => sum + r.count, 0);
  const totalAmount = reasonBreakdown.reduce((sum, r) => sum + r.totalAmount, 0);

  // Get overall rejection rate
  const totalPayments = await paymentsCollection.countDocuments({
    ...(customerId && { chatId: customerId }),
    ...(startDate || endDate) && {
      createdAt: {
        ...(startDate && { $gte: new Date(startDate) }),
        ...(endDate && { $lte: new Date(endDate) })
      }
    }
  });

  const rejectionRate = totalPayments > 0 ? (totalRejected / totalPayments * 100) : 0;

  return {
    summary: {
      totalRejected,
      totalPayments,
      rejectionRate: parseFloat(rejectionRate.toFixed(2)),
      totalRejectedAmount: totalAmount,
      avgRejectedAmount: totalRejected > 0 ? totalAmount / totalRejected : 0
    },
    reasonBreakdown: enhancedReasons,
    period: { startDate, endDate }
  };
}

/**
 * Get rejection trends over time
 * @param {Collection} paymentsCollection - MongoDB payments collection
 * @param {Object} options - Query options
 * @returns {Array} Daily/hourly rejection trends
 */
async function getRejectionTrends(paymentsCollection, options = {}) {
  const { period = '7d', groupBy = 'day' } = options;

  // Calculate date range
  const now = new Date();
  const periodDays = {
    '1d': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365
  };
  const daysBack = periodDays[period] || 7;
  const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

  // Group by day or hour
  const groupStage = groupBy === 'hour' ? {
    _id: {
      year: { $year: '$createdAt' },
      month: { $month: '$createdAt' },
      day: { $dayOfMonth: '$createdAt' },
      hour: { $hour: '$createdAt' }
    }
  } : {
    _id: {
      year: { $year: '$createdAt' },
      month: { $month: '$createdAt' },
      day: { $dayOfMonth: '$createdAt' }
    }
  };

  const trends = await paymentsCollection.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        verificationStatus: 'rejected'
      }
    },
    {
      $group: {
        ...groupStage,
        count: { $sum: 1 },
        amount: { $sum: { $toDouble: '$amountInKHR' } },
        reasons: {
          $push: {
            reason: '$rejectionReason',
            customer: '$chatId'
          }
        }
      }
    },
    {
      $sort: {
        '_id.year': 1,
        '_id.month': 1,
        '_id.day': 1,
        ...(groupBy === 'hour' && { '_id.hour': 1 })
      }
    }
  ]).toArray();

  return trends.map(trend => {
    const date = new Date(
      trend._id.year,
      trend._id.month - 1,
      trend._id.day,
      trend._id.hour || 0
    );

    // Count reasons
    const reasonCounts = {};
    trend.reasons.forEach(r => {
      reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
    });

    return {
      date: date.toISOString(),
      timestamp: date.getTime(),
      count: trend.count,
      amount: trend.amount,
      avgAmount: trend.amount / trend.count,
      reasonBreakdown: reasonCounts,
      uniqueCustomers: [...new Set(trend.reasons.map(r => r.customer))].length
    };
  });
}

/**
 * Identify suspicious rejection patterns
 * @param {Collection} paymentsCollection - MongoDB payments collection
 * @param {Object} options - Query options
 * @returns {Object} Suspicious patterns and alerts
 */
async function detectSuspiciousPatterns(paymentsCollection, options = {}) {
  const { period = '30d' } = options;

  const now = new Date();
  const daysBack = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
  const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

  // Find customers with high rejection rates
  const customerPatterns = await paymentsCollection.aggregate([
    {
      $match: { createdAt: { $gte: startDate } }
    },
    {
      $group: {
        _id: '$chatId',
        totalAttempts: { $sum: 1 },
        rejections: {
          $sum: { $cond: [{ $eq: ['$verificationStatus', 'rejected'] }, 1, 0] }
        },
        reasons: {
          $addToSet: {
            $cond: [{ $eq: ['$verificationStatus', 'rejected'] }, '$rejectionReason', null]
          }
        },
        latestRejection: { $max: '$createdAt' },
        username: { $first: '$username' },
        fullName: { $first: '$fullName' }
      }
    },
    {
      $project: {
        chatId: '$_id',
        totalAttempts: 1,
        rejections: 1,
        rejectionRate: {
          $multiply: [{ $divide: ['$rejections', '$totalAttempts'] }, 100]
        },
        reasons: { $filter: { input: '$reasons', as: 'r', cond: { $ne: ['$$r', null] } } },
        latestRejection: 1,
        username: 1,
        fullName: 1
      }
    },
    {
      $match: { rejections: { $gte: 2 } } // At least 2 rejections
    },
    {
      $sort: { rejectionRate: -1, rejections: -1 }
    },
    {
      $limit: 20
    }
  ]).toArray();

  // Categorize suspicious patterns
  const alerts = [];

  customerPatterns.forEach(customer => {
    const patterns = [];

    if (customer.rejectionRate > 80) {
      patterns.push('Very high rejection rate');
    }
    if (customer.reasons.includes('OLD_SCREENSHOT') && customer.reasons.includes('DUPLICATE_TRANSACTION')) {
      patterns.push('Multiple fraud indicators');
    }
    if (customer.rejections >= 5) {
      patterns.push('Frequent rejection attempts');
    }

    if (patterns.length > 0) {
      alerts.push({
        ...customer,
        suspiciousPatterns: patterns,
        riskLevel: customer.rejectionRate > 80 ? 'high' : customer.rejectionRate > 50 ? 'medium' : 'low'
      });
    }
  });

  // Find unusual rejection spikes
  const dailyRejections = await paymentsCollection.aggregate([
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
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]).toArray();

  const avgDailyRejections = dailyRejections.reduce((sum, d) => sum + d.count, 0) / dailyRejections.length;
  const spikes = dailyRejections.filter(d => d.count > avgDailyRejections * 2);

  return {
    suspiciousCustomers: alerts,
    rejectionSpikes: spikes.map(spike => ({
      date: new Date(spike._id.year, spike._id.month - 1, spike._id.day).toISOString().split('T')[0],
      count: spike.count,
      avgDaily: avgDailyRejections,
      multiplier: (spike.count / avgDailyRejections).toFixed(1)
    })),
    summary: {
      totalSuspiciousCustomers: alerts.length,
      highRiskCustomers: alerts.filter(a => a.riskLevel === 'high').length,
      rejectionSpikes: spikes.length,
      analysisDate: now.toISOString()
    }
  };
}

/**
 * Generate comprehensive rejection report
 * @param {Collection} paymentsCollection - MongoDB payments collection
 * @param {Object} options - Report options
 * @returns {Object} Complete rejection analysis report
 */
async function generateRejectionReport(paymentsCollection, options = {}) {
  const { period = '30d', includeCustomers = true, includeTrends = true } = options;

  console.log(`📊 Generating rejection report for period: ${period}`);

  try {
    // Get basic statistics
    const stats = await calculateRejectionStats(paymentsCollection, { period });

    // Get trends if requested
    const trends = includeTrends ? await getRejectionTrends(paymentsCollection, { period }) : null;

    // Detect suspicious patterns
    const patterns = await detectSuspiciousPatterns(paymentsCollection, { period });

    // Get top rejected customers if requested
    let topRejectedCustomers = null;
    if (includeCustomers) {
      const now = new Date();
      const daysBack = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[period] || 30;
      const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

      topRejectedCustomers = await paymentsCollection.aggregate([
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
            totalAmount: { $sum: { $toDouble: '$amountInKHR' } },
            reasons: { $addToSet: '$rejectionReason' },
            latestRejection: { $max: '$createdAt' },
            username: { $first: '$username' },
            fullName: { $first: '$fullName' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray();
    }

    const report = {
      generatedAt: new Date().toISOString(),
      period,
      statistics: stats,
      trends: trends,
      suspiciousPatterns: patterns,
      topRejectedCustomers: topRejectedCustomers,
      reasonReference: REJECTION_REASONS
    };

    console.log(`✅ Rejection report generated: ${stats.summary.totalRejected} rejections analyzed`);
    return report;

  } catch (error) {
    console.error('❌ Error generating rejection report:', error);
    throw error;
  }
}

/**
 * Export rejection data to Excel format
 * @param {Array} rejections - Array of rejection records
 * @param {Object} options - Export options
 * @returns {Buffer} Excel file buffer
 */
function exportRejectionsToExcel(rejections, options = {}) {
  const { includeMetadata = true, sheetName = 'Rejected Payments' } = options;

  // Prepare data for export
  const exportData = rejections.map(rejection => {
    const baseData = {
      'Payment ID': rejection._id,
      'Customer Chat ID': rejection.chatId,
      'Customer Name': rejection.fullName || rejection.username || 'Unknown',
      'Amount (KHR)': rejection.amountInKHR || 0,
      'Rejection Reason': rejection.rejectionReason || 'UNKNOWN',
      'Rejected At': rejection.rejectedAt ? new Date(rejection.rejectedAt).toLocaleString() : 'N/A',
      'Rejected By': rejection.rejectedBy || 'auto_verification',
      'Confidence': rejection.confidence || 'N/A',
      'Bank Name': rejection.bankName || 'Unknown',
      'Transaction Date': rejection.transactionDate ? new Date(rejection.transactionDate).toLocaleDateString() : 'N/A',
      'Created At': new Date(rejection.createdAt).toLocaleString(),
      'Verification Notes': rejection.verificationNotes || '',
      'Screenshot Available': rejection.screenshotId ? 'Yes' : 'No'
    };

    if (includeMetadata && rejection.rejectionMetadata) {
      baseData['Review Status'] = rejection.reviewAction || 'Not reviewed';
      baseData['Review Notes'] = rejection.reviewNotes || '';
      baseData['Confidence Score'] = rejection.rejectionMetadata.confidenceScore || 'N/A';
      baseData['Manual Review'] = rejection.rejectionMetadata.manualReview ? 'Yes' : 'No';
    }

    return baseData;
  });

  // Create workbook
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(exportData);

  // Auto-size columns
  const colWidths = Object.keys(exportData[0] || {}).map(key => ({
    wch: Math.max(key.length, 15)
  }));
  worksheet['!cols'] = colWidths;

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Generate buffer
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  REJECTION_REASONS,
  calculateRejectionStats,
  getRejectionTrends,
  detectSuspiciousPatterns,
  generateRejectionReport,
  exportRejectionsToExcel
};