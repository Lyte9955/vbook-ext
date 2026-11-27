load('baidu.js');
load('prompts.js');
load('llm.js');

var TRANSLATION_MEMORY_TABLE = "translation_memory";
var MAX_MEMORY_ROWS = 2000;
var MAX_MEMORY_MATCHES = 80;
var MAX_LEARNED_ITEMS = 20;
var MAX_CHINESE_REPAIR_FRAGMENTS = 40;
var CHINESE_FRAGMENT_CONTEXT_LENGTH = 160;
var CHAPTER_SOFT_BUDGET_MS = 55000;
var CHAPTER_HARD_BUDGET_MS = 85000;

function execute(text, from, to, source, model, style) {
    var chapterStartMs = new Date().getTime();
    text = String(text || "");
    from = String(from || "auto");
    to = String(to || "");
    source = String(source || "");
    model = llmNormalizeModel(model);
    style = String(style || "natural");

    if (!text) {
        return Response.success("");
    }
    if (!to) {
        return Response.error("Chưa chọn ngôn ngữ đích");
    }

    // Without a key the engine reports it instead of silently translating with QT/Baidu.
    var apiKeys = readApiKeys();
    if (apiKeys.length === 0 && !(typeof llmHasDeepSeek === "function" && llmHasDeepSeek())) {
        return Response.error("Vui lòng thêm " + LLM_NAME + " API key trong cài đặt extension");
    }

    if (!shouldUseProvider(source)) {
        var fallback = translateWithFallback(text, from, to, source);
        if (fallback.text) return Response.success(fallback.text);
        // Baidu does not cover every listed language; use the model instead.
    }

    // The model can hand "auto-detected" text back untranslated, while the same text with
    // an explicit source translates fine; name the detected language when it is certain.
    if (from === "auto") from = translationDetectLanguage(text) || "auto";

    var temperature = readNumber("temperature", 0.2, 0, 2);
    var maxOutputTokens = Math.round(readNumber("max_output_tokens", 16384, 256, 65536));
    var customInstruction = readBookCustomInstruction();
    var memoryContext = loadTranslationMemory(text, from, to, source);
    var bookId = memoryContext.bookId || readCurrentBookId();
    var ecoMode = readBoolean("free_tier_eco_mode", true);
    var learnMemory = !ecoMode && memoryContext.enabled && readBoolean("auto_translation_memory", false);
    var systemInstruction = buildInstruction(
        text,
        from,
        to,
        source,
        style,
        customInstruction,
        memoryContext.prompt
    );
    var contextSuffix = "";
    if (source === "chapterContent" && bookId) {
        var storyState = typeof llmLoadStoryState === "function" ? llmLoadStoryState(bookId) : "";
        var contextBridge = typeof llmLoadContextBridge === "function" ? llmLoadContextBridge(bookId) : "";
        if (storyState) {
            contextSuffix += "\n\n<story_state>\nTRẠNG THÁI MẠCH TRUYỆN & XƯNG HÔ HIỆN TẠI (chỉ dùng để bám ngữ cảnh, KHÔNG dịch lại):\n" + storyState + "\n</story_state>";
        }
        if (contextBridge) {
            contextSuffix += "\n\n<previous_tail>\nĐOẠN CUỐI CHƯƠNG TRƯỚC (chỉ dùng để nối mạch văn & giọng điệu, KHÔNG lặp lại):\n" + contextBridge + "\n</previous_tail>";
        }
        if (contextSuffix) systemInstruction += contextSuffix;
    }
    var isStandaloneBookPrompt = Boolean(customInstruction &&
        (/^\s*<prompt[\s>]/i.test(customInstruction) || /<\/(?:prompt|role|instructions|constraints)>/i.test(customInstruction)));
    var hardPronounTail = (!isStandaloneBookPrompt && isChineseSource(text, from) && to === "vi")
        ? ("\n\n" + buildHardPronounLock())
        : "";
    if (hardPronounTail) systemInstruction += hardPronounTail;

    var isLineAlignedToc = source === "tableOfContent" && text.indexOf("\n") >= 0;
    var inputForModel = text;
    var tocOriginalLines = null;
    var usedQtPolish = false;
    var qtDraftText = "";

    if (isLineAlignedToc) {
        tocOriginalLines = text.replace(/\r\n/g, "\n").split("\n");
        var taggedLines = [];
        for (var tl = 0; tl < tocOriginalLines.length; tl++) {
            taggedLines.push("[L" + tl + "] " + tocOriginalLines[tl]);
        }
        inputForModel = taggedLines.join("\n");
        systemInstruction += "\n\nBẮT BUỘC GIỮ ĐÚNG ĐÁNH SỐ DÒNG: giữ nguyên tiền tố [L0], [L1], ... ở đầu mỗi dòng, không gộp dòng và không thêm/bớt dòng.";
    } else if (source === "chapterContent" && to === "vi" && isChineseSource(text, from) && readBoolean("qt_polish_mode", false)) {
        var qtDraft = translateWithQt(text, from, to, source);
        if (qtDraft) {
            var origHan = Math.max(1, countChinese(text));
            var qtHanRatio = countChinese(qtDraft) / origHan;
            // Adaptive QT-Polish Gate: >25% sót Hán thì bỏ qua QT dịch thẳng nguyên văn; 8%-25% tự kèm nguyên văn
            if (qtHanRatio <= 0.25) {
                usedQtPolish = true;
                qtDraftText = qtDraft;
                var includeRaw = readBoolean("qt_polish_include_raw", false) || qtHanRatio >= 0.08;
                systemInstruction = buildQtPolishInstruction(systemInstruction, includeRaw, Boolean(hardPronounTail));
                inputForModel = includeRaw
                    ? ("<raw_chinese>\n" + text + "\n</raw_chinese>\n\n<qt_draft>\n" + qtDraft + "\n</qt_draft>")
                    : qtDraft;
            }
        }
    }

    var result = requestTranslation(apiKeys, model, systemInstruction, inputForModel, temperature, maxOutputTokens, bookId, from, to, source, 55000, text);
    if (result.error) {
        if (typeof llmRecordError === "function") llmRecordError("TRANSLATE", result.error);
        return Response.error(result.error);
    }
    var finalText = isLineAlignedToc ? restoreLineTaggedOutput(result.text, tocOriginalLines) : result.text;

    // 1. Kiểm tra bản dịch còn nguyên văn HOẶC AI lười chép y nguyên bản QT thô (Echo-Guard)
    var needsMainRetry = translationIsUntranslated(finalText, text, from, to);
    var echoedQtDraft = !needsMainRetry && usedQtPolish && qtDraftText && isUneditedQtEcho(finalText, qtDraftText);
    if (needsMainRetry || echoedQtDraft) {
        var elapsedBeforeRetry = new Date().getTime() - chapterStartMs;
        if (elapsedBeforeRetry > CHAPTER_HARD_BUDGET_MS - 15000) {
            if (echoedQtDraft) {
                // Nếu chỉ bị giống QT mà hết thời gian thì giữ bản hiện có thay vì báo lỗi
            } else {
                var budgetRetryErr = LLM_NAME + " trả về bản dịch giống nguyên văn và không đủ thời gian thử lại.";
                if (typeof llmRecordError === "function") llmRecordError("RETRY", budgetRetryErr);
                return Response.error(budgetRetryErr);
            }
        } else {
            var retryInstruction = buildInstruction(text, from, to, source, style, customInstruction, "") +
                contextSuffix +
                hardPronounTail +
                "\n\nBẮT BUỘC: dịch toàn bộ văn bản sang " + translationLanguageName(to) +
                " bằng văn xuôi tiếng Việt mượt mà, tuyệt đối không chép lại nguyên văn hay văn convert thô.";
            if (isLineAlignedToc) {
                retryInstruction += "\n\nBẮT BUỘC GIỮ ĐÚNG ĐÁNH SỐ DÒNG: giữ nguyên tiền tố [L0], [L1], ... ở đầu mỗi dòng, không gộp dòng và không thêm/bớt dòng.";
            }
            var retryInput = isLineAlignedToc ? inputForModel : text;
            var retryTimeoutMs = Math.max(15000, Math.min(55000, CHAPTER_HARD_BUDGET_MS - elapsedBeforeRetry));
            var retry = requestTranslation(apiKeys, model, retryInstruction, retryInput, temperature, maxOutputTokens, bookId, from, to, source, retryTimeoutMs, text);
            if (retry.error) {
                if (!echoedQtDraft) {
                    if (typeof llmRecordError === "function") llmRecordError("RETRY", retry.error);
                    return Response.error(retry.error);
                }
            } else {
                var retryText = isLineAlignedToc ? restoreLineTaggedOutput(retry.text, tocOriginalLines) : retry.text;
                if (!translationIsUntranslated(retryText, text, from, to)) {
                    finalText = retryText;
                } else if (!echoedQtDraft) {
                    var untransErr = LLM_NAME + " trả về bản dịch vẫn giống nguyên văn. Hãy thử lại hoặc đổi model.";
                    if (typeof llmRecordError === "function") llmRecordError("UNTRANSLATED", untransErr);
                    return Response.error(untransErr);
                }
            }
            learnMemory = false;
        }
    }

    // 2. Xử lý các dòng bị đánh dấu [RETRY] TRƯỚC bước sửa sót chữ Hán để tránh rò rỉ [RETRY]
    if (hasRetryMarker(finalText)) {
        var elapsedBeforeMarker = new Date().getTime() - chapterStartMs;
        var leftForMarker = CHAPTER_HARD_BUDGET_MS - elapsedBeforeMarker;
        var markerTimeout = Math.max(12000, Math.min(30000, leftForMarker));
        finalText = repairRetryMarkerLines(
            model,
            apiKeys,
            finalText,
            text,
            to,
            memoryContext.enabled ? memoryContext.prompt : "",
            maxOutputTokens,
            bookId,
            markerTimeout
        );
    }

    // 3. Sửa sót chữ Hán (luôn truyền glossary nếu đang bật bộ nhớ dịch, kể cả khi bật Eco Mode)
    var elapsedAfterMain = new Date().getTime() - chapterStartMs;
    var leftForRepair = CHAPTER_HARD_BUDGET_MS - elapsedAfterMain;
    if (shouldRepairChinese(finalText, text, from, to) && leftForRepair >= 12000) {
        var remainingHan = countChinese(finalText);
        if (elapsedAfterMain <= 60000 || remainingHan > 3) {
            var repairTimeout = Math.min(30000, leftForRepair);
            finalText = repairRemainingChinese(model, apiKeys, finalText, to, memoryContext.enabled ? memoryContext.prompt : "", maxOutputTokens, bookId, repairTimeout);
            finalText = sanitizeTranslationOutput(finalText, text, to);
        }
    }

    if (source === "chapterContent" && bookId && to === "vi" && isChineseSource(text, from)) {
        qtPromotePendingTerms(bookId, text);
    }

    if (source === "chapterContent" && bookId && typeof llmSaveContextBridge === "function") {
        llmSaveContextBridge(bookId, finalText);
    }

    // Ngân sách thời gian tổng: nếu bước dịch chính đã mất >55s hoặc chương quá ngắn (<250 ký tự) thì bỏ qua bước phụ cuối chương
    var elapsedBeforePost = new Date().getTime() - chapterStartMs;
    var allowPostSteps = elapsedBeforePost < CHAPTER_SOFT_BUDGET_MS && String(finalText || "").trim().length >= 250;

    var usedContextSync = false;
    if (allowPostSteps && source === "chapterContent" && bookId && typeof llmDeepSeekSyncContextAndMemory === "function" &&
        readBoolean("use_context_bridge", true)) {
        var sourceName = isChineseSource(text, from) ? translationLanguageName("zh") : translationLanguageName(from);
        var targetName = translationLanguageName(to);
        var syncBudgetMs = Math.max(8000, Math.min(25000, CHAPTER_HARD_BUDGET_MS - elapsedBeforePost));
        var syncRes = llmDeepSeekSyncContextAndMemory(bookId, text, finalText, sourceName, targetName, memoryContext.prompt, syncBudgetMs, apiKeys);
        if (syncRes && syncRes.memory && syncRes.memory.length > 0 && memoryContext.enabled) {
            persistTranslationMemory(memoryContext, text, syncRes.memory);
        }
        if (syncRes && syncRes.mode && syncRes.mode !== "off") {
            usedContextSync = true;
        }
    }

    if (allowPostSteps && !usedContextSync && learnMemory) {
        var learnedItems = extractTranslationMemory(model, apiKeys, text, finalText, from, to, memoryContext.prompt, bookId);
        persistTranslationMemory(memoryContext, text, learnedItems);
    }

    return Response.success(finalText);
}

