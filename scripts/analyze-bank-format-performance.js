/**
 * Bank Format Recognition Performance Analyzer for ScriptClient
 *
 * This script analyzes the performance of bank format recognition
 * by examining the bankFormatEnhancement metadata in payment records.
 *
 * Usage: node scripts/analyze-bank-format-performance.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Database configuration
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'customerDB';

async function analyzeBankFormatPerformance() {
  if (!MONGO_URL) {
    console.error('❌ MONGO_URL environment variable is required');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URL, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  try {
    console.log('🔗 Connecting to MongoDB...');
    await client.connect();

    const db = client.db(DB_NAME);
    const collection = db.collection('payments');
    console.log(`✅ Connected to database: ${DB_NAME}\n`);

    // Analyze bank format recognition performance
    console.log('📊 Analyzing bank format recognition performance...\n');

    // 1. Overall statistics
    const totalPayments = await collection.countDocuments({
      uploadedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });

    const paymentsWithBankFormat = await collection.countDocuments({
      'bankFormatEnhancement.detected': true,
      uploadedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    const enhancementRate = totalPayments > 0 ? (paymentsWithBankFormat / totalPayments * 100) : 0;

    console.log('📈 Overall Performance (Last 30 days):');
    console.log('═'.repeat(50));
    console.log(`Total payments processed: ${totalPayments}`);
    console.log(`Bank format enhancements: ${paymentsWithBankFormat}`);
    console.log(`Enhancement rate: ${enhancementRate.toFixed(1)}%\n`);

    // 2. Bank detection breakdown
    const bankBreakdown = await collection.aggregate([
      {
        $match: {
          'bankFormatEnhancement.detected': true,
          uploadedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: '$bankFormatEnhancement.bank',
          count: { $sum: 1 },
          avgConfidence: { $avg: '$bankFormatEnhancement.confidence' },
          verifiedCount: {
            $sum: { $cond: [{ $eq: ['$verificationStatus', 'verified'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]).toArray();

    if (bankBreakdown.length > 0) {
      console.log('🏦 Bank Detection Breakdown:');
      console.log('─'.repeat(60));
      for (const bank of bankBreakdown) {
        const verificationRate = (bank.verifiedCount / bank.count * 100).toFixed(1);
        console.log(`${(bank._id || 'Unknown').padEnd(15)} | ${bank.count.toString().padEnd(6)} detected | ` +
                   `${bank.avgConfidence.toFixed(3)} avg confidence | ${verificationRate}% verified`);
      }
      console.log('');
    }

    // 3. Enhancement impact analysis
    const impactAnalysis = await analyzeEnhancementImpact(collection);

    console.log('💡 Enhancement Impact Analysis:');
    console.log('─'.repeat(50));
    console.log(`Recipient name improvements: ${impactAnalysis.recipientImprovements}`);
    console.log(`Account number improvements: ${impactAnalysis.accountImprovements}`);
    console.log(`Combined improvements: ${impactAnalysis.combinedImprovements}\n`);

    // 4. Accuracy comparison
    const accuracyComparison = await analyzeAccuracyComparison(collection);

    console.log('🎯 Accuracy Comparison:');
    console.log('─'.repeat(50));
    console.log(`Without bank format: ${accuracyComparison.withoutBankFormat.toFixed(1)}% accuracy`);
    console.log(`With bank format: ${accuracyComparison.withBankFormat.toFixed(1)}% accuracy`);
    console.log(`Improvement: +${(accuracyComparison.withBankFormat - accuracyComparison.withoutBankFormat).toFixed(1)} percentage points\n`);

    // 5. Daily trend analysis
    const dailyTrends = await analyzeDailyTrends(collection);

    console.log('📅 Daily Enhancement Trends (Last 7 days):');
    console.log('─'.repeat(50));
    for (const day of dailyTrends) {
      const date = day._id.toISOString().split('T')[0];
      const rate = (day.enhancementRate * 100).toFixed(1);
      console.log(`${date}: ${day.enhanced}/${day.total} (${rate}%) enhanced`);
    }

    // 6. Generate recommendations
    console.log('\n💡 Recommendations:');
    console.log('═'.repeat(50));

    if (enhancementRate < 50) {
      console.log('⚠️  Low enhancement rate - consider updating bank format patterns');
    } else if (enhancementRate > 80) {
      console.log('✅ Excellent enhancement rate - bank format recognition working well');
    } else {
      console.log('👍 Good enhancement rate - system is improving OCR accuracy');
    }

    if (bankBreakdown.length < 3) {
      console.log('📊 Limited bank coverage - add more bank format templates');
    }

    const avgConfidence = bankBreakdown.reduce((sum, bank) => sum + bank.avgConfidence, 0) / bankBreakdown.length;
    if (avgConfidence < 0.8) {
      console.log('🎯 Consider adjusting confidence thresholds or improving patterns');
    }

    console.log('\n✅ Analysis complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n✅ Database connection closed');
  }
}

async function analyzeEnhancementImpact(collection) {
  const enhancements = await collection.find({
    'bankFormatEnhancement.detected': true,
    uploadedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
  }, {
    projection: {
      recipientName: 1,
      toAccount: 1,
      bankFormatEnhancement: 1
    }
  }).toArray();

  let recipientImprovements = 0;
  let accountImprovements = 0;
  let combinedImprovements = 0;

  // Note: This is a simplified analysis since we don't store the original
  // OCR results separately. In practice, you'd want to track before/after.
  for (const payment of enhancements) {
    if (payment.recipientName && payment.recipientName.length > 0) {
      recipientImprovements++;
    }
    if (payment.toAccount && payment.toAccount.length > 0) {
      accountImprovements++;
    }
    if (payment.recipientName && payment.toAccount) {
      combinedImprovements++;
    }
  }

  return {
    recipientImprovements,
    accountImprovements,
    combinedImprovements
  };
}

async function analyzeAccuracyComparison(collection) {
  // Simplified accuracy calculation based on verification status
  const withBankFormat = await collection.aggregate([
    {
      $match: {
        'bankFormatEnhancement.detected': true,
        uploadedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        verified: {
          $sum: { $cond: [{ $eq: ['$verificationStatus', 'verified'] }, 1, 0] }
        }
      }
    }
  ]).toArray();

  const withoutBankFormat = await collection.aggregate([
    {
      $match: {
        $or: [
          { 'bankFormatEnhancement.detected': false },
          { 'bankFormatEnhancement.detected': { $exists: false } }
        ],
        uploadedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        verified: {
          $sum: { $cond: [{ $eq: ['$verificationStatus', 'verified'] }, 1, 0] }
        }
      }
    }
  ]).toArray();

  const withBankFormatAccuracy = withBankFormat[0] ?
    (withBankFormat[0].verified / withBankFormat[0].total * 100) : 0;

  const withoutBankFormatAccuracy = withoutBankFormat[0] ?
    (withoutBankFormat[0].verified / withoutBankFormat[0].total * 100) : 0;

  return {
    withBankFormat: withBankFormatAccuracy,
    withoutBankFormat: withoutBankFormatAccuracy
  };
}

async function analyzeDailyTrends(collection) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  return await collection.aggregate([
    {
      $match: {
        uploadedAt: { $gte: sevenDaysAgo }
      }
    },
    {
      $group: {
        _id: {
          $dateFromParts: {
            year: { $year: '$uploadedAt' },
            month: { $month: '$uploadedAt' },
            day: { $dayOfMonth: '$uploadedAt' }
          }
        },
        total: { $sum: 1 },
        enhanced: {
          $sum: { $cond: [{ $eq: ['$bankFormatEnhancement.detected', true] }, 1, 0] }
        }
      }
    },
    {
      $addFields: {
        enhancementRate: { $divide: ['$enhanced', '$total'] }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]).toArray();
}

// CLI interface
if (require.main === module) {
  console.log('📊 Bank Format Recognition Performance Analyzer\n');
  console.log('Analyzing the impact of bank format recognition on OCR accuracy...\n');

  analyzeBankFormatPerformance().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { analyzeBankFormatPerformance };