/**
 * ML Model Training Script
 *
 * Trains the bank format classifier and recipient validator models
 * using collected payment data from MongoDB
 */

const { enhancedBankFormatRecognizer } = require('../src/ml/enhancedBankFormatRecognizer');
const { TrainingDataCollector } = require('../src/ml/trainingData');

async function trainModels() {
  console.log('🚀 Starting ML Model Training\n');
  console.log('═'.repeat(80));

  const collector = new TrainingDataCollector();

  try {
    // Connect to database
    console.log('🔗 Connecting to MongoDB...');
    await collector.connect();
    console.log('✅ Connected to database\n');

    // Collect training data
    console.log('📊 Collecting training data...');
    const bankFormatData = await collector.collectBankFormatTrainingData(2000);
    const nameValidationData = await collector.collectNameValidationTrainingData(2000);

    console.log(`📈 Bank format samples: ${bankFormatData.length}`);
    console.log(`📈 Name validation samples: ${nameValidationData.length}`);

    // Generate synthetic data
    console.log('🔄 Generating synthetic training data...');
    const syntheticData = collector.generateSyntheticNameData();
    const combinedNameData = [...nameValidationData, ...syntheticData];
    console.log(`📈 Combined name validation samples: ${combinedNameData.length}\n`);

    // Initialize enhanced recognizer
    console.log('🤖 Initializing Enhanced Bank Format Recognizer...');
    await enhancedBankFormatRecognizer.initialize();

    if (bankFormatData.length > 0) {
      // Train bank format classifier
      console.log('🏦 Training bank format classifier...');
      console.log('─'.repeat(50));

      const bankTrainingConfig = {
        epochs: 100,
        batchSize: 32,
        validationSplit: 0.2,
        verbose: 1
      };

      await enhancedBankFormatRecognizer.bankDetector.trainModel(bankFormatData, bankTrainingConfig);
      console.log('✅ Bank classifier training completed!\n');
    } else {
      console.log('⚠️ No bank format data available for training\n');
    }

    if (combinedNameData.length > 0) {
      // Train recipient validator
      console.log('👤 Training recipient validator...');
      console.log('─'.repeat(50));

      const nameTrainingConfig = {
        epochs: 150,
        batchSize: 16,
        validationSplit: 0.2,
        verbose: 1
      };

      await enhancedBankFormatRecognizer.recipientValidator.trainModel(combinedNameData, nameTrainingConfig);
      console.log('✅ Recipient validator training completed!\n');
    } else {
      console.log('⚠️ No name validation data available for training\n');
    }

    // Save models
    console.log('💾 Saving trained models...');
    await enhancedBankFormatRecognizer.saveModels();
    console.log('✅ Models saved successfully!\n');

    // Save training data for future reference
    console.log('📁 Saving training data...');
    await collector.saveTrainingData('./training_data');

    console.log('🎉 Training completed successfully!');

  } catch (error) {
    console.error('❌ Training failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await collector.disconnect();
    console.log('\n✅ Database connection closed');
  }
}

async function trainWithCustomData() {
  console.log('🧪 Training with custom synthetic data...\n');

  // Create extensive synthetic training data for when no real data is available
  const syntheticBankData = generateSyntheticBankData();
  const syntheticNameData = generateExtensiveSyntheticNameData();

  console.log(`📈 Synthetic bank samples: ${syntheticBankData.length}`);
  console.log(`📈 Synthetic name samples: ${syntheticNameData.length}\n`);

  await enhancedBankFormatRecognizer.initialize();

  // Train with synthetic data
  await enhancedBankFormatRecognizer.bankDetector.trainModel(syntheticBankData, {
    epochs: 50,
    batchSize: 16,
    validationSplit: 0.2
  });

  await enhancedBankFormatRecognizer.recipientValidator.trainModel(syntheticNameData, {
    epochs: 100,
    batchSize: 16,
    validationSplit: 0.2
  });

  await enhancedBankFormatRecognizer.saveModels();
  console.log('🎉 Synthetic training completed!');
}

function generateSyntheticBankData() {
  const { BANK_SIGNATURES } = require('../src/ml/trainingData');
  const bankTypes = Object.keys(BANK_SIGNATURES);
  const syntheticData = [];

  // Generate positive examples for each bank
  for (const bankType of bankTypes) {
    const bankData = BANK_SIGNATURES[bankType];

    for (let i = 0; i < 50; i++) {
      // Create OCR text with bank keywords and patterns
      let ocrText = '';

      // Add random keywords
      const keyword = bankData.keywords[Math.floor(Math.random() * bankData.keywords.length)];
      ocrText += keyword.toUpperCase() + '\n';

      // Add random patterns
      const pattern = bankData.patterns[Math.floor(Math.random() * bankData.patterns.length)];
      ocrText += pattern + ': SAMPLE_DATA\n';

      // Add noise
      ocrText += 'Amount: ' + (Math.random() * 1000).toFixed(2) + ' USD\n';
      ocrText += 'Transaction ID: ' + Math.random().toString(36).substr(2, 9) + '\n';

      const features = extractSyntheticFeatures(ocrText, bankType);

      syntheticData.push({
        input: features,
        output: bankType,
        synthetic: true,
        ocrText
      });
    }
  }

  // Generate negative examples (non-bank text)
  const negativeTexts = [
    'WhatsApp Chat\nJohn: Hello\nYou: Hi there\n',
    'Facebook Messenger\nMessage received\n',
    'Random photo with text\nThis is not a bank statement\n',
    'Invoice document\nTotal: $100\nDue date: Tomorrow\n'
  ];

  for (const negativeText of negativeTexts) {
    for (let i = 0; i < 25; i++) {
      const features = extractSyntheticFeatures(negativeText, null);
      syntheticData.push({
        input: features,
        output: bankTypes[0], // Default to first bank type, but with low confidence features
        synthetic: true,
        ocrText: negativeText,
        isNegative: true
      });
    }
  }

  return syntheticData;
}

function generateExtensiveSyntheticNameData() {
  const { KNOWN_RECIPIENT_DATA } = require('../src/ml/trainingData');
  const syntheticData = [];

  // Generate positive examples (more variations)
  const nameVariations = [
    'CHAN K. & THOEURN T.',
    'CHAN KASING AND THOEURN THEARY',
    'K. CHAN & T. THOEURN',
    'KASING CHAN AND THEARY THOEURN',
    'CHAN K THOEURN T',
    'CHAN KASING THOEURN THEARY',
    'MR CHAN K & MS THOEURN T',
    'CHAN K. AND THOEURN T.'
  ];

  const accountVariations = [
    '086228226',
    '086 228 226',
    '086-228-226',
    '086.228.226',
    'ACC: 086228226',
    'Account 086 228 226'
  ];

  // Generate positive combinations
  for (const name of nameVariations) {
    for (const account of accountVariations) {
      for (let i = 0; i < 5; i++) {
        const features = extractNameFeaturesSynthetic(name, account);
        syntheticData.push({
          input: features,
          output: 1,
          recipientName: name,
          toAccount: account,
          synthetic: true
        });
      }
    }
  }

  // Generate negative examples (wrong names/accounts)
  const wrongNames = [
    'JOHN DOE', 'MARY SMITH', 'PETER TAN', 'SARAH WONG',
    'DAVID LEE', 'LISA CHEN', 'MICHAEL BROWN', 'ANNA DAVIS',
    'ROBERT WILSON', 'JESSICA TAYLOR', 'JAMES MOORE', 'EMILY JOHNSON'
  ];

  const wrongAccounts = [
    '123456789', '987654321', '555666777', '111222333',
    '999888777', '444555666', '777888999', '333444555'
  ];

  for (let i = 0; i < 200; i++) {
    const wrongName = wrongNames[Math.floor(Math.random() * wrongNames.length)];
    const wrongAccount = wrongAccounts[Math.floor(Math.random() * wrongAccounts.length)];

    const features = extractNameFeaturesSynthetic(wrongName, wrongAccount);
    syntheticData.push({
      input: features,
      output: 0,
      recipientName: wrongName,
      toAccount: wrongAccount,
      synthetic: true
    });
  }

  return syntheticData;
}

function extractSyntheticFeatures(text, bankType) {
  const { BANK_SIGNATURES } = require('../src/ml/trainingData');
  const lowerText = text.toLowerCase();
  const features = [];

  // Bank signature scores
  for (const [bankCode, bankData] of Object.entries(BANK_SIGNATURES)) {
    let bankScore = 0;

    if (bankType === bankCode) {
      // Boost score for correct bank type
      bankScore = 0.8 + Math.random() * 0.2;
    } else {
      // Random low score for other banks
      bankScore = Math.random() * 0.3;
    }

    features.push(bankScore);
  }

  // Text characteristics (normalized)
  features.push(Math.min(text.length / 1000, 1.0));
  features.push(Math.min((text.match(/\d/g) || []).length / 50, 1.0));
  features.push(Math.min((text.match(/[A-Z]/g) || []).length / 100, 1.0));
  features.push(Math.min((text.match(/[\.\-\:]/g) || []).length / 20, 1.0));

  return features;
}

function extractNameFeaturesSynthetic(recipientName, toAccount) {
  const { KNOWN_RECIPIENT_DATA } = require('../src/ml/trainingData');
  const combinedText = `${recipientName || ''} ${toAccount || ''}`.toLowerCase();
  const features = [];

  // Account number matching features
  for (const accountVar of KNOWN_RECIPIENT_DATA.accountVariations) {
    features.push(combinedText.includes(accountVar.toLowerCase()) ? 1 : 0);
  }

  // Name matching features by category
  const nameCategories = ['initials', 'combined', 'fullNames', 'fullCombined'];
  for (const category of nameCategories) {
    let categoryScore = 0;
    for (const name of KNOWN_RECIPIENT_DATA.names[category]) {
      if (combinedText.includes(name.toLowerCase())) {
        categoryScore++;
      }
    }
    features.push(Math.min(categoryScore, 1));
  }

  // Text characteristics
  features.push(Math.min((recipientName || '').length / 50, 1));
  features.push(Math.min((toAccount || '').length / 20, 1));
  features.push(Math.min((combinedText.match(/\d/g) || []).length / 20, 1));
  features.push(Math.min((combinedText.match(/[A-Z\.&]/gi) || []).length / 20, 1));

  return features;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--synthetic') || args.includes('-s')) {
    console.log('🧪 Running with synthetic data only...\n');
    trainWithCustomData().catch(error => {
      console.error('💥 Synthetic training failed:', error);
      process.exit(1);
    });
  } else {
    console.log('📊 Running with real database data...\n');
    trainModels().catch(error => {
      console.error('💥 Training failed:', error);
      process.exit(1);
    });
  }
}

module.exports = { trainModels, trainWithCustomData };