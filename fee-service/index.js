const express = require('express');
const http = require('http');
const { URL } = require('url');

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4001', 10);

// In-memory student database
// Sinh viên 1: nợ 50.000.000đ; 2: nợ 0; 3: nợ 3.200.000đ
const students = {
  1: { id: 1, name: 'Nguyen Van A', debt: 50000000 },
  2: { id: 2, name: 'Tran Thi B', debt: 0 },
  3: { id: 3, name: 'Le Van C', debt: 3200000 },
};

// Payment tracking
let paymentCounter = 0;
const payments = new Map();

// HTTP Agent with Keep-Alive connection pooling
const bankAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 30,
  maxFreeSockets: 30,
  keepAliveMsecs: 3500, // keep-alive packet interval
});

// Helper: Get Bank URL dynamically from environment
function getBankUrl() {
  return process.env.BANK_URL || 'http://localhost:4002';
}

// Low-level HTTP call to Bank Gateway with individual attempt timeout
function callBankOnce(bankUrlStr, payload, idempotencyKey, attemptTimeoutMs) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(bankUrlStr);
    const postData = JSON.stringify(payload);

    const options = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: '/charges',
      method: 'POST',
      agent: bankAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Idempotency-Key': idempotencyKey,
      },
    };

    let hasTimedOut = false;
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (err) {
          resolve({ statusCode: res.statusCode, data: { raw: data } });
        }
      });
    });

    // Handle attempt timeout
    req.setTimeout(attemptTimeoutMs, () => {
      hasTimedOut = true;
      req.destroy(new Error('REQUEST_TIMEOUT'));
    });

    req.on('error', (err) => {
      if (hasTimedOut) {
        reject(new Error('REQUEST_TIMEOUT'));
      } else {
        reject(err);
      }
    });

    req.write(postData);
    req.end();
  });
}

// Resilient caller with retries, timeout budget, and error classification
async function callBankWithResilience(payload, idempotencyKey) {
  const bankUrl = getBankUrl();
  const overallTimeoutMs = 4200; // Keep strictly under 4.5s requirement
  const startTime = Date.now();
  const maxRetries = 2; // Up to 3 attempts total

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt++;
    const elapsed = Date.now() - startTime;
    const remainingTime = overallTimeoutMs - elapsed;

    if (remainingTime <= 300) {
      // Out of time budget -> 504 PENDING
      return {
        httpStatus: 504,
        status: 'PENDING',
        error: 'Timeout waiting for bank response (overall timeout exceeded)',
      };
    }

    const attemptTimeout = Math.min(3800, remainingTime);

    try {
      const response = await callBankOnce(bankUrl, payload, idempotencyKey, attemptTimeout);

      // 1. Success from bank
      if (response.statusCode === 201) {
        return {
          httpStatus: 201,
          status: 'PAID',
          data: response.data,
        };
      }

      // 2. Explicit bank business rejection (e.g. 400, 402 exceed limit)
      // DO NOT RETRY!
      if (response.statusCode >= 400 && response.statusCode < 500) {
        return {
          httpStatus: response.statusCode,
          status: 'FAILED',
          error: (response.data && response.data.error) || 'Bank rejected payment',
        };
      }

      // 3. Transient Bank Server Error (e.g. 500)
      if (response.statusCode >= 500) {
        lastError = new Error(`Bank returned HTTP ${response.statusCode}`);
        // If we still have retries and time, retry
        if (attempt <= maxRetries && (Date.now() - startTime < overallTimeoutMs - 500)) {
          console.log(`[Fee Service] Bank returned ${response.statusCode}, retrying attempt ${attempt + 1}...`);
          await new Promise((r) => setTimeout(r, 60));
          continue;
        } else {
          return {
            httpStatus: 503,
            status: 'FAILED',
            error: (response.data && response.data.error) || 'Bank transient failure after retries',
          };
        }
      }
    } catch (err) {
      lastError = err;

      // Handle Connection Refused (Bank is down/offline)
      // "Chắc chắn chưa trừ tiền: 503 FAILED, Không kết nối được tới ngân hàng"
      if (err.code === 'ECONNREFUSED') {
        console.log('[Fee Service] Cannot connect to bank (ECONNREFUSED)');
        return {
          httpStatus: 503,
          status: 'FAILED',
          error: 'Cannot connect to bank gateway (service unavailable)',
        };
      }

      // Handle Request Timeout
      if (err.message === 'REQUEST_TIMEOUT' || err.code === 'ETIMEDOUT') {
        console.log('[Fee Service] Bank request timed out');
        return {
          httpStatus: 504,
          status: 'PENDING',
          error: 'Bank request timed out (unknown status)',
        };
      }

      // Handle connection dropped/reset while waiting
      // (e.g. ECONNRESET, EPIPE, socket hang up)
      console.log(`[Fee Service] Bank connection dropped (${err.message}), retrying...`);
      if (attempt <= maxRetries && (Date.now() - startTime < overallTimeoutMs - 500)) {
        await new Promise((r) => setTimeout(r, 60));
        continue;
      } else {
        // "Không biết đã trừ tiền hay chưa: 504 PENDING"
        return {
          httpStatus: 504,
          status: 'PENDING',
          error: 'Connection dropped by bank and retries exhausted',
        };
      }
    }
  }

  return {
    httpStatus: 504,
    status: 'PENDING',
    error: lastError ? lastError.message : 'Unknown payment processing state',
  };
}

