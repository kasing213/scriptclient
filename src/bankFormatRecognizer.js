/**
 * Bank Format Recognition for ScriptClient
 *
 * This module provides bank-specific OCR extraction patterns to improve
 * recipient name and account number detection accuracy from payment screenshots.
 *
 * Works alongside existing hardcoded verification - this only improves
 * the OCR extraction, doesn't change security validation.
 */

// Bank format templates for Cambodian banks
const BANK_FORMATS = {
  ABA: {
    name: 'ABA Bank',
    keywords: ['aba', 'aba bank', 'advanced bank', 'transfer to', '012 888'],

    recipientPatterns: [
      {
        regex: /Transfer to[\s:]*([A-Z\s\.&]+?)(?:\n|Account|$)/gi,
        confidence: 0.95,
        priority: 1
      },
      {
        regex: /Beneficiary[\s:]*([A-Z\s\.&]+?)(?:\n|Account|$)/gi,
        confidence: 0.90,
        priority: 2
      }
    ],

    accountPatterns: [
      {
        regex: /Account[\s:]*([0-9\s\-]{8,15})/gi,
        confidence: 0.95,
        priority: 1
      },
      {
        regex: /(\d{3}\s\d{3}\s\d{3})/gi,
        confidence: 0.90,
        priority: 2
      }
    ],

    amountPatterns: [
      {
        regex: /Amount[\s:]*([0-9,\.]+)[\s]*(?:USD|KHR|៛)/gi,
        confidence: 0.90,
        priority: 1
      }
    ]
  },

  ACLEDA: {
    name: 'ACLEDA Bank',
    keywords: ['acleda', 'acleda bank', 'beneficiary name', '012 20'],

    recipientPatterns: [
      {
        regex: /Beneficiary Name[\s:]*([A-Z\s\.]+?)(?:\n|Account|$)/gi,
        confidence: 0.95,
        priority: 1
      },
      {
        regex: /Account Name[\s:]*([A-Z\s\.]+?)(?:\n|$)/gi,
        confidence: 0.90,
        priority: 2
      }
    ],

    accountPatterns: [
      {
        regex: /Account No[\s:]*([0-9\-]{10,20})/gi,
        confidence: 0.95,
        priority: 1
      },
      {
        regex: /(\d{3}-\d{3}-\d{3}-\d{1}-\d{2})/gi,
        confidence: 0.90,
        priority: 2
      }
    ]
  },

  Wing: {
    name: 'Wing Bank',
    keywords: ['wing', 'wing bank', 'receiver', '089 999'],

    recipientPatterns: [
      {
        regex: /Receiver[\s:]*(\d{8,10})\s*\(([A-Z\s]+)\)/gi,
        confidence: 0.95,
        priority: 1,
        extractGroup: 2  // Extract name from parentheses
      },
      {
        regex: /Account Name[\s:]*([A-Z\s\.]+?)(?:\n|$)/gi,
        confidence: 0.85,
        priority: 2
      }
    ],

    accountPatterns: [
      {
        regex: /Wing Account[\s:]*(\d{8,10})/gi,
        confidence: 0.95,
        priority: 1
      }
    ]
  },

  KHQR: {
    name: 'KHQR',
    keywords: ['khqr', 'bakong', 'merchant', 'cambodia qr'],

    recipientPatterns: [
      {
        regex: /Merchant[\s:]*([A-Z\s\.&]+?)(?:\n|KHQR|$)/gi,
        confidence: 0.90,
        priority: 1
      },
      {
        regex: /To[\s:]*([A-Z\s\.&]+?)(?:\n|$)/gi,
        confidence: 0.85,
        priority: 2
      }
    ],

    accountPatterns: [
      {
        regex: /KHQR ID[\s:]*([A-Z0-9]{10,})/gi,
        confidence: 0.85,
        priority: 1
      }
    ]
  }
};

/**
 * Detect bank from OCR text using keywords
 */
function detectBank(ocrText) {
  if (!ocrText) return null;

  const text = ocrText.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const [bankCode, format] of Object.entries(BANK_FORMATS)) {
    let score = 0;

    for (const keyword of format.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += keyword.length; // Longer keywords get higher scores
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = bankCode;
    }
  }

  return bestMatch;
}

/**
 * Extract field using bank-specific patterns
 */
