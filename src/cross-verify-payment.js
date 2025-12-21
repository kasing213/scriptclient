/**
 * Cross-Database Payment Verification
 * Connects to BOTH databases to verify payment status
 *
 * Queries:
 * - customerDB.payments (payment screenshots with OCR data)
 * - invoiceDB.excelreadings (customer bills with amounts and chatId)
 *
 * Usage: node src/cross-verify-payment.js <chatId> [amount]
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Database 1: scriptclient (payments from OCR)
const MONGO_URL_SCRIPTCLIENT = process.env.MONGO_URL;
const DB_NAME_SCRIPTCLIENT = process.env.DB_NAME;

// Database 2: Invoice-generator (excelreadings with amounts)
const MONGO_URL_INVOICE = process.env.MONGO_URL_INVOICE || process.env.MONGO_URL;
const DB_NAME_INVOICE = process.env.DB_NAME_INVOICE || 'invoice_db';

async function crossVerifyPayment(chatId, amount = null) {
  const client1 = new MongoClient(MONGO_URL_SCRIPTCLIENT, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  const client2 = new MongoClient(MONGO_URL_INVOICE, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  try {
    console.log('🔗 Connecting to both databases...\n');

    // Connect to both databases
    await client1.connect();
    await client2.connect();

    console.log('✅ Connected to scriptclient database (customerDB)');
    console.log('✅ Connected to invoice-generator database (invoiceDB)\n');

    const paymentsCollection = client1.db(DB_NAME_SCRIPTCLIENT).collection('payments');
    const excelReadingsCollection = client2.db(DB_NAME_INVOICE).collection('excelreadings');

    // Query 1: Get payments from scriptclient by chatId
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 PAYMENT SCREENSHOTS (OCR Analysis)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const paymentQuery = { chatId: chatId };
    if (amount !== null) {
      paymentQuery.amountInKHR = { $gte: amount - 100, $lte: amount + 100 }; // Tolerance
    }

    const payments = await paymentsCollection
      .find(paymentQuery)
      .sort({ uploadedAt: -1 })
      .toArray();

    if (payments.length === 0) {
      console.log(`❌ No payment screenshots found for Chat ID: ${chatId}\n`);
    } else {
      console.log(`Found ${payments.length} payment screenshot(s):\n`);
      payments.forEach((payment, index) => {
        const statusIcon = payment.isPaid ? '✅' : '❌';
        const verifiedIcon = payment.isVerified ? '✅' : '❌';

        console.log(`${index + 1}. ${statusIcon} Payment Screenshot`);
        console.log(`   Amount: ${payment.amountInKHR || payment.paymentAmount} ${payment.currency || 'KHR'}`);
        console.log(`   User: ${payment.fullName} (@${payment.username})`);
        console.log(`   Bank: ${payment.bankName || 'N/A'}`);
        console.log(`   Transaction ID: ${payment.transactionId || 'N/A'}`);
        console.log(`   Uploaded: ${new Date(payment.uploadedAt).toLocaleString()}`);
        console.log(`   Verified: ${verifiedIcon} ${payment.verificationStatus || 'pending'}`);
        if (payment.verificationNotes && payment.verificationNotes !== 'None') {
          console.log(`   Notes: ${payment.verificationNotes}`);
        }
        console.log('');
      });
    }

    // Query 2: Get excelreadings (customer bills) from Invoice-generator
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 CUSTOMER BILLS (Excel Readings)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const excelQuery = { chatId: chatId };
    if (amount !== null) {
      excelQuery.amount = { $gte: amount - 100, $lte: amount + 100 };
    }

    const excelReadings = await excelReadingsCollection
      .find(excelQuery)
      .sort({ lastSent: -1 })
      .toArray();

    if (excelReadings.length === 0) {
      console.log(`❌ No customer bills found for Chat ID: ${chatId}\n`);
    } else {
      console.log(`Found ${excelReadings.length} customer bill(s):\n`);
      excelReadings.forEach((bill, index) => {
        const statusIcon =
          bill.status === 'sent' ? '✅' :
          bill.status === 'pending' ? '⏳' : '❌';

        console.log(`${index + 1}. ${statusIcon} ${bill.status.toUpperCase()}`);
        console.log(`   Customer: ${bill.customer}`);
        console.log(`   Amount: ${bill.amount} KHR`);
        console.log(`   Usage: ${bill.usage} units (${bill.oldMeter} → ${bill.newMeter})`);
        console.log(`   Username: @${bill.username || 'N/A'}`);
        console.log(`   Group: ${bill.GroupName || 'N/A'}`);
        console.log(`   Last Sent: ${bill.lastSent ? new Date(bill.lastSent).toLocaleString() : 'Never'}`);
        console.log(`   PDF: ${bill.pdfFile || 'N/A'}`);
        console.log('');
      });
    }

    // Cross-verification analysis
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 CROSS-VERIFICATION ANALYSIS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (payments.length === 0 && excelReadings.length === 0) {
      console.log('❌ No data found in either database for this Chat ID\n');
      return { verified: false, reason: 'no_data' };
    }

    if (payments.length === 0) {
      console.log('⚠️  Customer bills exist but NO payment screenshots uploaded\n');
      console.log('Status: UNPAID - Waiting for payment proof\n');
      return { verified: false, reason: 'no_payment_proof', bills: excelReadings };
    }

    if (excelReadings.length === 0) {
      console.log('⚠️  Payment screenshots exist but NO customer bills found\n');
      console.log('Status: NO BILL - Payment received without bill?\n');
      return { verified: false, reason: 'no_bill', payments };
    }

    // Match payments to bills by amount
    const matches = [];
    payments.forEach(payment => {
      excelReadings.forEach(bill => {
        const paymentAmount = payment.amountInKHR || payment.paymentAmount;
        const billAmount = bill.amount;

        // Check if amounts match within 5% tolerance
        const tolerance = billAmount * 0.05;
        const amountMatch = Math.abs(paymentAmount - billAmount) <= tolerance;

        if (amountMatch) {
          matches.push({
            payment,
            bill,
            amountDiff: Math.abs(paymentAmount - billAmount)
          });
        }
      });
    });

    if (matches.length > 0) {
      console.log(`✅ Found ${matches.length} matching payment(s) with bill(s):\n`);

      matches.forEach((match, index) => {
        console.log(`Match ${index + 1}:`);
        console.log(`   Payment Amount: ${match.payment.amountInKHR || match.payment.paymentAmount} KHR`);
        console.log(`   Bill Amount: ${match.bill.amount} KHR`);
        console.log(`   Difference: ${match.amountDiff.toFixed(2)} KHR`);
        console.log(`   Customer: ${match.bill.customer}`);
        console.log(`   Bill Status: ${match.bill.status}`);
        console.log(`   Payment Verified: ${match.payment.isVerified ? '✅ Yes' : '❌ No'}`);
        console.log(`   Payment Confidence: ${match.payment.confidence || 'N/A'}`);
        console.log('');

        // Final verdict - based on amount match and bill status
        const paymentAmount = match.payment.amountInKHR || match.payment.paymentAmount;
        const billAmount = match.bill.amount;
        const isExactMatch = match.amountDiff <= (billAmount * 0.05); // Within 5% tolerance
        const isPaid = match.payment.isPaid === true;
        const isSent = match.bill.status === 'sent';

        if (isExactMatch && isPaid && isSent) {
          console.log('   ✅ FULLY VERIFIED - Amount matches, payment received, bill sent\n');
        } else if (isExactMatch && isPaid) {
          console.log('   ⚠️  PAYMENT CONFIRMED - Amount matches but bill not sent yet\n');
        } else if (isExactMatch && isSent) {
          console.log('   ⚠️  AMOUNT MATCHES - Bill sent but payment proof unclear\n');
        } else if (paymentAmount < billAmount) {
          const paidPercent = ((paymentAmount / billAmount) * 100).toFixed(1);
          console.log(`   ❌ UNDERPAID - Only paid ${paidPercent}% of bill amount\n`);
        } else if (paymentAmount > billAmount) {
          const overpaidAmount = (paymentAmount - billAmount).toFixed(2);
          console.log(`   ⚠️  OVERPAID - Paid ${overpaidAmount} KHR more than bill\n`);
        } else {
          console.log('   ⏳ PENDING - Verification in progress\n');
        }
      });

      return { verified: true, matches };
    } else {
      console.log('❌ No matching amounts found between payments and bills\n');
      console.log('Payment amounts:');
      payments.forEach(p => console.log(`   - ${p.amountInKHR || p.paymentAmount} KHR`));
      console.log('\nBill amounts:');
      excelReadings.forEach(b => console.log(`   - ${b.amount} KHR`));
      console.log('');

      return { verified: false, reason: 'amount_mismatch', payments, bills: excelReadings };
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    return { error: error.message };
  } finally {
    await client1.close();
    await client2.close();
    console.log('✅ Disconnected from databases');
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage:');
    console.log('  node src/cross-verify-payment.js <chatId> [amount]');
    console.log('\nExamples:');
    console.log('  node src/cross-verify-payment.js -4809300176');
    console.log('  node src/cross-verify-payment.js -4809300176 30000');
    console.log('  node src/cross-verify-payment.js -4883667610');
    process.exit(1);
  }

  const chatId = parseInt(args[0]);
  const amount = args[1] ? parseFloat(args[1]) : null;

  if (isNaN(chatId)) {
    console.error('❌ Invalid chat ID');
    process.exit(1);
  }

  console.log('🔍 Cross-Database Payment Verification\n');
  console.log(`Chat ID: ${chatId}`);
  if (amount) {
    console.log(`Amount: ${amount} KHR`);
  }
  console.log('');

  const result = await crossVerifyPayment(chatId, amount);

  // Exit with appropriate code
  if (result.verified) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { crossVerifyPayment };
