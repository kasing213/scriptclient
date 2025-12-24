# Payment Verification Bot - Railway Deployment Guide

A Telegram bot that automatically verifies payment screenshots using OpenAI GPT-4 Vision API, with MongoDB storage and comprehensive payment tracking.

## 🎯 Features

### ✅ **Automated Payment Verification**
- **OCR Analysis**: Extracts payment details from screenshots using GPT-4 Vision
- **Amount Verification**: Compares against expected amounts with configurable tolerance
- **Account Verification**: Validates recipient account numbers
- **Multi-Currency Support**: Automatically converts USD to KHR
- **Confidence Scoring**: AI assigns confidence levels (high/medium/low)

### 📊 **Payment Tracking**
- **Status Labels**: PAID, UNPAID, PENDING
- **Screenshot Organization**: Automatically sorts into verified/rejected/pending folders
- **Database Storage**: Comprehensive payment records in MongoDB
- **Transaction Details**: Captures transaction ID, reference number, bank name, dates, etc.

### 🔄 **Data Management**
- **Dual Database Support**: Separate customerDB and invoiceDB
- **Customer Records**: Links payments to customer data
- **Excel Readings**: Integrates with invoice/bill data
- **Payment History**: Full audit trail of all transactions

### 🛡️ **Security & Reliability**
- **Rate Limiting**: Built-in OpenAI API rate limiter (10 req/min)
- **Error Handling**: Graceful error recovery with detailed logging
- **Queue System**: Message queue prevents race conditions
- **Health Monitoring**: Built-in health check endpoints
- **Graceful Shutdown**: Proper cleanup on termination

## 🚀 Quick Deploy to Railway

