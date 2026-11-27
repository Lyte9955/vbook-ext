load('prompts.js');
load('llm.js');

function execute() {
    var config = {};
    var migratedGeminiKeys = llmParseApiKeys(llmReadConfig("api_key", "")).join("\n");

    // === NHÓM 1: GOOGLE GEMINI (DỊCH CHÍNH) ===
    config[translationConfigKey("api_key_lines")] = {
        title: "1.1. Google Gemini API keys",
        subtitle: "Mỗi dòng 1 API key, chỉ dán thuần API key (không thêm ký hiệu dư thừa); tự dàn tải tránh 429",
        "default": migratedGeminiKeys,
        mode: "input",
        format: "text"
    };
    llmAddGeminiConfig(config);

    // === NHÓM 2: DEEPSEEK / GITAPIHUB (NGỮ CẢNH & CỨU HỘ) ===
    llmAddDeepSeekConfig(config);

    // === NHÓM 3: THAM SỐ DỊCH & HẬU XỬ LÝ ===
    config[translationConfigKey("max_output_tokens")] = {
        title: "3.1. Số token đầu ra tối đa",
        subtitle: "Mặc định 16384; đủ lớn cho cả suy luận (thinking) và chương truyện dài",
        "default": "16384",
        mode: "input",
        format: "number"
    };
    if (LLM_SUPPORTS_TEMPERATURE) {
        config[translationConfigKey("temperature")] = {
            title: "3.2. Temperature (độ sáng tạo)",
            subtitle: "0.0 - 2.0; giá trị thấp (0.2) giúp bản dịch ổn định (tự bỏ qua trên Gemini 4 và 3.6+)",
            "default": "0.2",
            mode: "input",
            format: "number"
        };
    }
    llmAddContextBridgeConfig(config);
    config[translationConfigKey("retry_untranslated_chinese")] = {
        title: "3.4. Tự sửa chữ Hán còn sót",
        subtitle: "Nếu bật mục 2.2 và có DeepSeek sẽ dùng DeepSeek (tự chuyển về Gemini nếu lỗi); nếu tắt mục 2.2 dùng Gemini Flash-Lite (khi bật Eco Mode chỉ sửa khi sót >= 8 chữ)",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("qt_polish_mode")] = {
        title: "3.5. Dịch thô QT rồi AI viết lại mượt (QT-Polish)",
        subtitle: "BẬT: gọi Qt.translate của vBook dịch thô trước (giữ chuẩn 100% Names/VietPhrase & ta-ngươi), sau đó mới gửi AI biên tập lại cho mượt",
        "default": "false",
        mode: "toggle"
    };
    config[translationConfigKey("qt_polish_include_raw")] = {
        title: "3.6. Gửi kèm nguyên văn Trung khi dùng QT-Polish",
        subtitle: "TẮT (Siêu nhanh): chỉ gửi bản QT thô (tiết kiệm ~45% token). BẬT (Chuẩn xác): gửi kèm nguyên văn Trung để AI đối chiếu câu tối nghĩa",
        "default": "false",
        mode: "toggle"
    };

    // === NHÓM 4: PROMPT & BỘ NHỚ DỊCH ===
    config[translationConfigKey("use_translation_memory")] = {
        title: "4.1. Sử dụng bộ nhớ dịch (Glossary)",
        subtitle: "Tự nạp tên riêng, địa danh, thuật ngữ và từ điển Names/VietPhrase của truyện vào thẻ <glossary>",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("auto_translation_memory")] = {
        title: "4.2. Tự học bộ nhớ bằng Gemini (dự phòng)",
        subtitle: "Chỉ chạy khi tắt Eco Mode và không dùng DeepSeek điều phối ngữ cảnh",
        "default": "false",
        mode: "toggle"
    };
    config[translationConfigKey("memory_analysis_chapters")] = {
        title: "4.3. Số chương phân tích mỗi lần chạy Action",
        subtitle: "Action 'Phân tích tên nhân vật và quan hệ' sẽ đọc từ chương đang đọc trở đi, tối đa theo số này",
        "default": "5",
        mode: "input",
        format: "number"
    };
    config[translationConfigKey("system_prompt")] = {
        title: "4.4. Prompt hệ thống mặc định (toàn cục)",
        subtitle: "Áp dụng cho mọi truyện không có prompt riêng; giữ các biến {source_language}, {target_language}, {style_prompt}, {source_prompt}, {custom_instruction}, {memory_prompt}",
        "default": translationDefaultSystemPrompt(),
        mode: "input",
        format: "text"
    };
    config.translation_prompts = {
        title: "4.5. Danh sách Prompt phong cách dịch",
        subtitle: "Dùng chung cho mọi truyện; khi thêm mới hãy để trống bookId, key là ID style và value là nội dung prompt",
        mode: "database"
    };

    initializeTranslationPrompts();

    var bookInfo = null;
    try {
        bookInfo = localBook.getInfo();
    } catch (e) {}

    if (bookInfo && bookInfo.id) {
        var bookPromptKey = translationConfigKey(translationBookPromptConfigKey(String(bookInfo.id)));
        config[bookPromptKey] = {
            title: "4.6. Prompt / Yêu cầu riêng cho truyện này",
            subtitle: "Chỉ áp dụng cho truyện hiện tại; nếu dán trọn bộ XML <prompt>...</prompt> sẽ tự ghi đè sạch prompt mặc định",
            "default": "",
            mode: "input",
            format: "text"
        };
        config.translation_memory = {
            title: "4.7. Quản lý bộ nhớ dịch của truyện này",
            subtitle: "Xem, thêm, sửa hoặc xóa thủ công tên riêng, địa danh, thuật ngữ và quan hệ nhân vật đã lưu",
            mode: "database"
        };
    }

    // === NHÓM 5: DỊCH PHỤ TRỢ (QT / BAIDU MIỄN PHÍ) ===
    config[translationConfigKey("use_qt_fallback")] = {
        title: "5.1. Ưu tiên QT offline cho mục lục & chi tiết",
        subtitle: "Khuyên BẬT: dịch mục lục/chi tiết cực nhanh, khớp bộ Names và không tốn quota API",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("translate_table_of_content")] = {
        title: "5.2. Dùng AI dịch mục lục (tốn quota)",
        subtitle: "Khuyên TẮT để dùng QT offline + Baidu miễn phí cho hàng nghìn tên chương",
        "default": "false",
        mode: "toggle"
    };
    config[translationConfigKey("translate_detail")] = {
        title: "5.3. Dùng AI dịch giới thiệu truyện (tốn quota)",
        subtitle: "Khuyên TẮT để dùng QT offline + Baidu miễn phí",
        "default": "false",
        mode: "toggle"
    };
    config[translationConfigKey("translate_discovery")] = {
        title: "5.4. Dùng AI dịch mục khám phá (tốn quota)",
        subtitle: "Khuyên TẮT để tiết kiệm hạn mức ngày cho việc dịch chương truyện",
        "default": "false",
        mode: "toggle"
    };

    return Response.success(config);
}

