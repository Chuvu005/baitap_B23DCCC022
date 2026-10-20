// Master test runner: Starts Fee Service and runs all 4 test scenarios sequentially
const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: process.env,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script ${scriptPath} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log('################################################################');
  console.log('🚀 KHỞI ĐỘNG HỆ THỐNG KIỂM THỬ TỰ ĐỘNG CẢ 4 TÌNH HUỐNG');
  console.log('################################################################\n');

  // Start Fee Service
  console.log('[Runner] Khởi động Fee Service (Port 4001)...');
  const feeProcess = spawn('node', ['fee-service/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '4001', BANK_URL: 'http://localhost:4002' },
  });

  await sleep(1500);

  try {
    console.log('\n>>> CHẠY TEST TÌNH HUỐNG 1...');
    await runScript('tests/test_scenario1.js');
    await sleep(1000);

    console.log('\n>>> CHẠY TEST TÌNH HUỐNG 2...');
    await runScript('tests/test_scenario2.js');
    await sleep(1000);

    console.log('\n>>> CHẠY TEST TÌNH HUỐNG 3...');
    await runScript('tests/test_scenario3.js');
    await sleep(1000);

    console.log('\n>>> CHẠY TEST TÌNH HUỐNG 4...');
    await runScript('tests/test_scenario4.js');
    await sleep(1000);

    console.log('\n################################################################');
    console.log('🏆 TẤT CẢ 4 TÌNH HUỐNG ĐÃ HOÀN TẤT THÀNH CÔNG VỚI ĐẦY ĐỦ CHỈ SỐ!');
    console.log('################################################################');
    process.exit(0);
  } catch (err) {
    console.error('Lỗi trong quá trình chạy test:', err);
    process.exit(1);
  } finally {
    try {
      feeProcess.kill();
    } catch (e) {}
  }
}

main();
