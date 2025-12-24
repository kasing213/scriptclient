# Payment Verification & Screenshot Download Workflow

Complete guide for using the bot on Railway and downloading verified screenshots to your local machine.

## 🔄 How the System Works

### Architecture Overview

```
┌─────────────────┐
│  Telegram User  │ Sends payment screenshot
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Telegram Group Chat             │
└────────┬────────────────────────────────┘
         │
         │ Bot monitors group
         ▼
┌─────────────────────────────────────────┐
│      Railway Container (Cloud)          │
│  ┌───────────────────────────────────┐  │
│  │  Payment Verification Bot         │  │
│  │  - Receives screenshot            │  │
│  │  - Downloads from Telegram API    │  │
│  │  - Analyzes with GPT-4 Vision     │  │
│  │  - Verifies payment details       │  │
│  │  - Organizes into folders         │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Container Filesystem:                  │
│  /usr/src/app/screenshots/              │
│    ├── verified/                        │
│    │   ├── abc123.jpg  ✅               │
│    │   └── def456.jpg  ✅               │
│    ├── rejected/                        │
│    │   └── xyz789.jpg  ❌               │
│    └── pending/                         │
│        └── mno234.jpg  ⏳               │
└────────┬────────────────────────────────┘
         │
         │ HTTPS API
         ▼
┌─────────────────────────────────────────┐
│      Your Local Computer                │
│  - Download verified screenshots        │
│  - Review payment records                │
│  - Archive for compliance                │
└─────────────────────────────────────────┘
```

## 📝 Step-by-Step Process

### Step 1: User Sends Payment Screenshot

**What happens:**
- Customer sends payment screenshot to your Telegram group
- Screenshot can be from any banking app (ABA, Wing, etc.)
- Can include caption/text

**Example:**
```
👤 Customer: [Sends ABA Bank transfer screenshot]
💬 Caption: "Payment for invoice #12345"
```

### Step 2: Bot Receives & Downloads (on Railway)

**What the bot does:**
1. Detects new photo message in group
2. Downloads image from Telegram API
3. Saves to Railway container: `/usr/src/app/screenshots/{uuid}.jpg`

**Console log on Railway:**
```
📸 Photo received from user 123456789
⬇️  Downloading screenshot...
✅ Screenshot saved: /usr/src/app/screenshots/a1b2c3d4.jpg
```

### Step 3: GPT-4 Vision Analysis (on Railway)

**What the bot does:**
1. Reads the screenshot file
2. Sends to OpenAI GPT-4 Vision API
3. Extracts payment information:
   - Amount (e.g., 100,000 KHR)
   - Currency (USD/KHR)
   - Transaction ID
   - Bank name
   - Sender/Recipient accounts
   - Transaction date

**Console log on Railway:**
```
🔍 Analyzing payment screenshot...
⏳ Rate limiter: OK (3/10 requests used)
🤖 OpenAI API call...
✅ OCR Analysis complete
```

**Extracted data:**
```json
{
  "isPaid": true,
  "amount": 100000,
  "currency": "KHR",
  "transactionId": "TXN20241224001",
  "bankName": "ABA Bank",
  "fromAccount": "001234567",
  "toAccount": "000 054 702",
  "confidence": "high"
}
```

### Step 4: Payment Verification (on Railway)

**What the bot does:**
1. Looks up expected amount in MongoDB (`excelreadings` collection)
2. Compares extracted amount vs expected amount
3. Checks recipient account number
4. Applies tolerance (5% by default)

**Verification logic:**
```javascript
Expected: 100,000 KHR
Received: 98,000 KHR
Tolerance: 5% (±5,000 KHR)
Range: 95,000 - 105,000 KHR
Result: ✅ VERIFIED (within tolerance)
```

**Console log on Railway:**
```
📊 Verification:
   Expected: 100,000 KHR
   Received: 98,000 KHR
   Tolerance: ±5,000 KHR
   Account: ✅ Match (000 054 702)
   Confidence: high
   Status: ✅ VERIFIED
```

### Step 5: Screenshot Organization (on Railway)

**What the bot does:**
1. Moves screenshot to appropriate folder based on verification result:
   - `verified/` - Payment verified ✅
   - `rejected/` - Invalid/failed verification ❌
   - `pending/` - Needs manual review ⏳

**File structure on Railway:**
```
/usr/src/app/screenshots/
├── verified/
│   └── a1b2c3d4.jpg  ← Moved here if verified
├── rejected/
│   └── x9y8z7w6.jpg  ← Invalid payments
└── pending/
    └── m5n4o3p2.jpg  ← Uncertain cases
```

