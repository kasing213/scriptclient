/**
 * Intelligent Recipient Name Validator
 *
 * ML-based fuzzy matching for validating recipient names and accounts
 * against your known variations: "CHAN K. & THOEURN T." / "086228226"
 */

const tf = require('@tensorflow/tfjs-node');
const { KNOWN_RECIPIENT_DATA } = require('./trainingData');

/**
 * String similarity algorithms
 */
class StringSimilarity {
  /**
   * Calculate Levenshtein distance between two strings
   */
  static levenshteinDistance(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Calculate distances
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Calculate similarity ratio (0-1, higher = more similar)
   */
  static similarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    return 1 - (distance / maxLen);
  }

  /**
   * Jaccard similarity for token-based comparison
   */
  static jaccardSimilarity(str1, str2) {
    const tokens1 = new Set(str1.toLowerCase().split(/[\s\.\&\-]+/).filter(t => t.length > 0));
    const tokens2 = new Set(str2.toLowerCase().split(/[\s\.\&\-]+/).filter(t => t.length > 0));

    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}

/**
 * Rule-based fuzzy matcher for recipient validation
 */
class FuzzyRecipientMatcher {
  constructor() {
    this.knownData = KNOWN_RECIPIENT_DATA;
    this.thresholds = {
      exact: 0.95,      // Almost exact match
      high: 0.80,       // High confidence
      medium: 0.60,     // Medium confidence
      low: 0.40         // Minimum acceptance
    };
  }

  /**
   * Validate recipient name and account
   */
  validateRecipient(recipientName, toAccount) {
    const combinedText = `${recipientName || ''} ${toAccount || ''}`.toLowerCase();

    const result = {
      isValid: false,
      confidence: 0,
      matchType: 'none',
      matches: {
        account: null,
        name: null,
        combined: null
      },
      method: 'fuzzy_matching'
    };

    // Account number validation
    const accountMatch = this.validateAccount(toAccount);
    result.matches.account = accountMatch;

    // Name validation
    const nameMatch = this.validateName(recipientName);
    result.matches.name = nameMatch;

    // Combined validation (most comprehensive)
    const combinedMatch = this.validateCombined(combinedText);
    result.matches.combined = combinedMatch;

    // Determine final result
    const bestMatch = Math.max(
      accountMatch.confidence,
      nameMatch.confidence,
      combinedMatch.confidence
    );

    result.confidence = bestMatch;
    result.isValid = bestMatch >= this.thresholds.low;

    if (bestMatch >= this.thresholds.exact) {
      result.matchType = 'exact';
    } else if (bestMatch >= this.thresholds.high) {
      result.matchType = 'high';
    } else if (bestMatch >= this.thresholds.medium) {
      result.matchType = 'medium';
    } else if (bestMatch >= this.thresholds.low) {
      result.matchType = 'low';
    }

    return result;
  }

  /**
   * Validate account number
   */
  validateAccount(account) {
    if (!account) {
      return { confidence: 0, bestMatch: null, method: 'account' };
    }

    const normalizedAccount = account.replace(/[\s\-\.]/g, '');
    let bestConfidence = 0;
    let bestMatch = null;

    for (const knownAccount of this.knownData.accountVariations) {
      const normalizedKnown = knownAccount.replace(/[\s\-\.]/g, '');
      const similarity = StringSimilarity.similarity(normalizedAccount, normalizedKnown);

      if (similarity > bestConfidence) {
        bestConfidence = similarity;
        bestMatch = knownAccount;
      }

      // Exact match gets full confidence
      if (normalizedAccount === normalizedKnown) {
        return { confidence: 1.0, bestMatch: knownAccount, method: 'account_exact' };
      }
    }

    return { confidence: bestConfidence, bestMatch, method: 'account_fuzzy' };
  }

