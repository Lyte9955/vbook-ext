---
trigger: always_on
description: Quy tắc ngôn ngữ, khóa cứng đại từ tiểu thuyết mạng Trung Quốc và chuẩn hóa TTS.
---
# Quy tắc Ngôn ngữ & Văn phong Tiểu thuyết mạng Trung Quốc

1. **Khóa cứng đại từ (`<hard_pronoun_lock>`)**:
   - Luôn đặt `<hard_pronoun_lock>` ở **cuối cùng** của `systemInstruction` (sau `<story_state>` và `<previous_tail>`) để thắng hiệu ứng Recency trên Gemini Flash-Lite (`MINIMAL`).
   - Ánh xạ cứng: `我 -> ta`, `你 -> ngươi`, `您 -> ngài`, `我们/咱们 -> chúng ta`, `你们 -> các ngươi`, `他 -> hắn/y/gã/lão`, `她 -> nàng/cô`.
   - Cấm tuyệt đối đại từ Việt Nam (`tôi`, `tớ`, `cậu`, `mình`, `bạn`, `anh/em`, `chị/em`, `chú/cháu`, `tao/mày`, `anh ấy/cô ấy`) ở mọi phong cách.
2. **Danh xưng & Từ mượn**:
   - Giữ nguyên `[Họ/Tên + hậu tố viết thường]` (`Lâm ca`, `Phùng lão sư`, `Trương đội`, `Vương tổng`) và `[tiền tố viết thường + Họ]` (`lão Vương`, `tiểu Trần`).
   - Chuẩn học đường: `学长=học trưởng`, `学姐=học tỷ`, `学弟=học đệ`, `学妹=học muội` (cấm bịa `học nữ`).
   - Tên/từ mượn phương Tây dùng dạng phổ thông (`Holmes`, `Cthulhu`, `sâm-panh`, `Tarot`, `sofa`).
3. **Bảo toàn định dạng TTS**:
   - Không phá vỡ URL, thẻ HTML, số thập phân (`3.14`), giờ (`12:30`), ký hiệu che từ `**` rời rạc.
   - Đổi `《...》` sang `'...'` để tránh lồng ngoặc thoại `“...”`; xóa dòng phân cảnh `——————` đứng trơ trọi.
