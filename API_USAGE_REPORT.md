# OpenAI API Usage Report
## Payment Automation System

**Date:** October 2025
**Department:** Payment Processing
**System:** Automated Payment Verification & Reminder System

---

## Executive Summary

This system uses OpenAI's GPT models to automate payment verification and customer reminders in Khmer language, reducing manual work and improving payment collection efficiency.

---

## API Usage Breakdown

### 1. Payment Screenshot OCR Analysis
**Model:** GPT-4o (Vision)
**Purpose:** Extract payment information from customer screenshots
**Frequency:** Per screenshot upload

#### Token Usage Per Request
- **Input Tokens:** ~1,200 tokens (includes base64 image + prompt)
- **Output Tokens:** ~300 tokens (JSON response with payment details)
- **Total:** ~1,500 tokens per screenshot

#### Cost Per Request
- Input: 1,200 tokens × $0.0025/1K = **$0.003**
- Output: 300 tokens × $0.010/1K = **$0.003**
- **Total: $0.006 per screenshot**

#### Extracted Information
- Payment amount & currency
- Bank name & transaction ID
- Sender/recipient account
- Transaction date
- Confidence level
- Verification status

---

### 2. Payment Reminder Messages
**Model:** GPT-4o-mini
**Purpose:** Generate personalized Khmer language reminders
**Frequency:** Once per overdue payment (max 1/day per customer)

#### Token Usage Per Request
- **Input Tokens:** ~100 tokens (customer info + prompt)
- **Output Tokens:** ~100 tokens (Khmer message 2-3 sentences)
- **Total:** ~200 tokens per reminder

#### Cost Per Request
- Input: 100 tokens × $0.00015/1K = **$0.000015**
- Output: 100 tokens × $0.0006/1K = **$0.00006**
- **Total: $0.000075 per reminder**

---

## Monthly Cost Projections

### Scenario 1: Small Scale (100 customers)
| Item | Quantity/Month | Unit Cost | Monthly Cost |
|------|----------------|-----------|--------------|
| Payment OCR | 100 screenshots | $0.006 | $0.60 |
| Reminders (UNPAID) | 20 reminders | $0.000075 | $0.0015 |
| Reminders (PENDING) | 30 reminders | $0.000075 | $0.00225 |
| **TOTAL** | | | **$0.60/month** |

### Scenario 2: Medium Scale (500 customers)
| Item | Quantity/Month | Unit Cost | Monthly Cost |
|------|----------------|-----------|--------------|
| Payment OCR | 500 screenshots | $0.006 | $3.00 |
| Reminders (UNPAID) | 100 reminders | $0.000075 | $0.0075 |
| Reminders (PENDING) | 150 reminders | $0.000075 | $0.01125 |
| **TOTAL** | | | **$3.02/month** |

### Scenario 3: Large Scale (1,000 customers)
| Item | Quantity/Month | Unit Cost | Monthly Cost |
|------|----------------|-----------|--------------|
| Payment OCR | 1,000 screenshots | $0.006 | $6.00 |
| Reminders (UNPAID) | 200 reminders | $0.000075 | $0.015 |
| Reminders (PENDING) | 300 reminders | $0.000075 | $0.0225 |
| **TOTAL** | | | **$6.04/month** |

### Scenario 4: Enterprise Scale (5,000 customers)
| Item | Quantity/Month | Unit Cost | Monthly Cost |
|------|----------------|-----------|--------------|
| Payment OCR | 5,000 screenshots | $0.006 | $30.00 |
| Reminders (UNPAID) | 1,000 reminders | $0.000075 | $0.075 |
| Reminders (PENDING) | 1,500 reminders | $0.000075 | $0.1125 |
| **TOTAL** | | | **$30.19/month** |

---

## Annual Cost Projections

| Scale | Monthly Cost | Annual Cost |
|-------|--------------|-------------|
| Small (100) | $0.60 | **$7.20** |
| Medium (500) | $3.02 | **$36.24** |
| Large (1,000) | $6.04 | **$72.48** |
| Enterprise (5,000) | $30.19 | **$362.28** |

---

