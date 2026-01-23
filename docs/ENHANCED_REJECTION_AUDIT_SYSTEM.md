# Enhanced Rejection Audit System - ScriptClient Documentation

## Overview

The Enhanced Rejection Audit System provides comprehensive tracking, analytics, and reporting for rejected bank statement payments in the ScriptClient bot. This system includes advanced fraud detection, pattern analysis, and complete audit trails.

## System Status: ✅ LIVE & OPERATIONAL

**Server:** Running on http://localhost:3000
**Database:** MongoDB connected with 215+ rejection records
**Rejection Rate:** 31.2% (215/689 total payments)

---

## 🔍 Key Features Implemented

### 1. **Enhanced Database Tracking**
- **Detailed metadata** for each rejection including confidence scores
- **Complete audit trail** for manual reviews and approvals
- **User tracking** showing who made decisions and when
- **Verification checks breakdown** for debugging

### 2. **Advanced Analytics & Reports**
- **Rejection rate analysis** by customer and time period
- **Pattern detection** for fraud prevention (duplicates, old screenshots)
- **False positive tracking** to improve system accuracy
- **Suspicious customer identification** with risk scoring

### 3. **API Endpoints for Business Intelligence**
- **Summary statistics** with date filtering
- **Detailed rejection lists** with pagination and search
- **Customer analysis** with fraud pattern detection
- **Export capabilities** (Excel/JSON) for reporting
- **Manual review system** for edge cases

---

## 📊 API Endpoints Reference

### Core Statistics
```http
GET /api/rejections/summary
GET /api/rejections/summary?startDate=2026-01-01&endDate=2026-01-22
```
**Response:** Total rejections, rejection rate, breakdown by reason

### Detailed Data
```http
GET /api/rejections/detailed?page=1&limit=50
GET /api/rejections/detailed?reason=BLURRY&customer=123456789
```
**Response:** Paginated rejection list with full metadata

### Customer Analysis
```http
GET /api/rejections/customer/1450060367
```
**Response:** Individual customer rejection history with pattern analysis

### Analytics Dashboard
```http
GET /api/rejections/analytics?period=30d
```
**Response:** Trends, patterns, top rejected customers, hourly analysis

### Data Export
```http
GET /api/rejections/export?format=xlsx&startDate=2026-01-01
GET /api/rejections/export?format=json&reason=OLD_SCREENSHOT
```
**Response:** Excel file or JSON data for external analysis

### Manual Review
```http
POST /api/rejections/{paymentId}/review
Content-Type: application/json

{
  "action": "approve",
  "notes": "Clear image upon manual review",
  "reviewedBy": "admin_user"
}
```
**Response:** Updates payment status and notifies customer

---

## 🎯 Rejection Reasons & Categories

| Code | Description | Category | Severity | User Message |
|------|-------------|----------|----------|--------------|
| `NOT_BANK_STATEMENT` | Not a bank statement image | invalid_document | Low | Silent rejection |
| `BLURRY` | Image unclear/blurry | image_quality | Medium | Ask for clearer image |
| `WRONG_RECIPIENT` | Payment to wrong account | verification_failed | High | Show correct account |
| `OLD_SCREENSHOT` | Screenshot too old | fraud_prevention | High | Request recent receipt |
| `DUPLICATE_TRANSACTION` | Transaction already used | fraud_prevention | Critical | Alert about duplicate |
| `AMOUNT_MISMATCH` | Amount doesn't match | verification_failed | Medium | Show received amount |
| `MANUAL_REJECTION` | Manually rejected by auditor | manual_review | High | Generic rejection |

---

## 📈 Current System Statistics

**Live Data (as of implementation):**
- **Total Payments:** 689
- **Total Rejections:** 215
- **Rejection Rate:** 31.2%
- **Top Rejection Reason:** NOT_BANK_STATEMENT (91 cases)
- **Fraud Detections:** OLD_SCREENSHOT, DUPLICATE_TRANSACTION

---

## 🛠️ Technical Implementation

