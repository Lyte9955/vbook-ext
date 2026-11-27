load('llm.js');

function execute() {
    try {
        var info = localBook.getInfo();
        if (!info || !info.id) {
            return Response.error("Action này chỉ dùng khi mở cài đặt từ bên trong một truyện.");
        }
        var bookId = String(info.id);
        localStorage.removeItem(LLM_STORY_STATE_PREFIX + bookId);
        localStorage.removeItem(LLM_CONTEXT_BRIDGE_PREFIX + bookId);
        localStorage.removeItem(LLM_DS_SYNC_COUNT_PREFIX + bookId);

        var msg = "Đã làm mới ngữ cảnh mạch truyện hiện tại (story_state, cầu nối chương). Trạng thái RPD/cooldown của API key, bộ nhớ từ điển và prompt vẫn được giữ nguyên.";
        console.log(msg);
        return Response.success(msg);
    } catch (e) {
        return Response.error("Không thể làm mới ngữ cảnh truyện: " + String(e));
    }
}
