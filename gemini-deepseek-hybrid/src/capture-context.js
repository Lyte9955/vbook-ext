load('prompts.js');
load('llm.js');

function captureCleanText(value) {
    var text = String(value || "");
    if (/<(?:p|div|br|span|h[1-6]|li|section|article|blockquote|html|body)\b[^>]*>/i.test(text)) {
        try {
            var withBreaks = text
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, "\n");
            text = String(Html.parse(withBreaks).text() || "");
        } catch (e) {}
    }
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function capturePickChapterText(chapterData) {
    if (!chapterData || !chapterData.content) return { text: "", isVietnamese: false };
    var c = chapterData.content;
    if (typeof c === "string") {
        var cleanStr = captureCleanText(c);
        return { text: cleanStr, isVietnamese: translationLooksVietnamese(cleanStr) };
    }
    var raw = c.raw !== null && c.raw !== undefined ? c.raw : c[""];
    if (raw === null || raw === undefined) {
        for (var k in c) {
            if (Object.prototype.hasOwnProperty.call(c, k) && c[k]) {
                raw = c[k];
                break;
            }
        }
    }
    var cleanRaw = captureCleanText(raw);

    // Chỉ ưu tiên bản tiếng Việt nếu đủ dài (>= 250 ký tự hoặc không bị cụt so với bản gốc)
    var viCandidates = [c.vi, c["vi-VN"], c.translated];
    for (var i = 0; i < viCandidates.length; i++) {
        if (viCandidates[i] !== null && viCandidates[i] !== undefined) {
            var cleanVi = captureCleanText(viCandidates[i]);
            var minViLen = cleanRaw.length >= 250 ? Math.max(250, Math.floor(cleanRaw.length * 0.7)) : 60;
            if (cleanVi.length >= minViLen) return { text: cleanVi, isVietnamese: true };
        }
    }
    return { text: cleanRaw, isVietnamese: translationLooksVietnamese(cleanRaw) };
}

function captureBuildHeadTailSample(text) {
    var full = String(text || "").trim();
    if (full.length <= 10000) return full;
    // Ghép 4.000 ký tự đầu + 6.000 ký tự cuối để AI luôn thấy trọn vẹn diễn biến kết chương
    return full.substring(0, 4000).trim() +
        "\n\n[...lược phần giữa chương...]\n\n" +
        full.substring(full.length - 6000).trim();
}

