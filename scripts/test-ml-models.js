/**
 * ML Bank Format Recognition Testing Script
 *
 * Tests the enhanced ML bank format recognition system with various
 * bank format examples and your account variations
 */

const { enhancedBankFormatRecognizer } = require('../src/ml/enhancedBankFormatRecognizer');

// Test cases representing different bank formats
const TEST_CASES = [
  // ABA Bank KHQR Format
  {
    name: 'ABA KHQR - Exact Match',
    ocrText: `
      ABA KHQR Payment
      Transfer to CHAN K. & THOEURN T.
      Account 086 228 226
      Amount 50.00 USD
      Transaction ID: ABC123456
      Status: Success
    `,
    expectedBank: 'ABA',
    shouldVerifyRecipient: true,
    expectedRecipient: 'CHAN K. & THOEURN T.',
    expectedAccount: '086228226'
  },

  // ABA Bank Transfer Format
  {
    name: 'ABA Transfer - Full Names',
    ocrText: `
      ABA Bank Transfer
      Beneficiary CHAN KASING AND THOEURN THEARY
      To Account 086228226
      Amount 75.50 USD
      Reference: XYZ789
    `,
    expectedBank: 'ABA',
    shouldVerifyRecipient: true,
    expectedRecipient: 'CHAN KASING AND THOEURN THEARY',
    expectedAccount: '086228226'
  },

  // ACLEDA Bank Format
  {
    name: 'ACLEDA - Name Variation',
    ocrText: `
      ACLEDA Bank Transfer
      Beneficiary Name K. CHAN & T. THOEURN
      Account No 086-228-226
      Amount 100,000 KHR
      Status Complete
    `,
    expectedBank: 'ACLEDA',
    shouldVerifyRecipient: true,
    expectedRecipient: 'K. CHAN & T. THOEURN',
    expectedAccount: '086228226'
  },

  // Wing Bank Format
  {
    name: 'Wing - Different Format',
    ocrText: `
      Wing Money Transfer
      Receiver 086228226 (CHAN KASING)
      Amount 25.00 USD
      Transaction Complete
      Reference WIN001
    `,
    expectedBank: 'Wing',
    shouldVerifyRecipient: true,
    expectedRecipient: 'CHAN KASING',
    expectedAccount: '086228226'
  },

  // KHQR Merchant Format
  {
    name: 'KHQR Merchant - Variation',
    ocrText: `
      KHQR Payment
      Merchant THOEURN THEARY & CHAN K.
      KHQR ID KB123456789
      Amount 35.00 USD
      Payment Success
    `,
    expectedBank: 'KHQR',
    shouldVerifyRecipient: true,
    expectedRecipient: 'THOEURN THEARY & CHAN K.',
    expectedAccount: 'KB123456789'
  },

  // Wrong Recipient Test
  {
    name: 'Wrong Recipient - Should Fail',
    ocrText: `
      ABA Bank Transfer
      Transfer to JOHN DOE
      Account 123456789
      Amount 50.00 USD
      Transaction Complete
    `,
    expectedBank: 'ABA',
    shouldVerifyRecipient: false,
    expectedRecipient: 'JOHN DOE',
    expectedAccount: '123456789'
  },

  // Non-bank Statement
  {
    name: 'Chat Screenshot - Should Reject',
    ocrText: `
      WhatsApp Chat
      John: Did you receive the payment?
      You: Not yet, let me check
      John: I sent $50 yesterday
      You: Okay, thanks
    `,
    expectedBank: null,
    shouldVerifyRecipient: false,
    expectedRecipient: null,
    expectedAccount: null
  },

  // Canadia Bank (new format)
  {
    name: 'Canadia Bank - New Format',
    ocrText: `
      Canadia Bank Transfer
      Recipient CHAN K. & THOEURN T.
      Account Number 086 228 226
      Amount 150.00 USD
      Status Completed
    `,
    expectedBank: 'Canadia',
    shouldVerifyRecipient: true,
    expectedRecipient: 'CHAN K. & THOEURN T.',
    expectedAccount: '086228226'
  }
];

