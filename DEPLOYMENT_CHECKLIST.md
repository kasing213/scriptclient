# Railway Deployment Checklist

Complete this checklist before and after deploying your Payment Verification Bot to Railway.

## 📋 Pre-Deployment Checklist

### ✅ Code & Repository
- [x] Code committed to GitHub
- [x] Dockerfile created and tested
- [x] .dockerignore configured
- [x] .gitignore prevents committing secrets
- [x] package-lock.json included in repo
- [ ] All features tested locally

### ✅ Environment Variables Prepared

Gather these values before deployment:

#### Required Variables
- [ ] **TELEGRAM_TOKEN**
  - Source: @BotFather on Telegram
  - Format: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`
  - Test: Send `/start` to your bot

- [ ] **MONGO_URL**
  - Source: MongoDB Atlas connection string
  - Format: `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority`
  - Test: Connect with MongoDB Compass

- [ ] **DB_NAME**
  - Value: `customerDB` (or your database name)
  - Ensure database exists in MongoDB

- [ ] **OPENAI_API_KEY**
  - Source: https://platform.openai.com/api-keys
  - Format: `sk-proj-...` or `sk-...`
  - Test: Check usage limits and credits

#### Optional Variables (Recommended)
- [ ] **USD_TO_KHR_RATE**: Current exchange rate (default: 4000)
- [ ] **PAYMENT_TOLERANCE_PERCENT**: Allowed variance (default: 5)
- [ ] **EXPECTED_RECIPIENT_ACCOUNT**: Your payment account number
- [ ] **PORT**: 3000 (Railway sets this automatically)
- [ ] **SCREENSHOT_DIR**: ./screenshots (default)

#### Optional: Dual Database Support
- [ ] **MONGO_URL_INVOICE**: Separate database for invoices (optional)
- [ ] **DB_NAME_INVOICE**: invoiceDB (optional)

### ✅ MongoDB Setup

#### Network Access
- [ ] MongoDB Network Access configured
  - Option 1: Allow 0.0.0.0/0 (easiest, less secure)
  - Option 2: Add specific Railway IP addresses
  - Option 3: Use MongoDB's "Add Current IP" when deploying

#### Database Structure
- [ ] Database `customerDB` created with collections:
  - [ ] `messages` - Chat message history
  - [ ] `payments` - Payment verification records
  - [ ] `customers` - Customer information

- [ ] Database `invoiceDB` created with collections:
  - [ ] `excelreadings` - Expected payment amounts

#### Sample Data (Optional)
- [ ] Add test customer to `customers` collection
- [ ] Add test invoice to `excelreadings` collection with:
  ```json
  {
    "chatId": -1001234567890,
    "amount": 100000,
    "customerName": "Test User"
  }
  ```

### ✅ Telegram Bot Configuration

- [ ] Bot created via @BotFather
- [ ] Bot username chosen (e.g., @YourPaymentBot)
- [ ] Bot token saved securely
- [ ] Bot added to target Telegram group
- [ ] Bot has message read permissions in group
- [ ] Test: Bot responds to messages in group

### ✅ OpenAI API

- [ ] OpenAI account created
- [ ] API key generated
- [ ] Billing configured (required for GPT-4)
- [ ] Credits available
- [ ] Usage limits reviewed (10 req/min default)
- [ ] Test: API key works with GPT-4 Vision

### ✅ Local Testing (Optional but Recommended)

```bash
# Test environment variables
node -e "require('dotenv').config(); console.log('TELEGRAM_TOKEN:', process.env.TELEGRAM_TOKEN ? '✅' : '❌')"

# Test MongoDB connection
node -e "const {MongoClient} = require('mongodb'); const client = new MongoClient(process.env.MONGO_URL); client.connect().then(() => console.log('✅ Connected')).catch(e => console.log('❌', e.message))"