## Cost Optimization Features

### Already Implemented
1. **Rate Limiting**: Max 10 OCR requests/minute to prevent API abuse
2. **GPT-4o-mini for Reminders**: 20x cheaper than GPT-4o
3. **Duplicate Prevention**: No redundant reminders within 24 hours
4. **Fallback Templates**: Free Khmer templates if AI fails
5. **Batch Processing**: Queue system for efficient processing

### Configuration Options
```env
# Reduce reminder frequency
CHECK_INTERVAL_HOURS=48        # Check every 2 days (50% savings)

# Increase warning threshold
PENDING_WARNING_DAYS=7         # Wait longer before reminding

# Adjust rate limits
OPENAI_MAX_REQUESTS_PER_MIN=5  # Slower processing (cost unchanged)
```

---

## ROI Analysis

### Manual Processing Costs (Current)
- Staff time: 5 min per payment verification
- Hourly rate: $10/hour
- Cost per payment: **$0.83**
- 100 payments/month: **$83.00**

### Automated Processing Costs (Proposed)
- API cost: $0.006 per payment
- 100 payments/month: **$0.60**

### **Monthly Savings: $82.40 (99% reduction)**

### Additional Benefits
- ✅ 24/7 automated processing
- ✅ Instant verification (vs 5-10 minutes manual)
- ✅ Reduced human error
- ✅ Automatic Khmer communication
- ✅ Complete audit trail in database

---

## Risk Mitigation

### Cost Control Measures
1. **Rate Limiting**: Prevents runaway API usage
2. **Error Handling**: Graceful fallbacks prevent repeated failures
3. **Monitoring**: Console logs track all API calls
4. **Timeout Protection**: 60s timeout prevents hanging requests

### Failure Scenarios
| Scenario | Impact | Mitigation |
|----------|--------|------------|
| API Down | Payment processing stops | Fallback to manual verification |
| API Rate Limit | Temporary delay | Queue system handles backlog |
| Out of Credits | System stops | Alert monitoring + auto-reload |
| Network Issues | Timeout after 60s | Retry mechanism + logging |

---

## Recommendations

### Short Term (Current Setup)
✅ **Proceed with current implementation**
- Cost is negligible (<$1/month for 100 customers)
- ROI is extremely high (99% cost reduction)
- System includes comprehensive safety measures

### Medium Term (If Scaling to 1,000+)
- Monitor usage via OpenAI dashboard
- Set up billing alerts at $20/month threshold
- Consider enterprise OpenAI pricing if exceeding $50/month

### Long Term (If Scaling to 10,000+)
- Negotiate volume pricing with OpenAI
- Consider fine-tuned model for payment OCR (lower cost)
- Implement additional caching for repeat queries

---

## Monitoring & Reporting

### Real-Time Monitoring
```bash
# View current usage
npm run scheduler  # Shows reminder count in logs
npm start         # Shows OCR processing in logs
```

### Monthly Usage Report
```bash
# Check MongoDB for actual usage
db.payments.count({ uploadedAt: { $gte: new Date('2025-10-01') } })
db.reminders.count({ sentAt: { $gte: new Date('2025-10-01') } })
```

### OpenAI Dashboard
- Login: https://platform.openai.com/usage
- View: Real-time token usage & costs
- Alerts: Set billing notifications

---

## Conclusion

**Total Monthly Cost: $0.60 - $30.00** (depending on scale)

The OpenAI API usage for this payment automation system is **minimal and highly cost-effective**. Even at enterprise scale (5,000 customers), the monthly cost is only **$30**, while providing significant operational efficiency and customer service improvements.

**Recommendation: APPROVE for production deployment**

---

## Appendix: API Pricing Reference

### OpenAI Pricing (as of 2025)
| Model | Input | Output |
|-------|--------|---------|
| GPT-4o | $0.0025/1K | $0.010/1K |
| GPT-4o-mini | $0.00015/1K | $0.0006/1K |

### Pricing Source
https://openai.com/api/pricing/

---

**Prepared by:** Development Team
**Review Status:** Pending Approval
**Next Review:** Q1 2026