async function runTests() {
  console.log('🧪 Starting ML Bank Format Recognition Tests\n');
  console.log('═'.repeat(80));

  // Initialize the enhanced recognizer
  await enhancedBankFormatRecognizer.initialize();

  const results = {
    total: TEST_CASES.length,
    passed: 0,
    failed: 0,
    details: []
  };

  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`\n🔍 Test ${i + 1}/${TEST_CASES.length}: ${testCase.name}`);
    console.log('─'.repeat(50));

    try {
      // Run the enhanced extraction
      const result = await enhancedBankFormatRecognizer.extractWithEnhancedFormat(testCase.ocrText);

      // Evaluate results
      const evaluation = evaluateResult(testCase, result);

      if (evaluation.passed) {
        console.log('✅ PASSED');
        results.passed++;
      } else {
        console.log('❌ FAILED');
        results.failed++;
      }

      console.log(`   Bank Detection: ${result.bank} (expected: ${testCase.expectedBank})`);
      console.log(`   Recipient: "${result.recipientName}" (expected: "${testCase.expectedRecipient}")`);
      console.log(`   Account: "${result.toAccount}" (expected: "${testCase.expectedAccount}")`);
      console.log(`   Confidence: ${result.confidence.toFixed(3)}`);
      console.log(`   Method: ${result.method}`);

      if (result.mlEnhancement?.bankDetection) {
        console.log(`   ML Bank Detection: ${result.mlEnhancement.bankDetection.finalPrediction} (${result.mlEnhancement.bankDetection.confidence.toFixed(3)})`);
      }

      if (result.mlEnhancement?.recipientValidation) {
        const recipientVal = result.mlEnhancement.recipientValidation.finalResult;
        if (recipientVal) {
          console.log(`   ML Recipient Validation: ${recipientVal.isValid} (${recipientVal.confidence.toFixed(3)})`);
        }
      }

      console.log(`   Evaluation: ${evaluation.reason}`);

      results.details.push({
        testCase: testCase.name,
        passed: evaluation.passed,
        result: result,
        evaluation: evaluation
      });

    } catch (error) {
      console.log('❌ ERROR:', error.message);
      results.failed++;
      results.details.push({
        testCase: testCase.name,
        passed: false,
        error: error.message
      });
    }
  }

  // Print summary
  console.log('\n' + '═'.repeat(80));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total Tests: ${results.total}`);
  console.log(`Passed: ${results.passed} (${(results.passed / results.total * 100).toFixed(1)}%)`);
  console.log(`Failed: ${results.failed} (${(results.failed / results.total * 100).toFixed(1)}%)`);

  // Analyze ML performance
  const mlStats = analyzeMLPerformance(results.details);
  console.log('\n🤖 ML PERFORMANCE ANALYSIS');
  console.log('─'.repeat(50));
  console.log(`Bank Detection Accuracy: ${mlStats.bankDetectionAccuracy.toFixed(1)}%`);
  console.log(`Recipient Validation Accuracy: ${mlStats.recipientValidationAccuracy.toFixed(1)}%`);
  console.log(`ML Enhancement Rate: ${mlStats.mlEnhancementRate.toFixed(1)}%`);

  // Enhanced stats
  const enhancedStats = enhancedBankFormatRecognizer.getEnhancedStats();
  console.log('\n🏗️ SYSTEM STATUS');
  console.log('─'.repeat(50));
  console.log(`Enhanced System Initialized: ${enhancedStats.enhanced.isInitialized}`);
  console.log(`ML Bank Classifier Loaded: ${enhancedStats.enhanced.mlModelsLoaded.bankClassifier}`);
  console.log(`ML Recipient Validator Loaded: ${enhancedStats.enhanced.mlModelsLoaded.recipientValidator}`);

  console.log('\n✅ Testing completed!');
  return results;
}

/**
 * Evaluate if test result matches expectations
 */
function evaluateResult(testCase, result) {
  const evaluation = {
    passed: false,
    reason: '',
    checks: {
      bankDetection: false,
      recipientVerification: false,
      dataExtraction: false
    }
  };

  // Check bank detection
  if (testCase.expectedBank === null && result.bank === null) {
    evaluation.checks.bankDetection = true;
  } else if (testCase.expectedBank && result.bank === testCase.expectedBank) {
    evaluation.checks.bankDetection = true;
  }

  // Check recipient verification
  if (!testCase.shouldVerifyRecipient) {
    // For negative cases, we expect either no ML validation or validation failure
    if (!result.mlEnhancement?.recipientValidation?.finalResult?.isValid) {
      evaluation.checks.recipientVerification = true;
    }
  } else {
    // For positive cases, we expect successful validation
    if (result.mlEnhancement?.recipientValidation?.finalResult?.isValid) {
      evaluation.checks.recipientVerification = true;
    } else {
      // Fallback to traditional validation check
      const combinedText = `${result.recipientName || ''} ${result.toAccount || ''}`.toLowerCase();
      const hasKnownRecipient = (
        combinedText.includes('chan k') ||
        combinedText.includes('thoeurn t') ||
        combinedText.includes('086228226') ||
        combinedText.includes('chan kasing') ||
        combinedText.includes('thoeurn theary')
      );

      if (hasKnownRecipient) {
        evaluation.checks.recipientVerification = true;
      }
    }
  }

  // Check data extraction (at least one field should be extracted for valid bank statements)
  if (testCase.expectedBank && (result.recipientName || result.toAccount)) {
    evaluation.checks.dataExtraction = true;
  } else if (!testCase.expectedBank && !result.recipientName && !result.toAccount) {
    evaluation.checks.dataExtraction = true; // Correctly extracted nothing from non-bank statements
  }

  // Determine overall pass/fail
  const passedChecks = Object.values(evaluation.checks).filter(check => check).length;
  evaluation.passed = passedChecks >= 2; // At least 2/3 checks must pass

  // Generate reason
  if (evaluation.passed) {
    evaluation.reason = `Passed ${passedChecks}/3 checks (bank: ${evaluation.checks.bankDetection}, recipient: ${evaluation.checks.recipientVerification}, extraction: ${evaluation.checks.dataExtraction})`;
  } else {
    evaluation.reason = `Failed - only ${passedChecks}/3 checks passed`;
  }

  return evaluation;
}

/**
 * Analyze ML performance across all test cases
 */
function analyzeMLPerformance(testDetails) {
  let bankDetectionCorrect = 0;
  let recipientValidationCorrect = 0;
  let mlEnhancedCount = 0;

  for (const detail of testDetails) {
    if (detail.passed) {
      if (detail.evaluation?.checks?.bankDetection) {
        bankDetectionCorrect++;
      }
      if (detail.evaluation?.checks?.recipientVerification) {
        recipientValidationCorrect++;
      }
    }

    if (detail.result?.mlEnhancement) {
      mlEnhancedCount++;
    }
  }

  return {
    bankDetectionAccuracy: (bankDetectionCorrect / testDetails.length) * 100,
    recipientValidationAccuracy: (recipientValidationCorrect / testDetails.length) * 100,
    mlEnhancementRate: (mlEnhancedCount / testDetails.length) * 100
  };
}

// Run tests if script is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests, TEST_CASES };