function isSuspiciouslyTruncated(translated, original, from, to, source) {
    if (source !== "chapterContent" || to !== "vi") return false;
    if (!isChineseSource(original, from)) return false;
    var hanCount = countChinese(original);
    if (hanCount < 600) return false;
    var outLen = String(translated || "").trim().length;
    // Truyện Trung -> Việt bình thường đạt ~2.5-4.5 ký tự Việt / 1 chữ Hán; dưới 1.1x là bị cụt sớm bất thường
    return outLen < Math.floor(hanCount * 1.1);
}

// Returns { text, keyIndex, error }.
function requestTranslation(apiKeys, model, systemInstruction, text, temperature, maxOutputTokens, bookId, from, to, source, timeoutMs, rawOriginal) {
    var checkOriginal = rawOriginal || text;
    var reqTimeout = timeoutMs || 55000;
    var result = llmRequest(
        apiKeys,
        llmBuildBody(model, systemInstruction, text, {
            temperature: temperature,
            maxTokens: maxOutputTokens,
            bookId: bookId
        }),
        reqTimeout
    );
    if (result.error) {
        if (typeof llmShouldDeepSeekRescue === "function" && llmShouldDeepSeekRescue(result.error, result.finishReason)) {
            var rescueModel = typeof llmReadConfig === "function" ? llmReadConfig("deepseek_rescue_model", "") : "";
            var rescue = llmDeepSeekRequest(
                systemInstruction,
                text,
                { temperature: temperature, maxTokens: maxOutputTokens, model: rescueModel || undefined },
                55000
            );
            if (!rescue.error && (rescue.finishReason === "length" || rescue.finishReason === "max_tokens")) {
                return {
                    text: "",
                    keyIndex: -1,
                    error: "Bản dịch cứu hộ DeepSeek bị cắt vì vượt số token đầu ra tối đa. Hãy tăng giới hạn này trong cài đặt."
                };
            }
            if (!rescue.error && rescue.text) {
                var rescuedText = sanitizeTranslationOutput(
                    parseTranslationResult(stripCodeFence(rescue.text), false).translation,
                    text,
                    to
                );
                if (rescuedText) {
                    if (typeof llmRecordError === "function") {
                        llmRecordError("RESCUE", "DeepSeek cứu hộ thành công sau lỗi: " + result.error);
                    }
                    return { text: rescuedText, keyIndex: -1, error: "" };
                }
            }
            return {
                text: "",
                keyIndex: result.keyIndex,
                error: result.error + " | Cứu hộ DeepSeek thất bại: " + (rescue.error || "trả về bản dịch rỗng sau khi lọc")
            };
        }
        return { text: "", keyIndex: result.keyIndex, error: result.error };
    }
    // A cut-off chapter would be cached as a finished translation; try DeepSeek rescue (non-thinking) first!
    if (result.finishReason === "length" || result.finishReason === "max_tokens") {
        if (typeof llmShouldDeepSeekRescue === "function" && llmShouldDeepSeekRescue("max_tokens", "max_tokens")) {
            var rescueModelMt = typeof llmReadConfig === "function" ? llmReadConfig("deepseek_rescue_model", "") : "";
            var rescueMt = llmDeepSeekRequest(
                systemInstruction,
                text,
                { temperature: temperature, maxTokens: maxOutputTokens, model: rescueModelMt || undefined },
                55000
            );
            if (!rescueMt.error && rescueMt.text && rescueMt.finishReason !== "length" && rescueMt.finishReason !== "max_tokens") {
                var rescuedMtText = sanitizeTranslationOutput(
                    parseTranslationResult(stripCodeFence(rescueMt.text), false).translation,
                    text,
                    to
                );
                if (rescuedMtText) return { text: rescuedMtText, keyIndex: -1, error: "" };
            }
        }
        return {
            text: "",
            keyIndex: result.keyIndex,
            error: "Bản dịch bị cắt vì vượt số token đầu ra tối đa. Hãy tăng giới hạn này hoặc giảm mức suy luận trong cài đặt."
        };
    }
    if (!result.text) {
        return {
            text: "",
            keyIndex: result.keyIndex,
            error: result.finishReason
                ? LLM_NAME + " không thể dịch: " + result.finishReason
                : LLM_NAME + " không trả về bản dịch"
        };
    }
    var translation = sanitizeTranslationOutput(
        parseTranslationResult(stripCodeFence(result.text), false).translation,
        text,
        to
    );
    if (!translation) return { text: "", keyIndex: result.keyIndex, error: LLM_NAME + " không trả về bản dịch hợp lệ" };

    // Truncation Guard: luôn đối chiếu với nguyên văn gốc (kể cả khi bật QT-Polish)
    if (isSuspiciouslyTruncated(translation, checkOriginal, from, to, source)) {
        if (typeof llmShouldDeepSeekRescue === "function" && llmShouldDeepSeekRescue("truncated", "max_tokens")) {
            var rescueModelTr = typeof llmReadConfig === "function" ? llmReadConfig("deepseek_rescue_model", "") : "";
            var rescueTr = llmDeepSeekRequest(
                systemInstruction,
                text,
                { temperature: temperature, maxTokens: maxOutputTokens, model: rescueModelTr || undefined },
                55000
            );
            if (!rescueTr.error && rescueTr.text && rescueTr.finishReason !== "length" && rescueTr.finishReason !== "max_tokens") {
                var rescuedTrText = sanitizeTranslationOutput(
                    parseTranslationResult(stripCodeFence(rescueTr.text), false).translation,
                    text,
                    to
                );
                if (rescuedTrText && rescuedTrText.length > translation.length * 1.25) {
                    if (typeof llmRecordError === "function") {
                        llmRecordError("RESCUE", "Đã cứu hộ bản dịch bị cụt sớm (" + translation.length + " -> " + rescuedTrText.length + " ký tự)");
                    }
                    return { text: rescuedTrText, keyIndex: -1, error: "" };
                }
            }
        }
        // Nếu vẫn bị cụt quá nặng (<0.7x số chữ Hán), trả lỗi để vBook thử lại thay vì lưu bản dịch cụt vào cache
        if (translation.length < Math.floor(countChinese(checkOriginal) * 0.7)) {
            return {
                text: "",
                keyIndex: result.keyIndex,
                error: "Bản dịch bị dừng sớm bất thường (" + translation.length + " ký tự). Vui lòng thử lại."
            };
        }
    }
    return { text: translation, keyIndex: result.keyIndex, error: "" };
}