function initializeTranslationPrompts() {
    try {
        var defaults = translationDefaultPrompts();
        var rows = [];
        var total = localDatabase.count(TRANSLATION_PROMPT_SCOPE, TRANSLATION_PROMPT_TABLE);
        if (total === 0) {
            for (var style in defaults) {
                if (!defaults.hasOwnProperty(style)) continue;
                rows.push({ key: style, value: defaults[style] });
            }
        } else {
            var storedPrompts = {};
            var storedRows = localDatabase.list(
                TRANSLATION_PROMPT_SCOPE,
                TRANSLATION_PROMPT_TABLE,
                0,
                total
            );
            for (var rowIndex = 0; storedRows && rowIndex < storedRows.length; rowIndex++) {
                storedPrompts[String(storedRows[rowIndex].key || "")] = String(storedRows[rowIndex].value || "");
            }
            var definitions = translationDefaultStyleDefinitions();
            for (var index = 0; index < definitions.length; index++) {
                var definition = definitions[index];
                var stored = storedPrompts[definition.id];
                var isOldPronounStyle = stored && (
                    stored.indexOf("Xưng hô phải theo") >= 0 ||
                    stored.indexOf("Xưng hô theo ") >= 0 ||
                    stored.indexOf("Xưng hô, kính ngữ") >= 0 ||
                    stored.indexOf("Xưng hô gia đình") >= 0 ||
                    stored.indexOf("Xưng hô vẫn dựa trên") >= 0 ||
                    stored.indexOf("Tước vị và xưng hô") >= 0 ||
                    stored.indexOf("thay đổi xưng hô khi quan hệ") >= 0 ||
                    stored.indexOf("nếu vai vế/tình huống không thay đổi") >= 0 ||
                    (definition.id === "vo-han-luu" && stored.indexOf("THỂ LOẠI VÔ HẠN LƯU / PHÓ BẢN / SINH TỒN:") === 0 && stored.indexOf("KHÓA CỨNG TA - NGƯƠI") < 0) ||
                    (definition.id === "do-thi" && stored.indexOf("THỂ LOẠI ĐÔ THỊ HIỆN ĐẠI:") === 0 && stored.indexOf("KHÓA CỨNG TA - NGƯƠI") < 0) ||
                    (definition.id === "ngon-tinh-hien-dai" && stored.indexOf("THỂ LOẠI NGÔN TÌNH HIỆN ĐẠI:") === 0 && stored.indexOf("KHÓA CỨNG TA - NGƯƠI") < 0)
                );
                if (stored === translationLegacyPrompt(definition.rule) ||
                    isOldPronounStyle ||
                    (definition.id === "tu-nhien" && stored === undefined)) {
                    rows.push({ key: definition.id, value: definition.rule });
                }
            }
        }
        if (rows.length > 0) localDatabase.upsertAll(TRANSLATION_PROMPT_SCOPE, TRANSLATION_PROMPT_TABLE, rows);
    } catch (e) {}
}
