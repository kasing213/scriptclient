/**
 * Training Data Generator for Bank Format ML Models
 *
 * Collects and structures training data from payment records
 * to train bank format classification and recipient name validation models
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Your known bank account and name variations
const KNOWN_RECIPIENT_DATA = {
  account: '086228226',
  accountVariations: ['086228226', '086 228 226', '086-228-226'],
  names: {
    // Different bank format variations of your name
    initials: ['CHAN K.', 'THOEURN T.', 'K. CHAN', 'T. THOEURN'],
    combined: ['CHAN K. & THOEURN T.', 'K. CHAN & T. THOEURN'],
    fullNames: ['CHAN KASING', 'THOEURN THEARY'],
    fullCombined: ['CHAN KASING AND THOEURN THEARY', 'KASING CHAN AND THEARY THOEURN']
  }
};

// Bank-specific patterns from your existing bank format recognizer
const BANK_SIGNATURES = {
  ABA: {
    keywords: ['aba', 'aba bank', 'advanced bank', 'transfer to', '012 888'],
    patterns: [
      'Transfer to',
      'Beneficiary',
      'Account',
      'Trx. ID',
      'Reference'
    ]
  },
  ACLEDA: {
    keywords: ['acleda', 'acleda bank', 'beneficiary name', '012 20'],
    patterns: [
      'Beneficiary Name',
      'Account Name',
      'Account No'
    ]
  },
  Wing: {
    keywords: ['wing', 'wing bank', 'receiver', '089 999'],
    patterns: [
      'Receiver',
      'Wing Account'
    ]
  },
  KHQR: {
    keywords: ['khqr', 'bakong', 'merchant', 'cambodia qr'],
    patterns: [
      'Merchant',
      'KHQR ID'
    ]
  },
  Canadia: {
    keywords: ['canadia', 'canadia bank', 'cbc'],
    patterns: [
      'Recipient',
      'Account Number'
    ]
  }
};

/**
 * Collects training data from payment records
 */
class TrainingDataCollector {
  constructor() {
    this.client = null;
    this.db = null;
    this.paymentsCollection = null;
  }

