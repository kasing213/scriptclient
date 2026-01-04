# Screenshot Download Helper Scripts

Quick reference for downloading payment screenshots from Railway to your local machine.

## 🚀 Quick Start

### Setup (One Time)

**PowerShell (Windows):**
```powershell
$env:SCREENSHOT_DOWNLOAD_TOKEN = "your-token-here"
```

**Bash (Linux/Mac/WSL):**
```bash
export SCREENSHOT_DOWNLOAD_TOKEN="your-token-here"
```

## 📋 Usage

### Check All Folders

**PowerShell:**
```powershell
.\check-screenshots.ps1
```

**Bash:**
```bash
./check-screenshots.sh
```

**Output:**
```
📊 Payment Screenshots Summary
================================

✅ Verified:  5 screenshots
   - payment-001.jpg
   - payment-002.jpg

❌ Rejected:  2 screenshots
   - invalid-001.jpg

⏳ Pending:   1 screenshot
   - review-001.jpg

🚨 Fraud:     1 screenshot
   - old-screenshot-001.jpg

📦 Total: 9 screenshots collected
```

### Check Specific Folder

```powershell
# PowerShell
.\check-screenshots.ps1 verified
.\check-screenshots.ps1 rejected
.\check-screenshots.ps1 pending
.\check-screenshots.ps1 fraud

# Bash
./check-screenshots.sh verified
./check-screenshots.sh rejected
./check-screenshots.sh pending
./check-screenshots.sh fraud
```

### Download Screenshots

```powershell
# PowerShell
.\check-screenshots.ps1 download

# Bash
./check-screenshots.sh download
```

Then choose:
```
Download which folder?
1. Verified
2. Rejected
3. Pending
4. Fraud
5. All
Enter choice (1-5):
```

**Files downloaded to:**
- `./verified/` - Verified screenshots
- `./rejected/` - Rejected screenshots
- `./pending/` - Pending screenshots
- `./fraud/` - Fraud-flagged screenshots

## 🔐 Security

These scripts use your `SCREENSHOT_DOWNLOAD_TOKEN` to authenticate with Railway.

**Important:**
- ✅ Scripts are in `.gitignore` - won't be committed
- ✅ Scripts are in `.dockerignore` - won't be in Docker image
- ⚠️ Keep your token secret!
- ⚠️ Don't share these scripts with token hardcoded

## 💡 Tips

### Save Token Permanently

**PowerShell (add to profile):**
```powershell
notepad $PROFILE
# Add this line:
$env:SCREENSHOT_DOWNLOAD_TOKEN = "your-token"
```

**Bash (add to ~/.bashrc or ~/.zshrc):**
```bash
echo 'export SCREENSHOT_DOWNLOAD_TOKEN="your-token"' >> ~/.bashrc
source ~/.bashrc
```

### Quick Aliases

**PowerShell:**
```powershell
function Check-Payments { .\check-screenshots.ps1 }
Set-Alias check Check-Payments
```

**Bash:**
```bash
alias check='./check-screenshots.sh'
alias check-verified='./check-screenshots.sh verified'
alias check-pending='./check-screenshots.sh pending'
alias check-fraud='./check-screenshots.sh fraud'
```

## 🎯 Common Workflows

### Daily Review
```powershell
# Check what's new
.\check-screenshots.ps1

# Download verified payments
.\check-screenshots.ps1 download
# Choose 1 (Verified)

# Review pending manually
.\check-screenshots.ps1 pending
```

### Weekly Archive
```powershell
# Download everything
.\check-screenshots.ps1 download
# Choose 5 (All)

# Move to archive folder
Move-Item verified archive/2024-W52-verified
Move-Item rejected archive/2024-W52-rejected
Move-Item pending archive/2024-W52-pending
Move-Item fraud archive/2024-W52-fraud
```

## 🆘 Troubleshooting

### "Token not set" error
```
❌ Error: SCREENSHOT_DOWNLOAD_TOKEN not set
```
**Solution:** Set the environment variable as shown in Setup section

### "Unauthorized" error
```
401 Unauthorized
```
**Solution:** Check that your token matches the one in Railway's environment variables

### "No files found"
```
✅ Verified:  0 screenshots
```
**Solution:** No screenshots in that folder yet. Send a test payment to Telegram group.

## 📖 Related Documentation

- [README.md](README.md) - Full deployment guide
- [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) - Complete verification workflow
- [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) - Setup checklist

## 🌐 API Endpoints

These scripts use:
- `GET /screenshots/{status}` - List files
- `GET /screenshots/{status}/{filename}` - Download file

Where `{status}` is: `verified`, `rejected`, `pending`, or `fraud`

**Fraud Folder:**
- Contains screenshots flagged for potential fraud (old screenshots, date mismatches, etc.)
- Requires admin review via `/fraud/alerts` API
- Screenshots kept permanently for audit trail
