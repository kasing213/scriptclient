# Rejection Audit System - Complete Guide

## Overview

The Enhanced Rejection Audit System provides comprehensive tracking, analytics, and reporting for rejected bank statement payments. This system helps identify fraud patterns, improve verification processes, and maintain detailed audit trails.

## Features Added

### 📊 Enhanced Rejection Tracking
- **Detailed metadata** for each rejection with confidence scores
- **Audit trail** for manual reviews and approvals
- **Pattern detection** for fraud prevention
- **Performance analytics** to improve verification accuracy

### 🔍 New API Endpoints
- **Summary statistics** with date filtering
- **Detailed rejection lists** with pagination
- **Customer analysis** with fraud pattern detection
- **Analytics dashboard** data with trends
- **Export functionality** in Excel and JSON formats
- **Manual review** capabilities for false positives

---

## API Endpoints Reference

### 1. Rejection Summary
```http
GET /api/rejections/summary?startDate=2026-01-01&endDate=2026-01-22
```

**Response:**
```json
{
  "summary": {
    "totalRejected": 45,
    "totalPayments": 150,
    "rejectionRate": 30.0,
    "totalRejectedAmount": 2500000,
    "avgRejectedAmount": 55555.56
  },
  "byReason": [
    {
      "_id": "BLURRY",
      "count": 20,
      "totalAmount": 1200000,
      "avgConfidence": 0.3,
      "recentDate": "2026-01-22T08:30:00Z"
    }
  ]
}
```

### 2. Detailed Rejections
```http
GET /api/rejections/detailed?page=1&limit=50&reason=BLURRY&customer=1450060367
```

**Response:**
```json
{
  "data": [
    {
      "_id": "uuid-here",
      "chatId": 1450060367,
      "fullName": "John Doe",
      "amountInKHR": 50000,
      "rejectionReason": "BLURRY",
      "rejectedAt": "2026-01-22T10:15:00Z",
      "rejectedBy": "auto_verification",
      "confidence": "low",
      "screenshotUrl": "/screenshots/gridfs/screenshot-id",
      "rejectionMetadata": {
        "confidenceScore": "low",
        "extractedData": {...},
        "verificationChecks": {...}
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "pages": 2
  }
}
```

### 3. Customer Rejection Analysis
```http
GET /api/rejections/customer/1450060367
```

**Response:**
```json
{
  "chatId": 1450060367,
  "rejections": [...],
  "analysis": {
    "totalRejected": 5,
    "totalAttempts": 8,
    "rejectionRate": 62.5,
    "reasonBreakdown": {
      "BLURRY": 3,
      "AMOUNT_MISMATCH": 2
    },
    "suspiciousPatterns": ["High rejection rate"]
  }
}
```

### 4. Analytics Dashboard
```http
GET /api/rejections/analytics?period=7d
```

**Response:**
```json
{
  "period": "7d",
  "dailyTrend": [
    {
      "_id": {"year": 2026, "month": 1, "day": 22},
      "count": 8,
      "totalAmount": 400000
    }
  ],
  "topRejectedCustomers": [...],
  "hourlyPattern": [...],
  "metrics": {
    "totalRejections": 50,
    "manualApprovals": 5,
    "falsePositiveRate": 10.0
  }
}
```

### 5. Export Rejections
```http
GET /api/rejections/export?format=xlsx&startDate=2026-01-01&reason=BLURRY
```

**Excel Export:** Downloads Excel file with all rejection data
**JSON Export:** Add `format=json` for JSON response

### 6. Manual Review
```http
POST /api/rejections/{paymentId}/review
Content-Type: application/json

{
  "action": "approve",
  "notes": "Clear image upon manual review",
  "reviewedBy": "admin_user"
}
```

**Response:**
```json
{
  "success": true,
  "action": "approve",
  "paymentId": "uuid-here",
  "updatedFields": {
    "verificationStatus": "verified",
    "reviewedAt": "2026-01-22T11:00:00Z",
    "reviewAction": "approve"
  }
}
```

---

## Rejection Reasons Reference

