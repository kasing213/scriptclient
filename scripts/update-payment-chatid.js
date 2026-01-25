/**
 * Update old payment record to add chatId field for testing
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

    // Find the payment with 30000 KHR and update it with chatId
    const result = await collection.updateMany(
      { amountInKHR: 30000, chatId: { $exists: false } },
      { $set: { chatId: -4883667610 } }
    );

    console.log(`✅ Updated ${result.modifiedCount} payment record(s) with chatId: -4883667610\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

main();
