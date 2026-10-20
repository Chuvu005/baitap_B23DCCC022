// Test Scenario 2: Ngân hàng phản hồi rất chậm
const { spawn } = require('child_process');
const { makeRequest, sleep, ensureFeeService } = require('./test_helpers');

async function runScenario2() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: TÌNH HUỐNG 2');
  console.log('Mô tả: Ngân hàng phản hồi rất chậm (DELAY_MS=5000)');
  console.log('================================================================\n');

  await ensureFeeService();

  // 1. Spawn bank with DELAY_MS=5000
  console.log('--- Khởi động Ngân hàng với DELAY_MS=5000 ---');
  const bankProcess = spawn('node', ['bank-service/index.js'], {
    env: { ...process.env, PORT: '4002', DELAY_MS: '5000' },
    stdio: 'ignore',
  });

  await sleep(1500);

  try {
    // 2. Test single payment timeout
    console.log('--- Bước 1: Gửi 1 thanh toán và đo thời gian phản hồi ---');
    const payRes = await makeRequest('http://localhost:4001/students/1/payments', 'POST', { amount: 100000 });
    console.log(`Kết quả: HTTP ${payRes.status} | Thời gian: ${payRes.duration}ms`);
    console.log('Phản hồi:', payRes.data);

    const check1_504 = payRes.status === 504 && payRes.data && payRes.data.status === 'PENDING';
    const check1_time = payRes.duration <= 4500;

    console.log(`☐ Trả 504 với status: "PENDING": ${check1_504 ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
    console.log(`☐ Tổng thời gian phản hồi ≤ 4,5s (${payRes.duration}ms): ${check1_time ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

    // 3. Test 20 concurrent payments while checking GET /fees
    console.log('--- Bước 2: Bắn cùng lúc 20 thanh toán và đo GET /students/1/fees ---');
    const concurrentPayments = [];
    for (let i = 0; i < 20; i++) {
      concurrentPayments.push(
        makeRequest('http://localhost:4001/students/1/payments', 'POST', { amount: 1000 })
      );
    }

    // Wait 500ms so all 20 payment requests are active in flight
    await sleep(500);

    console.log('-> Đang gọi GET /students/1/fees trong khi 20 payments đang chờ...');
    const feeRes = await makeRequest('http://localhost:4001/students/1/fees', 'GET');
    console.log(`Kết quả GET /fees: HTTP ${feeRes.status} | Thời gian: ${feeRes.duration}ms`);

    const check2_feeFast = feeRes.status === 200 && feeRes.duration < 300;
    console.log(`☐ GET /students/1/fees phản hồi < 300ms (${feeRes.duration}ms): ${check2_feeFast ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

    console.log('-> Chờ 20 thanh toán hoàn tất...');
    const results = await Promise.all(concurrentPayments);
    const allPending = results.every((r) => r.status === 504 && r.data.status === 'PENDING');
    const maxTime = Math.max(...results.map((r) => r.duration));
    console.log(`Tất cả 20 thanh toán trả 504 PENDING: ${allPending ? '✅ ĐÚNG' : '❌ SAI'}`);
    console.log(`Thời gian tối đa trong 20 payments: ${maxTime}ms (≤ 4500ms)`);

    console.log('\n================================================================');
    if (check1_504 && check1_time && check2_feeFast && allPending && maxTime <= 4500) {
      console.log('🎉 TÌNH HUỐNG 2 HOÀN TOÀN ĐẠT MỌI TIÊU CHÍ!');
      process.exit(0);
    } else {
      console.log('⚠️ TÌNH HUỐNG 2 CẦN KIỂM TRA LẠI');
      process.exit(1);
    }
  } finally {
    bankProcess.kill();
    await sleep(500);
  }
}

runScenario2().catch((err) => {
  console.error(err);
  process.exit(1);
});
