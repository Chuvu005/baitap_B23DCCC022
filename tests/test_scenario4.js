// Test Scenario 4: Đứt giữa chừng, lỗi tạm thời, bị từ chối
const { spawn } = require('child_process');
const { makeRequest, sleep, ensureFeeService } = require('./test_helpers');

async function runScenario4() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: TÌNH HUỐNG 4');
  console.log('Mô tả: Đứt giữa chừng (a), Lỗi tạm thời 500 (b), Bị từ chối 402 (c)');
  console.log('================================================================\n');

  await ensureFeeService();

  // =================================================================
  // SUB-SCENARIO 4(a): DROP_RATE=0.3
  // =================================================================
  console.log('----------------------------------------------------------------');
  console.log('▶ TEST 4(a): Ngân hàng trừ tiền rồi đứt kết nối (DROP_RATE=0.3)');
  console.log('----------------------------------------------------------------');

  // Reset student debt in Fee Service
  await makeRequest('http://localhost:4001/reset-test-data', 'POST');
  const studentInitial = await makeRequest('http://localhost:4001/students/1/fees', 'GET');
  const initialDebt = studentInitial.data.debt;

  // Start Bank with DROP_RATE=0.3
  let bankProcess = spawn('node', ['bank-service/index.js'], {
    env: { ...process.env, PORT: '4002', DROP_RATE: '0.3' },
    stdio: 'ignore',
  });
  await sleep(1500);

  let paidCountA = 0;
  let pendingCountA = 0;
  let maxTimeA = 0;
  const AMOUNT_PER_PAYMENT = 10000; // 10k VND

  for (let i = 1; i <= 60; i++) {
    const res = await makeRequest('http://localhost:4001/students/1/payments', 'POST', {
      amount: AMOUNT_PER_PAYMENT,
    });
    maxTimeA = Math.max(maxTimeA, res.duration);
    if (res.status === 201 && res.data && res.data.status === 'PAID') {
      paidCountA++;
    } else if (res.status === 504 && res.data && res.data.status === 'PENDING') {
      pendingCountA++;
    }
    if (i % 20 === 0) {
      process.stdout.write(`Đã gửi ${i}/60 lệnh...\n`);
    }
  }

  // Check bank stats
  const statsA = (await makeRequest('http://localhost:4002/stats', 'GET')).data;
  console.log(`\nKết quả Test 4(a):`);
  console.log(`- Thành công (PAID): ${paidCountA}/60`);
  console.log(`- Thất bại/Chờ (PENDING 504): ${pendingCountA}/60`);
  console.log(`- Thống kê Ngân hàng: charges=${statsA.charges}, duplicates=${statsA.duplicates}`);
  console.log(`- Thời gian tối đa mỗi request: ${maxTimeA}ms (≤ 4500ms)`);

  // Check student remaining debt
  const studentAfterA = await makeRequest('http://localhost:4001/students/1/fees', 'GET');
  const actualDeduction = initialDebt - studentAfterA.data.debt;
  const expectedDeduction = paidCountA * AMOUNT_PER_PAYMENT;
  console.log(`- Công nợ ban đầu: ${initialDebt.toLocaleString()}đ`);
  console.log(`- Công nợ sau test: ${studentAfterA.data.debt.toLocaleString()}đ (giảm ${actualDeduction.toLocaleString()}đ)`);
  console.log(`- Số tiền giảm kỳ vọng: ${expectedDeduction.toLocaleString()}đ`);

  const checkA_dup = statsA.duplicates === 0;
  const checkA_success = paidCountA >= 54;
  const checkA_pending = (paidCountA + pendingCountA) === 60;
  const checkA_debt = actualDeduction === expectedDeduction;
  const checkA_time = maxTimeA <= 4500;

  console.log(`☐ Duplicates = 0: ${checkA_dup ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ ≥ 54/60 thanh toán thành công (${paidCountA}/60): ${checkA_success ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ Lệnh không thành công trả 504 + PENDING: ${checkA_pending ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ Công nợ chỉ giảm đúng tiền của các lệnh PAID: ${checkA_debt ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ Thời gian ≤ 4,5s: ${checkA_time ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

  bankProcess.kill();
  await sleep(1000);

  // =================================================================
  // SUB-SCENARIO 4(b): FAIL_RATE=0.3
  // =================================================================
  console.log('----------------------------------------------------------------');
  console.log('▶ TEST 4(b): Ngân hàng trả lỗi 500 trước khi trừ tiền (FAIL_RATE=0.3)');
  console.log('----------------------------------------------------------------');

  bankProcess = spawn('node', ['bank-service/index.js'], {
    env: { ...process.env, PORT: '4002', FAIL_RATE: '0.3' },
    stdio: 'ignore',
  });
  await sleep(1500);

  let paidCountB = 0;
  let maxTimeB = 0;

  for (let i = 1; i <= 60; i++) {
    const res = await makeRequest('http://localhost:4001/students/1/payments', 'POST', {
      amount: AMOUNT_PER_PAYMENT,
    });
    maxTimeB = Math.max(maxTimeB, res.duration);
    if (res.status === 201 && res.data && res.data.status === 'PAID') {
      paidCountB++;
    }
    if (i % 20 === 0) {
      process.stdout.write(`Đã gửi ${i}/60 lệnh...\n`);
    }
  }

  const statsB = (await makeRequest('http://localhost:4002/stats', 'GET')).data;
  console.log(`\nKết quả Test 4(b):`);
  console.log(`- Thành công (PAID): ${paidCountB}/60`);
  console.log(`- Thống kê Ngân hàng: charges=${statsB.charges}, duplicates=${statsB.duplicates}`);
  console.log(`- Thời gian tối đa mỗi request: ${maxTimeB}ms (≤ 4500ms)`);

  const checkB_success = paidCountB >= 54;
  const checkB_noDup = statsB.duplicates === 0;
  const checkB_time = maxTimeB <= 4500;

  console.log(`☐ ≥ 54/60 thanh toán thành công (${paidCountB}/60): ${checkB_success ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ Không trừ tiền 2 lần (duplicates = 0): ${checkB_noDup ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ Thời gian ≤ 4,5s: ${checkB_time ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

  // =================================================================
  // SUB-SCENARIO 4(c): Từ chối vì vượt hạn mức (amount = 25,000,000đ)
  // =================================================================
  console.log('----------------------------------------------------------------');
  console.log('▶ TEST 4(c): Từ chối rõ ràng vì vượt hạn mức (amount = 25.000.000đ)');
  console.log('----------------------------------------------------------------');

  const reqBeforeC = statsB.requests;
  const resC = await makeRequest('http://localhost:4001/students/1/payments', 'POST', {
    amount: 25000000,
  });

  const statsAfterC = (await makeRequest('http://localhost:4002/stats', 'GET')).data;
  const bankRequestsReceived = statsAfterC.requests - reqBeforeC;

  console.log(`Kết quả: HTTP ${resC.status} | Thời gian: ${resC.duration}ms`);
  console.log('Phản hồi:', resC.data);
  console.log(`Số request ngân hàng nhận thêm cho lệnh này: ${bankRequestsReceived}`);

  const checkC_402 = resC.status === 402 && resC.data && resC.data.status === 'FAILED';
  const checkC_single = bankRequestsReceived === 1;

  console.log(`☐ Trả 402 và status FAILED: ${checkC_402 ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}`);
  console.log(`☐ Ngân hàng nhận đúng 1 yêu cầu (không retry): ${checkC_single ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}\n`);

  bankProcess.kill();
  await sleep(500);

  console.log('================================================================');
  const allPassed =
    checkA_dup &&
    checkA_success &&
    checkA_pending &&
    checkA_debt &&
    checkA_time &&
    checkB_success &&
    checkB_noDup &&
    checkB_time &&
    checkC_402 &&
    checkC_single;

  if (allPassed) {
    console.log('🎉 TÌNH HUỐNG 4 HOÀN TOÀN ĐẠT MỌI TIÊU CHÍ!');
    process.exit(0);
  } else {
    console.log('⚠️ TÌNH HUỐNG 4 CẦN KIỂM TRA LẠI');
    process.exit(1);
  }
}

runScenario4().catch((err) => {
  console.error(err);
  process.exit(1);
});