| Code | Description | Category | Severity | User Action |
|------|-------------|----------|----------|-------------|
| `NOT_BANK_STATEMENT` | Image is not a bank statement | invalid_document | low | Silent rejection |
| `BLURRY` | Image is unclear/blurry | image_quality | medium | Ask for clearer image |
| `WRONG_RECIPIENT` | Payment to wrong account | verification_failed | high | Show correct account |
| `OLD_SCREENSHOT` | Screenshot timestamp too old | fraud_prevention | high | Request recent receipt |
| `DUPLICATE_TRANSACTION` | Transaction already used | fraud_prevention | critical | Alert about duplicate |
| `AMOUNT_MISMATCH` | Amount doesn't match expected | verification_failed | medium | Show received amount |
| `MANUAL_REJECTION` | Manually rejected by auditor | manual_review | high | Generic rejection message |

---

## Enhanced Database Schema

### Rejection Metadata Structure
```javascript
{
  // Standard payment fields...

  // Enhanced rejection tracking
  "rejectedAt": "2026-01-22T10:15:00Z",
  "rejectedBy": "auto_verification", // or username
  "rejectionReason": "BLURRY",

  // Detailed audit information
  "rejectionMetadata": {
    "confidenceScore": "low",
    "extractedData": {
      "amount": 50000,
      "bankName": "ACLEDA",
      "transactionId": "TXN123",
      "toAccount": "123456789",
      "recipientName": "Business Name"
    },
    "verificationChecks": {
      "recipientVerified": false,
      "amountVerified": true,
      "duplicateCheck": false,
      "timestampCheck": false
    },
    "userAgent": {
      "id": 1450060367,
      "username": "johndoe",
      "firstName": "John",
      "lastName": "Doe"
    }
  },

  // Manual review tracking
  "reviewedAt": "2026-01-22T11:00:00Z",
  "reviewedBy": "admin_user",
  "reviewNotes": "Approved after manual review",
  "reviewAction": "approve" // or "confirm_rejection"
}
```

---

## Usage Examples

### 1. Daily Rejection Report
```bash
# Get summary for yesterday
curl "http://localhost:3000/api/rejections/summary?startDate=2026-01-21&endDate=2026-01-22"

# Export to Excel
curl "http://localhost:3000/api/rejections/export?startDate=2026-01-21&endDate=2026-01-22" \
  -o daily_rejections.xlsx
```

### 2. Customer Investigation
```bash
# Check specific customer's rejection history
curl "http://localhost:3000/api/rejections/customer/1450060367"

# Get all their payment attempts (rejected and verified)
curl "http://localhost:3000/api/customer/1450060367/payments"
```

### 3. Fraud Pattern Detection
```bash
# Get analytics with suspicious patterns
curl "http://localhost:3000/api/rejections/analytics?period=30d"

# Check customers with high rejection rates
curl "http://localhost:3000/api/rejections/detailed?sortBy=rejectionRate&limit=10"
```

### 4. Manual Review Workflow
```bash
# Get pending/rejected payments for review
curl "http://localhost:3000/api/rejections/detailed?page=1&limit=10"

# Approve a false positive
curl -X POST "http://localhost:3000/api/rejections/payment-id-here/review" \
  -H "Content-Type: application/json" \
  -d '{"action":"approve","notes":"Clear image upon review","reviewedBy":"admin"}'
```

---

## Monitoring & Alerts

### Key Metrics to Monitor
- **Daily rejection rate** (target: <20%)
- **False positive rate** (target: <5%)
- **Manual review queue size** (target: <10 pending)
- **Top rejection reasons** (optimize OCR for common issues)
- **Suspicious customer patterns** (fraud detection)

### Recommended Alerts
```bash
# High rejection rate alert (>30%)
curl "http://localhost:3000/api/rejections/summary?startDate=today" | \
  jq '.summary.rejectionRate > 30'

# False positive rate alert (>10%)
curl "http://localhost:3000/api/rejections/analytics?period=7d" | \
  jq '.metrics.falsePositiveRate > 10'

# Suspicious customer alert
curl "http://localhost:3000/api/rejections/analytics?period=7d" | \
  jq '.topRejectedCustomers[] | select(.rejectionRate > 80)'
```

