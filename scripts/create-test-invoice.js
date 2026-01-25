/**
 * Create a test invoice in the Invoice Generator database
 * Usage: node scripts/create-test-invoice.js <chatId> <amount> <customerName>
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL_INVOICE || process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME_INVOICE || 'invoiceDB';

async function createTestInvoice(chatId, amount, customerName) {
  const client = new MongoClient(MONGO_URL, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  try {
    await client.connect();
    console.log('✅ Connected to Invoice database\n');

    const db = client.db(DB_NAME);
    const invoicesCollection = db.collection('invoices');

    const invoice = {
      customer: customerName,
      oldMeter: 50,
      newMeter: 64,
      usage: 14,
      amount: amount,
      chatId: chatId,
      username: 'test_user',
      groupName: 'Test Group',
      status: 'unpaid',
      dueDate: new Date().toISOString().slice(0, 10),
      invoiceNumber: `INV-${Date.now()}`,
      createdAt: new Date()
    };

    const result = await invoicesCollection.insertOne(invoice);

    console.log('✅ Test invoice created successfully!\n');
    console.log('Invoice Details:');
    console.log(`   ID: ${result.insertedId}`);
    console.log(`   Customer: ${customerName}`);
    console.log(`   Amount: ${amount}`);
    console.log(`   Chat ID: ${chatId}`);
    console.log(`   Status: unpaid`);
    console.log(`   Invoice Number: ${invoice.invoiceNumber}`);
    console.log('');

    return result;

  } catch (error) {
    console.error('❌ Error creating invoice:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Disconnected from database');
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('Usage: node scripts/create-test-invoice.js <chatId> <amount> <customerName>');
    console.log('\nExample:');
    console.log('  node scripts/create-test-invoice.js -4883667610 30000 "CHAN.K& THOEURN T."');
    process.exit(1);
  }

  const chatId = parseInt(args[0]);
  const amount = parseFloat(args[1]);
  const customerName = args[2];

  if (isNaN(chatId) || isNaN(amount)) {
    console.error('❌ Invalid chatId or amount');
    process.exit(1);
  }

  console.log('🔨 Creating test invoice...\n');
  console.log(`Chat ID: ${chatId}`);
  console.log(`Amount: ${amount}`);
  console.log(`Customer: ${customerName}\n`);

  await createTestInvoice(chatId, amount, customerName);
}

if (require.main === module) {
  main();
}

module.exports = { createTestInvoice };
