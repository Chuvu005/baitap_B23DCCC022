const http = require('http');
const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRequest(url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const parsed = new URL(url);
    const postData = body ? JSON.stringify(body) : null;

    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: method,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), duration });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, duration });
        }
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      reject({ error: err, duration });
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function isFeeServiceAlive() {
  try {
    const res = await makeRequest('http://localhost:4001/students/1/fees', 'GET');
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

let spawnedFeeProcess = null;

async function ensureFeeService() {
  const alive = await isFeeServiceAlive();
  if (alive) {
    console.log('[Setup] Fee Service đang chạy trên cổng 4001.');
    return null;
  }

  console.log('[Setup] Đang khởi động Fee Service trên cổng 4001...');
  spawnedFeeProcess = spawn('node', ['fee-service/index.js'], {
    env: { ...process.env, PORT: '4001', BANK_URL: process.env.BANK_URL || 'http://localhost:4002' },
    stdio: 'ignore',
  });

  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (await isFeeServiceAlive()) {
      console.log('[Setup] Fee Service đã sẵn sàng!');
      return spawnedFeeProcess;
    }
  }
  throw new Error('Không thể khởi động Fee Service trên cổng 4001');
}

function cleanupFeeService() {
  if (spawnedFeeProcess) {
    spawnedFeeProcess.kill();
    spawnedFeeProcess = null;
  }
}

module.exports = {
  makeRequest,
  sleep,
  ensureFeeService,
  cleanupFeeService,
  isFeeServiceAlive,
};