function shouldUseProvider(source) {
    if (source === "tableOfContent") return readBoolean("translate_table_of_content", false);
    if (source === "detail") return readBoolean("translate_detail", false);
    if (source === "discovery") return readBoolean("translate_discovery", false);
    return true;
}

function translateWithFallback(text, from, to, source) {
    var qtText = "";
    if (readBoolean("use_qt_fallback", true)) {
        qtText = translateWithQt(text, from, to, source);
        // QT leaves words missing from its dictionaries in Chinese; prefer Baidu for those
        // and keep the partial QT result only if Baidu fails.
        if (qtText && !containsChinese(qtText)) {
            return { text: qtText, error: "" };
        }
    }

    var baiduResult = baiduTranslateText(text, from, to);
    if (baiduResult.text) {
        return { text: baiduResult.text, error: "" };
    }
    if (qtText) return { text: qtText, error: "" };
    return { text: "", error: baiduResult.error || "Không thể dịch bằng Baidu" };
}

function translateWithQt(text, from, to, source) {
    if (to !== "vi") return "";
    if (!isChineseSource(text, from)) return "";

    try {
        var result = Qt.translate(text, to, {
            source: source,
            chapter_name: source === "tableOfContent",
            first_line_chapter_name: source === "tableOfContent",
            first_capitalize: true
        });
        var translated = result && result.translateText ? String(result.translateText).trim() : "";
        return translated && translated !== String(text).trim() ? translated : "";
    } catch (e) {
        return "";
    }
}

function loadTranslationMemory(text, from, to, source) {
    var context = {
        enabled: false,
        bookId: "",
        prompt: "",
        existing: {},
        included: {},
        lines: []
    };

    if (!readBoolean("use_translation_memory", true)) return context;

    if (source !== "chapterContent" || !translationSourceDiffers(text, from, to)) return context;
    context.chinese = isChineseSource(text, from);
    context.to = to;

    var info;
    try {
        info = localBook.getInfo();
    } catch (e) {
        return context;
    }

    if (!info || !info.id) return context;

    context.enabled = true;
    context.bookId = String(info.id);
    translationRememberLanguages(context.bookId, from, to);

    try {
        var totalRows = localDatabase.count(context.bookId, TRANSLATION_MEMORY_TABLE);
        var rows;
        if (totalRows > MAX_MEMORY_ROWS) {
            var half = Math.floor(MAX_MEMORY_ROWS / 2);
            rows = localDatabase.list(context.bookId, TRANSLATION_MEMORY_TABLE, 0, half);
            var recentRows = localDatabase.list(
                context.bookId,
                TRANSLATION_MEMORY_TABLE,
                Math.max(0, totalRows - half),
                half
            );
            var mergedRows = [];
            for (var r1 = 0; rows && r1 < rows.length; r1++) mergedRows.push(rows[r1]);
            for (var r2 = 0; recentRows && r2 < recentRows.length; r2++) mergedRows.push(recentRows[r2]);
            rows = mergedRows;
        } else {
            rows = localDatabase.list(context.bookId, TRANSLATION_MEMORY_TABLE, 0, MAX_MEMORY_ROWS);
        }

        for (var i = 0; rows && i < rows.length; i++) {
            var rowKey = String(rows[i].key || "").trim();
            if (!rowKey) continue;
            context.existing[rowKey] = true;
            addStoredMemoryLine(context, rowKey, String(rows[i].value || ""), text);
        }

    } catch (databaseError) {}

    // The book's QT names and VietPhrases are Chinese-to-Vietnamese dictionaries.
    if (context.chinese && to === "vi") {
        try {
            addBookDictionary(context, text, localBook.getNames(), "name");
            addBookDictionary(context, text, localBook.getQtNames(), "name");
            addBookDictionary(context, text, localBook.getQtVietPhrases(), "term");
        } catch (dictionaryError) {}
    }

    if (context.lines.length > 0) {
        context.prompt = "Dùng chính xác bộ nhớ dịch riêng của truyện dưới đây; không đổi tên hoặc diễn giải lại các mục đã có:\n" +
            context.lines.join("\n");
    }

    return context;
}

function addStoredMemoryLine(context, source, rawValue, text) {
    var target = rawValue;
    var kind = "term";
    var note = "";
    var aliases = [];
    var details = [];

    try {
        var data = JSON.parse(rawValue);
        if (data && data.target) target = String(data.target);
        if (data && data.kind) kind = String(data.kind);
        if (data && data.note) note = String(data.note);
        if (data && Array.isArray(data.aliases)) aliases = data.aliases;
        if (data && data.gender && data.gender !== "unknown") details.push("giới tính: " + oneLine(data.gender));
        if (data && data.role) details.push("vai trò: " + oneLine(data.role));
        if (data && Array.isArray(data.relationships)) {
            for (var relationshipIndex = 0; relationshipIndex < data.relationships.length; relationshipIndex++) {
                var relationship = data.relationships[relationshipIndex];
                if (!relationship || !relationship["with"] || !relationship.type) continue;
                var relationshipText = oneLine(relationship["with"]) + ": " + oneLine(relationship.type);
                var banPronounRe = /\b(?:tôi|tớ|cậu|mình|bạn|anh|em|chị|chú|cháu|bác|con|tao|mày)\b/i;
                var addrTo = oneLine(relationship.addressTo || "");
                var addrFrom = oneLine(relationship.addressFrom || "");
                if (addrTo && !(context.chinese && context.to === "vi" && banPronounRe.test(addrTo))) {
                    relationshipText += ", gọi họ: " + addrTo;
                }
                if (addrFrom && !(context.chinese && context.to === "vi" && banPronounRe.test(addrFrom))) {
                    relationshipText += ", họ gọi lại: " + addrFrom;
                }
                details.push("quan hệ " + relationshipText);
            }
        }
        if (data && data.autoNote) details.push(oneLine(data.autoNote));
    } catch (e) {}

    var matched = translationTermInText(text, source);
    var validAliases = [];
    for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
        var alias = oneLine(aliases[aliasIndex]);
        if (!alias || alias === source) continue;
        validAliases.push(alias);
        if (translationTermInText(text, alias)) matched = true;
    }
    if (!matched) return;

    if (note) details.unshift(note);
    var displaySource = source;
    if (validAliases.length > 0) displaySource += " (còn gọi: " + validAliases.join(", ") + ")";
    addMemoryLine(context, displaySource, target, kind, details.join("; "));
    context.included[source] = true;
}

