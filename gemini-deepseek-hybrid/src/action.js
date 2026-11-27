load('prompts.js');
load('llm.js');

function execute() {
    var dsOn = llmHasDeepSeek();
    var bridgeOn = llmReadBoolConfig("use_context_bridge", true);
    var actions = {
        check_key_status: {
            name: "1. Kiểm tra số key & trạng thái ngữ cảnh",
            description: "Xem số key SẴN SÀNG/RPD/RPM theo từng model, vị trí con trỏ tuần tự và trạng thái ngữ cảnh",
            script: "status-check.js"
        }
    };
    try {
        var book = localBook.getInfo();
        if (book && book.id) {
            var pos = parseInt(book.lastReadChapterIndex, 10);
            if (isNaN(pos) || pos < 0) pos = 0;
            var bid = String(book.id);
            var stLen = 0;
            try { stLen = String(localStorage.getItem(LLM_STORY_STATE_PREFIX + bid) || "").trim().length; } catch (eS) {}

            actions.analyze_translation_memory = {
                name: "2. Phân tích tên nhân vật và quan hệ",
                description: (dsOn ? "[Động cơ: DeepSeek]" : "[Đang chạy thuần Gemini — tốn RPD]") +
                    " Đọc từ chương #" + pos + " trở đi để cập nhật bộ nhớ dịch",
                script: "analyze-memory.js"
            };
            actions.capture_book_context = {
                name: "3. Thu thập ngữ cảnh từ chương đang mở",
                description: (!bridgeOn ? "[Cảnh báo: Mục 3.3 đang TẮT] " : "") +
                    "Đọc chương #" + pos + " tạo story_state & cầu nối mới (hiện có: " + stLen + " ký tự; giữ nguyên RPD key)",
                script: "capture-context.js"
            };
            actions.reset_book_context = {
                name: "4. Làm mới ngữ cảnh mạch truyện hiện tại",
                description: "Chỉ xóa ngữ cảnh chương trước (hiện có: " + stLen + " ký tự) khi nhảy cóc chương. Giữ nguyên RPD key và bộ nhớ từ điển",
                script: "reset-context.js"
            };
        }
    } catch (e) {}
    actions.reset_key_cooldown = {
        name: "5. Gỡ cooldown API key",
        description: "Mở khóa trạng thái RPD/RPM/401/403/quá tải 504 của key (giữ nguyên vị trí con trỏ, nhật ký lỗi, danh sách key và ngữ cảnh truyện)",
        script: "reset-keys.js"
    };
    actions.restore_defaults = {
        name: "6. Khôi phục toàn bộ cài đặt gốc",
        description: "Đặt lại toàn bộ cấu hình (gồm API key, prompt riêng từng truyện, token Baidu) và prompt mặc định (không xóa bộ nhớ dịch đã lưu)",
        script: "reset-defaults.js"
    };
    return Response.success(actions);
}
