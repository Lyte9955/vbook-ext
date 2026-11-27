load('prompts.js');
load('llm.js');

function execute() {
    try {
        var cleared = localDatabase.clear(TRANSLATION_PROMPT_SCOPE, TRANSLATION_PROMPT_TABLE);
        if (!cleared) return Response.error("Không thể xóa các prompt đã sửa");

        var defaults = translationDefaultPrompts();
        var rows = [];
        for (var style in defaults) {
            if (defaults.hasOwnProperty(style)) {
                rows.push({ key: style, value: defaults[style] });
            }
        }
        if (rows.length > 0) {
            var inserted = Number(localDatabase.upsertAll(
                TRANSLATION_PROMPT_SCOPE,
                TRANSLATION_PROMPT_TABLE,
                rows
            ));
            if (inserted !== rows.length) {
                return Response.error("Không thể khôi phục đầy đủ prompt mặc định");
            }
        }
        translationNextConfigGeneration();
        if (typeof llmResetKeyState === "function") llmResetKeyState(true);
        try { localStorage.removeItem("baidu_acs_token"); localStorage.removeItem("baidu_browser_fail_until"); } catch (eBd) {}
        return Response.success("Đã khôi phục toàn bộ cấu hình, trạng thái xoay vòng API key và prompt về mặc định. Hãy mở lại trang cài đặt extension.");
    } catch (e) {
        return Response.error("Không thể khôi phục cài đặt gốc: " + String(e));
    }
}
