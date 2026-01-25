const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testOCR(imagePath) {
  try {
    console.log('🔍 Testing OCR on payment screenshot...');
    console.log('📁 Image path:', imagePath);

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    console.log('📤 Sending to GPT-4o Vision API...');

    // Call GPT-4o Vision API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this payment screenshot and extract the following information in JSON format:
{
  "isPaid": true/false (whether this is a valid payment confirmation),
  "amount": number (the payment amount, use positive number),
  "currency": "string (USD, KHR, etc)",
  "transactionId": "string",
  "referenceNumber": "string",
  "fromAccount": "string (sender account number or name)",
  "toAccount": "string (recipient account number)",
  "bankName": "string (e.g., ABA Bank)",
  "transactionDate": "string (ISO format if possible)",
  "remark": "string (any notes or remarks)",
  "recipientName": "string (if visible)",
  "confidence": "high/medium/low (your confidence in the extraction)"
}

If this is NOT a payment screenshot, set isPaid to false. Only mark isPaid as true if you can clearly identify it as a valid payment/transfer confirmation.`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 1000
    });

    const aiResponse = response.choices[0].message.content;
    console.log('\n🤖 AI Response:');
    console.log('═══════════════════════════════════════');
    console.log(aiResponse);
    console.log('═══════════════════════════════════════\n');

    // Parse JSON response
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const paymentData = JSON.parse(jsonMatch[0]);
        console.log('✅ Parsed Payment Data:');
        console.log(JSON.stringify(paymentData, null, 2));
        console.log('\n📊 Summary:');
        console.log(`   Payment Status: ${paymentData.isPaid ? '✅ PAID' : '❌ NOT PAID'}`);
        console.log(`   Amount: ${paymentData.amount} ${paymentData.currency || ''}`);
        console.log(`   Transaction ID: ${paymentData.transactionId || 'N/A'}`);
        console.log(`   To Account: ${paymentData.toAccount || 'N/A'}`);
        console.log(`   Bank: ${paymentData.bankName || 'N/A'}`);
        console.log(`   Date: ${paymentData.transactionDate || 'N/A'}`);
        console.log(`   Confidence: ${paymentData.confidence || 'N/A'}`);
      } else {
        console.error('❌ No JSON found in response');
      }
    } catch (parseError) {
      console.error('❌ Failed to parse JSON:', parseError.message);
    }

  } catch (error) {
    console.error('❌ OCR Test Failed:', error.message);
    if (error.response) {
      console.error('API Error:', error.response.data);
    }
  }
}

// Usage: node src/test-ocr.js <path-to-image>
const imagePath = process.argv[2];

if (!imagePath) {
  console.error('❌ Usage: node src/test-ocr.js <path-to-image>');
  console.log('Example: node src/test-ocr.js ./screenshots/test-payment.jpg');
  process.exit(1);
}

if (!fs.existsSync(imagePath)) {
  console.error(`❌ File not found: ${imagePath}`);
  process.exit(1);
}

testOCR(imagePath);