// GET /students/:id/fees
app.get('/students/:id/fees', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const student = students[studentId];

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  return res.status(200).json({
    studentId: student.id,
    name: student.name,
    debt: student.debt,
  });
});

// POST /students/:id/payments
app.post('/students/:id/payments', async (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const student = students[studentId];

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const { amount } = req.body;

  // Validate amount
  if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({
      error: 'Invalid payment amount',
      paymentId: null,
      status: 'FAILED',
    });
  }

  // Check amount does not exceed current debt
  if (amount > student.debt) {
    return res.status(400).json({
      error: `Payment amount (${amount.toLocaleString()}đ) exceeds outstanding debt (${student.debt.toLocaleString()}đ)`,
      paymentId: null,
      status: 'FAILED',
    });
  }

  // Generate Payment ID: P1, P2, P3...
  paymentCounter++;
  const paymentId = 'P' + paymentCounter;

  // Call Bank with idempotency and fault tolerance
  const bankResult = await callBankWithResilience(
    { reference: paymentId, amount },
    paymentId
  );

  // Business Rule: Debt is ONLY reduced when bank has confirmed payment (status: PAID / 201)
  if (bankResult.httpStatus === 201 && bankResult.status === 'PAID') {
    student.debt -= amount;
    const record = {
      paymentId,
      studentId,
      amount,
      chargeId: bankResult.data ? bankResult.data.chargeId : null,
      status: 'PAID',
      remainingDebt: student.debt,
      timestamp: new Date().toISOString(),
    };
    payments.set(paymentId, record);

    return res.status(201).json(record);
  }

  // Failed or Pending payment
  const failureRecord = {
    paymentId,
    studentId,
    amount,
    error: bankResult.error,
    status: bankResult.status,
    remainingDebt: student.debt, // Not deducted!
    timestamp: new Date().toISOString(),
  };
  payments.set(paymentId, failureRecord);

  return res.status(bankResult.httpStatus).json({
    error: bankResult.error,
    paymentId,
    status: bankResult.status,
  });
});

// Helper for test reset of student debts
app.post('/reset-test-data', (req, res) => {
  students[1].debt = 50000000;
  students[2].debt = 0;
  students[3].debt = 3200000;
  paymentCounter = 0;
  payments.clear();
  res.json({ message: 'Fee service data reset successfully', students });
});

// Start HTTP Server
const server = app.listen(PORT, () => {
  console.log(`[Fee Service] Running on port ${PORT}`);
  console.log(`[Fee Service] Target BANK_URL=${getBankUrl()}`);
});

module.exports = { app, server, students };