function addBookDictionary(context, text, dictionary, kind) {
    if (!dictionary) return;
    for (var rawKey in dictionary) {
        if (!Object.prototype.hasOwnProperty.call(dictionary, rawKey)) continue;
        var source = String(rawKey || "").trim();
        if (!source || text.indexOf(source) < 0) continue;
        addMemoryLine(context, source, String(dictionary[rawKey] || ""), kind, "");
        if (context.lines.length >= MAX_MEMORY_MATCHES) return;
    }
}

function addMemoryLine(context, source, target, kind, note) {
    if (!source || !target || context.included[source]) return;
    // A Chinese "translation" tells the model to keep the source text and snowballs into
    // fully untranslated chapters; ignore such entries, including ones already stored.
    if (containsChinese(target) && !translationWritesHan(context.to)) return;
    if (context.lines.length >= MAX_MEMORY_MATCHES) return;

    context.included[source] = true;
    var line = "- " + oneLine(source) + " => " + oneLine(target) + " [" + oneLine(kind || "term") + "]";
    if (note) line += " — " + oneLine(note);
    context.lines.push(line);
}

function parseTranslationResult(value, expectsMemory) {
    var raw = stripCodeFence(String(value || "")).trim();
    var data = parseTranslationJson(raw);
    var translation = readTranslationValue(data);

    if (translation) {
        return {
            translation: translation,
            memory: expectsMemory && Array.isArray(data.memory) ? data.memory : []
        };
    }

    var extracted = extractLooseTranslation(raw);
    if (extracted) return { translation: extracted, memory: [] };

    if (!expectsMemory && !looksLikeJsonResult(raw)) {
        return { translation: raw, memory: [] };
    }

    return { translation: "", memory: [] };
}

function parseTranslationJson(value) {
    try {
        return JSON.parse(value);
    } catch (e) {}

    var start = value.indexOf("{");
    var end = value.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    try {
        return JSON.parse(value.substring(start, end + 1));
    } catch (e2) {
        return null;
    }
}

function readTranslationValue(data) {
    if (!data || data.translation === null || data.translation === undefined) return "";
    if (typeof data.translation === "string") return data.translation;
    if (data.translation && typeof data.translation.text === "string") return data.translation.text;
    return "";
}

function extractLooseTranslation(value) {
    var memoryDelimited = value.match(/"translation"\s*:\s*"([\s\S]*)"\s*,\s*"memory"\s*:/);
    if (memoryDelimited) return decodeLooseJsonString(memoryDelimited[1]);

    var match = value.match(/"translation"\s*:\s*"((?:\\.|[^"\\])*)"/);
    return match ? decodeLooseJsonString(match[1]) : "";
}

function decodeLooseJsonString(value) {
    try {
        return String(JSON.parse('"' + value + '"'));
    } catch (e) {}

    try {
        var escapedControls = value
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t");
        return String(JSON.parse('"' + escapedControls + '"'));
    } catch (e2) {}

    return String(value)
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();
}

