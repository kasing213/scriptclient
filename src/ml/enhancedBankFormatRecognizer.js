/**
 * Enhanced Bank Format Recognizer with ML Integration
 *
 * Combines the existing rule-based bank format recognizer with
 * machine learning models for improved accuracy and adaptability
 */

const { extractWithBankFormat, detectBank, formatName, formatAccount, BANK_FORMATS } = require('../bankFormatRecognizer');
const { HybridBankDetector } = require('./bankClassifier');
const { HybridRecipientValidator } = require('./nameValidator');

class EnhancedBankFormatRecognizer {
  constructor() {
    this.bankDetector = new HybridBankDetector();
    this.recipientValidator = new HybridRecipientValidator();
    this.isInitialized = false;
  }

  /**
   * Initialize the ML models
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      console.log('🤖 Initializing Enhanced Bank Format Recognizer...');

      // Initialize ML components
      await this.bankDetector.initialize();
      await this.recipientValidator.initialize();

      this.isInitialized = true;
      console.log('✅ Enhanced Bank Format Recognizer initialized successfully');
    } catch (error) {
      console.warn('⚠️ ML initialization failed, falling back to rule-based:', error.message);
      this.isInitialized = false;
    }
  }

  /**
   * Enhanced bank format extraction with ML integration
   */
  async extractWithEnhancedFormat(ocrText) {
    // Ensure initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    const result = {
      success: false,
      confidence: 0,
      method: 'enhanced_ml',
      bank: null,
      recipientName: null,
      toAccount: null,
      amount: null,
      extractionDetails: {},
      mlEnhancement: {
        bankDetection: null,
        recipientValidation: null,
        improvements: []
      }
    };

