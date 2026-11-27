---
trigger: always_on
description: Quy tắc tương thích bắt buộc cho Mozilla Rhino JS Engine trên vBook Android và cấu trúc gói plugin.zip.
---
# Quy tắc Runtime vBook Android (Mozilla Rhino)

1. **Chỉ dùng cú pháp ES5 thuần**:
   - TUYỆT ĐỐI CẤM: `let`, `const`, arrow function (`=>`), template literals (`` `...` ``), optional chaining (`?.`), nullish coalescing (`??`), destructuring, spread (`...`), default parameters, `class`, `for..of`, `async/await`.
   - TUYỆT ĐỐI CẤM các method ES6+: `Array.prototype.includes`, `String.prototype.startsWith`, `endsWith`, `replaceAll`, `padStart`, `Object.entries`, `Object.values`, `Object.assign`.
   - Bọc ngoặc kép từ khóa ES3 làm tên thuộc tính: `"default": ...`, `"with": ...`, `obj["with"]`.
   - Dùng `new Date().getTime()` thay cho `Date.now()`.
2. **Phòng vệ Java String / List coercion trên Rhino**:
   - Luôn ép `String(...)` trước khi gọi `.replace(RegExp)`, `.split()`, `JSON.parse()` hoặc so sánh chặt `===` với giá trị trả về từ `localStorage`, `localConfig`, `response.text()`, `Html.parse().text()`, hay tham số `execute(...)`.
   - Không gọi `.push()` hoặc `.sort()` trực tiếp lên kết quả của `localDatabase.list()` hoặc `localBook.getTableOfContent()` mà hãy sao chép sang mảng JS thuần trước.
3. **Đóng gói chuẩn vBook**:
   - Giữ cố định tên tệp `gemini-deepseek-hybrid/plugin.zip` trong `plugin.json` gốc.
   - Luôn chạy `python3 scripts/build.py` và đảm bảo 100% test PASS trước khi commit.