**Console log on Railway:**
```
📁 Moved screenshot to verified folder
✅ PAID | 98,000 KHR | VERIFIED
```

### Step 6: Database Storage (on Railway)

**What the bot does:**
Saves complete payment record to MongoDB:

```javascript
{
  _id: "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6",
  chatId: -1001234567890,
  userId: 123456789,
  username: "customer_username",
  fullName: "John Doe",

  // Payment Status
  paymentLabel: "PAID",        // PAID, UNPAID, or PENDING
  verificationStatus: "verified",

  // OCR Extracted Data
  isPaid: true,
  paymentAmount: 100000,
  currency: "KHR",
  amountInKHR: 100000,
  transactionId: "TXN20241224001",
  bankName: "ABA Bank",
  fromAccount: "001234567",
  toAccount: "000 054 702",
  transactionDate: "2024-12-24T10:30:00Z",

  // Verification Details
  expectedAmountKHR: 100000,
  isVerified: true,
  verificationNotes: "Amount verified within 5% tolerance",
  confidence: "high",

  // File & Metadata
  screenshotPath: "/usr/src/app/screenshots/verified/a1b2c3d4.jpg",
  uploadedAt: "2024-12-24T10:31:05Z",
  aiAnalysis: "{ full GPT-4 response... }"
}
```

### Step 7: Telegram Notification

**What the bot does:**
If verified, sends confirmation message in Khmer:

```
🤖 Bot → Group Chat:
✅ បានទទួលការទូទាត់ 100000 KHR សូមអរគុណ
(Payment of 100000 KHR received. Thank you.)
```

### Step 8: Download to Local Machine (You)

**How to download verified screenshots:**

#### Option 1: List All Verified Screenshots

```bash
curl -H "x-download-token: YOUR_SECRET_TOKEN" \
  "https://your-app.railway.app/screenshots/verified"
```

**Response:**
```json
{
  "status": "verified",
  "count": 3,
  "files": [
    "a1b2c3d4.jpg",
    "b2c3d4e5.jpg",
    "c3d4e5f6.jpg"
  ]
}
```

#### Option 2: Download Specific Screenshot

```bash
curl -H "x-download-token: YOUR_SECRET_TOKEN" \
  "https://your-app.railway.app/screenshots/verified/a1b2c3d4.jpg" \
  -o payment-screenshot-001.jpg
```

**Result:** File downloaded to your local machine as `payment-screenshot-001.jpg`

#### Option 3: Bulk Download (PowerShell)

```powershell
# Set your token and Railway URL
$token = "YOUR_SECRET_TOKEN"
$base = "https://your-app.railway.app/screenshots/verified"

# Get list of all verified files
$response = Invoke-RestMethod -Headers @{ "x-download-token" = $token } -Uri $base
Write-Host "Found $($response.count) verified screenshots"

# Download each file
foreach ($file in $response.files) {
    Write-Host "Downloading $file..."
    Invoke-WebRequest `
        -Headers @{ "x-download-token" = $token } `
        -Uri "$base/$file" `
        -OutFile "verified_$file"
}

Write-Host "✅ All files downloaded!"
```

#### Option 4: Bulk Download (Bash)

```bash
#!/bin/bash
TOKEN="YOUR_SECRET_TOKEN"
BASE="https://your-app.railway.app/screenshots/verified"

# Get file list
FILES=$(curl -s -H "x-download-token: $TOKEN" "$BASE" | jq -r '.files[]')

# Download each file
for FILE in $FILES; do
    echo "Downloading $FILE..."
    curl -H "x-download-token: $TOKEN" \
         "$BASE/$FILE" \
         -o "verified_$FILE"
done

