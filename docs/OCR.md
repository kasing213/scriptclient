# OCR Payment Verification System

## Overview

This system uses **GPT-4o Vision** to verify payment screenshots from Cambodian banks (ABA Bank, Wing, ACLEDA, Canadia, etc.).

## 3-Stage Verification Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 1: Image Type Detection                                   │
│                                                                  │
│  isBankStatement = false?  →  SILENT REJECT (no message)        │
│  isBankStatement = true?   →  Go to Stage 2                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 2: Confidence Check                                        │
│                                                                  │
│  confidence = low/medium?  →  PENDING + "send clearer image"    │
│  confidence = high?        →  Go to Stage 3                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 3: Security Verification (HIGH confidence only)           │
│                                                                  │
│  Wrong recipient?  →  REJECT + message                          │
│  Old screenshot?   →  REJECT + fraud alert                      │
│  Duplicate Trx ID? →  REJECT + fraud alert                      │
│  Amount mismatch?  →  PENDING (manual review)                   │
│  All pass?         →  VERIFIED ✅                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## GPT-4o OCR Prompt

### Step 1: Identify Image Type

**Set `isBankStatement = FALSE` if:**
- Chat screenshot (Telegram, WhatsApp, Messenger, LINE, etc.)
- Invoice, bill, receipt, or QR code (NOT payment confirmation)
- Random photo, meme, selfie, or non-banking image
- Text/numbers without banking app interface
- Cannot identify any banking app UI elements

**Set `isBankStatement = TRUE` if:**
- Shows banking app interface (ABA Bank, Wing, ACLEDA, Canadia, Prince Bank, Sathapana)
- Even if blurry, cropped, or partially visible - if clearly FROM a bank app

### Step 2: Verify Payment

**Set `isPaid = TRUE` if COMPLETED TRANSFER:**

| Bank | How to Identify Completed Transfer |
|------|-----------------------------------|
| **ABA Bank** | CT logo with minus amount (e.g., "-28,000 KHR"), Trx. ID, To account |
| **ACLEDA/Wing** | "រួចរាល់" (completed) or checkmark ✓, green success screen |
| **Other Banks** | "Success", "Completed", "ជោគជ័យ" text, checkmark |

**Set `isPaid = FALSE` but `isBankStatement = TRUE` if:**
- Image too blurry to read
- Image cropped/partial - missing key fields
- Shows "Pending", "Failed", or "Processing" status

### Step 3: Extract Data

**JSON Output:**
```json
{
  "isBankStatement": true/false,
  "isPaid": true/false,
  "amount": 28000,
  "currency": "KHR",
  "transactionId": "47062628112",
  "referenceNumber": "100FT36424434346",
  "fromAccount": "MEY THIDA (001 113 484)",
  "toAccount": "086 228 226",
  "bankName": "ABA Bank",
  "transactionDate": "2026-01-04T13:35:00",
  "remark": "H228",
  "recipientName": "CHAN K. & THOEURN T.",
  "confidence": "high"
}
```

---

## Recipient Matching Rules

### Valid Recipients

| Format | Example | Source |
|--------|---------|--------|
| Account (no spaces) | `086228226` | Direct transfer |
| Account (with spaces) | `086 228 226` | Some bank formats |
| Initials | `CHAN K. & THOEURN T.` | ABA KHQR |
| Full names | `CHAN KASING AND THOEURN THEARY` | ABA Transfer |

### Match Logic (case-insensitive)

```javascript
const text = (toAccount + ' ' + recipientName).toLowerCase();

recipientVerified = (
  text.includes('086228226') ||        // account no spaces
  text.includes('086 228 226') ||      // account with spaces
  text.includes('chan k') ||           // "CHAN K."
  text.includes('thoeurn t') ||        // "THOEURN T."
  text.includes('chan kasing') ||      // full name
  text.includes('thoeurn theary')      // full name
);
```

---

## Rejection Reasons

| Code | Description | Message Sent |
|------|-------------|--------------|
| `NOT_BANK_STATEMENT` | Image is not from a banking app | 🔇 SILENT (no message) |
| `BLURRY` | Bank statement but image unclear | ⏳ "Send clearer image" |
| `WRONG_RECIPIENT` | Payment to wrong account/name | ❌ "Wrong account" |
| `OLD_SCREENSHOT` | Screenshot older than 7 days | ❌ "Screenshot too old" + fraud alert |
| `DUPLICATE_TRANSACTION` | Transaction ID already used | ❌ "Receipt already used" + fraud alert |
| `AMOUNT_MISMATCH` | Amount doesn't match expected | ⏳ "Under review" (show amount) |

---

## Messages (Khmer + English)

### 🔇 SILENT (Not Bank Statement)
No message sent - just log internally.

### ⏳ PENDING - Blurry Image
```
⏳ រូបភាពមិនច្បាស់

សូមផ្ញើរូបភាពច្បាស់ជាងនេះសម្រាប់ការផ្ទៀងផ្ទាត់។

(Image unclear. Please send a clearer photo for verification.)
```

