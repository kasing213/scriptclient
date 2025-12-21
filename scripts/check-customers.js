/**
 * Check customers collection
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

    const collection = client.db(DB_NAME).collection('customers');

    const customers = await collection.find({}).limit(10).toArray();

    console.log(`Found ${customers.length} customer(s):\n`);

    customers.forEach((customer, i) => {
      console.log(`${i + 1}. ${customer.name || 'No name'}`);
      console.log(`   chatId: ${customer.chatId || 'N/A'}`);
      console.log(`   userId: ${customer.userId || 'N/A'}`);
      console.log(`   expectedPaymentAmount: ${customer.expectedPaymentAmount || 'NOT SET'}`);
      console.log('');
    });

    // Check for the specific chatId
    const specificCustomer = await collection.findOne({ chatId: -4883667610 });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Customer with chatId -4883667610:');
    console.log(specificCustomer ? JSON.stringify(specificCustomer, null, 2) : '❌ NOT FOUND');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

main();
