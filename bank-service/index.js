const express = require('express');

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4002', 10);

// In-memory stats
const stats = {
  connections: 0,
  requests: 0,
  charges: 0,
  duplicates: 0,
};

// In-memory idempotency storage: idempotencyKey -> response
const idempotencyStore = new Map();

// Map of reference -> chargeId to detect duplicate charges for the same reference
const chargedReferences = new Map();

// GET /stats
app.get('/stats', (req, res) => {
  res.json({
    connections: stats.connections,
    requests: stats.requests,
    charges: stats.charges,
    duplicates: stats.duplicates,
  });
});

// POST /stats/reset (Helper for resetting stats between test scenarios)
app.post('/stats/reset', (req, res) => {
  stats.requests = 0;
  stats.charges = 0;
  stats.duplicates = 0;
  // Keep connections or reset as needed:
  if (req.body && req.body.resetConnections) {
    stats.connections = 0;
  }
  idempotencyStore.clear();
  chargedReferences.clear();
  res.json({ message: 'Stats reset successfully', stats });
});

// POST /charges
app.post('/charges', async (req, res) => {
  stats.requests++;

  const idempotencyKey = req.header('Idempotency-Key');
  const { reference, amount } = req.body;

  // 1. Validate request body
  if (amount === undefined || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid charge amount' });
  }

  if (!reference) {
    return res.status(400).json({ error: 'Missing reference' });
  }

  // 2. Business rule: Max limit 20,000,000
  if (amount > 20000000) {
    return res.status(402).json({
      error: 'Transaction amount exceeds limit of 20,000,000 VND',
    });
  }

  // Read environment fault injection variables
  const delayMs = parseInt(process.env.DELAY_MS || '0', 10);
  const failRate = parseFloat(process.env.FAIL_RATE || '0');
  const dropRate = parseFloat(process.env.DROP_RATE || '0');

  // 3. Idempotency check:
  // If request has Idempotency-Key and was previously charged, return cached response
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const cachedResponse = idempotencyStore.get(idempotencyKey);
    // If delay configured, simulate delay even on cached response if needed
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return res.status(201).json(cachedResponse);
  }

  // 4. Simulate delay if configured
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // 5. Simulate FAIL_RATE: rate of returning 500 BEFORE deducting money
  if (failRate > 0 && Math.random() < failRate) {
    console.log(`[Bank] Simulating 500 error for reference ${reference} (FAIL_RATE=${failRate})`);
    return res.status(500).json({
      error: 'Internal Bank Error: Transient failure before processing',
    });
  }

  // 6. Deduct money / Charge processing
  if (chargedReferences.has(reference)) {
    // If this reference has already been charged, this is an illegal duplicate charge!
    stats.duplicates++;
    console.warn(`[Bank ALERT] Duplicate charge detected for reference ${reference}!`);
  }

  stats.charges++;
  const chargeId = 'CHG_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  chargedReferences.set(reference, chargeId);

  const chargeResult = {
    chargeId,
    reference,
    amount,
    status: 'SUCCESS',
    timestamp: new Date().toISOString(),
  };

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, chargeResult);
  }

  // 7. Simulate DROP_RATE: rate of deducting money, then cutting connection before responding
  if (dropRate > 0 && Math.random() < dropRate) {
    console.log(`[Bank] Charged ${amount} for ${reference} but DROP_RATE triggered -> destroying socket!`);
    // Close and destroy the TCP socket abruptly without sending HTTP response
    req.socket.destroy();
    return;
  }

  // 8. Normal success response
  return res.status(201).json(chargeResult);
});

// Start HTTP Server
const server = app.listen(PORT, () => {
  console.log(`[Bank Gateway] Running on port ${PORT}`);
  console.log(`[Bank Gateway] Config: DELAY_MS=${process.env.DELAY_MS || 0}, FAIL_RATE=${process.env.FAIL_RATE || 0}, DROP_RATE=${process.env.DROP_RATE || 0}`);
});

// Idle connection timeout: Bank closes idle connections after 5 seconds
server.keepAliveTimeout = 5000;
server.headersTimeout = 6000;

// Track and log every new TCP connection
server.on('connection', (socket) => {
  stats.connections++;
  const connId = stats.connections;
  console.log(`[Bank] New TCP connection established (#${connId}) from ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('close', () => {
    // optional debug
  });
});

module.exports = { app, server, stats };