echo "✅ All files downloaded!"
```

## 🔐 Security Features

### Token Authentication
- **Required**: `SCREENSHOT_DOWNLOAD_TOKEN` environment variable in Railway
- **Header**: `x-download-token: YOUR_TOKEN`
- **Alternative**: Query parameter `?token=YOUR_TOKEN`

### Protection Mechanisms
1. **Path Traversal Protection**: Cannot access files outside screenshot folders
2. **Status Validation**: Only `verified`, `rejected`, `pending` folders allowed
3. **Filename Sanitization**: Prevents directory traversal attacks
4. **401 Unauthorized**: Invalid/missing tokens rejected
5. **503 Service Unavailable**: When `SCREENSHOT_DOWNLOAD_TOKEN` not set

## 📊 Monitoring & Verification

### Check Bot Status

```bash
curl https://your-app.railway.app/status
```

**Response:**
```json
{
  "bot": {
    "status": "running",
    "strategy": "Standard IPv4"
  },
  "database": {
    "customerDB": "connected",
    "invoiceDB": "connected"
  },
  "queues": {
    "messageQueue": 0,
    "processing": false
  },
  "uptime": 3600,
  "memory": {
    "rss": 150000000,
    "heapTotal": 50000000,
    "heapUsed": 40000000
  }
}
```

### View Payment Records in MongoDB

Connect to MongoDB Atlas and query the `payments` collection:

```javascript
// Find all verified payments
db.payments.find({ paymentLabel: "PAID" })

// Find payments for specific user
db.payments.find({ chatId: -1001234567890 })

// Count payments by status
db.payments.aggregate([
  { $group: { _id: "$paymentLabel", count: { $sum: 1 } } }
])
```

## 🚨 Error Handling

### Scenario 1: Screenshot Not Clear

**What happens:**
```
🤖 GPT-4 Response:
{
  "isPaid": false,
  "confidence": "low",
  "remark": "Image too blurry to read transaction details"
}

📁 Status: REJECTED
📂 Moved to: screenshots/rejected/
```

### Scenario 2: Amount Mismatch

**What happens:**
```
📊 Verification:
   Expected: 100,000 KHR
   Received: 50,000 KHR
   Difference: -50% (outside tolerance)
   Status: ⏳ PENDING (manual review needed)

📁 Moved to: screenshots/pending/
```

### Scenario 3: Wrong Recipient Account

**What happens:**
```
📊 Verification:
   Expected account: 000 054 702
   Received account: 000 123 456
   Status: ❌ REJECTED

📁 Moved to: screenshots/rejected/
```

## 📋 Daily Workflow Example

### Morning Routine

1. **Check overnight payments:**
```bash
curl -H "x-download-token: TOKEN" \
  "https://your-app.railway.app/screenshots/verified"
```

2. **Download verified screenshots:**
```bash
# Downloads all verified payments from last 24h
./download-verified.sh
```

3. **Review pending cases:**
```bash
curl -H "x-download-token: TOKEN" \
  "https://your-app.railway.app/screenshots/pending"
```

4. **Check MongoDB for details:**
```javascript
// Get today's payments
db.payments.find({
  uploadedAt: {
    $gte: ISODate("2024-12-24T00:00:00Z")
  }
}).sort({ uploadedAt: -1 })
```

### Weekly Routine

1. **Download all verified screenshots for archive:**
```powershell
# Archive verified payments by week
$week = "2024-W52"
$files = Get-VerifiedScreenshots
foreach ($f in $files) {
    Download-Screenshot -File $f -Destination "archive/$week/"
}
```

2. **Clear old rejected screenshots from Railway:**
   - Keep verified: ✅ (for compliance)
   - Keep pending: ⏳ (for review)
   - Delete rejected: ❌ (after 7 days)

3. **Generate payment report:**
```javascript
// MongoDB aggregation
db.payments.aggregate([
  { $match: {
      uploadedAt: { $gte: ISODate("2024-12-17") }
  }},
  { $group: {
      _id: "$paymentLabel",
      count: { $sum: 1 },
      totalAmount: { $sum: "$amountInKHR" }
  }}
])
```

## 🎯 Summary

**Railway Bot (Cloud):**
- ✅ Receives screenshots from Telegram
- ✅ Analyzes with GPT-4 Vision
- ✅ Verifies payments automatically
- ✅ Organizes into verified/rejected/pending
- ✅ Stores records in MongoDB
- ✅ Sends Telegram confirmations

**Your Local Machine:**
- ✅ Download verified screenshots via API
- ✅ Review pending cases
- ✅ Archive for compliance
- ✅ Generate reports from MongoDB

**Data Flow:**
```
Telegram → Railway Container → MongoDB
                    ↓
              Local Machine (via API)
```

This workflow ensures:
- 🔐 **Security**: Screenshots never exposed publicly
- ⚡ **Speed**: Automated verification in seconds
- 📊 **Accuracy**: AI-powered OCR with verification
- 💾 **Storage**: Both files (Railway) and data (MongoDB)
- 📥 **Access**: Download anytime via secure API

---

**Questions?** Check the [README.md](README.md) or [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)
