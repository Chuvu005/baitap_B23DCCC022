// Test Scenario 1: Ngân hàng không kết nối được, rồi hoạt động lại
const { spawn } = require('child_process');
const { makeRequest, sleep, ensureFeeService } = require('./test_helpers');

async function runScenario1() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: TÌNH HUỐNG 1');
  console.log('Mô tả: Ngân hàng không kết nối được, sau đó hoạt động lại');
  console.log('================================================================\n');

  await ensureFeeService();

  // 1. Fee Service payment call when Bank is down
  console.log('--- Bước 1: Gọi thanh toán khi Ngân hàng CHƯA chạy ---');
  const pay1 = await makeRequest('http://localhost:4001/students/1/payments', 'POST', { amount: 100000 });
  console.log(`Kết quả: HTTP ${pay1.status} | Thời gian: ${pay1.duration}ms`);
  console.log('Phản hồi:', pay1.data);

  const check1_503 = pay1.status === 503;
  const check1_time = pay1.duration < 1500;
  const check1_body = pay1.data && pay1.data.status === 'FAILED' && pay1.data.error;

  console.log(`☐ Khi ngân hàng tắt: trả 503: ${check1_503 ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ Thời gian < 1,5s (${pay1.duration}ms): ${check1_time ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ JSON có error và status FAILED: ${check1_body ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

  // 2. Check Fee Service is still alive and GET /fees is fast
  console.log('--- Bước 2: Kiểm tra Fee Service còn sống & GET /fees nhanh ---');
  const feeCheck = await makeRequest('http://localhost:4001/students/1/fees', 'GET');
  console.log(`Kết quả: HTTP ${feeCheck.status} | Thời gian: ${feeCheck.duration}ms`);
  console.log('Công nợ:', feeCheck.data);

  const check2_alive = feeCheck.status === 200 && feeCheck.duration < 300;
  console.log(`☐ Fee Service không sập & GET /fees < 300ms (${feeCheck.duration}ms): ${check2_alive ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

  // 3. Start Bank Service dynamically (Fee Service is NOT restarted)
  console.log('--- Bước 3: Khởi động Ngân hàng (KHÔNG khởi động lại Fee Service) ---');
  const bankProcess = spawn('node', ['bank-service/index.js'], {
    env: { ...process.env, PORT: '4002' },
    stdio: 'ignore',
  });

  // Wait for bank to boot
  await sleep(1500);

  // 4. Call payment again
  console.log('--- Bước 4: Gọi lại thanh toán sau khi Ngân hàng đã bật ---');
  const pay2 = await makeRequest('http://localhost:4001/students/1/payments', 'POST', { amount: 100000 });
  console.log(`Kết quả: HTTP ${pay2.status} | Thời gian: ${pay2.duration}ms`);
  console.log('Phản hồi:', pay2.data);

  const check3_201 = pay2.status === 201 && pay2.data && pay2.data.status === 'PAID';
  console.log(`☐ Thanh toán trả 201 PAID thành công: ${check3_201 ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

  // Clean up bank process
  bankProcess.kill();
  await sleep(500);

  console.log('================================================================');
  if (check1_503 && check1_time && check1_body && check2_alive && check3_201) {
    console.log('🎉 TÌNH HUỐNG 1 HOÀN TOÀN ĐẠT MỌI TIÊU CHÍ!');
    process.exit(0);
  } else {
    console.log('⚠️ TÌNH HUỐNG 1 CẦN KIỂM TRA LẠI');
    process.exit(1);
  }
}

runScenario1().catch((err) => {
  console.error(err);
  process.exit(1);
});