function looksLikeJsonResult(value) {
    var trimmed = String(value || "").trim();
    if (/"translation"\s*:/.test(trimmed)) return true;
    // Chỉ coi là JSON nếu có cấu trúc JSON thực sự ({"key": ...}), KHÔNG chặn thoại {độc thoại} hay [Thông báo hệ thống]
    if (/^\{\s*"[^"\r\n]+"\s*:/.test(trimmed)) return true;
    if (/^\[\s*\{\s*"[^"\r\n]+"\s*:/.test(trimmed)) return true;
    return false;
}

function sanitizeTranslationOutput(text, original, to) {
    var out = String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[\u00A0\u3000]/g, " ")
        .replace(/<(think|thought|reasoning)>[\s\S]*?(?:<\/\1>|$)/gi, "")
        .replace(/<\/?(?:think|thought|reasoning)>/gi, "")
        .replace(/<(story_state|previous_tail|glossary|source_task|pronoun_rules|hard_pronoun_lock|raw_chinese)>[\s\S]*?(?:<\/\1>|$)/gi, "")
        .replace(/<\/?(?:story_state|previous_tail|glossary|source_task|pronoun_rules|hard_pronoun_lock|raw_chinese)>/gi, "")
        .trim();
    if (!out) return "";
    // Bóc vỏ thẻ bọc ngoài (kể cả <qt_draft> nếu model bọc bản biên tập bên trong thay vì xóa mất nội dung)
    out = out.replace(/^\s*<(?:output|translation|result|response|qt_draft)[^>]*>\s*/i, "");
    out = out.replace(/\s*<\/(?:output|translation|result|response|qt_draft)>\s*$/i, "");
    out = out.replace(/<\/?qt_draft[^>]*>/gi, "");
    // Xử lý ***in đậm + nghiêng*** -> giữ lại *in nghiêng* đơn
    out = out.replace(/\*\*\*([^\r\n*]+?)\*\*\*/g, "*$1*");
    // Bỏ dấu sao kép **...** nhưng giữ nguyên ký hiệu che từ ** rời rạc trong thoại
    out = out.replace(/\*\*(\S(?:(?!\*\*)[^\r\n])*?\S|\S)\*\*/g, "$1");
    // Bỏ tiêu đề Markdown (# ) ở đầu dòng nếu nguyên tác không dùng #
    if (String(original || "").indexOf("# ") < 0) {
        out = out.replace(/(^|\n)#{1,6}[ \t]+/g, "$1");
    }
    if (!/(^|\n)\s*[-*_]{3,}\s*($|\n)/.test(String(original || ""))) {
        out = out.replace(/(^|\n)[ \t]*([-*_])\2{2,}[ \t]*(?=\n|$)/g, "$1");
    }

    // Chuẩn hóa dấu câu CJK full-width và khoảng trắng TTS (an toàn 100%: mask trước HTML & URL)
    var targetCode = String(to || "").toLowerCase();
    var isCjkTarget = targetCode === "zh" || targetCode.indexOf("zh-") === 0 || targetCode === "ja";
    if (!isCjkTarget) {
        var stash = [];
        function protectToken(match) {
            var token = "\uE000" + stash.length + "\uE001";
            stash.push(match);
            return token;
        }
        out = out.replace(/<\/?[a-zA-Z][^>\r\n]*>/g, protectToken);
        out = out.replace(/https?:\/\/[^\s<>"'\)\]\u201D]+/gi, protectToken);
        out = out.replace(/\bwww\.[^\s<>"'\)\]\u201D]+/gi, protectToken);

        var L = "A-Za-z\\u00C0-\\u024F\\u1E00-\\u1EFF";
        out = out.replace(new RegExp("\\u3002([" + L + "\\u201C\\(\\[\\u3010])", "g"), ". $1");
        // Dọn dòng phân cảnh trang trí (———, ===, ~~~) đứng trơ trọi để TTS không đọc "gạch ngang"
        out = out.replace(/(^|\n)[ \t]*[\u2014\u2500=~\-]{3,}[ \t]*(?=\n|$)/g, "$1");
        out = out
            .replace(/\u2026{2,}|\u2026/g, "...")
            .replace(/\.{4,}/g, "...")
            .replace(/\u2014{2,}|\u2500{2,}/g, " \u2014 ")
            .replace(/\uFF0C/g, ",")
            .replace(/\u3002/g, ".")
            .replace(/\uFF1A/g, ":")
            .replace(/\uFF1B/g, ";")
            .replace(/\uFF01/g, "!")
            .replace(/\uFF1F/g, "?")
            .replace(/\u3001/g, ",")
            .replace(/\uFF08/g, "(")
            .replace(/\uFF09/g, ")")
            .replace(/[\u300C\u300E]/g, "\u201C")
            .replace(/[\u300D\u300F]/g, "\u201D")
            .replace(/\u300A/g, "'")
            .replace(/\u300B/g, "'");

        // Vá cặp khung hệ thống bị lệch 【...] hoặc [...】
        out = out.replace(/\u3010([^\r\n\u3010\u3011\[\]]+)\]/g, "\u3010$1\u3011");
        out = out.replace(/\[([^\r\n\u3010\u3011\[\]]+)\u3011/g, "[$1]");

        // Khoảng trắng chuẩn cho TTS (giữ nguyên số 3.14, 1,000, 12:30, HP:100)
        var U = "A-Z\u00C0-\u00DE\u1EA0-\u1EFE";
        out = out.replace(new RegExp("([" + L + "0-9\u201D\u3011)\\]])\\u2014([" + L + "0-9\u201C\u3010(\\[])", "g"), "$1 \u2014 $2");
        out = out.replace(/[ \t]*\u2014[ \t]*([\u201D\)\]\u3011\n]|$)/g, " \u2014$1");
        out = out.replace(/[ \t]+([,.;:!?\)\]\u201D\u3011])/g, "$1");
        out = out.replace(/([\(\[\u201C\u3010])[ \t]+/g, "$1");
        out = out.replace(new RegExp("([,;:\\!\\?])([" + L + "\\u201C\\(\\[\\u3010])", "g"), "$1 $2");
        out = out.replace(/([!?])([0-9])/g, "$1 $2");
        out = out.replace(new RegExp("([" + L + "])\\.([" + U + "])", "g"), "$1. $2");
        out = out.replace(new RegExp("([" + L + "])\\.\\.\\.([" + L + "])", "g"), "$1... $2");
        out = out.replace(new RegExp("([" + L + ",.;:!\\?])([\u201C\u3010\(\[])", "g"), "$1 $2");
        out = out.replace(new RegExp("([\u201D\u3011\)\]])([" + L + "])", "g"), "$1 $2");
        out = out.replace(/[ \t]{2,}/g, " ");
        out = out.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
        out = out.replace(/\n{3,}/g, "\n\n");

        out = out.replace(/\uE000(\d+)\uE001/g, function (_, idx) {
            return stash[parseInt(idx, 10)] || "";
        });
    }
    return out.trim();
}

function qtWriteEntry(src, tgt, kind, qtNames, qtVp, bookId) {
    var canAddName = typeof localBook !== "undefined" && localBook && typeof localBook.addQtName === "function";
    var canAddVp = typeof localBook !== "undefined" && localBook && typeof localBook.addQtVietPhrase === "function";
    if (kind === "character" || kind === "place" || kind === "organization") {
        if (canAddName && !qtNames[src]) {
            try {
                localBook.addQtName(src, tgt);
                qtNames[src] = tgt;
                llmQtAppendSyncLog(bookId, src, tgt);
                return true;
            } catch (e1) {}
        }
    } else if (canAddVp && !qtVp[src] && !qtNames[src]) {
        try {
            localBook.addQtVietPhrase(src, tgt);
            qtVp[src] = tgt;
            llmQtAppendSyncLog(bookId, src, tgt);
            return true;
        } catch (e2) {}
    }
    return false;
}

function qtLoadPending(bookId) {
    try {
        var parsed = JSON.parse(String(localStorage.getItem(LLM_QT_PENDING_PREFIX + String(bookId)) || "{}"));
        return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function qtSavePending(bookId, pending) {
    try {
        var keys = [];
        for (var k in pending) {
            if (pending.hasOwnProperty(k)) keys.push(k);
        }
        if (keys.length > 200) {
            var trimmed = {};
            for (var i = keys.length - 200; i < keys.length; i++) trimmed[keys[i]] = pending[keys[i]];
            pending = trimmed;
        }
        localStorage.setItem(LLM_QT_PENDING_PREFIX + String(bookId), JSON.stringify(pending));
    } catch (e) {}
}

function syncItemsToQtDictionary(items, isChinese, to, bookId) {
    if (!isChinese || to !== "vi" || !readBoolean("sync_memory_to_qt", true)) return;
    if (!Array.isArray(items) || items.length === 0) return;
    var canAddName = typeof localBook !== "undefined" && localBook && typeof localBook.addQtName === "function";
    var canAddVp = typeof localBook !== "undefined" && localBook && typeof localBook.addQtVietPhrase === "function";
    if (!canAddName && !canAddVp) return;

    var minHits = Math.round(readNumber("qt_sync_min_hits", 2, 1, 5));
    var qtNames = {};
    var qtVp = {};
    try { qtNames = localBook.getQtNames() || {}; } catch (eN) {}
    try { qtVp = localBook.getQtVietPhrases() || {}; } catch (eV) {}

    var pending = (minHits > 1 && bookId) ? qtLoadPending(bookId) : null;
    var pendingChanged = false;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.source || !it.target) continue;
        var src = String(it.source).trim();
        var tgt = String(it.target).trim();
        var kind = String(it.kind || "term");
        if (src.length < 2 || src.length > 20 || tgt.length < 2 || tgt.length > 60) continue;
        if (containsChinese(tgt)) continue;
        if (qtNames[src] || qtVp[src]) continue;

        if (pending) {
            if (!pending[src]) {
                pending[src] = { t: tgt, k: kind, n: 1 };
                pendingChanged = true;
            }
        } else {
            qtWriteEntry(src, tgt, kind, qtNames, qtVp, bookId);
        }
    }
    if (pending && pendingChanged) qtSavePending(bookId, pending);
}

// Mỗi chương: từ đang chờ nào xuất hiện lại trong nguyên văn thì +1; đủ số lần thì ghi sang QT.
function qtPromotePendingTerms(bookId, text) {
    if (!bookId || !readBoolean("sync_memory_to_qt", true)) return 0;
    var minHits = Math.round(readNumber("qt_sync_min_hits", 2, 1, 5));
    var pending = qtLoadPending(bookId);
    var value = String(text || "");
    var qtNames = {};
    var qtVp = {};
    try { qtNames = localBook.getQtNames() || {}; } catch (eN) {}
    try { qtVp = localBook.getQtVietPhrases() || {}; } catch (eV) {}

    var changed = false;
    var written = 0;
    for (var src in pending) {
        if (!pending.hasOwnProperty(src)) continue;
        var entry = pending[src];
        if (!entry || value.indexOf(src) < 0) continue;
        entry.n = Number(entry.n || 1) + 1;
        changed = true;
        if (entry.n >= minHits) {
            if (qtWriteEntry(src, String(entry.t || ""), String(entry.k || "term"), qtNames, qtVp, bookId)) written++;
            delete pending[src];
        }
    }
    if (changed) qtSavePending(bookId, pending);
    return written;
}

function persistTranslationMemory(context, input, items) {
    if (!context.bookId || !Array.isArray(items) || items.length === 0) return;

    var records = [];
    var qtSyncItems = [];
    for (var i = 0; i < items.length && records.length < MAX_LEARNED_ITEMS; i++) {
        var item = items[i];
        if (!item) continue;

        var source = String(item.source || "").trim();
        var target = String(item.target || "").trim();
        if (!source || !target || context.existing[source]) continue;
        if (source.length > 80 || target.length > 160) continue;
        if (!translationIsMemoryTerm(source, target, input, context.chinese)) continue;
        if (containsChinese(target) && !translationWritesHan(context.to)) continue;

        var kind = normalizeMemoryKind(item.kind);
        var note = oneLine(String(item.note || ""));
        if (note.length > 300) note = note.substring(0, 300);

        records.push({
            key: source,
            value: JSON.stringify({ target: target, kind: kind, note: note })
        });
        qtSyncItems.push({ source: source, target: target, kind: kind });
        context.existing[source] = true;
    }

    if (records.length === 0) return;

    try {
        localDatabase.upsertAll(context.bookId, TRANSLATION_MEMORY_TABLE, records);
    } catch (e) {}

    syncItemsToQtDictionary(qtSyncItems, context.chinese, context.to, context.bookId);
}

function extractTranslationMemory(model, apiKeys, original, translated, from, to, memoryPrompt, bookId) {
    var sourceName = isChineseSource(original, from) ? translationLanguageName("zh") : translationLanguageName(from);
    var targetName = translationLanguageName(to);
    var instruction = "Xác định tối đa 20 tên riêng, địa danh, tổ chức, danh hiệu hoặc thuật ngữ lặp lại có độ tin cậy cao trong nguyên văn (" + sourceName + "). " +
        "Dùng đúng cách gọi tương ứng đã xuất hiện trong bản dịch (" + targetName + "). Không tự đặt tên hoặc diễn giải lại bộ nhớ hiện có. " +
        "Chỉ trả về một đối tượng JSON có mảng memory; mỗi phần tử gồm source, target, kind và note. " +
        "Mỗi source phải là chuỗi con chính xác trong NGUYÊN VĂN, viết đúng như nguyên văn. Không lấy từ thông thường. Nếu không chắc chắn thì bỏ qua mục đó.";
    if (memoryPrompt) instruction += "\n\n" + memoryPrompt;
    var userText = "NGUYÊN VĂN:\n" + original + "\n\nBẢN DỊCH:\n" + translated;

    try {
        var response = llmRequest(
            apiKeys,
            llmBuildBody(model, instruction, userText, { temperature: 0, maxTokens: 2048, json: true, bookId: bookId }),
            30000
        );
        if (response.error || !response.text) return [];
        var result = parseTranslationJson(stripCodeFence(response.text));
        return result && Array.isArray(result.memory) ? result.memory : [];
    } catch (e) {
        return [];
    }
}

function normalizeMemoryKind(value) {
    var kind = String(value || "term").toLowerCase();
    if (kind === "character" || kind === "place" || kind === "organization" || kind === "term") {
        return kind;
    }
    return "term";
}

function shouldRepairChinese(translated, original, from, to) {
    if (!readBoolean("retry_untranslated_chinese", true)) return false;
    if (translationWritesHan(to) || !isChineseSource(original, from)) return false;
    var count = countChinese(translated);
    var useDsRepair = typeof llmHasDeepSeek === "function" && llmHasDeepSeek() && readBoolean("deepseek_context_engine", false);
    var minThreshold = (!useDsRepair && readBoolean("free_tier_eco_mode", true)) ? 8 : 1;
    if (count < minThreshold) return false;
    return true;
}

function repairRemainingChinese(model, apiKeys, draft, to, memoryPrompt, maxOutputTokens, bookId, repairTimeoutMs) {
    var previous = String(draft || "");
    var matches = previous.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || [];
    var seen = {};
    var items = [];

    for (var index = 0; index < matches.length; index++) {
        var fragment = String(matches[index] || "");
        if (!fragment || seen[fragment]) continue;
        seen[fragment] = true;
        items.push({
            id: String(items.length),
            fragment: fragment,
            context: chineseFragmentContext(previous, fragment)
        });
        if (items.length >= MAX_CHINESE_REPAIR_FRAGMENTS) break;
    }

    if (items.length === 0) return previous;

    var replacements = translateChineseFragmentsOnce(
        model,
        apiKeys,
        items,
        to,
        memoryPrompt,
        maxOutputTokens,
        bookId,
        repairTimeoutMs
    );
    if (!replacements) return previous;

    // Longest first so a short fragment never splits a longer one that contains it; a
    // fragment the model failed on stays as it was instead of discarding every fix.
    items.sort(function (a, b) { return b.fragment.length - a.fragment.length; });
    var repaired = previous;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
        var item = items[itemIndex];
        var replacement = replacements[item.id];
        if (!replacement || countChinese(replacement) > 0) continue;
        repaired = replaceChineseFragment(repaired, item.fragment, replacement);
    }
    return repaired;
}

// Chinese needs no spaces, so "Hoàng玉" must become "Hoàng Ngọc", not "HoàngNgọc".
function replaceChineseFragment(text, fragment, replacement) {
    var parts = text.split(fragment);
    var result = parts[0];
    for (var i = 1; i < parts.length; i++) {
        var before = result.charAt(result.length - 1);
        var after = parts[i].charAt(0);
        var value = replacement;
        if (/[0-9A-Za-z\u00c0-\u024f\u1e00-\u1eff\u3011\]\)\u201D]/.test(before)) value = " " + value;
        if (/[0-9A-Za-z\u00c0-\u024f\u1e00-\u1eff]/.test(after)) value += " ";
        result += value + parts[i];
    }
    return result;
}

function chineseFragmentContext(text, fragment) {
    var value = String(text || "");
    var position = value.indexOf(fragment);
    if (position < 0) return fragment;
    var start = Math.max(0, position - CHINESE_FRAGMENT_CONTEXT_LENGTH);
    var end = Math.min(value.length, position + fragment.length + CHINESE_FRAGMENT_CONTEXT_LENGTH);
    return value.substring(start, end);
}

function translateChineseFragmentsOnce(model, apiKeys, items, to, memoryPrompt, maxOutputTokens, bookId, repairTimeoutMs) {
    var instruction = "Dịch mọi cụm tiếng Trung được cung cấp sang " + translationLanguageName(to) + " tự nhiên để chèn vào bản dịch văn học hiện có. " +
        "Chỉ dùng ngữ cảnh của từng mục để xác định nghĩa và tên riêng; không dịch hoặc trả lại phần ngữ cảnh. " +
        "Chỉ trả về một đối tượng JSON hợp lệ, không dùng Markdown, theo đúng cấu trúc: " +
        '{"items":[{"id":"0","translation":"phần thay thế đã dịch"}]}. ' +
        "Trả về mỗi id đầu vào đúng một lần. Mỗi translation chỉ được chứa phần thay thế cho cụm tương ứng.";
    if (memoryPrompt) instruction += "\n\n" + memoryPrompt;
    if (to === "vi") instruction += "\n\n" + buildCompactPronounLock();

    try {
        var response;
        var useDs = typeof llmHasDeepSeek === "function" && llmHasDeepSeek() && readBoolean("deepseek_context_engine", false);
        var reqBodyItems = JSON.stringify({ items: items });
        var reqTimeout = repairTimeoutMs || 30000;
        if (useDs) {
            response = llmDeepSeekRequest(
                instruction,
                reqBodyItems,
                { temperature: 0, maxTokens: Math.min(maxOutputTokens || 4096, 4096), json: true },
                reqTimeout
            );
            if ((!response || response.error) && Array.isArray(apiKeys) && apiKeys.length > 0) {
                response = llmRequest(
                    apiKeys,
                    llmBuildBody(LLM_ANALYSIS_MODEL, instruction, reqBodyItems, {
                        temperature: 0,
                        maxTokens: Math.min(maxOutputTokens || 4096, 4096),
                        json: true,
                        bookId: bookId
                    }),
                    reqTimeout
                );
            }
        } else {
            response = llmRequest(
                apiKeys,
                llmBuildBody(LLM_ANALYSIS_MODEL, instruction, reqBodyItems, {
                    temperature: 0,
                    maxTokens: Math.min(maxOutputTokens || 4096, 4096),
                    json: true,
                    bookId: bookId
                }),
                reqTimeout
            );
        }
        if (response.error) return null;

        var output = stripCodeFence(response.text).trim();
        if (!output) return null;

        var parsed = parseTranslationJson(output);
        if (!parsed || !Array.isArray(parsed.items)) return null;

        var replacements = {};
        for (var index = 0; index < parsed.items.length; index++) {
            var translatedItem = parsed.items[index];
            if (!translatedItem || translatedItem.id === undefined) continue;
            var id = String(translatedItem.id);
            var translation = String(translatedItem.translation || "").trim();
            if (translation) replacements[id] = translation;
        }
        return replacements;
    } catch (e) {
        return null;
    }
}

function containsChinese(value) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}

function countChinese(value) {
    var matches = String(value || "").match(/[\u3400-\u9fff\uf900-\ufaff]/g);
    return matches ? matches.length : 0;
}

function oneLine(value) {
    return String(value || "").replace(/[\r\n\t]+/g, " ").trim();
}

function isChineseSource(text, from) {
    return translationIsChineseSource(text, from);
}

function readConfig(key, fallback) {
    try {
        var value = localConfig.getItem(translationConfigKey(key));
        if (value === null || value === undefined) return fallback;
        var text = String(value);
        return text.trim() === "" ? fallback : text;
    } catch (e) {
        return fallback;
    }
}

function readCurrentBookId() {
    try {
        var info = localBook.getInfo();
        if (info && info.id) return String(info.id);
    } catch (e) {}
    return "";
}

function readBookCustomInstruction() {
    try {
        var info = localBook.getInfo();
        if (info && info.id) {
            var key = translationBookPromptConfigKey(String(info.id));
            return readConfig(key, "").trim();
        }
    } catch (e) {}
    return "";
}

function readBoolean(key, fallback) {
    return readConfig(key, fallback ? "true" : "false") === "true";
}

function readApiKeys() {
    return llmReadGeminiKeys();
}


function readNumber(key, fallback, min, max) {
    var value = parseFloat(readConfig(key, String(fallback)));
    if (isNaN(value)) value = fallback;
    if (value < min) value = min;
    if (value > max) value = max;
    return value;
}


function buildInstruction(text, from, to, source, style, customInstruction, memoryPrompt) {
    var chineseSource = isChineseSource(text, from);
    var sourceLanguage = translationLanguageName(from);
    var targetLanguage = translationLanguageName(to);
    // Genre styles are written for Vietnamese output; the generic style fits any target.
    var styleId = translationResolveStyle(style, chineseSource);
    var stylePrompt = to === "vi" || styleId === "tu-nhien" ? loadTranslationStylePrompt(styleId) : "";
    if (stylePrompt) {
        stylePrompt = stylePrompt.split("{target_language}").join(targetLanguage);
        var note = translationNonChineseNote(chineseSource);
        if (note) stylePrompt += "\n" + note;
    }
    var sourcePrompt = "";
    if (source === "chapterContent") {
        sourcePrompt = "Viết văn xuôi trôi chảy, phù hợp với một chương truyện.";
    } else if (source === "tableOfContent") {
        sourcePrompt = "Giữ nguyên số thứ tự chương và dịch tiêu đề ngắn gọn.";
    } else if (source === "detail") {
        sourcePrompt = "Giữ nguyên các nhãn thông tin và mọi cấu trúc HTML.";
    } else if (source === "discovery") {
        sourcePrompt = "Dịch tiêu đề, thẻ và mô tả ngắn một cách súc tích.";
    }
    var isStandaloneCustomPrompt = customInstruction &&
        (/^\s*<prompt[\s>]/i.test(customInstruction) || /<\/(?:prompt|role|instructions|constraints)>/i.test(customInstruction));

    var template;
    if (isStandaloneCustomPrompt) {
        // Khi người dùng dán full XML prompt vào "Yêu cầu dịch riêng cho truyện":
        // Dùng trực tiếp prompt đó cho RIÊNG truyện này, bỏ qua system_prompt & style mặc định để tránh xung đột luật và tiết kiệm token.
        template = customInstruction;
        if (sourcePrompt && template.indexOf("{source_prompt}") < 0) {
            template += "\n\n<source_task>" + sourcePrompt + "</source_task>";
        }
        if (memoryPrompt && template.indexOf("{memory_prompt}") < 0) {
            template += "\n\n<glossary>\n" + memoryPrompt + "\n</glossary>";
        }
    } else {
        template = readConfig("system_prompt", translationDefaultSystemPrompt());
        // Bảo đảm không bao giờ mất bộ nhớ dịch nếu người dùng sửa system_prompt mà quên biến {memory_prompt}
        if (memoryPrompt && template.indexOf("{memory_prompt}") < 0) {
            template += "\n\n" + memoryPrompt;
        }
    }

    var values = {
        source_language: sourceLanguage,
        target_language: targetLanguage,
        style_prompt: stylePrompt ? "PHONG CÁCH DỊCH TRUYỆN:\n" + stylePrompt : "",
        source_prompt: sourcePrompt,
        custom_instruction: (!isStandaloneCustomPrompt && customInstruction) ? "YÊU CẦU RIÊNG:\n" + customInstruction : "",
        memory_prompt: memoryPrompt || ""
    };
    for (var key in values) {
        if (values.hasOwnProperty(key)) {
            template = template.split("{" + key + "}").join(values[key]);
        }
    }
    // Appended outside the editable template so customized system prompts get it too.
    if (translationSourceDiffers(text, from, to)) {
        template += "\n\nBẮT BUỘC VỀ NGÔN NGỮ: mọi câu trong bản dịch phải viết bằng " + targetLanguage +
            ", kể cả tiêu đề, lời tác giả, lời nhắn, quảng cáo, ghi chú và thông báo hệ thống. ";
        if (chineseSource && !translationWritesHan(to)) {
            template += "Không để sót bất kỳ chữ Hán nào; " +
                (to === "vi"
                    ? "tên riêng Trung Quốc chưa có trong bộ nhớ thì phiên âm Hán Việt, còn tên/từ mượn phương Tây dùng dạng phổ thông (Holmes, Cthulhu, sâm-panh, Tarot, sofa). "
                    : "tên riêng chưa có trong bộ nhớ thì phiên âm theo quy ước phổ biến của " + targetLanguage + ". ");
        } else {
            template += "Không để sót câu hoặc cụm từ nào bằng ngôn ngữ gốc. ";
        }
        template += "Không chèn nguyên văn hoặc chú thích trong ngoặc.";
    }
    return String(template).replace(/\n{3,}/g, "\n\n").trim();
}

function loadTranslationStylePrompt(style) {
    var selected = String(style || "");
    try {
        var stored = localDatabase.get(TRANSLATION_PROMPT_SCOPE, TRANSLATION_PROMPT_TABLE, selected);
        if (stored !== null && stored !== undefined) {
            return String(stored).trim();
        }
    } catch (e) {}
    var prompts = translationDefaultPrompts();
    return prompts[selected] || prompts["tu-nhien"];
}



function stripCodeFence(text) {
    var value = String(text || "").trim();
    var exact = value.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
    if (exact) return exact[1];
    var embedded = value.match(/```[^\n]*\n([\s\S]*?)\n```/);
    return embedded ? embedded[1] : value;
}

function restoreLineTaggedOutput(output, originalLines) {
    var lines = String(output || "").replace(/\r\n/g, "\n").split("\n");
    var mapped = {};
    var matchedCount = 0;
    for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/^\s*\[L(\d+)\]\s*(.*)$/);
        if (m) {
            var idx = parseInt(m[1], 10);
            if (!isNaN(idx) && idx >= 0 && idx < originalLines.length) {
                mapped[idx] = m[2];
                matchedCount++;
            }
        }
    }
    if (matchedCount > 0) {
        var result = [];
        for (var j = 0; j < originalLines.length; j++) {
            result.push(mapped[j] !== undefined ? mapped[j] : originalLines[j]);
        }
        return result.join("\n");
    }
    // Fallback: xóa tag [L\d+] nếu có
    var cleaned = [];
    for (var k = 0; k < lines.length; k++) {
        cleaned.push(lines[k].replace(/^\s*\[L\d+\]\s*/, ""));
    }
    return cleaned.join("\n");
}