  /**
   * Validate recipient name
   */
  validateName(name) {
    if (!name) {
      return { confidence: 0, bestMatch: null, method: 'name' };
    }

    const normalizedName = name.toLowerCase();
    let bestConfidence = 0;
    let bestMatch = null;
    let bestCategory = null;

    // Check all name categories
    for (const [category, names] of Object.entries(this.knownData.names)) {
      for (const knownName of names) {
        const normalizedKnown = knownName.toLowerCase();

        // Multiple similarity algorithms
        const levenshtein = StringSimilarity.similarity(normalizedName, normalizedKnown);
        const jaccard = StringSimilarity.jaccardSimilarity(normalizedName, normalizedKnown);
        const contains = normalizedName.includes(normalizedKnown) || normalizedKnown.includes(normalizedName) ? 0.8 : 0;

        // Weighted combination
        const similarity = Math.max(
          levenshtein * 0.6 + jaccard * 0.4,
          contains
        );

        if (similarity > bestConfidence) {
          bestConfidence = similarity;
          bestMatch = knownName;
          bestCategory = category;
        }
      }
    }

    return {
      confidence: bestConfidence,
      bestMatch,
      category: bestCategory,
      method: 'name_fuzzy'
    };
  }

  /**
   * Validate combined text (name + account)
   */
  validateCombined(combinedText) {
    let totalScore = 0;
    let matchCount = 0;
    const matches = [];

    // Check account presence
    for (const account of this.knownData.accountVariations) {
      if (combinedText.includes(account.toLowerCase().replace(/[\s\-]/g, ''))) {
        totalScore += 1.0;
        matchCount++;
        matches.push({ type: 'account', value: account, score: 1.0 });
        break;
      }
    }

    // Check name components
    const nameTokens = combinedText.split(/[\s\.\&\-]+/).filter(t => t.length > 1);

    for (const [category, names] of Object.entries(this.knownData.names)) {
      for (const name of names) {
        const nameWords = name.toLowerCase().split(/[\s\.\&\-]+/);
        let nameScore = 0;

        for (const word of nameWords) {
          if (word.length > 1) {
            for (const token of nameTokens) {
              const similarity = StringSimilarity.similarity(token, word);
              if (similarity > 0.7) {
                nameScore += similarity;
                break;
              }
            }
          }
        }

        if (nameScore > 0.5) {
          totalScore += Math.min(nameScore / nameWords.length, 1.0);
          matchCount++;
          matches.push({
            type: 'name',
            category,
            value: name,
            score: nameScore / nameWords.length
          });
        }
      }
    }

    const confidence = matchCount > 0 ? totalScore / (matchCount + 1) : 0;

    return {
      confidence,
      matches,
      matchCount,
      method: 'combined_fuzzy'
    };
  }
}

/**
 * ML-based recipient validator
 */
class MLRecipientValidator {
  constructor() {
    this.model = null;
    this.isLoaded = false;
    this.featureSize = 12; // Based on extractNameFeatures in trainingData.js
    this.threshold = 0.7; // Confidence threshold for accepting ML prediction
  }

