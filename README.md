# Hệ thống Thanh toán Học phí & Ngân hàng Giả lập (Microservices Resilience)

Bài tập: **Kết nối và duy trì kết nối giữa các service**  
Giảng viên: **ThS Nguyễn Việt Dũng**

## 1. Cấu trúc thư mục
- `fee-service/index.js`: Dịch vụ thu học phí (cổng 4001), quản lý công nợ, connection pooling, retry thông minh.
- `bank-service/index.js`: Dịch vụ ngân hàng giả lập (cổng 4002), kiểm soát hạn mức, Idempotency-Key, mô phỏng lỗi (DELAY_MS, FAIL_RATE, DROP_RATE).
- `tests/`:
  - `test_scenario1.js`: Tình huống 1 - Ngân hàng không kết nối được, rồi hoạt động lại.
  - `test_scenario2.js`: Tình huống 2 - Ngân hàng phản hồi rất chậm (DELAY_MS=5000).
  - `test_scenario3.js`: Tình huống 3 - Duy trì kết nối (Keep-Alive, 200 reqs, nhàn rỗi 6s).
  - `test_scenario4.js`: Tình huống 4 - Đứt giữa chừng (DROP_RATE), lỗi 500 (FAIL_RATE), vượt hạn mức 402.
  - `compare_before_after.js`: Bảng đo lường so sánh trước và sau khi sửa.
  - `run_all_tests.js`: Runner tự động chạy toàn bộ bài test.
- `postman_collection.json`: File bộ sưu tập Postman để kiểm thử API thủ công.
- `BaoCao_ThuyetTrinh.md`: Báo cáo chi tiết và kịch bản thuyết trình bảo vệ trước lớp.

---

## 2. Cách chạy nhanh

### Cài đặt thư viện:
```bash
npm install
```

### Chạy toàn bộ kiểm thử tự động (cả 4 tình huống):
```bash
npm run test:all
```

### In bảng so sánh số liệu trước / sau khi sửa:
```bash
node tests/compare_before_after.js
```

### Chạy từng kịch bản kiểm thử:
- Tình huống 1: `npm run test:s1`
- Tình huống 2: `npm run test:s2`
- Tình huống 3: `npm run test:s3`
- Tình huống 4: `npm run test:s4`

### Khởi động từng service độc lập:
- Chạy Fee Service: `npm run start:fee`
- Chạy Bank Service: `npm run start:bank`
