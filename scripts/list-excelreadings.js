/**
 * List all excelreadings to see what chatIds have bills
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL_INVOICE || process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME_INVOICE || 'invoiceDB';

async function main() {
  const client = new MongoClient(MONGO_URL, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to invoiceDB\n');

    const collection = client.db(DB_NAME).collection('excelreadings');

    const excelReadings = await collection.find({}).limit(10).toArray();

    console.log(`Found ${excelReadings.length} excelreadings:\n`);

    excelReadings.forEach((record, i) => {
      console.log(`${i + 1}. ${record.customer}`);
      console.log(`   Chat ID: ${record.chatId}`);
      console.log(`   Amount: ${record.amount} KHR`);
      console.log(`   Status: ${record.status}`);
      console.log(`   Username: @${record.username || 'N/A'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

main();