function hasRetryMarker(text) {
    return /(?:\[|\u3010)\s*RETRY\s*(?:\]|\u3011)/i.test(String(text || ""));
}

function repairRetryMarkerLines(model, apiKeys, draft, original, to, memoryPrompt, maxOutputTokens, bookId, timeoutMs) {
    var outLines = String(draft || "").replace(/\r\n/g, "\n").split("\n");
    var srcLines = String(original || "").replace(/\r\n/g, "\n").split("\n");
    var sameCount = outLines.length === srcLines.length;

    var retryItems = [];
    for (var i = 0; i < outLines.length; i++) {
        if (!hasRetryMarker(outLines[i])) continue;
        var srcLine = sameCount ? String(srcLines[i] || "").trim() : "";
        if (!srcLine && i < srcLines.length) srcLine = String(srcLines[i] || "").trim();
        var prevLine = i > 0 ? outLines[i - 1] : "";
        var nextLine = i + 1 < outLines.length ? outLines[i + 1] : "";
        retryItems.push({
            id: String(i),
            lineIndex: i,
            source: srcLine,
            before: prevLine,
            after: nextLine
        });
    }
    if (retryItems.length === 0) return draft;

    var instruction = "Các dòng dưới đây trong bản dịch trước bị đánh dấu lỗi [RETRY]. " +
        "Hãy dịch chính xác trường source sang " + translationLanguageName(to) + " khớp mạch văn với before và after. " +
        "Chỉ trả về DUY NHẤT một đối tượng JSON hợp lệ (không Markdown): " +
        '{"items":[{"id":"0","translation":"dòng đã dịch hoàn chỉnh"}]}. ' +
        "Không được chứa [RETRY] và không để sót chữ Hán.";
    if (memoryPrompt) instruction += "\n\n" + memoryPrompt;
    if (to === "vi") instruction += "\n\n" + buildCompactPronounLock();

    var replacements = null;
    try {
        var response = null;
        var useDsRetry = typeof llmHasDeepSeek === "function" && llmHasDeepSeek() && readBoolean("deepseek_context_engine", false);
        if (useDsRetry) {
            response = llmDeepSeekRequest(
                instruction,
                JSON.stringify({ items: retryItems }),
                { temperature: 0.1, maxTokens: Math.min(maxOutputTokens || 4096, 4096), json: true },
                timeoutMs || 25000
            );
        }
        if (!response || response.error) {
            response = llmRequest(
                apiKeys,
                llmBuildBody(LLM_ANALYSIS_MODEL, instruction, JSON.stringify({ items: retryItems }), {
                    temperature: 0.1,
                    maxTokens: Math.min(maxOutputTokens || 4096, 4096),
                    json: true,
                    bookId: bookId
                }),
                timeoutMs || 25000
            );
        }
        if (response && !response.error && response.text) {
            var parsed = parseTranslationJson(stripCodeFence(response.text));
            if (parsed && Array.isArray(parsed.items)) {
                replacements = {};
                for (var p = 0; p < parsed.items.length; p++) {
                    var it = parsed.items[p];
                    if (it && it.id !== undefined && it.translation) {
                        var tr = sanitizeTranslationOutput(String(it.translation), "", to).replace(/(?:\[|\u3010)\s*RETRY\s*(?:\]|\u3011)/gi, "").trim();
                        if (tr) replacements[String(it.id)] = tr;
                    }
                }
            }
        }
    } catch (e) {}

    for (var r = 0; r < retryItems.length; r++) {
        var item = retryItems[r];
        var rep = replacements ? replacements[item.id] : "";
        if (rep) {
            outLines[item.lineIndex] = rep;
        } else {
            // Chặn rò rỉ [RETRY] tuyệt đối: gỡ marker hoặc dùng dòng nguồn để bước sửa Hán tự xử lý tiếp
            var stripped = outLines[item.lineIndex].replace(/(?:\[|\u3010)\s*RETRY\s*(?:\]|\u3011)/gi, "").trim();
            outLines[item.lineIndex] = stripped || item.source || "";
        }
    }
    return outLines.join("\n");
}