  /**
   * Create neural network model for recipient validation
   */
  createModel() {
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.featureSize],
          units: 24,
          activation: 'relu',
          name: 'input_layer'
        }),

        tf.layers.dropout({ rate: 0.3 }),

        tf.layers.dense({
          units: 12,
          activation: 'relu',
          name: 'hidden_layer_1'
        }),

        tf.layers.dropout({ rate: 0.2 }),

        tf.layers.dense({
          units: 6,
          activation: 'relu',
          name: 'hidden_layer_2'
        }),

        // Binary classification (valid/invalid)
        tf.layers.dense({
          units: 1,
          activation: 'sigmoid',
          name: 'output_layer'
        })
      ]
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });

    console.log('🧠 Recipient Validator Model Created:');
    model.summary();

    return model;
  }

  /**
   * Extract features from recipient name and account
   */
  extractFeatures(recipientName, toAccount) {
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
      features.push(Math.min(categoryScore, 1)); // Normalize to 0-1
    }

    // Text characteristics
    features.push(Math.min((recipientName || '').length / 50, 1)); // Name length
    features.push(Math.min((toAccount || '').length / 20, 1)); // Account length
    features.push(Math.min((combinedText.match(/\d/g) || []).length / 20, 1)); // Digit density
    features.push(Math.min((combinedText.match(/[A-Z\.&]/gi) || []).length / 20, 1)); // Special char density

    return features;
  }

  /**
   * Train the model
   */
  async train(trainingData, options = {}) {
    const {
      epochs = 150,
      batchSize = 16,
      validationSplit = 0.2,
      verbose = 1
    } = options;

    console.log(`🚀 Training recipient validator with ${trainingData.length} samples...`);

    if (!this.model) {
      this.model = this.createModel();
    }

    // Prepare training data
    const features = [];
    const labels = [];

    for (const sample of trainingData) {
      if (sample.input && typeof sample.output === 'number') {
        features.push(sample.input);
        labels.push([sample.output]);
      }
    }

    const xs = tf.tensor2d(features);
    const ys = tf.tensor2d(labels);

    // Training
    const history = await this.model.fit(xs, ys, {
      epochs,
      batchSize,
      validationSplit,
      verbose,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 20 === 0) {
            console.log(`Epoch ${epoch}: loss=${logs.loss.toFixed(4)}, accuracy=${logs.acc.toFixed(4)}`);
          }
        }
      }
    });

    xs.dispose();
    ys.dispose();

    console.log('✅ Recipient validator training completed!');
    this.isLoaded = true;
    return history;
  }

  /**
   * Predict if recipient is valid
   */
  async predict(recipientName, toAccount) {
    if (!this.model || !this.isLoaded) {
      throw new Error('Model not loaded. Train or load model first.');
    }

    const features = this.extractFeatures(recipientName, toAccount);

    const prediction = tf.tidy(() => {
      const inputTensor = tf.tensor2d([features]);
      return this.model.predict(inputTensor);
    });

    const probability = await prediction.data();
    prediction.dispose();

    const confidence = probability[0];
    const isValid = confidence >= this.threshold;

    return {
      isValid,
      confidence,
      threshold: this.threshold,
      method: 'ml_prediction'
    };
  }

  /**
   * Save model
   */
  async saveModel(modelPath = 'file://./models/recipient_validator') {
    if (!this.model) {
      throw new Error('No model to save');
    }
    await this.model.save(modelPath);
    console.log(`💾 Recipient validator model saved to ${modelPath}`);
  }

  /**
   * Load model
   */
  async loadModel(modelPath = 'file://./models/recipient_validator/model.json') {
    try {
      this.model = await tf.loadLayersModel(modelPath);
      this.isLoaded = true;
      console.log(`📂 Recipient validator model loaded from ${modelPath}`);
    } catch (error) {
      console.warn(`⚠️ Could not load recipient validator model: ${error.message}`);
      this.isLoaded = false;
    }
  }
}

/**
 * Hybrid recipient validator combining fuzzy matching and ML
 */
class HybridRecipientValidator {
  constructor() {
    this.fuzzyMatcher = new FuzzyRecipientMatcher();
    this.mlValidator = new MLRecipientValidator();
    this.mlThreshold = 0.8;
  }

  async initialize() {
    await this.mlValidator.loadModel();
  }

  /**
   * Validate recipient using hybrid approach
   */
  async validateRecipient(recipientName, toAccount) {
    const result = {
      fuzzyResult: null,
      mlResult: null,
      finalResult: null,
      method: 'hybrid'
    };

    // Always run fuzzy matching (fast and reliable)
    result.fuzzyResult = this.fuzzyMatcher.validateRecipient(recipientName, toAccount);

    try {
      // Try ML prediction if model is available
      if (this.mlValidator.isLoaded) {
        result.mlResult = await this.mlValidator.predict(recipientName, toAccount);

        // Use ML if confidence is high
        if (result.mlResult.confidence >= this.mlThreshold) {
          result.finalResult = {
            isValid: result.mlResult.isValid,
            confidence: result.mlResult.confidence,
            matchType: result.mlResult.confidence >= 0.95 ? 'exact' : 'high',
            method: 'ml_primary'
          };
          return result;
        }
      }
    } catch (error) {
      console.warn('ML validation failed, using fuzzy matching:', error.message);
    }

    // Use fuzzy matching result
    result.finalResult = {
      isValid: result.fuzzyResult.isValid,
      confidence: result.fuzzyResult.confidence,
      matchType: result.fuzzyResult.matchType,
      method: 'fuzzy_fallback',
      details: result.fuzzyResult.matches
    };

    return result;
  }

  /**
   * Train the ML component
   */
  async trainModel(trainingData, options = {}) {
    return await this.mlValidator.train(trainingData, options);
  }

  /**
   * Save the ML model
   */
  async saveModel(modelPath) {
    return await this.mlValidator.saveModel(modelPath);
  }
}

module.exports = {
  StringSimilarity,
  FuzzyRecipientMatcher,
  MLRecipientValidator,
  HybridRecipientValidator
};