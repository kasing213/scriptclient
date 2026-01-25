/**
 * ML-based Bank Format Classifier
 *
 * Uses TensorFlow.js neural network to classify bank types from OCR text
 * Supports: ABA, ACLEDA, Wing, KHQR, Canadia
 */

const tf = require('@tensorflow/tfjs-node');
const { BANK_SIGNATURES } = require('./trainingData');

class BankClassifier {
  constructor() {
    this.model = null;
    this.isLoaded = false;
    this.bankTypes = Object.keys(BANK_SIGNATURES);
    this.featureSize = this.bankTypes.length + 4; // Bank scores + text characteristics
  }

  /**
   * Create and compile the neural network model
   */
  createModel() {
    const model = tf.sequential({
      layers: [
        // Input layer
        tf.layers.dense({
          inputShape: [this.featureSize],
          units: 32,
          activation: 'relu',
          name: 'input_layer'
        }),

        // Hidden layers with dropout for regularization
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({
          units: 16,
          activation: 'relu',
          name: 'hidden_layer_1'
        }),

        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 8,
          activation: 'relu',
          name: 'hidden_layer_2'
        }),

        // Output layer - softmax for multi-class classification
        tf.layers.dense({
          units: this.bankTypes.length,
          activation: 'softmax',
          name: 'output_layer'
        })
      ]
    });

    // Compile with categorical crossentropy for multi-class classification
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    console.log('🧠 Bank Classifier Model Created:');
    model.summary();

    return model;
  }

  /**
   * Extract features from OCR text
   */
  extractTextFeatures(text) {
    const lowerText = text.toLowerCase();
    const features = [];

    // Bank signature scores
    for (const [bankCode, bankData] of Object.entries(BANK_SIGNATURES)) {
      let bankScore = 0;

      // Keyword matching with weighted scores
      for (const keyword of bankData.keywords) {
        if (lowerText.includes(keyword)) {
          bankScore += keyword.length * 2; // Weight keywords higher
        }
      }

      // Pattern matching
      for (const pattern of bankData.patterns) {
        if (lowerText.includes(pattern.toLowerCase())) {
          bankScore += pattern.length;
        }
      }

      // Normalize score
      features.push(Math.min(bankScore / 100, 1.0));
    }

    // Text characteristics (normalized)
    features.push(Math.min(text.length / 1000, 1.0)); // Text length
    features.push(Math.min((text.match(/\d/g) || []).length / 50, 1.0)); // Number density
    features.push(Math.min((text.match(/[A-Z]/g) || []).length / 100, 1.0)); // Uppercase density
    features.push(Math.min((text.match(/[\.\-\:]/g) || []).length / 20, 1.0)); // Punctuation density

    return features;
  }

  /**
   * Convert bank type to one-hot encoded vector
   */
  bankTypeToOneHot(bankType) {
    const oneHot = new Array(this.bankTypes.length).fill(0);
    const index = this.bankTypes.indexOf(bankType);
    if (index !== -1) {
      oneHot[index] = 1;
    }
    return oneHot;
  }

  /**
   * Convert one-hot vector to bank type
   */
  oneHotToBankType(oneHot) {
    const maxIndex = oneHot.indexOf(Math.max(...oneHot));
    return this.bankTypes[maxIndex];
  }

  /**
   * Prepare training data for TensorFlow
   */
  prepareTrainingData(trainingData) {
    const features = [];
    const labels = [];

    for (const sample of trainingData) {
      if (sample.input && sample.output) {
        features.push(sample.input);
        labels.push(this.bankTypeToOneHot(sample.output));
      }
    }

    return {
      xs: tf.tensor2d(features),
      ys: tf.tensor2d(labels)
    };
  }

  /**
   * Train the model with provided training data
   */
  async train(trainingData, options = {}) {
    const {
      epochs = 100,
      batchSize = 32,
      validationSplit = 0.2,
      verbose = 1
    } = options;

    console.log(`🚀 Training bank classifier with ${trainingData.length} samples...`);

    // Create model if not exists
    if (!this.model) {
      this.model = this.createModel();
    }

    // Prepare data
    const { xs, ys } = this.prepareTrainingData(trainingData);

    // Training configuration
    const trainConfig = {
      epochs,
      batchSize,
      validationSplit,
      verbose,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 10 === 0) {
            console.log(`Epoch ${epoch}: loss=${logs.loss.toFixed(4)}, accuracy=${logs.acc.toFixed(4)}`);
          }
        }
      }
    };

    // Train the model
    const history = await this.model.fit(xs, ys, trainConfig);

    // Clean up tensors
    xs.dispose();
    ys.dispose();

    console.log('✅ Training completed!');
    const finalLoss = history.history.loss[history.history.loss.length - 1];
    const finalAcc = history.history.acc[history.history.acc.length - 1];
    console.log(`Final: loss=${finalLoss.toFixed(4)}, accuracy=${finalAcc.toFixed(4)}`);

    this.isLoaded = true;
    return history;
  }

  /**
   * Predict bank type from OCR text
   */
  async predict(ocrText) {
    if (!this.model || !this.isLoaded) {
      throw new Error('Model not loaded. Train or load model first.');
    }

    // Extract features
    const features = this.extractTextFeatures(ocrText);

    // Make prediction
    const prediction = tf.tidy(() => {
      const inputTensor = tf.tensor2d([features]);
      return this.model.predict(inputTensor);
    });

    // Get probabilities
    const probabilities = await prediction.data();
    prediction.dispose();

    // Find best match
    let maxProb = 0;
    let predictedBank = null;
    const bankProbabilities = {};

    for (let i = 0; i < this.bankTypes.length; i++) {
      const prob = probabilities[i];
      bankProbabilities[this.bankTypes[i]] = prob;

      if (prob > maxProb) {
        maxProb = prob;
        predictedBank = this.bankTypes[i];
      }
    }

    return {
      predictedBank,
      confidence: maxProb,
      probabilities: bankProbabilities,
      method: 'ml_classifier'
    };
  }

  /**
   * Save trained model to file
   */
  async saveModel(modelPath = 'file://./models/bank_classifier') {
    if (!this.model) {
      throw new Error('No model to save');
    }

    await this.model.save(modelPath);
    console.log(`💾 Model saved to ${modelPath}`);
  }

  /**
   * Load trained model from file
   */
  async loadModel(modelPath = 'file://./models/bank_classifier/model.json') {
    try {
      this.model = await tf.loadLayersModel(modelPath);
      this.isLoaded = true;
      console.log(`📂 Model loaded from ${modelPath}`);
    } catch (error) {
      console.warn(`⚠️ Could not load model: ${error.message}`);
      this.isLoaded = false;
    }
  }

  /**
   * Evaluate model performance on test data
   */
  async evaluate(testData) {
    if (!this.model || !this.isLoaded) {
      throw new Error('Model not loaded');
    }

    const { xs, ys } = this.prepareTrainingData(testData);
    const evaluation = await this.model.evaluate(xs, ys);

    const loss = await evaluation[0].data();
    const accuracy = await evaluation[1].data();

    xs.dispose();
    ys.dispose();
    evaluation[0].dispose();
    evaluation[1].dispose();

    return {
      loss: loss[0],
      accuracy: accuracy[0],
      testSamples: testData.length
    };
  }

  /**
   * Get model information
   */
  getModelInfo() {
    return {
      isLoaded: this.isLoaded,
      bankTypes: this.bankTypes,
      featureSize: this.featureSize,
      modelExists: !!this.model
    };
  }
}