function extractField(ocrText, patterns) {
  if (!ocrText || !patterns) return null;

  // Sort patterns by priority (lower number = higher priority)
  const sortedPatterns = patterns.sort((a, b) => (a.priority || 999) - (b.priority || 999));

  for (const pattern of sortedPatterns) {
    try {
      const matches = [...ocrText.matchAll(pattern.regex)];

      if (matches.length > 0) {
        const extractGroup = pattern.extractGroup || 1;
        const value = matches[0][extractGroup]?.trim();

        if (value && value.length > 1) {
          return {
            value: value,
            confidence: pattern.confidence,
            method: 'bank_format'
          };
        }
      }
    } catch (error) {
      console.warn('Bank pattern matching error:', error.message);
    }
  }

  return null;
}

/**
 * Format extracted name according to bank rules
 */
function formatName(rawName) {
  if (!rawName) return '';

  let name = rawName.trim().toUpperCase();

  // Add dots after single letters: "K CHAN" → "K. CHAN"
  name = name.replace(/\b([A-Z])\s+/g, '$1. ');

  // Clean up separators
  name = name.replace(/\s*&\s*/g, ' & ');
  name = name.replace(/\s+/g, ' ').trim();

  // Limit length
  if (name.length > 50) {
    name = name.substring(0, 50).trim();
  }

  return name;
}

/**
 * Format account number
 */
function formatAccount(rawAccount) {
  if (!rawAccount) return '';

  // Remove spaces and dashes, keep only digits
  return rawAccount.replace(/[^\d]/g, '');
}

/**
 * Main bank format extraction function
 */
function extractWithBankFormat(ocrText) {
  const result = {
    success: false,
    confidence: 0,
    method: 'bank_format',
    bank: null,
    recipientName: null,
    toAccount: null,
    amount: null,
    extractionDetails: {}
  };

  try {
    // Step 1: Detect bank
    const detectedBank = detectBank(ocrText);
    if (!detectedBank) {
      result.reason = 'bank_not_detected';
      return result;
    }

    result.bank = detectedBank;
    const bankFormat = BANK_FORMATS[detectedBank];

    console.log(`🏦 Bank detected: ${bankFormat.name}`);

    // Step 2: Extract recipient name
    const recipientExtraction = extractField(ocrText, bankFormat.recipientPatterns);
    if (recipientExtraction) {
      result.recipientName = formatName(recipientExtraction.value);
      result.extractionDetails.recipient = recipientExtraction;
      console.log(`📝 Recipient extracted: "${result.recipientName}" (confidence: ${recipientExtraction.confidence})`);
    }

    // Step 3: Extract account number
    const accountExtraction = extractField(ocrText, bankFormat.accountPatterns);
    if (accountExtraction) {
      result.toAccount = formatAccount(accountExtraction.value);
      result.extractionDetails.account = accountExtraction;
      console.log(`💳 Account extracted: "${result.toAccount}" (confidence: ${accountExtraction.confidence})`);
    }

    // Step 4: Extract amount (if patterns available)
    if (bankFormat.amountPatterns) {
      const amountExtraction = extractField(ocrText, bankFormat.amountPatterns);
      if (amountExtraction) {
        const amountStr = amountExtraction.value.replace(/[,\s]/g, '');
        result.amount = parseFloat(amountStr);
        result.extractionDetails.amount = amountExtraction;
        console.log(`💰 Amount extracted: ${result.amount} (confidence: ${amountExtraction.confidence})`);
      }
    }

    // Step 5: Calculate overall confidence
    const extractions = [
      result.extractionDetails.recipient,
      result.extractionDetails.account,
      result.extractionDetails.amount
    ].filter(Boolean);

    if (extractions.length > 0) {
      result.confidence = extractions.reduce((sum, ext) => sum + ext.confidence, 0) / extractions.length;
      result.success = result.recipientName || result.toAccount; // Success if we got either

      if (result.success) {
        console.log(`✅ Bank format extraction successful (confidence: ${result.confidence.toFixed(2)})`);
      }
    }

    return result;

  } catch (error) {
    console.error('Bank format extraction error:', error.message);
    result.reason = 'extraction_error';
    result.error = error.message;
    return result;
  }
}

/**
 * Get bank format statistics for monitoring
 */
function getBankFormatStats() {
  return {
    supportedBanks: Object.keys(BANK_FORMATS),
    bankCount: Object.keys(BANK_FORMATS).length,
    patterns: Object.fromEntries(
      Object.entries(BANK_FORMATS).map(([code, format]) => [
        code,
        {
          name: format.name,
          recipientPatterns: format.recipientPatterns.length,
          accountPatterns: format.accountPatterns.length
        }
      ])
    )
  };
}

module.exports = {
  extractWithBankFormat,
  detectBank,
  formatName,
  formatAccount,
  getBankFormatStats,
  BANK_FORMATS
};