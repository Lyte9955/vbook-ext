# Dự án vBook Extension: Gemini + DeepSeek Hybrid

## 1. Tổng quan & Trạng thái hiện tại
- **Phiên bản hiện tại**: `v41` (14/14 test PASS).
- **Kho GitHub kệ vBook**: `Lyte9955/vbook-ext` (nhánh `main`).
- **Link kệ trên vBook**: `https://raw.githubusercontent.com/Lyte9955/vbook-ext/main/plugin.json`
- **App mục tiêu**: vBook Android `1.2.9` (APK tham khảo ở `tools/`, đã bị `.gitignore`).
- **Tài nguyên của người dùng**:
  - **60 API key Google Gemini** (6 tài khoản × 10 project, xếp xen kẽ).
  - **1 API key DeepSeek (Gitapihub)**: `https://api.gitapihub.com/v1/chat/completions` — chỉ dùng **cứu hộ**.
  - **Cấu hình vBook Android**: 1 luồng, giãn cách `1000ms`, tắt Cronet, thử lại `5` lần; `max_length: 4500`, `max_line: 180`.

## 2. Cấu trúc thư mục & Quy tắc đóng gói BẮT BUỘC
- `plugin.json` (gốc): **BẮT BUỘC** giữ `"path"` trỏ tới `gemini-deepseek-hybrid/plugin.zip`.
- `gemini-deepseek-hybrid/src/*.js`: 15 tệp JS thuần **ES5 / Mozilla Rhino**.
- `gemini-deepseek-hybrid/plugin.json`: `version` phải khớp `plugin.json` gốc và `src/status-check.js`.
- `gemini-deepseek-hybrid/plugin.zip`: gốc zip chỉ chứa `icon.png`, `plugin.json`, `src/*.js`.
- `scripts/build.py`: kiểm tra cú pháp, chạy test, đóng gói (`--bump` để tăng version).
- `tests/run_tests.js`: 14 test mô phỏng runtime vBook trên Node.js.
- Môi trường Windows: Node.js LTS + Git đã cài qua winget; cần nạp lại PATH (`Machine` + `User`) trước khi gọi `node`/`git`; dùng `python` (không phải `python3`).

## 3. Kiến trúc v40: "60 key Gemini gánh 99%, DeepSeek chỉ cứu hộ"
1. **Dịch chính (`src/llm.js`)**: xoay vòng tuần tự 60 key, lướt key 401/403 và 429; Circuit Breaker né model nặng 10 phút khi 504; cache model 404.
2. **Ngữ cảnh truyện**: mục `2.2` mặc định **TẮT** → `gemini-3.5-flash-lite` cập nhật `story_state` theo chu kỳ mục `2.2b` (mặc định 2 chương); cầu nối cuối chương lưu mọi chương. `2.2` BẬT → DeepSeek, lỗi thì tự rơi về Gemini.
3. **DeepSeek cứu hộ (`2.4`)**: khi Gemini chặn `PROHIBITED_CONTENT/SAFETY`, cắt `max_tokens`, hoặc lỗi toàn chuỗi model.
4. **Cầu dao DeepSeek**: HTTP 401/402/403 → tạm ngắt key 6 giờ (`dsAuthDead` trong `gemini_ft_state_v2`); `reset-keys` gỡ ngay.
5. **QT-Polish (`3.5`/`3.6`)** + Adaptive Gate (8–25% sót Hán tự kèm nguyên văn, >25% bỏ QT) + Echo-Guard (bản QT ≥200 ký tự bị chép y nguyên thì dịch lại).
6. **Đồng bộ từ điển QuickTranslator (`4.2b`/`4.2c`/`4.2d`)**: từ AI học được lưu vào `translation_memory`, mặc định chỉ đồng bộ Tên riêng (`character`/`place`/`organization`) sang `localBook.addQtName` sau khi xuất hiện lại (mặc định 2 lần); `4.2d` mặc định **TẮT** (nếu bật chỉ ghi `term` >= 3 chữ Hán chưa có trong `Qt.translate` gốc sang `addQtVietPhrase`); không bao giờ ghi đè từ đã có; nhật ký 30 từ gần nhất hiện trong `status-check`. vBook 1.2.9 **không có API xóa**, sửa từ sai thủ công trong vBook.
7. **Khóa cứng đại từ & chuẩn hóa TTS (`src/translate.js`)**: `<hard_pronoun_lock>` luôn ở cuối `systemInstruction`; `sanitizeTranslationOutput()` chuẩn hóa dấu câu CJK và khoảng trắng.
8. **6 Action**: `status-check`, `analyze-memory`, `capture-context`, `reset-context`, `reset-keys`, `reset-defaults`.

## 4. Quy trình làm việc chuẩn
1. Sửa mã trong `gemini-deepseek-hybrid/src/` (chỉ ES5).
2. `python scripts/build.py --bump` → phải đạt 100% test PASS.
3. `git add plugin.json gemini-deepseek-hybrid/ tests/` → `git commit -m "chore: release vXX"` → `git push origin main`.
