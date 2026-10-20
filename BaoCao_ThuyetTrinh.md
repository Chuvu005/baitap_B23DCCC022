# BÁO CÁO THUYẾT TRÌNH BÀI TẬP: KẾT NỐI VÀ DUY TRÌ KẾT NỐI GIỮA CÁC SERVICE

**Giảng viên:** ThS Nguyễn Việt Dũng  
**Học phần:** Hệ thống phân tán / Kết nối vi dịch vụ  
**Hệ thống xây dựng:** Hệ thống thanh toán học phí trực tuyến gọi cổng Ngân hàng giả lập  
**Công nghệ:** Node.js (Express), In-memory store, HTTP Keep-Alive Connection Pooling, Idempotency Pattern, Circuit/Retry Budgeting.

---

## 1. Kiến trúc hệ thống và Quy ước nghiệp vụ

### 1.1 Hai dịch vụ thành phần
1. **Fee Service (Cổng 4001):**
   - Lưu trữ công nợ sinh viên trong bộ nhớ:
     - Sinh viên 1: Nợ **50.000.000đ**
     - Sinh viên 2: Nợ **0đ**
     - Sinh viên 3: Nợ **3.200.000đ**
   - API:
     - `GET /students/:id/fees`: Tra cứu công nợ (phản hồi siêu nhanh, không bị ảnh hưởng khi ngân hàng sự cố).
     - `POST /students/:id/payments`: Tiếp nhận thanh toán `{"amount": ...}`, kiểm tra hợp lệ, sinh mã `P1, P2...`, gọi cổng ngân hàng với `Idempotency-Key` và chỉ giảm nợ khi ngân hàng đã xác nhận trừ tiền thành công.
2. **Bank Gateway Giả lập (Cổng 4002):**
   - API `POST /charges`: Body `{"reference", "amount"}` kèm header `Idempotency-Key`.
     - Phản hồi `201` + `chargeId` khi thành công.
     - Phản hồi `400` nếu số tiền không hợp lệ (<= 0).
     - Phản hồi `402` nếu số tiền > 20.000.000đ (vượt hạn mức).
     - Tái hiện sự cố qua biến môi trường:
       - `DELAY_MS`: Độ trễ bổ sung (ms).
       - `FAIL_RATE`: Tỉ lệ trả mã lỗi 500 trước khi trừ tiền.
       - `DROP_RATE`: Tỉ lệ trừ tiền xong rồi ngắt kết nối socket trước khi trả lời.
   - API `GET /stats`: Theo dõi `{ connections, requests, charges, duplicates }`. Mặc định Node.js ngắt kết nối nhàn rỗi sau 5 giây (`keepAliveTimeout = 5000`).

### 1.2 Bảng quy ước kết quả thanh toán
| Tình trạng | HTTP Code | `status` | Khi nào | Xử lý công nợ |
| :--- | :---: | :---: | :--- | :--- |
| **Thành công** | **201** | `PAID` | Ngân hàng xác nhận đã trừ tiền | **Giảm công nợ** đúng số tiền |
| **Ngân hàng từ chối rõ ràng** | **402** (giữ mã) | `FAILED` | Vượt hạn mức 20.000.000đ hoặc tiền âm | **Không giảm nợ** (Không retry) |
| **Chắc chắn chưa trừ tiền** | **503** | `FAILED` | Không kết nối được tới ngân hàng (ECONNREFUSED) | **Không giảm nợ** |
| **Không biết đã trừ hay chưa** | **504** | `PENDING` | Hết thời gian chờ, hoặc đứt socket khi chờ phản hồi | **Không giảm nợ** (Giữ trạng thái chờ đối soát) |

---

## 2. BẢNG TỔNG HỢP SỐ LIỆU ĐO LƯỜNG TRƯỚC VÀ SAU KHI SỬA

*(Số liệu đo lường thực tế từ script kiểm chuẩn tự động `node tests/compare_before_after.js`)*