  async connect() {
    const MONGO_URL = process.env.MONGO_URL;
    const DB_NAME = process.env.DB_NAME || 'customerDB';

    if (!MONGO_URL) {
      throw new Error('MONGO_URL environment variable is required');
    }

    this.client = new MongoClient(MONGO_URL, {
      tls: true,
      tlsAllowInvalidCertificates: true,
    });

    await this.client.connect();
    this.db = this.client.db(DB_NAME);
    this.paymentsCollection = this.db.collection('payments');
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
    }
  }

  /**
   * Extract training data for bank format classification
   */
  async collectBankFormatTrainingData(limit = 1000) {
    const trainingData = [];

    // Get payments with bank format enhancement data
    const payments = await this.paymentsCollection.find({
      'bankFormatEnhancement.detected': true,
      'ocrResult': { $exists: true },
      'uploadedAt': { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } // Last 90 days
    }).limit(limit).toArray();

    for (const payment of payments) {
      const ocrText = payment.ocrResult || '';
      const detectedBank = payment.bankFormatEnhancement?.bank;

      if (ocrText && detectedBank) {
        trainingData.push({
          input: this.extractTextFeatures(ocrText),
          output: detectedBank,
          rawText: ocrText,
          confidence: payment.bankFormatEnhancement.confidence || 0.5,
          verified: payment.verificationStatus === 'verified'
        });
      }
    }

    return trainingData;
  }

  /**
   * Extract training data for recipient name validation
   */
  async collectNameValidationTrainingData(limit = 1000) {
    const trainingData = [];

    // Get verified payments (positive examples)
    const verifiedPayments = await this.paymentsCollection.find({
      'verificationStatus': 'verified',
      $or: [
        { 'recipientName': { $exists: true, $ne: '' } },
        { 'toAccount': { $exists: true, $ne: '' } }
      ],
      'uploadedAt': { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
    }).limit(limit / 2).toArray();

    // Get rejected payments (negative examples)
    const rejectedPayments = await this.paymentsCollection.find({
      'verificationStatus': 'rejected',
      $or: [
        { 'recipientName': { $exists: true, $ne: '' } },
        { 'toAccount': { $exists: true, $ne: '' } }
      ],
      'uploadedAt': { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
    }).limit(limit / 2).toArray();

    // Process verified payments as positive examples
    for (const payment of verifiedPayments) {
      const recipientName = payment.recipientName || '';
      const toAccount = payment.toAccount || '';
      const combinedText = `${recipientName} ${toAccount}`.toLowerCase();

      trainingData.push({
        input: this.extractNameFeatures(recipientName, toAccount),
        output: 1, // Valid recipient
        recipientName,
        toAccount,
        combinedText,
        bankType: payment.bankFormatEnhancement?.bank || 'unknown'
      });
    }

    // Process rejected payments as negative examples
    for (const payment of rejectedPayments) {
      const recipientName = payment.recipientName || '';
      const toAccount = payment.toAccount || '';
      const combinedText = `${recipientName} ${toAccount}`.toLowerCase();

      trainingData.push({
        input: this.extractNameFeatures(recipientName, toAccount),
        output: 0, // Invalid recipient
        recipientName,
        toAccount,
        combinedText,
        bankType: payment.bankFormatEnhancement?.bank || 'unknown'
      });
    }

    return trainingData;
  }

  /**
   * Extract features from OCR text for bank classification
   */
  extractTextFeatures(text) {
    const lowerText = text.toLowerCase();
    const features = [];

    // Keyword presence features
    for (const [bankCode, bankData] of Object.entries(BANK_SIGNATURES)) {
      let bankScore = 0;

      // Check keyword matches
      for (const keyword of bankData.keywords) {
        if (lowerText.includes(keyword)) {
          bankScore += keyword.length;
        }
      }

      // Check pattern matches
      for (const pattern of bankData.patterns) {
        if (lowerText.includes(pattern.toLowerCase())) {
          bankScore += pattern.length;
        }
      }

      features.push(bankScore);
    }

    // Text characteristics
    features.push(text.length); // Text length
    features.push((text.match(/\d/g) || []).length); // Number count
    features.push((text.match(/[A-Z]/g) || []).length); // Uppercase count
    features.push((text.match(/[\.\-\:]/g) || []).length); // Punctuation count

    return features;
  }

  /**
   * Extract features from recipient name and account for validation
   */
  extractNameFeatures(recipientName, toAccount) {
    const combinedText = `${recipientName} ${toAccount}`.toLowerCase();
    const features = [];

    // Account number matching features
    for (const accountVar of KNOWN_RECIPIENT_DATA.accountVariations) {
      features.push(combinedText.includes(accountVar.toLowerCase()) ? 1 : 0);
    }

    // Name matching features
    const nameCategories = ['initials', 'combined', 'fullNames', 'fullCombined'];
    for (const category of nameCategories) {
      let categoryScore = 0;
      for (const name of KNOWN_RECIPIENT_DATA.names[category]) {
        if (combinedText.includes(name.toLowerCase())) {
          categoryScore++;
        }
      }
      features.push(categoryScore);
    }

    // Text characteristics
    features.push(recipientName.length);
    features.push(toAccount.length);
    features.push((combinedText.match(/\d/g) || []).length); // Digit count
    features.push((combinedText.match(/[A-Z\.&]/gi) || []).length); // Special chars

    return features;
  }

  /**
   * Generate synthetic training data for name variations
   */
  generateSyntheticNameData() {
    const syntheticData = [];
    const bankTypes = Object.keys(BANK_SIGNATURES);

    // Generate positive examples
    for (const bankType of bankTypes) {
      // Account variations
      for (const account of KNOWN_RECIPIENT_DATA.accountVariations) {
        // Name variations
        for (const category of Object.keys(KNOWN_RECIPIENT_DATA.names)) {
          for (const name of KNOWN_RECIPIENT_DATA.names[category]) {
            syntheticData.push({
              input: this.extractNameFeatures(name, account),
              output: 1,
              recipientName: name,
              toAccount: account,
              bankType: bankType,
              synthetic: true
            });
          }
        }
      }
    }

    // Generate negative examples (wrong names/accounts)
    const wrongNames = [
      'JOHN DOE', 'MARY SMITH', 'DAVID LEE', 'SARAH WONG',
      'PETER TAN', 'LISA CHEN', 'MICHAEL BROWN', 'ANNA DAVIS'
    ];
    const wrongAccounts = [
      '123456789', '987654321', '111222333', '555666777'
    ];

    for (let i = 0; i < 100; i++) {
      const wrongName = wrongNames[Math.floor(Math.random() * wrongNames.length)];
      const wrongAccount = wrongAccounts[Math.floor(Math.random() * wrongAccounts.length)];
      const bankType = bankTypes[Math.floor(Math.random() * bankTypes.length)];

      syntheticData.push({
        input: this.extractNameFeatures(wrongName, wrongAccount),
        output: 0,
        recipientName: wrongName,
        toAccount: wrongAccount,
        bankType: bankType,
        synthetic: true
      });
    }

    return syntheticData;
  }

  /**
   * Save training data to files
   */
  async saveTrainingData(outputDir = './training_data') {
    const fs = require('fs').promises;

    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Collect bank format training data
    console.log('Collecting bank format training data...');
    const bankFormatData = await this.collectBankFormatTrainingData();

    // Collect name validation training data
    console.log('Collecting name validation training data...');
    const nameValidationData = await this.collectNameValidationTrainingData();

    // Generate synthetic data
    console.log('Generating synthetic training data...');
    const syntheticData = this.generateSyntheticNameData();

    // Combine name validation data
    const allNameData = [...nameValidationData, ...syntheticData];

    // Save to JSON files
    const bankFormatFile = `${outputDir}/bank_format_training.json`;
    const nameValidationFile = `${outputDir}/name_validation_training.json`;
    const summaryFile = `${outputDir}/training_summary.json`;

    await fs.writeFile(bankFormatFile, JSON.stringify(bankFormatData, null, 2));
    await fs.writeFile(nameValidationFile, JSON.stringify(allNameData, null, 2));

    // Create summary
    const summary = {
      generatedAt: new Date().toISOString(),
      bankFormatSamples: bankFormatData.length,
      nameValidationSamples: allNameData.length,
      syntheticSamples: syntheticData.length,
      bankTypes: Object.keys(BANK_SIGNATURES),
      knownRecipient: KNOWN_RECIPIENT_DATA
    };

    await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2));

    console.log(`Training data saved:`);
    console.log(`- Bank format: ${bankFormatData.length} samples → ${bankFormatFile}`);
    console.log(`- Name validation: ${allNameData.length} samples → ${nameValidationFile}`);
    console.log(`- Summary: → ${summaryFile}`);

    return summary;
  }
}

module.exports = {
  TrainingDataCollector,
  KNOWN_RECIPIENT_DATA,
  BANK_SIGNATURES
};