    try {
      // Step 1: Enhanced Bank Detection
      let detectedBank = null;
      let bankConfidence = 0;

      if (this.isInitialized) {
        // Use ML-enhanced bank detection
        const bankDetection = await this.bankDetector.detectBank(ocrText);
        result.mlEnhancement.bankDetection = bankDetection;

        detectedBank = bankDetection.finalPrediction;
        bankConfidence = bankDetection.confidence;

        console.log(`🏦 Enhanced bank detection: ${detectedBank} (confidence: ${bankConfidence.toFixed(3)})`);
      } else {
        // Fallback to rule-based detection
        detectedBank = detectBank(ocrText);
        bankConfidence = detectedBank ? 0.7 : 0;
        result.mlEnhancement.improvements.push('fallback_to_rules');
      }

      if (!detectedBank) {
        result.reason = 'bank_not_detected';
        return result;
      }

      result.bank = detectedBank;
      const bankFormat = BANK_FORMATS[detectedBank];

      // Step 2: Traditional OCR Extraction
      const traditionalResult = extractWithBankFormat(ocrText);

      if (traditionalResult.success) {
        // Copy traditional results
        result.recipientName = traditionalResult.recipientName;
        result.toAccount = traditionalResult.toAccount;
        result.amount = traditionalResult.amount;
        result.extractionDetails = traditionalResult.extractionDetails;
      }

      // Step 3: Enhanced Recipient Validation
      if (result.recipientName || result.toAccount) {
        const recipientValidation = await this.validateRecipientWithML(
          result.recipientName,
          result.toAccount,
          detectedBank
        );

        result.mlEnhancement.recipientValidation = recipientValidation;

        // Apply ML improvements if confidence is high
        if (recipientValidation.finalResult) {
          const mlResult = recipientValidation.finalResult;

          if (mlResult.confidence > 0.8) {
            result.mlEnhancement.improvements.push('ml_recipient_validation');
            console.log(`✨ ML recipient validation: ${mlResult.isValid} (confidence: ${mlResult.confidence.toFixed(3)})`);
          }

          // Store ML validation for security check
          result.mlRecipientValidation = {
            isValid: mlResult.isValid,
            confidence: mlResult.confidence,
            method: mlResult.method
          };
        }
      }

      // Step 4: Calculate Enhanced Confidence
      const confidenceFactors = [bankConfidence];

      if (result.extractionDetails.recipient) {
        confidenceFactors.push(result.extractionDetails.recipient.confidence);
      }
      if (result.extractionDetails.account) {
        confidenceFactors.push(result.extractionDetails.account.confidence);
      }
      if (result.mlEnhancement.recipientValidation?.finalResult) {
        confidenceFactors.push(result.mlEnhancement.recipientValidation.finalResult.confidence);
      }

      result.confidence = confidenceFactors.reduce((sum, conf) => sum + conf, 0) / confidenceFactors.length;

      // Step 5: Determine Success
      result.success = (result.recipientName || result.toAccount) && result.confidence > 0.3;

      if (result.success) {
        console.log(`✅ Enhanced extraction successful (confidence: ${result.confidence.toFixed(3)})`);

        // Log improvements
        if (result.mlEnhancement.improvements.length > 0) {
          console.log(`🚀 ML improvements: ${result.mlEnhancement.improvements.join(', ')}`);
        }
      }

      return result;

    } catch (error) {
      console.error('Enhanced bank format extraction error:', error.message);

      // Fallback to traditional method
      console.log('📋 Falling back to traditional bank format extraction...');
      const fallbackResult = extractWithBankFormat(ocrText);
      fallbackResult.method = 'fallback_traditional';
      fallbackResult.mlEnhancement = {
        error: error.message,
        fallbackUsed: true
      };

      return fallbackResult;
    }
  }

  /**
   * Enhanced recipient validation with ML
   */
  async validateRecipientWithML(recipientName, toAccount, bankType) {
    try {
      if (!this.isInitialized) {
        // Use simple validation if ML not available
        return this.simpleRecipientValidation(recipientName, toAccount);
      }

      const validation = await this.recipientValidator.validateRecipient(recipientName, toAccount);

      // Add bank-specific context
      validation.bankContext = {
        bankType,
        bankSpecificFormatting: this.getBankSpecificFormatting(bankType, recipientName, toAccount)
      };

      return validation;

    } catch (error) {
      console.warn('ML recipient validation failed:', error.message);
      return this.simpleRecipientValidation(recipientName, toAccount);
    }
  }

  /**
   * Simple rule-based recipient validation fallback
   */
  simpleRecipientValidation(recipientName, toAccount) {
    const combinedText = `${recipientName || ''} ${toAccount || ''}`.toLowerCase();
    const normalizedAccount = (toAccount || '').replace(/[\s\-\.]/g, '');

    const isValid = (
      normalizedAccount.includes('086228226') ||
      combinedText.includes('086 228 226') ||
      combinedText.includes('chan k') ||
      combinedText.includes('thoeurn t') ||
      combinedText.includes('chan kasing') ||
      combinedText.includes('thoeurn theary')
    );

    return {
      finalResult: {
        isValid,
        confidence: isValid ? 0.8 : 0.1,
        method: 'simple_rules'
      },
      fuzzyResult: { isValid, confidence: isValid ? 0.8 : 0.1 },
      mlResult: null
    };
  }

  /**
   * Get bank-specific formatting context
   */
  getBankSpecificFormatting(bankType, recipientName, toAccount) {
    const formatting = {
      bankType,
      expectedFormat: 'unknown',
      nameStyle: 'unknown',
      accountStyle: 'unknown'
    };

    if (!bankType || !BANK_FORMATS[bankType]) {
      return formatting;
    }

    const bankFormat = BANK_FORMATS[bankType];

    // Analyze name style
    if (recipientName) {
      if (recipientName.includes('.')) {
        formatting.nameStyle = 'initials_with_dots';
      } else if (recipientName.includes('&')) {
        formatting.nameStyle = 'combined_with_ampersand';
      } else if (recipientName.toLowerCase().includes('and')) {
        formatting.nameStyle = 'combined_with_and';
      } else if (recipientName.split(' ').length > 2) {
        formatting.nameStyle = 'full_names';
      } else {
        formatting.nameStyle = 'simple';
      }
    }

    // Analyze account style
    if (toAccount) {
      if (toAccount.includes('-')) {
        formatting.accountStyle = 'dashed';
      } else if (toAccount.includes(' ')) {
        formatting.accountStyle = 'spaced';
      } else if (/^\d+$/.test(toAccount)) {
        formatting.accountStyle = 'numeric_only';
      } else {
        formatting.accountStyle = 'mixed';
      }
    }

    // Set expected format based on bank
    switch (bankType) {
      case 'ABA':
        formatting.expectedFormat = 'Transfer to [NAME] Account [NUMBER]';
        break;
      case 'ACLEDA':
        formatting.expectedFormat = 'Beneficiary Name [NAME] Account No [NUMBER]';
        break;
      case 'Wing':
        formatting.expectedFormat = 'Receiver [NUMBER] ([NAME])';
        break;
      case 'KHQR':
        formatting.expectedFormat = 'Merchant [NAME] KHQR ID [ID]';
        break;
      default:
        formatting.expectedFormat = 'Bank-specific format';
    }

    return formatting;
  }

  /**
   * Get enhanced bank format statistics
   */
  getEnhancedStats() {
    return {
      traditional: {
        supportedBanks: Object.keys(BANK_FORMATS),
        bankCount: Object.keys(BANK_FORMATS).length
      },
      enhanced: {
        isInitialized: this.isInitialized,
        bankDetector: this.bankDetector ? 'available' : 'unavailable',
        recipientValidator: this.recipientValidator ? 'available' : 'unavailable',
        mlModelsLoaded: {
          bankClassifier: this.bankDetector?.mlClassifier?.isLoaded || false,
          recipientValidator: this.recipientValidator?.mlValidator?.isLoaded || false
        }
      },
      knownRecipient: {
        account: '086228226',
        nameVariations: [
          'CHAN K. & THOEURN T.',
          'CHAN KASING AND THOEURN THEARY',
          'K. CHAN & T. THOEURN'
        ]
      }
    };
  }

  /**
   * Train ML models with collected data
   */
  async trainModels(options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { TrainingDataCollector } = require('./trainingData');
    const collector = new TrainingDataCollector();

    try {
      await collector.connect();

      console.log('📊 Collecting training data...');

      // Collect training data
      const bankFormatData = await collector.collectBankFormatTrainingData();
      const nameValidationData = await collector.collectNameValidationTrainingData();

      console.log(`📈 Training bank classifier with ${bankFormatData.length} samples...`);
      await this.bankDetector.trainModel(bankFormatData, options.bankClassifier || {});

      console.log(`📈 Training recipient validator with ${nameValidationData.length} samples...`);
      await this.recipientValidator.trainModel(nameValidationData, options.recipientValidator || {});

      // Save models
      await this.saveModels();

      console.log('✅ ML model training completed!');

    } catch (error) {
      console.error('❌ Training failed:', error.message);
      throw error;
    } finally {
      await collector.disconnect();
    }
  }

  /**
   * Save trained models
   */
  async saveModels() {
    const modelDir = './models';

    try {
      await this.bankDetector.saveModel(`file://${modelDir}/bank_classifier`);
      await this.recipientValidator.saveModel(`file://${modelDir}/recipient_validator`);
      console.log('💾 Models saved successfully');
    } catch (error) {
      console.error('Failed to save models:', error.message);
    }
  }
}

// Create singleton instance
const enhancedBankFormatRecognizer = new EnhancedBankFormatRecognizer();

module.exports = {
  EnhancedBankFormatRecognizer,
  enhancedBankFormatRecognizer,
  // Export enhanced functions that can replace existing ones
  extractWithEnhancedBankFormat: (ocrText) => enhancedBankFormatRecognizer.extractWithEnhancedFormat(ocrText),
  getEnhancedBankFormatStats: () => enhancedBankFormatRecognizer.getEnhancedStats()
};