function buildHardPronounLock() {
    return "<hard_pronoun_lock>\n" +
        "LUẬT TỐI THƯỢNG VỀ ĐẠI TỪ, DANH XƯNG & TỪ VỰNG (GHI ĐÈ MỌI CHỈ DẪN PHÍA TRÊN, KỂ CẢ STYLE, GLOSSARY VÀ STORY_STATE):\n" +
        "1. BẢNG ÁNH XẠ CỨNG 1-1 (ÁP DỤNG MỌI NGỮ CẢNH: đối thoại, tỏ tình, độc thoại nội tâm, suy nghĩ, gia đình, học đường, khung chat, thông báo hệ thống, lời tác giả):\n" +
        "   - 我 -> ta | 你 -> ngươi | 您 -> ngài\n" +
        "   - 我们/咱们 -> chúng ta | 你们 -> các ngươi | 您们 -> các ngài\n" +
        "   - 他 -> hắn (hoặc y/gã/lão) | 她 -> nàng hoặc cô | 他们/她们 -> bọn họ | 自己 -> bản thân/chính mình | 人家 -> người ta\n" +
        "   (Chỉ giữ trẫm/thần/bổn cung/nô tỳ khi nguyên văn viết đúng chữ 朕/臣/本宫/奴婢; hễ là 我/你 bắt buộc dịch ta/ngươi.)\n" +
        "2. TỪ CẤM TUYỆT ĐỐI (CẤM DÙNG LÀM ĐẠI TỪ NHÂN XƯNG):\n" +
        "   - Cấm ngôi 1 & 2: tôi, tớ, cậu, mình, bạn, anh/em/chị/con/cháu/chú/bác (làm đại từ), tao, mày, chúng tôi, chúng mình, tụi mình, bọn tôi, các bạn, bọn em.\n" +
        "   - Cấm ngôi 3: anh ấy, anh ta, cậu ấy, cậu ta, cô ấy, cô ta, chị ấy, chị ta, ông ấy, ông ta, bà ấy, bà ta, em ấy, em ta, anh chàng, cô nàng.\n" +
        "3. DANH XƯNG, TỪ MƯỢN & LÓNG CHUẨN:\n" +
        "   - Giữ [Họ/Tên + hậu tố viết thường] (Lâm ca, Phùng lão sư, Trương đội, Vương tổng, Tô sư tỷ) và [tiền tố viết thường + Họ] (lão Vương, tiểu Trần).\n" +
        "   - Chuẩn học đường/xã hội: 学长=học trưởng, 学姐=học tỷ, 学弟=học đệ, 学妹=học muội, 小哥=tiểu ca, 大叔=đại thúc. CẤM bịa từ giả Hán Việt (học nữ, thủ cơ, điện thê).\n" +
        "   - Tên phương Tây/từ mượn dùng dạng phổ thông (Holmes, Cthulhu, sâm-panh, Tarot, sofa); lóng mạng dịch tự nhiên (副本=phó bản, 吃瓜=hóng chuyện, 背锅=gánh tội).\n" +
        "4. VÍ DỤ BẮT BUỘC (KHÔNG ĐƯỢC LỆCH):\n" +
        "   - Tỏ tình: “林御学长……我喜欢你！” -> “Lâm Ngự học trưởng... ta thích ngươi!” (SAI: “em thích anh!”)\n" +
        "   - Nội tâm: 我心里一惊，他不会发现我了吧？ -> Trong lòng ta giật thót, hắn sẽ không phát hiện ra ta chứ?\n" +
        "   - Gia đình + số nhiều: “妈，我们明天回去，你也早点休息。” -> “Mẹ, ngày mai chúng ta về, ngươi cũng nghỉ sớm đi.”\n" +
        "   - Hệ thống: 【提示：恭喜你获得道具】 -> 【Thông báo: Chúc mừng ngươi nhận được đạo cụ】 (SAI: “Chúc mừng bạn”)\n" +
        "   - Lời tác giả: 作者的话：我今天晚点更新，谢谢你们。 -> Lời tác giả: Hôm nay ta cập nhật muộn một chút, cảm ơn các ngươi.\n" +
        "</hard_pronoun_lock>";
}