function execute() {
    if (!llmReadBoolConfig("use_context_bridge", true)) {
        return Response.error("Mục 3.3 (Cầu nối ngữ cảnh giữa các chương) đang TẮT. Hãy bật mục 3.3 trước khi chạy Action thu thập ngữ cảnh.");
    }

    var info;
    try {
        info = localBook.getInfo();
    } catch (e) {
        return Response.error("Không lấy được thông tin truyện: " + String(e));
    }
    if (!info || !info.id) {
        return Response.error("Action này chỉ dùng khi mở cài đặt từ bên trong một truyện.");
    }

    var bookId = String(info.id);
    var pos = parseInt(info.lastReadChapterIndex, 10);
    if (isNaN(pos) || pos < 0) pos = 0;

    var chapterData;
    try {
        chapterData = localBook.getChapterContent(pos);
    } catch (eCh) {
        return Response.error("Không đọc được nội dung chương hiện tại (vị trí " + pos + "): " + String(eCh));
    }

    var picked = capturePickChapterText(chapterData);
    if (!picked.text || picked.text.length < 40) {
        return Response.error("Chương hiện tại (vị trí " + pos + ") chưa có nội dung tải về hoặc quá ngắn để thu thập ngữ cảnh.");
    }

    var hasDs = typeof llmHasDeepSeek === "function" && llmHasDeepSeek();
    var gemKeys = llmReadGeminiKeys();
    if (!hasDs && gemKeys.length === 0) {
        var dsRawCount = llmReadDeepSeekKeys().length;
        if (dsRawCount > 0 && !llmReadBoolConfig("enable_deepseek", true)) {
            return Response.error("Bạn đang TẮT công tắc DeepSeek (mục 2.0) và chưa có Gemini key. Hãy bật mục 2.0 hoặc thêm Gemini key.");
        }
        return Response.error("Vui lòng nhập DeepSeek hoặc Gemini API key trước khi thu thập ngữ cảnh.");
    }

    var sample = captureBuildHeadTailSample(picked.text);
    var instruction = "Bạn là bộ não điều phối ngữ cảnh cho hệ thống dịch tiểu thuyết mạng Trung Quốc sang tiếng Việt. " +
        "Dựa vào nội dung chương vừa mở, hãy trả về DUY NHẤT 1 đối tượng JSON hợp lệ (không Markdown) gồm 2 trường:\n" +
        "1) \"story_state\" (tối đa 140 từ tiếng Việt): gồm 2 phần rõ ràng: [BỐI CẢNH] bối cảnh/phó bản hiện tại, nhân vật đang có mặt và tình tiết kết chương; " +
        "[XƯNG HÔ] chỉ ghi danh xưng chuẩn và cặp đại từ khóa cứng ta - ngươi hoặc ta - ngài (CẤM ghi tôi/tớ/cậu/bạn/anh-em/chú-cháu/con-mẹ).\n" +
        "2) \"tail\" (chuỗi tiếng Việt 2-3 câu, tối đa 400 ký tự): trích lại (hoặc dịch sang tiếng Việt nếu nguồn là tiếng Trung) đúng 2-3 câu cuối cùng của chương để nối mạch văn cho chương kế tiếp.";

    var userText = "NỘI DUNG CHƯƠNG (vị trí " + pos + "):\n" + sample;
    var res;
    var engineUsed = "";
    if (hasDs) {
        engineUsed = "DeepSeek";
        res = llmDeepSeekRequest(instruction, userText, { temperature: 0.1, maxTokens: 1024, json: true }, 45000);
        if ((res.error || !res.text) && gemKeys.length > 0) {
            engineUsed = "Gemini (dự phòng sau lỗi DeepSeek)";
            res = llmRequest(
                gemKeys,
                llmBuildBody(LLM_ANALYSIS_MODEL, instruction, userText, { temperature: 0.1, maxTokens: 1024, json: true, bookId: bookId }),
                45000
            );
        }
    } else {
        engineUsed = "Gemini";
        res = llmRequest(
            gemKeys,
            llmBuildBody(LLM_ANALYSIS_MODEL, instruction, userText, { temperature: 0.1, maxTokens: 1024, json: true, bookId: bookId }),
            45000
        );
    }

    if (res.error || !res.text) {
        return Response.error("Không thu thập được ngữ cảnh chương " + pos + " (" + engineUsed + "): " + (res.error || "trả về rỗng"));
    }

    var parsed = llmExtractJsonObject(res.text);
    var nextState = parsed && typeof parsed.story_state === "string" ? parsed.story_state.trim() : "";
    var nextTail = parsed && typeof parsed.tail === "string" ? parsed.tail.trim() : "";

    if (!nextState || nextState.length < 30) {
        return Response.error("Kết quả ngữ cảnh chương " + pos + " quá ngắn hoặc JSON không hợp lệ, chưa ghi đè ngữ cảnh cũ.");
    }

    try {
        localStorage.removeItem(LLM_STORY_STATE_PREFIX + bookId);
        localStorage.removeItem(LLM_CONTEXT_BRIDGE_PREFIX + bookId);
        localStorage.removeItem(LLM_DS_SYNC_COUNT_PREFIX + bookId);
    } catch (eRm) {}

    llmSaveStoryState(bookId, nextState);
    if (picked.isVietnamese) {
        llmSaveContextBridge(bookId, picked.text, 40);
    } else if (nextTail && nextTail.length >= 40) {
        llmSaveContextBridge(bookId, nextTail, 40);
    }

    var savedState = llmLoadStoryState(bookId);
    var savedBridge = llmLoadContextBridge(bookId);
    var preview = savedState.length > 260 ? savedState.substring(0, 260) + "..." : savedState;
    var msg = "Đã thu thập ngữ cảnh từ chương #" + pos + " bằng " + engineUsed +
        " (giữ nguyên trạng thái RPD của " + gemKeys.length + " key Gemini).\n" +
        "- story_state: " + savedState.length + " ký tự\n" +
        "- Cầu nối cuối chương: " + (savedBridge ? savedBridge.length + " ký tự" : "trống") + "\n" +
        "- Tóm tắt đã lưu: " + preview;
    console.log(msg);
    return Response.success(msg);
}
