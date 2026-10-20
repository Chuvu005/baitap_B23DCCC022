// Test Scenario 3: Duy trì kết nối (Connection Pooling & Keep-Alive)
const { spawn } = require('child_process');
const { makeRequest, sleep, ensureFeeService } = require('./test_helpers');

async function runScenario3() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: TÌNH HUỐNG 3');
  console.log('Mô tả: Duy trì kết nối (Keep-Alive, 200 thanh toán, concurrency 10)');
  console.log('================================================================\n');

  await ensureFeeService();

  // Spawn bank normally
  console.log('--- Khởi động Ngân hàng (bình thường) ---');
  const bankProcess = spawn('node', ['bank-service/index.js'], {
    env: { ...process.env, PORT: '4002' },
    stdio: 'ignore',
  });

  await sleep(1500);

  try {
    // Reset bank stats before running
    await makeRequest('http://localhost:4002/stats/reset', 'POST', { resetConnections: true });
    await makeRequest('http://localhost:4001/reset-test-data', 'POST');

    console.log('--- Bước 1: Gửi 200 thanh toán với 10 yêu cầu cùng lúc (1.000đ mỗi lần) ---');
    const TOTAL_REQUESTS = 200;
    const CONCURRENCY = 10;
    const startTime = Date.now();

    let completed = 0;
    let successCount = 0;
    let failedCount = 0;

    let currentIndex = 0;
    async function worker() {
      while (currentIndex < TOTAL_REQUESTS) {
        const idx = ++currentIndex;
        try {
          const res = await makeRequest('http://localhost:4001/students/1/payments', 'POST', {
            amount: 1000,
          });
          if (res.status === 201 && res.data && res.data.status === 'PAID') {
            successCount++;
          } else {
            failedCount++;
          }
        } catch (err) {
          failedCount++;
        }
        completed++;
        if (completed % 50 === 0) {
          process.stdout.write(`Đã hoàn thành ${completed}/${TOTAL_REQUESTS}...\n`);
        }
      }
    }

    const workers = [];
    for (let c = 0; c < CONCURRENCY; c++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const totalDuration = Date.now() - startTime;
    console.log(`\nTổng thời gian hoàn thành 200 requests: ${totalDuration}ms (trung bình ${(totalDuration / TOTAL_REQUESTS).toFixed(1)}ms/req)`);

    // Check bank stats
    const statsRes = await makeRequest('http://localhost:4002/stats', 'GET');
    const stats = statsRes.data;
    console.log('Thống kê từ Ngân hàng (/stats):', stats);

    const check1_200 = successCount === 200;
    const check2_conn = stats.connections <= 20;

    console.log(`\n☐ 200/200 thanh toán thành công (${successCount}/200): ${check1_200 ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
    console.log(`☐ Số kết nối TCP ngân hàng mở ≤ 20 (${stats.connections} kết nối): ${check2_conn ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);

    // Test idle 6 seconds
    console.log('\n--- Bước 2: Chờ nhàn rỗi 6,5 giây (vượt qua 5s keepAliveTimeout của Ngân hàng) ---');
    console.log('Đang chờ 6.5 giây...');
    await sleep(6500);

    console.log('-> Gửi tiếp 5 thanh toán sau khi kết nối cũ đã bị đóng do nhàn rỗi...');
    let idleSuccessCount = 0;
    for (let i = 0; i < 5; i++) {
      const res = await makeRequest('http://localhost:4001/students/1/payments', 'POST', { amount: 1000 });
      if (res.status === 201 && res.data && res.data.status === 'PAID') {
        idleSuccessCount++;
      }
    }
    console.log(`Số yêu cầu thành công sau khi nhàn rỗi 6s: ${idleSuccessCount}/5`);
    const check3_idle = idleSuccessCount === 5;
    console.log(`☐ Sau 6s nhàn rỗi, các yêu cầu tiếp theo vẫn thành công: ${check3_idle ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);

    console.log('\n================================================================');
    if (check1_200 && check2_conn && check3_idle) {
      console.log('🎉 TÌNH HUỐNG 3 HOÀN TOÀN ĐẠT MỌI TIÊU CHÍ!');
      process.exit(0);
    } else {
      console.log('⚠️ TÌNH HUỐNG 3 CẦN KIỂM TRA LẠI');
      process.exit(1);
    }
  } finally {
    bankProcess.kill();
    await sleep(500);
  }
}

runScenario3().catch((err) => {
  console.error(err);
  process.exit(1);
});
