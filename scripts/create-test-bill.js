/**
 * Create test bill in excelreadings collection
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL_INVOICE || process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME_INVOICE || 'invoiceDB';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('Usage: node scripts/create-test-bill.js <chatId> <amount> <customerName>');
    console.log('Example: node scripts/create-test-bill.js -4883667610 30000 "CHAN.K& THOEURN T."');
    process.exit(1);
  }

  const chatId = parseInt(args[0]);
  const amount = parseFloat(args[1]);
  const customer = args[2];

  const client = new MongoClient(MONGO_URL, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to invoiceDB\n');

    const collection = client.db(DB_NAME).collection('excelreadings');

    const bill = {
      customer,
      oldMeter: 50,
      newMeter: 64,
      usage: 14,
      amount,
      chatId,
      username: 'Chankasing',
      GroupName: 'Water Department',
      status: 'sent',
      lastSent: new Date(),
      pdfFile: `invoice-${Date.now()}.pdf`,
      sendAttempts: 1
    };

    const result = await collection.insertOne(bill);

    console.log('✅ Test bill created successfully!\n');
    console.log(`   Customer: ${customer}`);
    console.log(`   Chat ID: ${chatId}`);
    console.log(`   Amount: ${amount} KHR`);
    console.log(`   Status: ${bill.status}`);
    console.log(`   ID: ${result.insertedId}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

main();