### Database Schema Enhancement
```javascript
{
  // Standard payment fields...
  "rejectedAt": "2026-01-22T10:15:00Z",
  "rejectedBy": "auto_verification",
  "rejectionReason": "BLURRY",

  // Enhanced audit metadata
  "rejectionMetadata": {
    "confidenceScore": "low",
    "extractedData": { /* OCR results */ },
    "verificationChecks": { /* validation results */ },
    "userAgent": { /* Telegram user info */ }
  },

  // Manual review tracking
  "reviewedAt": "2026-01-22T11:00:00Z",
  "reviewedBy": "admin_user",
  "reviewNotes": "Approved after manual review",
  "reviewAction": "approve"
}
```

### Files Created/Modified
| File | Purpose |
|------|---------|
| `src/botfetch.js` | Enhanced with 6 new API endpoints |
| `src/rejection-analytics.js` | Analytics module for patterns/trends |
| `scripts/test-rejection-api.js` | API testing and validation |
| `docs/REJECTION_AUDIT_GUIDE.md` | Complete user guide |

---

## 🔧 Usage Examples

### Daily Operations
```bash
# Check today's rejection rate
curl "http://localhost:3000/api/rejections/summary?startDate=2026-01-22"

# Export rejections for review
curl "http://localhost:3000/api/rejections/export?format=xlsx" -o daily_rejections.xlsx

# Check suspicious customers
curl "http://localhost:3000/api/rejections/analytics?period=7d"
```

### Manual Review Workflow
```bash
# Get pending rejections
curl "http://localhost:3000/api/rejections/detailed?limit=10"

# Approve false positive
curl -X POST "http://localhost:3000/api/rejections/PAYMENT_ID/review" \
  -H "Content-Type: application/json" \
  -d '{"action":"approve","notes":"Clear image","reviewedBy":"admin"}'
```

### Fraud Investigation
```bash
# Check specific customer
curl "http://localhost:3000/api/rejections/customer/CHAT_ID"

# Get duplicate transaction alerts
curl "http://localhost:3000/api/rejections/detailed?reason=DUPLICATE_TRANSACTION"
```

---

## 🔒 Security & Compliance

### Audit Trail
- ✅ **Complete audit trail** for all manual interventions
- ✅ **Immutable logs** (no deletion, only status updates)
- ✅ **User tracking** (who made what decision when)
- ✅ **Change history** (before/after values for reviews)

### Data Privacy
- 🔒 **No sensitive data** in logs or error messages
- 🔒 **Encrypted screenshot storage** (GridFS + local files)
- 🔒 **Access control** (API endpoints need authentication)
- 🔒 **Data retention** (configurable purging policies)

---

## 🚀 Performance & Monitoring

### Key Metrics to Track
- **Daily rejection rate** (target: <20%)
- **False positive rate** (target: <5%)
- **Manual review queue size** (target: <10 pending)
- **Top rejection reasons** (optimize OCR accordingly)
- **Suspicious customer patterns** (fraud prevention)

### Database Optimization
```javascript
// Recommended MongoDB indexes for performance
db.payments.createIndex({ "verificationStatus": 1, "createdAt": -1 })
db.payments.createIndex({ "chatId": 1, "verificationStatus": 1 })
db.payments.createIndex({ "rejectionReason": 1, "createdAt": -1 })
db.payments.createIndex({ "rejectedAt": -1 })
```

---

## 🎯 Business Benefits

### For Operations Team
- **Identify fraud patterns** before they scale
- **Optimize OCR accuracy** based on rejection data
- **Track system performance** with detailed metrics
- **Reduce manual review workload** with better automation

### For Management
- **Compliance reporting** with complete audit trails
- **Performance analytics** for system optimization
- **Fraud prevention** with pattern detection
- **Cost optimization** by reducing false positives

### For Customers
- **Faster resolution** of false positive rejections
- **Better feedback** on why payments were rejected
- **Improved success rate** through system optimization
- **Transparent process** with clear rejection reasons

---

## 📞 Support & Troubleshooting

### Common Issues
- **High rejection rate:** Check OCR confidence thresholds
- **Missing data:** Verify date filters and pagination
- **Slow queries:** Add database indexes for large datasets
- **Export failures:** Check memory limits for large exports

### Monitoring Commands
```bash
# System health
curl http://localhost:3000/health

# Current rejection rate
curl "http://localhost:3000/api/rejections/summary" | grep rejectionRate

# Check for issues
curl http://localhost:3000/status
```

---

**Last Updated:** January 22, 2026
**Version:** 1.0.0
**Status:** Production Ready
**Maintainer:** ScriptClient Team