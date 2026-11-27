load('llm.js');

function execute() {
    try {
        llmResetKeyState();
        var msg = "Đã gỡ toàn bộ trạng thái cooldown/RPD của API key. Danh sách API key, ngữ cảnh mạch truyện hiện tại, bộ nhớ từ điển và prompt vẫn được giữ nguyên.";
        console.log(msg);
        return Response.success(msg);
    } catch (e) {
        return Response.error("Không thể gỡ cooldown API key: " + String(e));
    }
}