/**
 * Hybrid bank detection combining ML and rule-based approaches
 */
class HybridBankDetector {
  constructor() {
    this.mlClassifier = new BankClassifier();
    this.mlThreshold = 0.7; // Minimum confidence for ML prediction
  }

  async initialize() {
    // Try to load existing model
    await this.mlClassifier.loadModel();
  }

  /**
   * Detect bank using hybrid approach
   */
  async detectBank(ocrText) {
    const results = {
      mlPrediction: null,
      ruleBased: null,
      finalPrediction: null,
      confidence: 0,
      method: 'hybrid'
    };

    try {
      // Try ML prediction first
      if (this.mlClassifier.isLoaded) {
        results.mlPrediction = await this.mlClassifier.predict(ocrText);

        // Use ML prediction if confidence is high enough
        if (results.mlPrediction.confidence >= this.mlThreshold) {
          results.finalPrediction = results.mlPrediction.predictedBank;
          results.confidence = results.mlPrediction.confidence;
          results.method = 'ml_classifier';
          return results;
        }
      }

      // Fallback to rule-based detection
      results.ruleBased = this.ruleBasedDetection(ocrText);
      results.finalPrediction = results.ruleBased.bank;
      results.confidence = results.ruleBased.confidence;
      results.method = 'rule_based_fallback';

    } catch (error) {
      console.warn('ML prediction failed, using rule-based:', error.message);
      results.ruleBased = this.ruleBasedDetection(ocrText);
      results.finalPrediction = results.ruleBased.bank;
      results.confidence = results.ruleBased.confidence;
      results.method = 'rule_based_error';
    }

    return results;
  }

  /**
   * Rule-based bank detection (existing logic)
   */
  ruleBasedDetection(ocrText) {
    if (!ocrText) return { bank: null, confidence: 0 };

    const text = ocrText.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [bankCode, bankData] of Object.entries(BANK_SIGNATURES)) {
      let score = 0;

      for (const keyword of bankData.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += keyword.length;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = bankCode;
      }
    }

    const confidence = bestScore > 0 ? Math.min(bestScore / 50, 1.0) : 0;

    return {
      bank: bestMatch,
      confidence,
      score: bestScore
    };
  }

  /**
   * Train the ML model
   */
  async trainModel(trainingData, options = {}) {
    return await this.mlClassifier.train(trainingData, options);
  }

  /**
   * Save the ML model
   */
  async saveModel(modelPath) {
    return await this.mlClassifier.saveModel(modelPath);
  }
}

module.exports = {
  BankClassifier,
  HybridBankDetector
};