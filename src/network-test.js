const https = require('https');
const dns = require('dns');
const { promisify } = require('util');

console.log('🌐 Network Connectivity Test');
console.log('==========================');

const resolveDNS = promisify(dns.resolve);

async function testNetwork() {
  console.log('\n1️⃣ Testing basic internet connectivity...');
  
  // Test general internet
  try {
    const response = await fetch('https://httpbin.org/get');
    console.log('✅ General internet: OK');
  } catch (error) {
    console.error('❌ General internet: Failed -', error.message);
  }

  console.log('\n2️⃣ Testing Telegram API reachability...');
  
  // Test Telegram API directly
  try {
    const response = await fetch('https://api.telegram.org');
    console.log('✅ Telegram API: OK (Status:', response.status, ')');
  } catch (error) {
    console.error('❌ Telegram API: Failed -', error.message);
  }

  console.log('\n3️⃣ Testing DNS resolution...');
  
  try {
    const addresses = await resolveDNS('api.telegram.org');
    console.log('✅ DNS resolution: OK -', addresses);
  } catch (error) {
    console.error('❌ DNS resolution: Failed -', error.message);
  }

  console.log('\n4️⃣ Testing with different DNS servers...');
  
  const dnsServers = [
    '8.8.8.8',    // Google DNS
    '1.1.1.1',    // Cloudflare DNS
    '208.67.222.222' // OpenDNS
  ];

  for (const dnsServer of dnsServers) {
    try {
      dns.setServers([dnsServer]);
      const addresses = await resolveDNS('api.telegram.org');
      console.log(`✅ DNS ${dnsServer}: OK -`, addresses);
    } catch (error) {
      console.error(`❌ DNS ${dnsServer}: Failed -`, error.message);
    }
  }

  console.log('\n5️⃣ Testing connection with different timeouts...');
  
  const timeouts = [5000, 10000, 30000];
  
  for (const timeout of timeouts) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch('https://api.telegram.org/bot123456:test/getMe', {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      console.log(`✅ Timeout ${timeout}ms: OK`);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(`❌ Timeout ${timeout}ms: Timed out`);
      } else {
        console.error(`❌ Timeout ${timeout}ms: Failed -`, error.message);
      }
    }
  }

  console.log('\n6️⃣ Testing IPv4 vs IPv6...');
  
  // Force IPv4
  try {
    const response = await fetch('https://api.telegram.org', {
      headers: { 'Host': 'api.telegram.org' }
    });
    console.log('✅ IPv4 connection: OK');
  } catch (error) {
    console.error('❌ IPv4 connection: Failed -', error.message);
  }

  console.log('\n7️⃣ Checking for proxy/firewall issues...');
  
  // Test if we can reach other HTTPS sites
  const testSites = [
    'https://google.com',
    'https://github.com',
    'https://cloudflare.com'
  ];

  for (const site of testSites) {
    try {
      const response = await fetch(site);
      console.log(`✅ ${site}: OK`);
    } catch (error) {
      console.error(`❌ ${site}: Failed -`, error.message);
    }
  }

  console.log('\n📊 Network Analysis Complete');
  console.log('==========================');
  console.log('If Telegram API fails but other sites work, it might be:');
  console.log('1. Regional blocking of Telegram');
  console.log('2. Corporate firewall blocking Telegram');
  console.log('3. ISP blocking Telegram');
  console.log('4. VPN interference');
}

testNetwork(); 