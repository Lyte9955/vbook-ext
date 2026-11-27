# vBook Extension — Gemini + DeepSeek Hybrid (Workspace cho Google Antigravity)

Workspace này đã được cấu hình sẵn cho **Google Antigravity App** (gồm `GEMINI.md`, `.agents/rules/*.md`, mã nguồn `v37` đã giải nén, script build 1 lệnh và bộ test tự động).

## Bắt đầu nhanh trong Google Antigravity
1. Giải nén thư mục `vbook-ext/` vào máy tính (hoặc copy đè vào thư mục đã `git clone https://github.com/Lyte9955/vbook-ext.git`).
2. Mở thư mục `vbook-ext/` bằng **Google Antigravity App** — Antigravity sẽ tự đọc `GEMINI.md` và `.agents/rules/*.md`.
3. Mỗi lần chỉnh code xong trong `gemini-deepseek-hybrid/src/`, chạy:
   ```bash
   python3 scripts/build.py --bump
   ```
   Lệnh này tự động tăng version (`v37 -> v38`), kiểm tra cú pháp, chạy toàn bộ test mô phỏng vBook và đóng gói lại `gemini-deepseek-hybrid/plugin.zip`.
4. Commit & Push lên nhánh `main` ngay trong panel Git của Antigravity (hoặc terminal):
   ```bash
   git add plugin.json gemini-deepseek-hybrid/
   git commit -m "release: v38"
   git push origin main
   ```
