/**
 * Check what chatIds are in the payments collection
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME;

async function main() {
  const client = new MongoClient(MONGO_URL, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to customerDB\n');

    const collection = client.db(DB_NAME).collection('payments');

    // Find all payments and show their chatId and userId
    const payments = await collection.find({}).sort({ uploadedAt: -1 }).limit(20).toArray();

    console.log(`Found ${payments.length} recent payment(s):\n`);

    payments.forEach((payment, i) => {
      console.log(`${i + 1}. Amount: ${payment.amountInKHR || payment.paymentAmount} ${payment.currency || 'KHR'}`);
      console.log(`   chatId: ${payment.chatId || 'MISSING'}`);
      console.log(`   userId: ${payment.userId || 'N/A'}`);
      console.log(`   User: ${payment.fullName} (@${payment.username})`);
      console.log(`   Transaction: ${payment.transactionId || 'N/A'}`);
      console.log(`   Uploaded: ${new Date(payment.uploadedAt).toLocaleString()}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

main();