# Run bot locally
npm start
```

## 🚀 Deployment Steps

### Step 1: Railway Setup
- [ ] Sign in to Railway (https://railway.app)
- [ ] GitHub account connected to Railway
- [ ] New project created
- [ ] Repository linked: `kasing213/scriptclient`

### Step 2: Configure Railway

#### Environment Variables
- [ ] All required env vars added to Railway dashboard
- [ ] Values verified (no typos)
- [ ] Secrets properly set (not visible in logs)

#### Settings
- [ ] Service name set (e.g., "payment-bot")
- [ ] Region selected (choose closest to your MongoDB region)
- [ ] Auto-deploy from GitHub enabled

### Step 3: Deploy

- [ ] Click "Deploy" in Railway
- [ ] Build logs show successful Docker build
- [ ] Look for these success messages in logs:
  ```
  ✅ Bot connected successfully
  ✅ MongoDB connected (customerDB)
  ✅ MongoDB connected (invoiceDB)
  🌐 Health server running on port 3000
  🎯 Bot is ready and listening for messages...
  ```

### Step 4: Verify Deployment

#### Health Checks
- [ ] Get Railway public URL (Settings → Networking → Generate Domain)
- [ ] Test health endpoint:
  ```bash
  curl https://your-app.railway.app/health
  ```
  Expected response:
  ```json
  {
    "status": "healthy",
    "bot": "connected",
    "mongo": "connected"
  }
  ```

- [ ] Test status endpoint:
  ```bash
  curl https://your-app.railway.app/status
  ```

#### Functional Testing
- [ ] Send test message to Telegram group
- [ ] Bot receives and processes message
- [ ] Send test payment screenshot
- [ ] Bot analyzes screenshot
- [ ] Bot sends verification result
- [ ] Payment record saved to MongoDB
- [ ] Screenshot organized into correct folder

## 🔍 Post-Deployment Verification

### ✅ Telegram Bot
- [ ] Bot responds in group
- [ ] Bot receives photos/images
- [ ] Bot processes messages in queue
- [ ] No "polling_error" in logs

### ✅ Payment Verification
- [ ] Screenshot upload works
- [ ] OCR analysis completes (check OpenAI usage)
- [ ] Payment amount extracted correctly
- [ ] Currency conversion works (USD → KHR)
- [ ] Amount verification against expected value works
- [ ] Account number verification works (if configured)
- [ ] Confidence scoring accurate
- [ ] Payment status labels correct (PAID/UNPAID/PENDING)

### ✅ Database Operations
- [ ] Messages saved to `messages` collection
- [ ] Payments saved to `payments` collection
- [ ] Customer lookups work
- [ ] Excel readings retrieved correctly
- [ ] No database connection errors

### ✅ File Management
- [ ] Screenshots download successfully
- [ ] Files saved to Railway filesystem
- [ ] Screenshots organized into verified/rejected/pending folders
- [ ] File permissions correct (Docker handles this)

### ✅ Monitoring
- [ ] Railway logs accessible
- [ ] Error messages clear and actionable
- [ ] Health endpoint returns 200 OK
- [ ] Status endpoint shows correct stats
- [ ] Memory usage reasonable
- [ ] No memory leaks (check over time)

## 🛡️ Security Verification

### ✅ Secrets Management
- [ ] .env file NOT in GitHub repository
- [ ] Environment variables set in Railway (not hardcoded)
- [ ] MongoDB password strong (16+ characters)
- [ ] API keys rotated regularly (set calendar reminder)

### ✅ Access Control
- [ ] MongoDB IP whitelist configured
- [ ] Railway project access limited to authorized users
- [ ] Telegram bot only in authorized groups
- [ ] OpenAI API key usage monitored

### ✅ Data Security
- [ ] MongoDB connections use TLS/SSL
- [ ] Sensitive data not logged
- [ ] Payment screenshots stored securely
- [ ] Customer data protected

## 📊 Monitoring Setup

### ✅ Railway Monitoring
- [ ] Enable Railway metrics
- [ ] Set up deployment notifications
- [ ] Configure error alerts
- [ ] Monitor resource usage

### ✅ Application Monitoring
- [ ] Check logs daily for errors
- [ ] Monitor OpenAI API usage/costs
- [ ] Review payment verification accuracy
- [ ] Track database size growth

### ✅ Alerts (Recommended)
- [ ] Set up error notifications (Railway/Email/Slack)
- [ ] Monitor OpenAI API quota
- [ ] Alert on MongoDB connection failures
- [ ] Track unusual payment patterns

## 🔄 Maintenance Schedule

### Daily
- [ ] Check Railway logs for errors
- [ ] Review payment verification results
- [ ] Monitor bot uptime

### Weekly
- [ ] Review payment verification accuracy
- [ ] Check OpenAI API costs
- [ ] Verify MongoDB backups (if enabled)
- [ ] Clean up old screenshots (if storage limited)

### Monthly
- [ ] Update dependencies (`npm audit`)
- [ ] Review security vulnerabilities
- [ ] Analyze payment trends
- [ ] Optimize database indexes if needed

### Quarterly
- [ ] Rotate API keys (OpenAI, if needed)
- [ ] Review and update MongoDB password
- [ ] Audit user access
- [ ] Performance review and optimization

## 🆘 Troubleshooting Quick Reference

### Bot Not Connecting
1. Check TELEGRAM_TOKEN in Railway env vars
2. Verify Railway logs for connection errors
3. Test token with curl: `curl https://api.telegram.org/bot<TOKEN>/getMe`

### MongoDB Connection Failed
1. Check MONGO_URL is correct
2. Verify MongoDB IP whitelist includes Railway
3. Test connection string with MongoDB Compass
4. Check MongoDB Atlas status

### OpenAI API Errors
1. Verify OPENAI_API_KEY is valid
2. Check OpenAI usage/billing at https://platform.openai.com/usage
3. Ensure you have GPT-4 access
4. Check rate limits (10 req/min by default)

### Verification Not Working
1. Check excelreadings collection has expected amounts
2. Verify chatId matches between bot and database
3. Review PAYMENT_TOLERANCE_PERCENT setting
4. Check OpenAI API response in logs

### Health Check Failing
1. Verify PORT env var (Railway sets this automatically)
2. Check if Express server started in logs
3. Test locally: `npm start` then `curl localhost:3000/health`
4. Review Railway networking settings

## ✅ Deployment Complete!

Once all items are checked:
- [ ] Deployment successful
- [ ] All features working
- [ ] Monitoring in place
- [ ] Team notified
- [ ] Documentation updated
- [ ] Backup strategy confirmed

**Deployment Date**: _______________
**Deployed By**: _______________
**Railway URL**: https://_______________.railway.app
**Notes**:

---

Need help? Check:
- [README.md](README.md) for detailed documentation
- [DOCKER_SECURITY_CHECKLIST.md](DOCKER_SECURITY_CHECKLIST.md) for security best practices
- Railway Docs: https://docs.railway.app