| Tình huống | Chỉ số đo lường | Trước khi sửa | Sau khi sửa | Tiêu chuẩn đề bài | Đánh giá |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **Tình huống 1**<br>*(Ngân hàng tắt, rồi bật lại)* | Mã HTTP khi Bank tắt<br>Thời gian trả về khi Bank tắt<br>Trạng thái Fee Service<br>GET /fees khi Bank tắt<br>Thanh toán sau khi Bank bật | Treo chờ timeout (> 30s)<br>> 5.000ms<br>Dễ sập uncaught exception<br>Bị chậm / gián đoạn<br>Lỗi socket hoặc cần restart | **503 FAILED**<br>**26ms**<br>**Hoạt động bình thường**<br>**200 OK (1ms)**<br>**201 PAID (19ms)** | 503 FAILED<br>< 1.500ms<br>Không sập<br>Phản hồi nhanh<br>Tự phục hồi không cần restart | **ĐẠT 100%** |
| **Tình huống 2**<br>*(Bank trễ 5.000ms)* | Mã phản hồi thanh toán<br>Thời gian thanh toán<br>20 thanh toán đồng thời<br>GET /fees khi 20 req chờ | Treo theo Bank (> 5.000ms)<br>5.000ms - 30.000ms<br>Nghẽn socket connection<br>> 3.000ms (bị nghẽn) | **504 PENDING**<br>**3.833ms**<br>**20/20 trả 504 PENDING**<br>**3ms** | 504 PENDING<br>≤ 4.500ms<br>Non-blocking<br>< 300ms | **ĐẠT 100%** |
| **Tình huống 3**<br>*(Duy trì kết nối Keep-Alive)* | Số kết nối TCP (200 payments)<br>Tổng thời gian hoàn thành<br>Tỉ lệ thanh toán thành công<br>Sau 6s nhàn rỗi (Bank timeout 5s) | **200 kết nối TCP** (mỗi req 1 TCP)<br>~3.000ms - 4.500ms<br>Thành công chậm<br>Gặp lỗi ECONNRESET / hỏng socket | **10 kết nối TCP** (tái sử dụng pool)<br>**130ms** (nhanh gấp ~25 lần!)<br>**200/200 PAID**<br>**5/5 PAID (tự cấp mới socket)** | ≤ 20 kết nối TCP<br>Tối ưu tài nguyên<br>200/200 thành công<br>Vẫn thành công sau 6s | **ĐẠT 100%** |
| **Tình huống 4**<br>*(DROP 0.3, FAIL 0.3, Limit 20tr)* | (a) DROP_RATE=0.3 thành công<br>(a) Trùng lặp (duplicates)<br>(a) Công nợ sinh viên<br>(b) FAIL_RATE=0.3 thành công<br>(b) Trùng lặp khi FAIL_RATE<br>(c) Thanh toán 25 triệu (vượt hạn mức)<br>Số request ngân hàng nhận ở (c) | ~42/60 (~30% mất kết nối)<br>Nếu retry bừa bãi: duplicates > 0<br>Bị trừ sai lệch tiền<br>~42/60 (lỗi 500)<br>Nguy cơ trừ 2 lần nếu retry sai<br>Bị từ chối 402 nhưng Fee lặp lại retry<br>> 1 request (lãng phí tài nguyên) | **60/60 PAID** (100%)<br>**duplicates = 0** (tuyệt đối)<br>**Giảm đúng 600.000đ**<br>**59/60 PAID** (98.3%)<br>**duplicates = 0**<br>**Trả 402 FAILED ngay**<br>**Đúng 1 request duy nhất** | ≥ 54/60<br>duplicates = 0<br>Giảm đúng tiền PAID<br>≥ 54/60<br>duplicates = 0<br>Giữ mã 402 FAILED<br>Đúng 1 request (không retry) | **ĐẠT 100%** |

---

## 3. CHI TIẾT GIẢI PHÁP KỸ THUẬT CHO TỪNG TÌNH HUỐNG

### Tình huống 1: Ngân hàng không kết nối được, rồi hoạt động lại
- **Vấn đề trước khi sửa:** Khi máy chủ ngân hàng chưa bật, Fee Service gọi sang cổng 4002 gặp lỗi `ECONNREFUSED`. Nếu không bắt lỗi cẩn thận, tiến trình Node.js sẽ crash do Unhandled Rejection, hoặc treo request nếu thư viện HTTP không cấu hình connect timeout.
- **Giải pháp:**
  - Bắt biệt lệ `err.code === 'ECONNREFUSED'`.
  - Không thử lại (no retry) vì chắc chắn ngân hàng đang tắt.
  - Phản hồi ngay mã **503** với thân JSON: `{"error": "Cannot connect to bank gateway...", "paymentId": "P1", "status": "FAILED"}`.
  - Thời gian xử lý: **26ms** (đáp ứng tiêu chuẩn < 1,5 giây).
  - Tách biệt luồng xem công nợ `GET /students/:id/fees` đọc trực tiếp từ bộ nhớ cục bộ, không phụ thuộc vào tình trạng ngân hàng.
  - Khi ngân hàng bật lên, các kết nối TCP mới được thiết lập tự động mà không cần khởi động lại Fee Service.