### Step 1: Prerequisites
- GitHub account
- Railway account (https://railway.app)
- Telegram Bot Token (from @BotFather)
- MongoDB Atlas cluster (free tier available)
- OpenAI API Key

### Step 2: Deploy from GitHub

1. **Sign in to Railway** with your GitHub account

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `kasing213/scriptclient`

3. **Railway Auto-Detection**
   - Railway will automatically detect the Dockerfile
   - Build process starts automatically

### Step 3: Configure Environment Variables

In Railway Dashboard → Variables, add these:

```bash
# Required Variables
TELEGRAM_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
DB_NAME=customerDB
OPENAI_API_KEY=sk-proj-...

# Optional Variables (with defaults)
USD_TO_KHR_RATE=4000
PAYMENT_TOLERANCE_PERCENT=5
EXPECTED_RECIPIENT_ACCOUNT=000 054 702
PORT=3000
SCREENSHOT_DIR=./screenshots
SCREENSHOT_DOWNLOAD_TOKEN=change-me

# Optional: Separate Invoice Database
MONGO_URL_INVOICE=mongodb+srv://...
DB_NAME_INVOICE=invoiceDB
```

### Downloading screenshots (Railway)
Set `SCREENSHOT_DOWNLOAD_TOKEN` in Railway, then download a file:

```bash
curl -H "x-download-token: YOUR_TOKEN" \
  "https://YOUR-RAILWAY-DOMAIN/screenshots/verified/FILE.jpg" \
  -o FILE.jpg
```

List files in a status folder:

```bash
curl -H "x-download-token: YOUR_TOKEN" \
  "https://YOUR-RAILWAY-DOMAIN/screenshots/verified"
```

Download all files in a status folder (PowerShell):

```powershell
$token = "YOUR_TOKEN"
$base = "https://YOUR-RAILWAY-DOMAIN/screenshots/verified"
$files = (Invoke-RestMethod -Headers @{ "x-download-token" = $token } -Uri $base).files
foreach ($f in $files) {
  Invoke-WebRequest -Headers @{ "x-download-token" = $token } -Uri "$base/$f" -OutFile $f
}
```

### Step 4: MongoDB Setup

1. **Create MongoDB Atlas Cluster** (if you don't have one)
   - Go to https://www.mongodb.com/cloud/atlas
   - Create free M0 cluster
   - Create database user
   - Get connection string

2. **Configure Network Access**
   - In MongoDB Atlas → Network Access
   - Click "Add IP Address"
   - Choose "Allow Access from Anywhere" (0.0.0.0/0)
   - Or add specific Railway IP addresses

3. **Create Collections**
   - Database: `customerDB`
     - Collections: `messages`, `payments`, `customers`
   - Database: `invoiceDB`
     - Collections: `excelreadings`

### Step 5: Telegram Bot Setup

1. **Create Bot with BotFather**
   ```
   /newbot
   Choose a name: Payment Verification Bot
   Choose a username: your_bot_username
   ```

2. **Get Bot Token**
   - Copy the token provided by BotFather
   - Add to Railway environment variables as `TELEGRAM_TOKEN`

3. **Add Bot to Group**
   - Add your bot to the Telegram group where payments are sent
   - Make sure bot has permission to read messages

### Step 6: Deploy & Monitor

1. **Deploy**
   - Railway automatically deploys when you push to GitHub
   - Or click "Deploy" in Railway dashboard

2. **Check Logs**
   - Railway Dashboard → Deployments → View Logs
   - Look for:
     ```
     🌐 Health server running on port 3000
     ✅ Bot connected successfully
     ✅ MongoDB connected (customerDB)
     ✅ MongoDB connected (invoiceDB)
     🎯 Bot is ready and listening for messages...
     ```

3. **Test Health Endpoint**
   ```bash
   curl https://your-app.railway.app/health
   ```

   Should return:
   ```json
   {
     "status": "healthy",
     "timestamp": "2024-...",
     "uptime": 123.45,
     "bot": "connected",
     "mongo": "connected"
   }
   ```

## 📋 Verification Workflow

### How Payment Verification Works

1. **User sends screenshot** to Telegram group
2. **Bot downloads** the image
3. **OpenAI GPT-4 Vision** analyzes the screenshot:
   - Extracts payment amount, currency, transaction ID
   - Identifies bank name, accounts, dates
   - Determines if it's a valid payment
4. **Bot verifies**:
   - Amount matches expected (within tolerance)
   - Recipient account matches (if configured)
5. **Bot responds**:
   - ✅ **PAID**: Sends confirmation in Khmer
   - ⏳ **PENDING**: Manual review needed
   - ❌ **UNPAID**: Invalid or rejected
6. **Screenshot organized** into verified/rejected/pending folders
7. **Payment record saved** to MongoDB

### Payment Data Captured

```javascript
{
  paymentLabel: "PAID" | "UNPAID" | "PENDING",
  isPaid: true | false,
  paymentAmount: 100,
  currency: "USD" | "KHR",
  amountInKHR: 400000,
  transactionId: "TXN123456",
  referenceNumber: "REF789",
  fromAccount: "sender account",
  toAccount: "recipient account",
  bankName: "ABA Bank",
  transactionDate: "2024-01-01T10:00:00Z",
  expectedAmountKHR: 400000,
  isVerified: true,
  verificationNotes: "Amount verified within 5% tolerance",
  confidence: "high" | "medium" | "low"
}
```

## 🔧 Configuration Details

### Payment Tolerance
- **PAYMENT_TOLERANCE_PERCENT**: Acceptable variance (default: 5%)
- Example: Expected 100,000 KHR
  - Accepts: 95,000 - 105,000 KHR (±5%)

### Currency Conversion
- **USD_TO_KHR_RATE**: Exchange rate (default: 4000)
- Automatically converts USD amounts to KHR for verification

### Expected Account
- **EXPECTED_RECIPIENT_ACCOUNT**: Your account number
- Format: "000 054 702" or "000054702" (spaces optional)
- Leave empty to skip account verification

## 📊 Monitoring & Health Checks

### Health Endpoints

1. **Basic Health Check**
   ```bash
   GET /health
   ```
   Returns basic health status

2. **Detailed Status**
   ```bash
   GET /status
   ```
   Returns:
   - Bot connection status
   - Database connections
   - Queue sizes
   - Memory usage
   - Uptime

3. **Root Endpoint**
   ```bash
   GET /
   ```
   Returns service information

### Logging

The bot provides detailed console logs:
- 🔍 Environment variable checks
- ✅ Successful operations
- ❌ Errors and failures
- 📊 Payment verification results
- 🎯 Status updates

## 🔐 Security Best Practices

### ✅ Implemented Security Features

1. **Non-root User**: Docker runs as `nodejs` user (UID 1001)
2. **Environment Secrets**: All sensitive data via env vars
3. **No Hardcoded Credentials**: `.env` excluded from Git
4. **Alpine Linux**: Minimal attack surface
5. **Security Updates**: Automated patches in Dockerfile
6. **TLS/SSL**: MongoDB connections encrypted
7. **Rate Limiting**: OpenAI API calls limited

### 🔒 Security Checklist

- [ ] Never commit `.env` to GitHub ✅ (protected by .gitignore)
- [ ] Use strong MongoDB passwords
- [ ] Enable MongoDB IP whitelisting
- [ ] Rotate API keys regularly (quarterly)
- [ ] Monitor API usage for anomalies
- [ ] Keep dependencies updated (`npm audit`)
- [ ] Review payment logs regularly
- [ ] Set up error alerting in Railway

## 🛠️ Troubleshooting

### Bot Not Starting

**Check Environment Variables:**
```bash
# In Railway logs, look for:
🔍 Environment Check:
TELEGRAM_TOKEN: ✅ Set
MONGO_URL: ✅ Set
DB_NAME: ✅ Set
OPENAI_API_KEY: ✅ Set
```

**Common Issues:**
- ❌ Missing env vars → Add in Railway dashboard
- ❌ Invalid Telegram token → Check @BotFather
- ❌ MongoDB connection failed → Check IP whitelist

### Database Connection Fails

1. **Check MongoDB Network Access**
   - Allow 0.0.0.0/0 or specific Railway IPs

2. **Verify Connection String**
   - Format: `mongodb+srv://user:pass@cluster.mongodb.net/dbname`
   - URL encode special characters in password

3. **Test Connection**
   - Use MongoDB Compass to test connection string

### Payment Verification Not Working

1. **Check OpenAI API Key**
   - Valid and has credits
   - Check usage at https://platform.openai.com/usage

2. **Check Expected Amounts**
   - Ensure `excelreadings` collection has data
   - Link chatId correctly

3. **Review Logs**
   - Look for "❌ Payment OCR analysis failed"
   - Check error messages for details

### Screenshots Not Saving

1. **Check Permissions**
   - Docker handles this automatically
   - Directories created on first run

2. **Check Disk Space**
   - Railway has storage limits
   - Consider periodic cleanup

## 📈 Scaling & Performance

### Current Limits
- **OpenAI API**: 10 requests/minute (rate limited)
- **Message Queue**: Sequential processing
- **MongoDB**: Free tier (M0) - 512MB storage

### Optimization Tips
1. **Increase OpenAI Rate Limit** (if you have higher tier)
2. **Use MongoDB Atlas M2+** for better performance
3. **Add Redis** for caching (future enhancement)
4. **Enable Compression** for screenshots

## 🔄 Updates & Maintenance

### Updating Your Bot

```bash
# Make changes locally
git add .
git commit -m "Your changes"
git push origin main

# Railway automatically redeploys!
```

### Dependency Updates

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Commit package-lock.json
git add package-lock.json
git commit -m "Update dependencies"
git push
```

### Backup Strategy

1. **MongoDB Backups**
   - Atlas M0: Manual exports
   - Atlas M2+: Automatic backups

2. **Screenshot Backups**
   - Download from Railway volumes (if using persistent storage)
   - Or use external storage (S3, etc.)

## 📞 Support & Resources

- **Railway Docs**: https://docs.railway.app
- **Telegram Bot API**: https://core.telegram.org/bots/api
- **OpenAI API**: https://platform.openai.com/docs
- **MongoDB Atlas**: https://www.mongodb.com/docs/atlas

## 📄 License & Credits

Built with:
- Node.js 20 LTS
- Express.js for health endpoints
- node-telegram-bot-api for Telegram integration
- OpenAI GPT-4 Vision for OCR analysis
- MongoDB for data persistence

Generated with [Claude Code](https://claude.com/claude-code)

---

**Version**: 1.0.0
**Last Updated**: 2024
**Repository**: https://github.com/kasing213/scriptclient
