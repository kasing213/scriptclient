#!/usr/bin/env node

/**
 * Test script for rejection audit API endpoints
 * Usage: node scripts/test-rejection-api.js
 */

const https = require('https');
const http = require('http');

// Configuration
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_CHAT_ID = process.env.TEST_CHAT_ID || '1450060367'; // Replace with actual test chat ID

/**
 * Make HTTP request
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method
 * @param {Object} data - Request body for POST requests
 * @returns {Promise} Response data
 */
function makeRequest(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${endpoint}`);
    const client = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data && method !== 'GET') {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Test all rejection API endpoints
 */
async function testRejectionAPI() {
  console.log('🧪 Testing Rejection Audit API Endpoints');
  console.log('=' .repeat(50));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test Chat ID: ${TEST_CHAT_ID}`);
  console.log('');

  const tests = [
    {
      name: 'Health Check',
      endpoint: '/health',
      description: 'Verify API is running'
    },
    {
      name: 'Rejection Summary',
      endpoint: '/api/rejections/summary',
      description: 'Get overall rejection statistics'
    },
    {
      name: 'Rejection Summary (7 days)',
      endpoint: '/api/rejections/summary?startDate=2026-01-15&endDate=2026-01-22',
      description: 'Get rejection stats for specific date range'
    },
    {
      name: 'Detailed Rejections',
      endpoint: '/api/rejections/detailed?limit=5',
      description: 'Get paginated list of rejected payments'
    },
    {
      name: 'Customer Rejection History',
      endpoint: `/api/rejections/customer/${TEST_CHAT_ID}`,
      description: `Get rejection history for customer ${TEST_CHAT_ID}`
    },
    {
      name: 'Rejection Analytics',
      endpoint: '/api/rejections/analytics?period=7d',
      description: 'Get rejection trends and patterns'
    },
    {
      name: 'Export Rejections (JSON)',
      endpoint: '/api/rejections/export?format=json&limit=3',
      description: 'Export rejections in JSON format (limited)'
    }
  ];

  for (const test of tests) {
    try {
      console.log(`🔍 ${test.name}`);
      console.log(`   ${test.description}`);
      console.log(`   GET ${test.endpoint}`);

      const result = await makeRequest(test.endpoint);

      if (result.status === 200) {
        console.log(`   ✅ Success (${result.status})`);

        // Show summary of response
        if (typeof result.data === 'object') {
          if (result.data.summary) {
            console.log(`      Summary: ${JSON.stringify(result.data.summary)}`);
          } else if (result.data.data && Array.isArray(result.data.data)) {
            console.log(`      Records: ${result.data.data.length}`);
          } else if (result.data.length !== undefined) {
            console.log(`      Records: ${result.data.length}`);
          } else {
            const keys = Object.keys(result.data);
            console.log(`      Keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
          }
        }
      } else {
        console.log(`   ❌ Failed (${result.status})`);
        console.log(`      ${JSON.stringify(result.data)}`);
      }

    } catch (error) {
      console.log(`   💥 Error: ${error.message}`);
    }

    console.log('');
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
  }

  console.log('🧪 Testing POST endpoints');
  console.log('-'.repeat(30));

  // Test review endpoint (if we have test data)
  try {
    // First, get a rejected payment to test with
    const rejectionsResponse = await makeRequest('/api/rejections/detailed?limit=1');

    if (rejectionsResponse.status === 200 && rejectionsResponse.data.data && rejectionsResponse.data.data.length > 0) {
      const testPayment = rejectionsResponse.data.data[0];
      console.log(`🔍 Testing Review Endpoint`);
      console.log(`   Testing with payment ID: ${testPayment._id}`);

      const reviewResult = await makeRequest(
        `/api/rejections/${testPayment._id}/review`,
        'POST',
        {
          action: 'confirm_rejection',
          notes: 'API test - confirming rejection',
          reviewedBy: 'test_script'
        }
      );

      if (reviewResult.status === 200) {
        console.log(`   ✅ Review endpoint works (${reviewResult.status})`);
        console.log(`      Action: ${reviewResult.data.action}`);
      } else {
        console.log(`   ⚠️  Review response (${reviewResult.status}): ${JSON.stringify(reviewResult.data)}`);
      }
    } else {
      console.log(`   ℹ️  No rejected payments found to test review endpoint`);
    }

  } catch (error) {
    console.log(`   💥 Review test error: ${error.message}`);
  }

  console.log('');
  console.log('✅ API testing completed!');
  console.log('');
  console.log('📋 Available endpoints:');
  console.log('   GET  /api/rejections/summary');
  console.log('   GET  /api/rejections/detailed');
  console.log('   GET  /api/rejections/customer/:chatId');
  console.log('   GET  /api/rejections/analytics');
  console.log('   GET  /api/rejections/export');
  console.log('   POST /api/rejections/:paymentId/review');
}

// Run tests
if (require.main === module) {
  testRejectionAPI().catch(console.error);
}

module.exports = { testRejectionAPI, makeRequest };