function buildCompactPronounLock() {
    return "<hard_pronoun_lock>\n" +
        "BẮT BUỘC: 我=ta, 你=ngươi, 您=ngài, 我们/咱们=chúng ta, 你们=các ngươi, 他=hắn/y/gã/lão, 她=nàng/cô. " +
        "CẤM dùng: tôi, tớ, cậu, mình, bạn, anh/em/chị/con/cháu/chú/tao/mày (làm đại từ), chúng tôi, các bạn, anh ấy/anh ta/cô ấy/cô ta/cậu ta/ông ấy. " +
        "Danh xưng giữ [Họ/Tên + hậu tố viết thường] (học trưởng/học tỷ/học đệ/học muội, cấm học nữ).\n" +
        "</hard_pronoun_lock>";
}


function buildQtPolishInstruction(baseInstruction, includeRaw, hasPronounLock) {
    var polishHeader = "CHẾ ĐỘ BIÊN TẬP BẢN DỊCH THÔ QUICKTRANSLATOR (QT-POLISH — GHI ĐÈ YÊU CẦU DỊCH TỪ ĐẦU):\n" +
        (includeRaw
            ? "Đầu vào gồm <raw_chinese> (nguyên văn tiếng Trung để đối chiếu câu tối nghĩa) và <qt_draft> (bản dịch thô từ QuickTranslator/VietPhrase). "
            : "Đầu vào đã là bản dịch thô tiếng Việt (convert) từ QuickTranslator/VietPhrase, KHÔNG phải nguyên văn tiếng Trung. ") +
        "Nhiệm vụ: viết lại toàn bộ thành văn xuôi tiếng Việt mượt mà, tự nhiên, đọc lâu và nghe TTS êm tai:\n" +
        "1) Giữ nhất quán tên nhân vật, địa danh, cảnh giới, thuật ngữ và danh xưng từ bản QT (nhưng tên/từ mượn phương Tây dùng dạng phổ thông như Holmes, sâm-panh, Tarot thay vì Hán Việt cứng).\n" +
        "2) BẮT BUỘC đảo lại trật tự ngữ pháp convert tiếng Trung cho đúng tiếng Việt thuần khiết, bỏ mùi dịch máy; KHÔNG chép nguyên xi bản convert và KHÔNG thêm/bớt/tóm tắt tình tiết.\n" +
        "3) Dịch nốt mọi chữ Hán còn sót (nếu có) và giữ nguyên bố cục đoạn, ngoặc thoại “...”, khung hệ thống 【...】/[...]" +
        (hasPronounLock ? "; tuân thủ tuyệt đối <hard_pronoun_lock> ở cuối.\n" : ".\n") +
        "4) Chỉ trả về bản biên tập tiếng Việt hoàn chỉnh, không lặp lại thẻ <raw_chinese>/<qt_draft> và không giải thích.";
    return polishHeader + "\n\n" + String(baseInstruction || "");
}

function isUneditedQtEcho(output, qtDraft) {
    var outClean = String(output || "").replace(/\s+/g, " ").trim();
    var qtClean = String(qtDraft || "").replace(/\s+/g, " ").trim();
    if (!outClean || !qtClean || qtClean.length < 200) return false;
    if (outClean === qtClean) return true;
    var qtWords = translationCompareWords(qtClean);
    if (qtWords.length < 40) return false;
    var outWords = translationCompareWords(outClean);
    if (Math.abs(outWords.length - qtWords.length) > qtWords.length * 0.1) return false;
    var samePos = 0;
    var limit = Math.min(qtWords.length, outWords.length);
    for (var i = 0; i < limit; i++) {
        if (qtWords[i] === outWords[i]) samePos++;
    }
    return (samePos / limit) >= 0.92;
}