---

## Testing the System

### 1. Run the Test Script
```bash
cd /mnt/d/scriptclient
node scripts/test-rejection-api.js
```

### 2. Manual Testing
```bash
# Check if service is running
curl http://localhost:3000/health

# Test each endpoint
curl http://localhost:3000/api/rejections/summary
curl http://localhost:3000/api/rejections/detailed?limit=5
curl http://localhost:3000/api/rejections/analytics?period=7d
```

### 3. Integration with Existing System
The rejection audit system integrates seamlessly with:
- ✅ **Existing payment verification** (enhanced metadata)
- ✅ **Telegram bot commands** (manual review via `/reject`)
- ✅ **Export functionality** (enhanced Excel exports)
- ✅ **Fraud detection** (duplicate/old screenshot alerts)

---

## Performance Considerations

### Database Indexing
```javascript
// Recommended MongoDB indexes for optimal performance
db.payments.createIndex({ "verificationStatus": 1, "createdAt": -1 })
db.payments.createIndex({ "chatId": 1, "verificationStatus": 1 })
db.payments.createIndex({ "rejectionReason": 1, "createdAt": -1 })
db.payments.createIndex({ "rejectedAt": -1 })
```

### Query Optimization
- **Date ranges**: Always specify date ranges for large datasets
- **Pagination**: Use pagination for detailed lists (default limit: 50)
- **Aggregation**: Use MongoDB aggregation pipeline for analytics
- **Caching**: Consider caching analytics results for frequently accessed data

---

## Security & Compliance

### Audit Trail
- ✅ **Complete audit trail** for all manual interventions
- ✅ **Immutable logs** (no deletion, only status updates)
- ✅ **User tracking** (who made what decision when)
- ✅ **Change history** (before/after values for reviews)

### Data Privacy
- 🔒 **No sensitive data** in logs or error messages
- 🔒 **Encrypted screenshot storage** (GridFS + local files)
- 🔒 **Access control** (API endpoints need proper authentication)
- 🔒 **Data retention** (consider purging old rejection data)

### Compliance Features
- 📋 **Export capabilities** for regulatory reporting
- 📋 **Detailed timestamps** in UTC format
- 📋 **Reason classification** for compliance categories
- 📋 **False positive tracking** for accuracy reporting

---

## Next Steps & Enhancements

### Phase 2 Improvements
1. **Real-time dashboard** (web interface for rejection analytics)
2. **Email notifications** (alerts for high rejection rates)
3. **Machine learning** (improve OCR accuracy based on rejection patterns)
4. **Automated review** (AI-powered second opinion for borderline cases)
5. **Customer communication** (proactive help for frequently rejected customers)

### Integration Opportunities
1. **Business intelligence** (Power BI/Tableau connectors)
2. **Slack/Teams alerts** (notification channels for admins)
3. **Mobile app** (auditor review interface)
4. **API webhooks** (real-time rejection notifications)

---

## Support & Troubleshooting

### Common Issues
1. **High false positive rate**: Tune OCR confidence thresholds
2. **Missing rejections**: Check date filters and pagination
3. **Slow analytics**: Add database indexes, use smaller date ranges
4. **Export failures**: Check disk space and memory limits

### Debug Commands
```bash
# Check database connection
curl http://localhost:3000/status

# Verify rejection data exists
curl "http://localhost:3000/api/rejections/summary" | jq '.summary'

# Check specific customer
curl "http://localhost:3000/api/rejections/customer/YOUR_CHAT_ID"

# Test export functionality
curl "http://localhost:3000/api/rejections/export?limit=5&format=json"
```

### Logging
Monitor these log patterns in the application:
- `📊 Rejection summary error` - Analytics endpoint issues
- `❌ Payment review error` - Manual review problems
- `💥 Error generating rejection report` - Report generation failures
- `✅ REJECTED` - Successful manual rejections via Telegram

---

*Last Updated: January 22, 2026*
*Version: 1.0.0*
*Author: Claude Code Assistant*