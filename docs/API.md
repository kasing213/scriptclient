# Payment Verification Bot API

REST API for external integrations with the payment verification system.

## Base URL

```
http://localhost:3000
```

## Authentication

Protected endpoints require the `SCREENSHOT_DOWNLOAD_TOKEN` environment variable.

Pass token via:
- Query parameter: `?token=YOUR_TOKEN`
- Header: `Authorization: Bearer YOUR_TOKEN`

---

## Health & Status

### GET /health

Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-06T15:30:00.000Z",
  "uptime": 3600,
  "bot": "connected",
  "mongo": "connected"
}
```

### GET /status

Detailed system status.

**Response:**
```json
{
  "bot": {
    "status": "running",
    "strategy": "long-polling"
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
  "memory": { "heapUsed": 50000000 },
  "timestamp": "2026-01-06T15:30:00.000Z"
}
```

### GET /

Service information.

**Response:**
```json
{
  "service": "Payment Verification Bot",
  "version": "1.0.0",
  "status": "running"
}
```

---

## Customer Endpoints

### GET /customer/:chatId/status

Get payment status for a specific customer.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| chatId | number | Telegram chat ID |

**Response:**
```json
{
  "chatId": 123456789,
  "username": "john_doe",
  "fullName": "John Doe",
  "paymentStatus": "FULLY_PAID",
  "totalExpected": 100000,
  "totalPaid": 100000,
  "remainingBalance": 0,
  "payments": [...]
}
```

**Errors:**
- `400` - Invalid chatId
- `404` - Customer not found

### GET /customers/summary

Get all customers with payment summary.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| status | string | Filter by status: `FULLY_PAID`, `PARTIAL_PAID`, `NOT_PAID`, `OVERPAID` |

**Response:**
```json
{
  "total": 150,
  "fullyPaid": 80,
  "partialPaid": 30,
  "notPaid": 35,
  "overpaid": 5,
  "totalExpected": 15000000,
  "totalPaid": 12000000,
  "totalRemaining": 3000000,
  "customers": [...]
}
```

### GET /customers/overdue

Get customers with overdue payments.

**Query Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| days | number | 3 | Days overdue threshold |

**Response:**
```json
{
  "daysOverdue": 3,
  "count": 12,
  "customers": [...]
}
```

---

## Fraud Detection

### GET /fraud/alerts

Get all fraud alerts.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| status | string | Filter by: `PENDING`, `CONFIRMED_FRAUD`, `FALSE_POSITIVE`, `APPROVED` |
| type | string | Filter by: `OLD_SCREENSHOT`, `INVALID_DATE`, `FUTURE_DATE`, `MISSING_DATE` |

**Response:**
```json
{
  "total": 25,
  "pending": 10,
  "confirmedFraud": 5,
  "falsePositives": 8,
  "approved": 2,
  "alerts": [
    {
      "alertId": "FA-20260106-123456",
      "fraudType": "OLD_SCREENSHOT",
      "severity": "HIGH",
      "chatId": 123456789,
      "username": "user123",
      "groupName": "Payment Group",
      "transactionId": "TRX123456",
      "reviewStatus": "PENDING",
      "detectedAt": "2026-01-06T10:30:00.000Z"
    }
  ]
}
```

### GET /fraud/alert/:alertId

Get specific fraud alert details.

**Response:**
```json
{
  "alertId": "FA-20260106-123456",
  "fraudType": "OLD_SCREENSHOT",
  "severity": "HIGH",
  "chatId": 123456789,
  "username": "user123",
  "transactionId": "TRX123456",
  "transactionDate": "2025-12-20T10:00:00.000Z",
  "screenshotAgeDays": 17,
  "reviewStatus": "PENDING",
  "detectedAt": "2026-01-06T10:30:00.000Z"
}
```

### POST /fraud/alert/:alertId/review

Review and resolve a fraud alert.

**Request Body:**
```json
{
  "reviewStatus": "CONFIRMED_FRAUD",
  "reviewedBy": "admin@company.com",
  "reviewNotes": "Confirmed reused receipt"
}
```

**Valid Review Statuses:**
- `PENDING` - Reset to pending
- `CONFIRMED_FRAUD` - Mark as confirmed fraud
- `FALSE_POSITIVE` - Mark as false positive (updates payment to PAID)
- `APPROVED` - Approve payment (updates payment to PAID)

**Response:**
```json
{
  "success": true,
  "message": "Fraud alert FA-20260106-123456 updated to CONFIRMED_FRAUD",
  "alertId": "FA-20260106-123456"
}
```

### GET /fraud/stats

Get fraud detection statistics.

**Response:**
```json
{
  "totalAlerts": 50,
  "pendingReview": 10,
  "byType": [
    { "_id": "OLD_SCREENSHOT", "count": 25 },
    { "_id": "INVALID_DATE", "count": 15 },
    { "_id": "FUTURE_DATE", "count": 10 }
  ],
  "recentAlerts": 8,
  "detectionRate": "5.2%"
}
```

---

## Screenshots

### GET /screenshots/:status

List screenshots by status. **Requires token.**

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| status | string | `verified`, `pending`, or `rejected` |

**Response:**
```json
{
  "status": "verified",
  "count": 45,
  "files": [
    "abc123-def456.jpg",
    "ghi789-jkl012.jpg"
  ]
}
```

### GET /screenshots/:status/:name

Download a specific screenshot. **Requires token.**

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| status | string | `verified`, `pending`, or `rejected` |
| name | string | Screenshot filename |

**Response:** Binary image file

---

## Export Endpoints

All export endpoints require token authentication and return Excel (.xlsx) files.

### GET /export/payments

Export all payments to Excel.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| token | string | Authentication token |

**Response:** Excel file download (`payments_YYYY-MM-DD.xlsx`)

**Columns:**
- chatId, userId, username, fullName, groupName
- paymentLabel, verificationStatus, rejectionReason
- amountInKHR, paymentAmount, currency, expectedAmountKHR
- transactionId, referenceNumber, transactionDate
- toAccount, recipientName, fromAccount, bankName
- isPaid, isVerified, isBankStatement, confidence
- uploadedAt, screenshotPath, remark

### GET /export/customers

Export all customers to Excel.

**Response:** Excel file download (`customers_YYYY-MM-DD.xlsx`)

### GET /export/fraud

Export all fraud alerts to Excel.

**Response:** Excel file download (`fraud_alerts_YYYY-MM-DD.xlsx`)

### GET /export/invoices

Export all invoice readings to Excel.

**Response:** Excel file download (`invoice_readings_YYYY-MM-DD.xlsx`)

### GET /export/all

Export all data (payments, customers, fraud alerts, invoices) to single Excel file with multiple sheets.

**Response:** Excel file download (`export_all_YYYY-MM-DD.xlsx`)

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message description"
}
```

**Common HTTP Status Codes:**
| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid or missing token |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |
| 503 | Service Unavailable - Feature disabled |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | API server port (default: 3000) |
| `SCREENSHOT_DOWNLOAD_TOKEN` | Token for protected endpoints |
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name (default: customerDB) |

---

## Example Usage

### cURL

```bash
# Health check
curl http://localhost:3000/health

# Get customer status
curl http://localhost:3000/customer/123456789/status

# Get fraud alerts (pending only)
curl "http://localhost:3000/fraud/alerts?status=PENDING"

# Review fraud alert
curl -X POST http://localhost:3000/fraud/alert/FA-20260106-123456/review \
  -H "Content-Type: application/json" \
  -d '{"reviewStatus": "CONFIRMED_FRAUD", "reviewedBy": "admin"}'

# Export payments (with token)
curl "http://localhost:3000/export/payments?token=YOUR_TOKEN" -o payments.xlsx

# List verified screenshots
curl "http://localhost:3000/screenshots/verified?token=YOUR_TOKEN"
```

### JavaScript/Node.js

```javascript
const axios = require('axios');

// Get customer summary
const response = await axios.get('http://localhost:3000/customers/summary');
console.log(`Total customers: ${response.data.total}`);
console.log(`Fully paid: ${response.data.fullyPaid}`);

// Export payments
const exportRes = await axios.get('http://localhost:3000/export/payments', {
  params: { token: 'YOUR_TOKEN' },
  responseType: 'arraybuffer'
});
fs.writeFileSync('payments.xlsx', exportRes.data);
```

### Python

```python
import requests

# Get fraud stats
response = requests.get('http://localhost:3000/fraud/stats')
stats = response.json()
print(f"Pending alerts: {stats['pendingReview']}")

# Review fraud alert
requests.post(
    'http://localhost:3000/fraud/alert/FA-20260106-123456/review',
    json={
        'reviewStatus': 'CONFIRMED_FRAUD',
        'reviewedBy': 'admin@company.com'
    }
)
```