### ⏳ PENDING - Amount Mismatch
```
⏳ បានទទួល {amount} KHR

ចំនួនទឹកប្រាក់មិនត្រូវគ្នា។ សូមរង់ចាំការពិនិត្យ។

(Received {amount} KHR. Amount mismatch - under review.)
```

### ❌ REJECTED - Wrong Recipient
```
❌ គណនីមិនត្រឹមត្រូវ

សូមផ្ទេរប្រាក់ទៅគណនីត្រឹមត្រូវ។

(Wrong account. Please transfer to the correct account.)
```

### ❌ REJECTED - Old Screenshot
```
❌ រូបភាពចាស់ពេក

សូមផ្ញើបង្កាន់ដៃថ្មី។

(Screenshot too old. Please send a recent receipt.)
```

### ❌ REJECTED - Duplicate Transaction
```
❌ បង្កាន់ដៃនេះត្រូវបានប្រើរួចហើយ

សូមផ្ញើបង្កាន់ដៃផ្សេង។

(This receipt has already been used. Please send a different receipt.)
```

### ✅ VERIFIED
```
✅ ការទូទាត់បានបញ្ជាក់ {amount} KHR ជោគជ័យ

សូមអរគុណ!
```

---

## Khmer Date Support

The system supports both English and Khmer date formats in payment screenshots.

### Supported Formats

| Format | Example | Notes |
|--------|---------|-------|
| ISO | `2026-01-04T13:35:00` | Direct JavaScript Date parse |
| English | `04 Jan 2026 13:35` | Standard date parse |
| DD/MM/YYYY | `04/01/2026` | Cambodian date format |
| Khmer numerals | Unicode U+17E0 to U+17E9 | Auto-converted to Arabic 0-9 |
| Khmer months | Khmer month names | Auto-recognized (see below) |

### Khmer Numeral Conversion

The parser converts Khmer Unicode numerals to Arabic numerals:
- Khmer 0-9 (U+17E0 to U+17E9) are converted to Arabic 0-9

### Khmer Month Recognition

The parser recognizes all 12 Khmer month names:

| Month | Khmer Name | Transliteration |
|-------|------------|-----------------|
| 1 | January | Makara |
| 2 | February | Kompeak |
| 3 | March | Mina |
| 4 | April | Mesa |
| 5 | May | Ousapha |
| 6 | June | Mithona |
| 7 | July | Kakada |
| 8 | August | Seiha |
| 9 | September | Kanha |
| 10 | October | Tola |
| 11 | November | Vicheka |
| 12 | December | Thnu |

### Date Validation Rules

- **Maximum age**: 7 days (configurable via `MAX_SCREENSHOT_AGE_DAYS`)
- **Future dates**: Rejected as potential fraud (FUTURE_DATE)
- **Missing dates**: Flagged as MISSING_DATE
- **Invalid format**: Marked as INVALID_DATE fraud type
- **Old screenshots**: Rejected as OLD_SCREENSHOT with fraud alert

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPECTED_RECIPIENT_ACCOUNT` | - | Expected recipient account number (e.g., "086 228 226") |
| `EXPECTED_RECIPIENT_NAME` | "CHAN K. & THOEURN T." | Expected recipient name |
| `MAX_SCREENSHOT_AGE_DAYS` | 7 | Maximum age of screenshot in days |
| `PAYMENT_TOLERANCE_PERCENT` | 5 | Tolerance for amount matching |
| `OCR_RATE_LIMIT_PER_MINUTE` | 10 | OpenAI API rate limit |
| `OCR_MAX_RETRIES` | 3 | Max retries for OCR |
| `OCR_TIMEOUT_MS` | 60000 | OCR timeout in milliseconds |

---

## MongoDB Collections

### payments (customerDB)
Stores all payment verification attempts.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | UUID | Unique ID |
| `chatId` | Number | Telegram chat ID |
| `userId` | Number | Telegram user ID |
| `username` | String | Telegram username |
| `fullName` | String | User's full name |
| `groupName` | String | Group name (if from group) |
| `paymentLabel` | String | "PAID", "PENDING", "UNPAID" |
| `verificationStatus` | String | "verified", "pending", "rejected" |
| `rejectionReason` | String | Reason for rejection (null if verified) |
| `amountInKHR` | Number | Amount in KHR |
| `transactionId` | String | Bank transaction ID |
| `toAccount` | String | Recipient account |
| `recipientName` | String | Recipient name |
| `isBankStatement` | Boolean | Is image from bank app |
| `confidence` | String | "high", "medium", "low" |

### fraudAlerts (customerDB)
Stores fraud detection alerts.

| Field | Type | Description |
|-------|------|-------------|
| `fraudType` | String | "OLD_SCREENSHOT", "DUPLICATE_TRANSACTION" |
| `severity` | String | "HIGH", "CRITICAL" |
| `chatId` | Number | Telegram chat ID |
| `username` | String | Telegram username |
| `groupName` | String | Group name |
| `transactionId` | String | Transaction ID |
| `actionTaken` | String | Action taken |

---

## Export

Run export script to get Excel files:

```bash
npm run export           # Export all collections
npm run export:payments  # Export payments only
npm run export:fraud     # Export fraud alerts
```

Output: `./exports/export_all_YYYYMMDD.xlsx`
