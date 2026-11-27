# Dự án vBook Extension: Gemini + DeepSeek Hybrid

## 1. Tổng quan & Trạng thái hiện tại
- **Phiên bản hiện tại**: `v37` (ổn định, đã kiểm thử).
- **Kho GitHub kệ vBook**: `Lyte9955/vbook-ext` (nhánh `main`).
- **Link kệ trên vBook**: `https://raw.githubusercontent.com/Lyte9955/vbook-ext/main/plugin.json`
- **Tài nguyên của người dùng**:
  - **60 API key Google Gemini** (6 tài khoản × 10 project, đã xếp xen kẽ sẵn theo thứ tự tài khoản).
  - **1 API key DeepSeek (Gitapihub)**: `https://api.gitapihub.com/v1/chat/completions`.
  - **Cấu hình vBook Android**: 1 luồng, giãn cách `1000ms`, tắt Cronet, thử lại `5` lần; `max_length: 4500`, `max_line: 180`.

## 2. Cấu trúc thư mục & Quy tắc đóng gói BẮT BUỘC
- `plugin.json` (gốc): Danh mục kệ vBook. **BẮT BUỘC** giữ cố định `"path"` trỏ tới `gemini-deepseek-hybrid/plugin.zip` (KHÔNG đổi tên thành `plugin-vXX.zip` để vBook nhận cập nhật trực tiếp).
- `gemini-deepseek-hybrid/src/*.js`: 15 tệp mã nguồn JS thuần **ES5 / Mozilla Rhino**.
- `gemini-deepseek-hybrid/plugin.json`: Metadata nội bộ của extension (số `version` phải khớp với `plugin.json` gốc và chuỗi phiên bản trong `src/status-check.js`).
- `gemini-deepseek-hybrid/plugin.zip`: Gói đóng sẵn cho vBook (ở gốc zip chỉ chứa `icon.png`, `plugin.json`, `src/*.js` — không có thư mục bọc ngoài).
- `scripts/build.py`: Tự kiểm tra cú pháp, chạy test và đóng gói `gemini-deepseek-hybrid/plugin.zip`.
- `tests/run_tests.js`: Bộ kiểm thử mô phỏng runtime vBook Android trên Node.js.

## 3. Các tính năng cốt lõi đang có ở v37
1. **Xoay vòng 60 key Gemini (`src/llm.js`)**:
   - Gọi tuần tự từ trên xuống dưới (`sequential_key_order`, mặc định BẬT), tự lướt qua key chết 401/403 và quét trọn 60/60 key khi gặp 429 RPD/RPM nhanh (`< 8s`).
   - Ngân sách thời gian: lượt 1 tối đa `38s` / trần tường `95s`; gặp HTTP 504 ở model nặng (`4-hydrogen`, `3.8-flash`, `3.6-flash`) nhảy thẳng sang `gemini-3.5-flash-lite`.
   - **Circuit Breaker (`modelOverload`)**: model nặng dính 504 `>= 25s` hoặc 2 lỗi liên tiếp tự tạm tránh `10 phút` trên toàn bộ 60 key. Cache model 404 (`modelDead` 1 giờ).
2. **Công tắc tổng DeepSeek (`2.0. enable_deepseek`)**:
   - BẬT: DeepSeek quản lý `story_state`, học bộ nhớ, sửa chữ Hán sót, cứu hộ khi Gemini lỗi (`deepseek-flash` cap `50s`, model chậm cap `35s` để kịp hạ về `deepseek-flash`), phân tích nhân vật (`analyze-memory.js` chỉ dùng DeepSeek khi bật).
   - TẮT: Chạy thuần Gemini 100%, không cần xóa key ở mục 2.1.
3. **Chế độ QT-Polish (`3.5. qt_polish_mode` & `3.6. qt_polish_include_raw`)**:
   - Gọi `Qt.translate` của vBook dịch thô trước để chốt tên riêng từ bộ Names/VietPhrase, sau đó AI biên tập mượt.
   - Có **Adaptive Gate** (`8%–25%` sót Hán tự kèm nguyên văn; `> 25%` bỏ QT dịch thẳng) và **Echo-Guard** (chống AI chép nguyên bản convert).
4. **Khóa cứng đại từ Trung văn & Chuẩn hóa TTS (`src/translate.js`, `src/prompts.js`)**:
   - `<hard_pronoun_lock>` đặt ở **cuối cùng** `systemInstruction` (Recency priority): khóa cứng `我=ta`, `你=ngươi`, `您=ngài`, `我们/咱们=chúng ta`, `你们=các ngươi`, `他=hắn/y/gã/lão`, `她=nàng/cô`. Cấm `tôi`, `tớ`, `cậu`, `mình`, `bạn`, `anh/em`, `chú/cháu`, `tao/mày`, `anh ấy/cô ấy`. (Lưu ý: để trống mục `4.6` nếu không muốn ghi đè `<hard_pronoun_lock>`).
   - `sanitizeTranslationOutput()` chuẩn hóa dấu câu CJK full-width (`，。：；！？……——`), đổi `《...》` → `'...'`, xóa dòng `——————`, chuẩn khoảng trắng TTS (bảo vệ tuyệt đối URL, HTML, số liệu).
5. **Hệ thống 6 Action (`src/action.js`)**:
   - `1. status-check.js`: Bảng theo dõi 60 key (`#X/60`, số key SẴN SÀNG theo model, `modelOverload`, trạng thái DeepSeek & QT-Polish).
   - `2. analyze-memory.js`: Phân tích nhân vật/quan hệ (khối 12k ký tự, bỏ qua chương lỗi không dừng cả lô).
   - `3. capture-context.js`: Thu thập ngữ cảnh (`story_state` + cầu nối) từ chương đang mở (Head 4k + Tail 6k, giữ nguyên RPD 60 key).
   - `4. reset-context.js`: Chỉ xóa ngữ cảnh truyện hiện tại (giữ nguyên RPD key).
   - `5. reset-keys.js`: Chỉ gỡ cooldown key (giữ nguyên vị trí con trỏ, nhật ký lỗi và ngữ cảnh truyện).
   - `6. reset-defaults.js`: Khôi phục cài đặt gốc + dọn token Baidu.

## 4. Quy trình làm việc chuẩn trên Antigravity
1. Chỉnh sửa mã nguồn trong `gemini-deepseek-hybrid/src/`.
2. Chạy kiểm thử + đóng gói:
   ```bash
   python3 scripts/build.py          # Kiểm thử & đóng gói giữ nguyên version
   python3 scripts/build.py --bump   # Tăng version +1 (vd 37 -> 38), kiểm thử & đóng gói
   ```
3. Commit và đẩy lên nhánh `main` của `Lyte9955/vbook-ext`:
   ```bash
   git add plugin.json gemini-deepseek-hybrid/
   git commit -m "chore: release v38"
   git push origin main
   ```
