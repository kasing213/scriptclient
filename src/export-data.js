'use strict';

/**
 * MongoDB to Excel Export Script
 *
 * Usage:
 *   node src/export-data.js                    # Export all collections
 *   node src/export-data.js payments           # Export only payments
 *   node src/export-data.js customers          # Export only customers
 *   node src/export-data.js fraudAlerts        # Export only fraud alerts
 *   node src/export-data.js excelreadings      # Export only invoice readings
 */

const { MongoClient } = require('mongodb');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// MongoDB connection strings
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'customerDB';
const MONGO_URL_INVOICE = process.env.MONGO_URL_INVOICE || MONGO_URL;
const DB_NAME_INVOICE = process.env.DB_NAME_INVOICE || 'invoiceDB';

// Export directory
const EXPORT_DIR = process.env.EXPORT_DIR || './exports';

// Ensure export directory exists
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

// MongoDB clients
let customerClient;
let invoiceClient;

async function connectDatabases() {
  console.log('🔌 Connecting to databases...');

  customerClient = new MongoClient(MONGO_URL, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  invoiceClient = new MongoClient(MONGO_URL_INVOICE, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });

  await customerClient.connect();
  console.log('✅ Connected to customerDB');

  await invoiceClient.connect();
  console.log('✅ Connected to invoiceDB');
}

async function closeDatabases() {
  if (customerClient) await customerClient.close();
  if (invoiceClient) await invoiceClient.close();
  console.log('🔌 Database connections closed');
}

// Format date for filename
function getDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0].replace(/-/g, '');
}

// Convert MongoDB documents to Excel-friendly format
function flattenDocument(doc) {
  const flat = {};

  for (const [key, value] of Object.entries(doc)) {
    if (value instanceof Date) {
      flat[key] = value.toISOString();
    } else if (typeof value === 'object' && value !== null) {
      // Stringify nested objects
      flat[key] = JSON.stringify(value);
    } else {
      flat[key] = value;
    }
  }

  return flat;
}

// Export collection to Excel
async function exportCollection(db, collectionName, filename) {
  console.log(`📊 Exporting ${collectionName}...`);

  const collection = db.collection(collectionName);
  const documents = await collection.find({}).toArray();

  if (documents.length === 0) {
    console.log(`⚠️ No documents found in ${collectionName}`);
    return null;
  }

  // Flatten documents for Excel
  const flatDocs = documents.map(flattenDocument);

  // Create worksheet
  const ws = XLSX.utils.json_to_sheet(flatDocs);

  // Auto-size columns
  const colWidths = [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; ++C) {
    let maxWidth = 10;
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v) {
        const width = String(cell.v).length;
        if (width > maxWidth) maxWidth = Math.min(width, 50);
      }
    }
    colWidths.push({ wch: maxWidth });
  }
  ws['!cols'] = colWidths;

  // Create workbook and save
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, collectionName);

  const filepath = path.join(EXPORT_DIR, filename);
  XLSX.writeFile(wb, filepath);

  console.log(`✅ Exported ${documents.length} records to ${filepath}`);
  return filepath;
}

// Export all collections to a single Excel file with multiple sheets
async function exportAll() {
  const dateStr = getDateString();
  const filename = `export_all_${dateStr}.xlsx`;
  const filepath = path.join(EXPORT_DIR, filename);

  console.log(`📊 Exporting all collections to ${filename}...`);

  const wb = XLSX.utils.book_new();

  // Get databases
  const customerDB = customerClient.db(DB_NAME);
  const invoiceDB = invoiceClient.db(DB_NAME_INVOICE);

  // Export payments
  const payments = await customerDB.collection('payments').find({}).toArray();
  if (payments.length > 0) {
    const ws = XLSX.utils.json_to_sheet(payments.map(flattenDocument));
    XLSX.utils.book_append_sheet(wb, ws, 'Payments');
    console.log(`  ✅ Payments: ${payments.length} records`);
  }

  // Export customers
  const customers = await customerDB.collection('customers').find({}).toArray();
  if (customers.length > 0) {
    const ws = XLSX.utils.json_to_sheet(customers.map(flattenDocument));
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    console.log(`  ✅ Customers: ${customers.length} records`);
  }

  // Export fraudAlerts
  const fraudAlerts = await customerDB.collection('fraudAlerts').find({}).toArray();
  if (fraudAlerts.length > 0) {
    const ws = XLSX.utils.json_to_sheet(fraudAlerts.map(flattenDocument));
    XLSX.utils.book_append_sheet(wb, ws, 'FraudAlerts');
    console.log(`  ✅ Fraud Alerts: ${fraudAlerts.length} records`);
  }

  // Export excelreadings (invoiceDB)
  const excelreadings = await invoiceDB.collection('excelreadings').find({}).toArray();
  if (excelreadings.length > 0) {
    const ws = XLSX.utils.json_to_sheet(excelreadings.map(flattenDocument));
    XLSX.utils.book_append_sheet(wb, ws, 'InvoiceReadings');
    console.log(`  ✅ Invoice Readings: ${excelreadings.length} records`);
  }

  // Save workbook
  XLSX.writeFile(wb, filepath);
  console.log(`\n📁 All data exported to: ${filepath}`);

  return filepath;
}

// Export specific collection
async function exportSpecific(collectionName) {
  const dateStr = getDateString();

  let db;
  let actualCollectionName = collectionName;

  // Determine which database to use
  if (collectionName === 'excelreadings' || collectionName === 'invoicereadings') {
    db = invoiceClient.db(DB_NAME_INVOICE);
    actualCollectionName = 'excelreadings';
  } else {
    db = customerClient.db(DB_NAME);
  }

  const filename = `export_${actualCollectionName}_${dateStr}.xlsx`;
  return await exportCollection(db, actualCollectionName, filename);
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const collection = args[0]?.toLowerCase();

  console.log('═══════════════════════════════════════════');
  console.log('📊 MongoDB to Excel Export Tool');
  console.log('═══════════════════════════════════════════\n');

  try {
    await connectDatabases();

    if (!collection || collection === 'all') {
      // Export all collections
      await exportAll();
    } else {
      // Export specific collection
      const validCollections = ['payments', 'customers', 'fraudalerts', 'excelreadings', 'invoicereadings'];

      if (!validCollections.includes(collection)) {
        console.error(`❌ Invalid collection: ${collection}`);
        console.log(`   Valid options: ${validCollections.join(', ')}`);
        process.exit(1);
      }

      await exportSpecific(collection);
    }

    console.log('\n✅ Export completed successfully!');

  } catch (error) {
    console.error('❌ Export failed:', error.message);
    process.exit(1);
  } finally {
    await closeDatabases();
  }
}

// Run export
main();
