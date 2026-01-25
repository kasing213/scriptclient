# Payment Reminder Scheduler

Automated payment reminder system with AI-generated messages in Khmer.

## Features

### 📁 Screenshot Organization
Screenshots are automatically organized into folders based on verification status:
- `screenshots/verified/` - ✅ PAID and verified payments
- `screenshots/rejected/` - ❌ UNPAID or invalid screenshots
- `screenshots/pending/` - ⏳ PENDING payments needing review

### 🏷️ Payment Labels
Clear payment status labels in database:
- **PAID** - Verified payments with high confidence
- **UNPAID** - Rejected or invalid payments
- **PENDING** - Payments needing manual review

### 🤖 AI-Powered Reminders
Automated reminders with AI-generated messages in Khmer:
- **UNPAID**: Immediate notification when payment is rejected
- **PENDING**: 5-day warning to complete full payment

## Setup

### 1. Environment Variables
Add to your `.env` file:

```env
# Payment Reminder Scheduler Settings
PENDING_WARNING_DAYS=5        # Days before sending PENDING reminder
CHECK_INTERVAL_HOURS=24       # How often to check (in hours)
```

### 2. Install Dependencies
```bash
npm install
```

## Usage

### Start the Bot
```bash
npm start
# or
node src/botfetch.js
```

### Start the Scheduler
```bash
npm run scheduler
# or
node src/payment-scheduler.js
```

### Verify Payments
```bash
npm run verify <chatId> [amount]
# or
node src/cross-verify-payment.js -4809300176
```

## How It Works

### Payment Processing Flow

1. **Screenshot Upload**
   - Customer uploads payment screenshot to Telegram group
   - Bot downloads and analyzes with GPT-4o Vision OCR
   - Extracts: amount, bank, transaction ID, etc.

2. **Verification**
   - Compares payment amount with customer bill
   - Checks within 5% tolerance
   - Assigns status: PAID, UNPAID, or PENDING

3. **Organization**
   - Moves screenshot to appropriate folder
   - Saves record to database with clear label

4. **Automated Reminders**
   - Scheduler runs every 24 hours (configurable)
   - Checks for UNPAID and overdue PENDING payments
   - Generates AI message in Khmer
   - Sends via Telegram

### Reminder Logic

#### UNPAID Payments
- Sent immediately on next scheduler run
- No waiting period
- Firm but polite message

#### PENDING Payments
- Waits 5 days (configurable)
- Then sends friendly reminder
- Asks to complete full payment

### AI Message Generation

Uses GPT-4o-mini to generate contextual messages in Khmer:
- Customer name personalization
- Amount and days overdue
- Polite and professional tone
- Fallback to template if AI fails

## Database Collections

### `payments`
Stores payment screenshot analysis:
```javascript
{
  _id: "uuid",
  chatId: -4809300176,
  paymentLabel: "PAID" | "UNPAID" | "PENDING",
  screenshotPath: "screenshots/verified/uuid.jpg",
  amountInKHR: 30000,
  isVerified: true,
  verificationStatus: "verified" | "rejected" | "pending",
  uploadedAt: Date,
  // ... OCR data
}
```

### `reminders`
Tracks sent reminders:
```javascript
{
  paymentId: "payment-uuid",
  chatId: -4809300176,
  paymentLabel: "PENDING",
  customerName: "John Doe",
  amount: 30000,
  daysOverdue: 7,
  message: "សូមជូនដំណឹង...",
  sentAt: Date,
  reminderType: "PENDING_OVERDUE" | "UNPAID"
}
```

## Configuration

### Adjust Warning Period
Change in `.env`:
```env
PENDING_WARNING_DAYS=3  # Send reminder after 3 days instead of 5
```

### Adjust Check Frequency
```env
CHECK_INTERVAL_HOURS=12  # Check every 12 hours instead of 24
```

### Prevent Duplicate Reminders
The system automatically:
- Checks if reminder was sent in last 24 hours
- Skips if already reminded
- Logs reminder to prevent duplicates

## Example Output

### Bot Processing
```
✅ PAID | 30000 KHR | VERIFIED
📁 Moved screenshot to verified folder
```

### Scheduler Running
```
🤖 Payment Reminder Scheduler Started

⏰ Checking every 24 hours
⚠️  PENDING payment warning: 5 days

🔍 Checking for payments requiring reminders...

Found 3 payment(s) to review

⏳ PENDING | Sent to John Doe (-4809300176) | 7d overdue
❌ UNPAID | Sent to Jane Smith (-4883667610) | 2d overdue
⏭️  Skipping UNPAID - Reminder already sent today for Bob Lee

✅ Reminder check completed

🎯 Scheduler is running. Next check in 24 hour(s)...
```

## Running in Production

### Using PM2
```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start src/botfetch.js --name payment-bot

# Start scheduler
pm2 start src/payment-scheduler.js --name payment-scheduler

# View logs
pm2 logs

# Restart
pm2 restart all

# Auto-start on system reboot
pm2 startup
pm2 save
```

### Using Screen (Linux)
```bash
# Start bot in screen
screen -S payment-bot
node src/botfetch.js
# Press Ctrl+A, then D to detach

# Start scheduler in screen
screen -S scheduler
node src/payment-scheduler.js
# Press Ctrl+A, then D to detach

# Reattach
screen -r payment-bot
screen -r scheduler
```

## Troubleshooting

### Reminders Not Sending
- Check scheduler is running
- Verify Telegram bot token
- Check database connection
- Review logs for errors

### Wrong Messages
- AI might fail - uses fallback template
- Check OpenAI API key
- Verify language settings

### Duplicate Reminders
- System prevents duplicates automatically
- Check `reminders` collection
- Clear old reminder records if needed

## License

MIT