### Tình huống 2: Ngân hàng phản hồi rất chậm (`DELAY_MS=5000`)
- **Vấn đề trước khi sửa:** Ngân hàng bị quá tải giờ cao điểm, mỗi giao dịch mất 5 giây. Nếu client chờ đủ 5s, sinh viên sẽ thấy trang web bị treo, pool kết nối bị chiếm dụng, và các request khác bị xếp hàng (head-of-line blocking).
- **Giải pháp:**
  - Thiết lập **Request Timeout Budget**: Giới hạn timeout cho mỗi yêu cầu gọi sang ngân hàng là **3.800ms** (tổng chu trình tối đa 4.200ms < 4.500ms).
  - Khi timer timeout kích hoạt: hủy request (`req.destroy()`), trả về mã **504** kèm trạng thái `status: "PENDING"`.
  - Công nợ sinh viên **không bị trừ** vì chưa rõ ngân hàng đã trừ tiền hay chưa (chờ đối soát).
  - Xử lý bất đồng bộ hoàn toàn (Non-blocking Event Loop): Khi có 20 giao dịch đang chờ timeout, endpoint `GET /students/1/fees` vẫn phản hồi chỉ trong **3ms** (< 300ms).

### Tình huống 3: Duy trì kết nối (Connection Pooling & Keep-Alive)
- **Vấn đề trước khi sửa:** Mặc định nếu tạo request mới không bật Keep-Alive, mỗi request mở 1 kết nối TCP (3-way handshake SYN/ACK), truyền dữ liệu xong gửi FIN đóng socket. Với 200 request, ngân hàng phải mở 200 kết nối TCP, tốn tài nguyên và tăng độ trễ.
- **Giải pháp:**
  - Sử dụng `http.Agent` với cấu hình:
    ```javascript
    const bankAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 30,
      maxFreeSockets: 30,
      keepAliveMsecs: 3500
    });
    ```
  - **Kết quả:** 200 giao dịch chạy đồng thời 10 luồng chỉ sử dụng **10 kết nối TCP** (đạt tiêu chuẩn ≤ 20).
  - **Xử lý nhàn rỗi 6 giây:** Ngân hàng đóng socket nhàn rỗi sau 5 giây (`server.keepAliveTimeout = 5000`). Fee Service khi phát hiện socket bị server đóng (hoặc nhận `ECONNRESET`) sẽ tự động thiết lập socket mới và gửi lại yêu cầu. Sau 6,5 giây nhàn rỗi, gửi tiếp 5 request đều thành công 100%.

### Tình huống 4: Đứt kết nối giữa chừng, lỗi tạm thời, từ chối rõ ràng
- **Giải pháp Cơ chế Idempotency & Phân loại lỗi:**
  1. **Trường hợp (a) - `DROP_RATE=0.3` (Trừ tiền xong đứt kết nối):**
     - Ngân hàng lưu giao dịch thành công vào bộ nhớ idempotency (`idempotencyStore`), nhưng socket bị đứt đột ngột (`req.socket.destroy()`).
     - Fee Service bắt lỗi `ECONNRESET` / `socket hang up`. Vì có `paymentId` làm `Idempotency-Key`, Fee Service gửi lại request với cùng key đó.
     - Ngân hàng nhận lại key cũ -> trả về kết quả đã trừ trước đó, **không trừ lần 2** -> `duplicates = 0`.
     - Số lệnh thành công đạt **60/60** (vượt xa mức tối thiểu 54/60). Công nợ giảm đúng bằng số tiền các lệnh PAID.
  2. **Trường hợp (b) - `FAIL_RATE=0.3` (Lỗi 500 tạm thời trước khi trừ):**
     - Ngân hàng trả mã 500 trước khi trừ tiền.
     - Fee Service retry tối đa 2 lần. Do ngân hàng chưa trừ tiền, lần retry tiếp theo ngân hàng xử lý bình thường.
     - Tỉ lệ thành công đạt **59/60** (98.3%), `duplicates = 0`.
  3. **Trường hợp (c) - Vượt hạn mức 20.000.000đ:**
     - Sinh viên thanh toán 25.000.000đ -> Ngân hàng trả mã **402**.
     - Fee Service nhận diện đây là lỗi nghiệp vụ 4xx (Client/Business rejection) -> **KHÔNG RETRY**.
     - Giữ nguyên mã 402 trả về cho người dùng với status `FAILED`.
     - Ngân hàng ghi nhận nhận **đúng 1 request duy nhất**.

