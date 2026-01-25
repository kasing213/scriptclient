# Bot Troubleshooting Guide

## Common Issues and Solutions

### 1. Bot Not Responding to Messages

**Symptoms:**
- Bot shows data in terminal but doesn't send messages back
- No confirmation messages in Telegram

**Possible Causes:**
- Missing or incorrect TELEGRAM_TOKEN
- Bot not added to group or doesn't have permissions
- Environment variables not loaded properly

**Solutions:**
1. Check your `.env` file has the correct TELEGRAM_TOKEN
2. Ensure the bot is added to your Telegram group
3. Give the bot admin permissions in the group
4. Run the test script: `node src/test-bot.js`

### 2. Environment Variables Not Loading

**Required .env file structure:**
```
TELEGRAM_TOKEN=your_telegram_bot_token_here
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
DB_NAME=your_database_name
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Database Connection Issues

**Symptoms:**
- "MongoDB connection failed" errors
- Data not saving to database

**Solutions:**
1. Check MONGO_URL format
2. Ensure MongoDB cluster is accessible
3. Verify database credentials

### 4. File Download Issues

**Symptoms:**
- Photos not saving to screenshots folder
- File download errors

**Solutions:**
1. Ensure screenshots folder exists
2. Check write permissions
3. Verify internet connection

## Testing Steps

1. **Test Environment Variables:**
   ```bash
   node src/test-bot.js
   ```

2. **Test Bot Connection:**
   - Run the test script
   - Check if bot responds to `/start` command

3. **Test in Group:**
   - Add bot to a Telegram group
   - Send a message
   - Check for confirmation response

## Debug Commands

```bash
# Check PM2 logs
pm2 logs myclient

# Restart bot
pm2 restart myclient

# Check bot status
pm2 status

# Run bot directly (for debugging)
node src/botfetch.js
```

## Getting Your Chat ID

To get your personal chat ID for testing:
1. Send a message to @userinfobot on Telegram
2. It will reply with your chat ID
3. Add it to .env as TEST_CHAT_ID 