/**
 * Training Data Collection Script
 *
 * Collects and saves training data from payment records
 * for ML model training
 */

const { TrainingDataCollector } = require('../src/ml/trainingData');

async function collectTrainingData() {
  console.log('📊 Collecting Training Data for ML Models\n');
  console.log('═'.repeat(80));

  const collector = new TrainingDataCollector();

  try {
    // Connect to database
    console.log('🔗 Connecting to MongoDB...');
    await collector.connect();
    console.log('✅ Connected to database\n');

    // Collect and save training data
    console.log('📈 Collecting payment data from last 90 days...');
    const summary = await collector.saveTrainingData('./training_data');

    console.log('\n📋 COLLECTION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`Bank format samples: ${summary.bankFormatSamples}`);
    console.log(`Name validation samples: ${summary.nameValidationSamples}`);
    console.log(`Synthetic samples: ${summary.syntheticSamples}`);
    console.log(`Supported banks: ${summary.bankTypes.join(', ')}`);
    console.log(`Generated at: ${summary.generatedAt}`);

    // Analyze data quality
    console.log('\n🔍 DATA QUALITY ANALYSIS');
    console.log('═'.repeat(50));

    if (summary.bankFormatSamples > 100) {
      console.log('✅ Sufficient bank format data for training');
    } else if (summary.bankFormatSamples > 50) {
      console.log('⚠️ Limited bank format data - consider synthetic augmentation');
    } else {
      console.log('🚨 Insufficient bank format data - synthetic training recommended');
    }

    if (summary.nameValidationSamples > 200) {
      console.log('✅ Sufficient name validation data for training');
    } else if (summary.nameValidationSamples > 100) {
      console.log('⚠️ Limited name validation data - synthetic data included');
    } else {
      console.log('🚨 Insufficient name validation data - synthetic training required');
    }

    // Bank coverage analysis
    console.log('\n🏦 BANK COVERAGE ANALYSIS');
    console.log('═'.repeat(50));

    try {
      const fs = require('fs');
      const bankFormatData = JSON.parse(fs.readFileSync('./training_data/bank_format_training.json', 'utf8'));

      const bankCoverage = {};
      for (const sample of bankFormatData) {
        if (sample.output) {
          bankCoverage[sample.output] = (bankCoverage[sample.output] || 0) + 1;
        }
      }

      for (const [bank, count] of Object.entries(bankCoverage)) {
        console.log(`${bank.padEnd(10)} | ${count.toString().padStart(3)} samples`);
      }

      // Recommendations
      console.log('\n💡 RECOMMENDATIONS');
      console.log('═'.repeat(50));

      const minSamplesPerBank = 20;
      const underRepresented = Object.entries(bankCoverage).filter(([, count]) => count < minSamplesPerBank);

      if (underRepresented.length > 0) {
        console.log('⚠️ Under-represented banks:');
        for (const [bank] of underRepresented) {
          console.log(`   - ${bank}: Need more training samples`);
        }
        console.log('   Consider synthetic data generation or collecting more data');
      } else {
        console.log('✅ All banks have sufficient representation');
      }

      if (summary.bankFormatSamples < 100) {
        console.log('📋 Run: npm run ml:train -- --synthetic (for synthetic training)');
      } else {
        console.log('📋 Run: npm run ml:train (for full training with real data)');
      }

    } catch (error) {
      console.warn('⚠️ Could not analyze bank coverage:', error.message);
    }

    console.log('\n🎉 Data collection completed successfully!');

  } catch (error) {
    console.error('❌ Data collection failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await collector.disconnect();
    console.log('\n✅ Database connection closed');
  }
}

// CLI interface
if (require.main === module) {
  collectTrainingData().catch(error => {
    console.error('💥 Data collection failed:', error);
    process.exit(1);
  });
}

module.exports = { collectTrainingData };