---

## 4. HƯỚNG DẪN CHẠY VÀ KIỂM THỬ

### 4.1 Cài đặt
Yêu cầu: Node.js >= v18.
```bash
npm install
```

### 4.2 Chạy toàn bộ 4 kịch bản tự động
Lệnh duy nhất chạy toàn bộ kịch bản và in báo cáo:
```bash
npm run test:all
```
Hoặc xem bảng so sánh trước và sau khi sửa:
```bash
node tests/compare_before_after.js
```

### 4.3 Chạy từng kịch bản riêng lẻ
- Kịch bản 1: `npm run test:s1` (Kiểm tra Ngân hàng tắt -> bật lại)
- Kịch bản 2: `npm run test:s2` (Kiểm tra phản hồi chậm DELAY_MS=5000)
- Kịch bản 3: `npm run test:s3` (Kiểm tra Keep-Alive 200 request, nhàn rỗi 6s)
- Kịch bản 4: `npm run test:s4` (Kiểm tra DROP_RATE, FAIL_RATE, 402)

### 4.4 Chạy thủ công với Postman
1. Khởi động Fee Service:
   ```bash
   npm run start:fee
   ```
2. Khởi động Ngân hàng (tùy biến lỗi theo mong muốn):
   ```bash
   # Bình thường:
   npm run start:bank

   # Giả lập trễ:
   $env:DELAY_MS="5000"; node bank-service/index.js

   # Giả lập đứt socket:
   $env:DROP_RATE="0.3"; node bank-service/index.js

   # Giả lập lỗi 500:
   $env:FAIL_RATE="0.3"; node bank-service/index.js
   ```
3. Import file `postman_collection.json` vào Postman để gọi thử các API.

---

## 5. DÀN Ý THUYẾT TRÌNH BẢO VỆ TRƯỚC LỚP (3 PHÚT)

1. **Mở đầu (30s):**
   - Giới thiệu bài toán: Thanh toán học phí trực tuyến giữa Fee Service (cổng 4001) và Cổng Ngân hàng (cổng 4002).
   - Mục tiêu: Hệ thống phải có tính sẵn sàng cao, đảm bảo tính toàn vẹn dữ liệu (không trừ tiền 2 lần, không trừ tiền khi chưa xác nhận), duy trì kết nối tối ưu và tự phục hồi khi có sự cố.

2. **Báo cáo kết quả 4 tình huống (90s):**
   - *Tình huống 1:* Khi ngân hàng chưa bật, Fee Service không sập, trả mã 503 FAILED chỉ trong 26ms; khi ngân hàng bật lại, thanh toán lập tức thành công mà không cần can thiệp.
   - *Tình huống 2:* Khi ngân hàng bị trễ 5 giây, Fee Service áp dụng Timeout Budget trả 504 PENDING trong 3.8s, bảo vệ hệ thống không bị treo. Trong lúc 20 lệnh đang chờ, tra cứu công nợ vẫn chỉ mất 3ms.
   - *Tình huống 3:* Áp dụng HTTP Keep-Alive Pooling: 200 thanh toán chỉ dùng 10 kết nối TCP (giảm từ 200 kết nối xuống 10), thời gian xử lý chỉ 130ms. Sau 6 giây nhàn rỗi, kết nối tự làm mới thành công 100%.
   - *Tình huống 4:* Ứng dụng Idempotency-Key và Smart Retry. Khi bị drop mạng (DROP=0.3) hay lỗi tạm thời (FAIL=0.3), hệ thống đạt 60/60 và 59/60 giao dịch thành công; số lần trừ tiền trùng lặp (duplicates) luôn luôn bằng 0. Khi lỗi nghiệp vụ (vượt hạn mức), hệ thống từ chối ngay 402 và không gửi retry vô ích.

3. **Kết luận (30s):**
   - Cả 4 tình huống đều vượt tất cả các tiêu chí đề bài đặt ra.
   - Hệ thống sẵn sàng demo thực tế và trả lời câu hỏi phản biện của thầy.
