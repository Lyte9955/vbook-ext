var LLM_NAME = "Gemini + DeepSeek";
var LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
var LLM_DEFAULT_MODEL = "gemini-3.5-flash-lite";
var LLM_ANALYSIS_MODEL = "gemini-3.5-flash-lite";
var LLM_SUPPORTS_TEMPERATURE = true;
var LLM_TEMPERATURE_NOTE = "; một số model Gemini 3.6+/4 sẽ tự tối ưu";

var DS_DEFAULT_ENDPOINT = "https://api.gitapihub.com/v1/chat/completions";
var DS_DEFAULT_MODEL = "deepseek-flash";
var DS_AUTH_STATUSES = { 401: true, 402: true, 403: true };
var DS_ROTATE_STATUSES = { 429: true, 500: true, 502: true, 503: true, 504: true };

var LLM_STATE_KEY = "gemini_ft_state_v2";
var LLM_ERROR_LOG_KEY = "gemini_recent_errors_v1";
var LLM_MAX_ERROR_LOG = 5;
var LLM_CONTEXT_BRIDGE_PREFIX = "gemini_ctx_bridge_v1_";
var LLM_STORY_STATE_PREFIX = "gemini_story_state_v1_";
var LLM_DS_SYNC_COUNT_PREFIX = "gemini_ds_sync_cnt_v1_";
var LLM_CONTEXT_BRIDGE_MAX_CHARS = 450;
var LLM_STORY_STATE_MAX_CHARS = 900;

var LLM_COOLDOWN_RPM_MS = 62000;
var LLM_COOLDOWN_AUTH_MS = 86400000;
var LLM_COOLDOWN_SERVER_MS = 15000;
var LLM_COOLDOWN_MODEL_DEAD_MS = 3600000;
var LLM_COOLDOWN_MODEL_OVERLOAD_MS = 600000;
var LLM_MAX_NETWORK_RETRIES = 2;
var LLM_MAX_TOTAL_NETWORK_RETRIES = 4;
var LLM_MAX_SERVER_RETRIES = 2;
var LLM_MAX_TOTAL_SERVER_RETRIES = 4;
var LLM_MAX_ATTEMPTS_PER_MODEL = 6;
var LLM_MAX_TOTAL_ATTEMPTS = 10;
var LLM_MAX_WALL_MS = 95000;            // Trần cứng 95s để model chính 38s vẫn còn >=55s trượt sang model dự phòng

var LLM_SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

var LLM_MODEL_INFO = {
    "gemini-3.8-flash": {
        apiModel: "gemini-3.8-flash",
        thinkingMode: "level",
        thinkingLevel: "LOW",
        safeRpm: 4,
        minIntervalMs: 13000,
        cascade: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    },
    "gemini-3.6-flash": {
        apiModel: "gemini-3.6-flash",
        thinkingMode: "level",
        thinkingLevel: "LOW",
        safeRpm: 4,
        minIntervalMs: 13000,
        cascade: ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    },
    "gemini-3.5-flash-lite": {
        apiModel: "gemini-3.5-flash-lite",
        thinkingMode: "level",
        thinkingLevel: "MINIMAL",
        safeRpm: 12,
        minIntervalMs: 4500,
        cascade: ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"]
    },
    "gemini-3.1-flash-lite": {
        apiModel: "gemini-3.1-flash-lite",
        thinkingMode: "level",
        thinkingLevel: "MINIMAL",
        safeRpm: 12,
        minIntervalMs: 4500,
        cascade: ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"]
    },
    "gemini-4-hydrogen": {
        apiModel: "gemini-4-hydrogen",
        thinkingMode: "level",
        thinkingLevel: "LOW",
        safeRpm: 4,
        minIntervalMs: 13000,
        cascade: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    },
    "gemini-2.5-flash-lite": {
        apiModel: "gemini-2.5-flash-lite",
        thinkingMode: "budget",
        thinkingBudget: 0,
        safeRpm: 8,
        minIntervalMs: 6500,
        cascade: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    }
};

function llmReadConfig(key, fallback) {
    try {
        var configKey = typeof translationConfigKey === "function" ? translationConfigKey(key) : key;
        var value = localConfig.getItem(configKey);
        if (value === null || value === undefined) return fallback;
        var text = String(value).trim();
        return text || fallback;
    } catch (e) {
        return fallback;
    }
}

function llmReadBoolConfig(key, fallback) {
    return llmReadConfig(key, fallback ? "true" : "false") === "true";
}

function llmAddGeminiConfig(config) {
    config[translationConfigKey("sequential_key_order")] = {
        title: "1.2. Gọi key tuần tự từ trên xuống dưới",
        subtitle: "BẬT (Mặc định): gọi lần lượt từng key #1 → #2 → #3 → ... theo đúng thứ tự danh sách (tự lướt qua key lỗi/cooldown). TẮT: bám 1 key cố định (Sticky)",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("free_tier_model_cascade")] = {
        title: "1.3. Tự chuyển model Gemini Free Tier",
        subtitle: "Hết RPD ở model hiện tại sẽ tự trượt sang model khác có hạn mức độc lập (4 Hydrogen → 3.8 Flash → 3.6 Flash → Flash-Lite)",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("free_tier_eco_mode")] = {
        title: "1.4. Chế độ Tiết kiệm Free Tier (Eco Mode)",
        subtitle: "Giữ mức 1 request Gemini/chương; khi có DeepSeek key, việc nhớ ngữ cảnh và sửa chữ Hán sót do DeepSeek gánh",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("custom_model")] = {
        title: "1.5. Model Gemini tùy chỉnh (tùy chọn)",
        subtitle: "Để trống để dùng model đã chọn ở danh sách Model; nhập model ID bất kỳ nếu muốn ghi đè",
        "default": "",
        mode: "input",
        format: "text"
    };
    config[translationConfigKey("api_base_url")] = {
        title: "1.6. Gemini API Base URL",
        subtitle: "Mặc định: https://generativelanguage.googleapis.com/v1beta",
        "default": LLM_BASE_URL,
        mode: "input",
        format: "text"
    };
}

function llmAddDeepSeekConfig(config) {
    config[translationConfigKey("enable_deepseek")] = {
        title: "2.0. Bật sử dụng DeepSeek (Công tắc tổng)",
        subtitle: "BẬT: dùng DeepSeek nhớ ngữ cảnh, sửa chữ Hán sót, cứu hộ & phân tích nhân vật. TẮT: chạy thuần Gemini (không gọi DeepSeek, vẫn giữ nguyên key ở mục 2.1)",
        "default": "true",
        mode: "toggle"
    };
    var migratedDsKeys = llmParseApiKeys(llmReadConfig("deepseek_api_key", "")).join("\n");
    config[translationConfigKey("deepseek_api_key_lines")] = {
        title: "2.1. DeepSeek API keys (Gitapihub)",
        subtitle: "Mỗi dòng 1 API key, chỉ dán thuần API key; dùng để nhớ mạch truyện, học tên riêng, sửa chữ Hán sót và cứu hộ",
        "default": migratedDsKeys,
        mode: "input",
        format: "text"
    };
    config[translationConfigKey("deepseek_context_engine")] = {
        title: "2.2. DeepSeek nhớ mạch truyện & học tên riêng",
        subtitle: "Cập nhật trạng thái cảnh & xưng hô sau mỗi chương (không làm lỗi chương nếu DeepSeek tạm bận)",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("deepseek_memory_interval")] = {
        title: "2.3. Chu kỳ học tên riêng mới (số chương)",
        subtitle: "Mặc định 3 (tiết kiệm ~50% token); nhập 0 nếu đã có file Names chuẩn và chỉ cần nhớ mạch truyện",
        "default": "3",
        mode: "input",
        format: "number"
    };
    config[translationConfigKey("deepseek_rescue_fallback")] = {
        title: "2.4. DeepSeek cứu hộ khi Gemini chặn/lỗi",
        subtitle: "Tự động dịch thay nếu Gemini dính bộ lọc cứng (PROHIBITED_CONTENT/SAFETY), cắt token hoặc timeout",
        "default": "true",
        mode: "toggle"
    };
    config[translationConfigKey("deepseek_model")] = {
        title: "2.5. Model DeepSeek điều phối ngữ cảnh",
        subtitle: "Khuyên dùng deepseek-flash (nhanh và rẻ nhất)",
        "default": DS_DEFAULT_MODEL,
        mode: "input",
        format: "text"
    };
    config[translationConfigKey("deepseek_rescue_model")] = {
        title: "2.6. Model DeepSeek riêng cho cứu hộ (tùy chọn)",
        subtitle: "Để trống sẽ dùng chung mục 2.5; có thể nhập deepseek-v4-pro cho các chương bị Gemini chặn",
        "default": "",
        mode: "input",
        format: "text"
    };
    config[translationConfigKey("deepseek_endpoint")] = {
        title: "2.7. DeepSeek API Endpoint",
        subtitle: "Mặc định: https://api.gitapihub.com/v1/chat/completions (tự chuẩn hóa nếu chỉ dán tên miền)",
        "default": DS_DEFAULT_ENDPOINT,
        mode: "input",
        format: "text"
    };
}

function llmAddContextBridgeConfig(config) {
    config[translationConfigKey("use_context_bridge")] = {
        title: "3.3. Cầu nối ngữ cảnh giữa các chương",
        subtitle: "Gửi kèm trạng thái mạch truyện (DeepSeek) + 2-3 đoạn cuối chương trước để giữ xưng hô xuyên suốt khi đổi key Gemini",
        "default": "true",
        mode: "toggle"
    };
}

function llmAddProviderConfig(config) {
    llmAddGeminiConfig(config);
    llmAddDeepSeekConfig(config);
    llmAddContextBridgeConfig(config);
}

function llmParseApiKeys(raw) {
    var text = String(raw || "").trim();
    if (!text) return [];
    var lines;
    if (text.charAt(0) === "[") {
        try {
            var parsed = JSON.parse(text);
            lines = Array.isArray(parsed) ? parsed : [text];
        } catch (e) {
            lines = text.split(/[\r\n]+/);
        }
    } else {
        lines = text.split(/[\r\n]+/);
    }
    var keys = [];
    for (var i = 0; i < lines.length; i++) {
        var key = String(lines[i] || "").trim();
        if (key && keys.indexOf(key) === -1) keys.push(key);
    }
    return keys;
}

function llmReadGeminiKeys() {
    var rawNew = llmReadConfig("api_key_lines", "");
    if (rawNew) return llmParseApiKeys(rawNew);
    return llmParseApiKeys(llmReadConfig("api_key", ""));
}

function llmReadDeepSeekKeys() {
    var rawNew = llmReadConfig("deepseek_api_key_lines", "");
    if (rawNew) return llmParseApiKeys(rawNew);
    return llmParseApiKeys(llmReadConfig("deepseek_api_key", ""));
}

function llmHasDeepSeek() {
    if (!llmReadBoolConfig("enable_deepseek", true)) return false;
    return llmReadDeepSeekKeys().length > 0;
}

function llmNormalizeModel(model) {
    var selected = String(model || "").trim();
    return LLM_MODEL_INFO[selected] ? selected : LLM_DEFAULT_MODEL;
}

function llmBuildEndpoint(apiModel) {
    var base = llmReadConfig("api_base_url", LLM_BASE_URL).replace(/\/+$/, "");
    var cleanModel = String(apiModel || LLM_DEFAULT_MODEL).trim().replace(/^models\//, "");
    return base + "/models/" + encodeURIComponent(cleanModel) + ":generateContent";
}

function llmCreatePayloadForModel(apiModel, presetInfo, isCustom, systemPrompt, userText, options) {
    options = options || {};
    var generationConfig = {
        maxOutputTokens: options.maxTokens || 8192
    };
    var omitTemp = /^gemini-(?:4|3\.[6-9])/i.test(String(apiModel || ""));
    if (!omitTemp && options.temperature !== undefined && !isNaN(options.temperature)) {
        generationConfig.temperature = options.temperature;
    }
    if (options.json) {
        generationConfig.responseMimeType = "application/json";
    }

    var info = presetInfo || LLM_MODEL_INFO[apiModel] || null;
    if (!isCustom && info) {
        if (info.thinkingMode === "budget") {
            generationConfig.thinkingConfig = { thinkingBudget: info.thinkingBudget };
        } else if (info.thinkingMode === "level" && info.thinkingLevel) {
            generationConfig.thinkingConfig = { thinkingLevel: info.thinkingLevel };
        }
    }

    var payload = {
        contents: [
            {
                role: "user",
                parts: [{ text: String(userText || "") }]
            }
        ],
        generationConfig: generationConfig,
        safetySettings: LLM_SAFETY_SETTINGS
    };

    if (systemPrompt) {
        payload.systemInstruction = {
            parts: [{ text: String(systemPrompt) }]
        };
    }
    return payload;
}

// options: { temperature, maxTokens, json, bookId }
function llmBuildBody(model, systemPrompt, userText, options) {
    options = options || {};
    var normalized = llmNormalizeModel(model);
    var info = LLM_MODEL_INFO[normalized];
    var customModel = llmReadConfig("custom_model", "");
    var apiModel = customModel || info.apiModel;

    return {
        _model: apiModel,
        _presetId: customModel ? "" : normalized,
        _isCustom: Boolean(customModel),
        _bookId: options.bookId ? String(options.bookId) : "",
        _systemPrompt: systemPrompt,
        _userText: userText,
        _options: options,
        payload: llmCreatePayloadForModel(apiModel, info, Boolean(customModel), systemPrompt, userText, options)
    };
}

// === DeepSeek (Gitapihub) Coordinator Engine ===
function llmDeepSeekRequest(systemPrompt, userText, options, timeout) {
    if (!llmReadBoolConfig("enable_deepseek", true)) {
        return { text: "", finishReason: "", error: "DeepSeek đang bị TẮT ở mục 2.0", keyIndex: -1 };
    }
    var dsKeys = llmReadDeepSeekKeys();
    if (dsKeys.length === 0) {
        return { text: "", finishReason: "", error: "Chưa cấu hình DeepSeek API key", keyIndex: -1 };
    }
    options = options || {};
    var endpoint = llmNormalizeDeepSeekEndpoint(llmReadConfig("deepseek_endpoint", DS_DEFAULT_ENDPOINT));
    var dsModel = (options && options.model) ? String(options.model).trim() : llmReadConfig("deepseek_model", DS_DEFAULT_MODEL);

    var body = {
        model: dsModel,
        messages: [
            { role: "system", content: String(systemPrompt || "") },
            { role: "user", content: String(userText || "") }
        ],
        max_tokens: Math.min(options.maxTokens || 2048, 8192),
        stream: false,
        thinking: { type: "disabled" }
    };
    if (options.temperature !== undefined && !isNaN(options.temperature)) {
        body.temperature = options.temperature;
    }
    if (options.json) {
        body.response_format = { type: "json_object" };
    }

    var defaultFastModel = llmReadConfig("deepseek_model", DS_DEFAULT_MODEL);
    var fallbackModel = (dsModel !== defaultFastModel) ? defaultFastModel : DS_DEFAULT_MODEL;
    var maxAttempts = Math.max(dsKeys.length, 2);
    var hasFallbackAttempt = maxAttempts > 1;
    var isShortSync = Boolean(timeout && timeout <= 30000);
    var dsStart = new Date().getTime();
    var dsBudget = isShortSync ? timeout : Math.max(timeout || 45000, 70000);
    var deadDsIdx = {};
    var lastError = "";
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
        var dsRem = dsBudget - (new Date().getTime() - dsStart);
        if (attempt > 0 && dsRem < 8000) break;
        var i = attempt % dsKeys.length;
        if (deadDsIdx[i]) continue;
        // Nếu lượt 1 dùng rescue model chậm bị 504/lỗi, lượt 2 tự hạ về model nhanh (deepseek-flash)
        var activeModel = (attempt > 0 && dsModel !== fallbackModel) ? fallbackModel : dsModel;
        var isSlowPrimaryDs = (attempt === 0 && dsModel !== fallbackModel && hasFallbackAttempt && !isShortSync);
        var attemptCap = isSlowPrimaryDs
            ? Math.min(timeout || 45000, 35000)
            : (timeout || 50000);
        var reqTimeout = Math.min(attemptCap, dsRem);
        if (reqTimeout < 8000) break;

        body.model = activeModel;
        var payload = JSON.stringify(body);
        var dsReqAt = new Date().getTime();
        var response;
        try {
            response = fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + dsKeys[i]
                },
                body: payload,
                timeout: reqTimeout
            });
        } catch (e) {
            var dsErrSec = Math.round((new Date().getTime() - dsReqAt) / 1000);
            lastError = "DeepSeek [" + activeModel + "] (" + dsErrSec + "s): " + String(e);
            continue;
        }

        var dsRespSec = Math.round((new Date().getTime() - dsReqAt) / 1000);
        var rawText = "";
        try { rawText = String(response.text() || ""); } catch (eRead) {}

        var data = null;
        try { data = rawText ? JSON.parse(rawText) : null; } catch (eParse) {}

        if (!response.ok) {
            var msg = data && data.error && data.error.message ? String(data.error.message) : "";
            lastError = "DeepSeek [" + activeModel + "] HTTP " + response.status + " (" + dsRespSec + "s)" + (msg ? ": " + msg : "");
            if (DS_AUTH_STATUSES[response.status]) {
                deadDsIdx[i] = true;
                if (dsKeys.length > 1) continue;
                return { text: "", finishReason: "", error: lastError, keyIndex: i };
            }
            if (DS_ROTATE_STATUSES[response.status]) continue;
            return { text: "", finishReason: "", error: lastError, keyIndex: i };
        }

        if (!data) {
            lastError = "DeepSeek [" + activeModel + "] trả về JSON không hợp lệ/bị cụt (len=" + rawText.length + ")";
            continue;
        }

        var choice = data && data.choices && data.choices.length > 0 ? data.choices[0] : null;
        var message = choice && choice.message ? choice.message : null;
        var text = llmStripThinkTags(message && message.content ? String(message.content) : "");
        var rawFinish = choice && choice.finish_reason ? String(choice.finish_reason) : "";
        var finish = rawFinish === "length" ? "max_tokens" : rawFinish;
        if (!text) {
            var hasReasoning = Boolean(message && message.reasoning_content);
            lastError = "DeepSeek [" + activeModel + "] trả về rỗng (finish=" + (finish || "none") + (hasReasoning ? ", chỉ có reasoning" : "") + ")";
            continue;
        }
        return { text: text, finishReason: finish, error: "", keyIndex: i };
    }
    return { text: "", finishReason: "", error: lastError || "Không có DeepSeek API key khả dụng", keyIndex: -1 };
}

function llmNormalizeDeepSeekEndpoint(raw) {
    var url = String(raw || DS_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
    if (!url) return DS_DEFAULT_ENDPOINT;
    url = url.replace(/^https?:\/\/gitapihub\.com(?=\/|$)/i, "https://api.gitapihub.com");
    if (/\/chat\/completions$/i.test(url)) return url;
    if (/\/v1$/i.test(url)) return url + "/chat/completions";
    return url + "/v1/chat/completions";
}

function llmStripThinkTags(text) {
    return String(text || "")
        .replace(/<(think|thought|reasoning)>[\s\S]*?(?:<\/\1>|$)/gi, "")
        .replace(/<\/?(?:think|thought|reasoning)>/gi, "")
        .replace(/<(story_state|previous_tail|glossary|source_task|pronoun_rules|hard_pronoun_lock|raw_chinese)>[\s\S]*?(?:<\/\1>|$)/gi, "")
        .replace(/<\/?(?:story_state|previous_tail|glossary|source_task|pronoun_rules|hard_pronoun_lock|raw_chinese|qt_draft)>/gi, "")
        .trim();
}

function llmExtractJsonObject(text) {
    var clean = llmStripThinkTags(text).replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1").trim();
    try {
        return JSON.parse(clean);
    } catch (e) {}
    var start = clean.indexOf("{");
    var end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(clean.substring(start, end + 1));
        } catch (e2) {}
    }
    return null;
}

function llmShouldDeepSeekRescue(geminiError, geminiFinishReason) {
    if (!llmHasDeepSeek() || !llmReadBoolConfig("deepseek_rescue_fallback", true)) return false;
    var err = String(geminiError || "").toLowerCase();
    var fin = String(geminiFinishReason || "").toLowerCase();
    if (fin === "prohibited_content" || fin === "safety" || fin === "blocklist" || fin === "recitation" || fin === "max_tokens") return true;
    if (err.indexOf("prohibited_content") >= 0 || err.indexOf("safety") >= 0 || err.indexOf("chặn nội dung") >= 0 || err.indexOf("từ chối trả về") >= 0) return true;
    if (err.indexOf("nội dung rỗng") >= 0 || err.indexOf("candidates rỗng") >= 0 || err.indexOf("không trả về kết quả") >= 0) return true;
    if (err.indexOf("http 429") >= 0 || err.indexOf("hạn mức") >= 0 || err.indexOf("quota") >= 0 || err.indexOf("http 401") >= 0 || err.indexOf("http 403") >= 0 || err.indexOf("http 404") >= 0 || err.indexOf("http 408") >= 0 || err.indexOf("http 500") >= 0 || err.indexOf("http 502") >= 0 || err.indexOf("http 503") >= 0 || err.indexOf("http 504") >= 0 || err.indexOf("quá tải") >= 0 || err.indexOf("json không hợp lệ") >= 0 || err.indexOf("timeout") >= 0 || err.indexOf("lỗi kết nối") >= 0 || err.indexOf("không có gemini api key") >= 0) return true;
    return false;
}

// === Portable Rolling Context Bridge + DeepSeek Story State ===
function llmLoadStoryState(bookId) {
    if (!bookId || !llmReadBoolConfig("use_context_bridge", true)) return "";
    try {
        var raw = localStorage.getItem(LLM_STORY_STATE_PREFIX + String(bookId));
        return raw ? String(raw).trim() : "";
    } catch (e) {
        return "";
    }
}

function llmSaveStoryState(bookId, stateText) {
    if (!bookId || !stateText || !llmReadBoolConfig("use_context_bridge", true)) return;
    try {
        var cleaned = String(stateText).replace(/<[^>]+>/g, " ").replace(/\r\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
        // Chống ghi đè mù bởi chuỗi rác ngắn hoặc câu meta không có nội dung mới
        if (cleaned.length < 30) return;
        if (/^(?:\.{2,}|-{2,}|…+|n\/a|none|null|undefined|không có|chưa rõ|无变化|无更新|未变化)$/i.test(cleaned)) return;
        if (/^(?:giữ nguyên|không có thay đổi|không có tình tiết mới|trạng thái (?:cũ|không đổi)|như cũ|chương này chỉ là lời tác giả)/i.test(cleaned)) return;
        var prev = String(localStorage.getItem(LLM_STORY_STATE_PREFIX + String(bookId)) || "").trim();
        if (prev.length >= 100 && cleaned.length < 50) return;
        if (cleaned.length > LLM_STORY_STATE_MAX_CHARS) {
            var cut = cleaned.lastIndexOf(" ", LLM_STORY_STATE_MAX_CHARS);
            cleaned = cleaned.substring(0, cut > LLM_STORY_STATE_MAX_CHARS - 120 ? cut : LLM_STORY_STATE_MAX_CHARS).trim();
        }
        if (cleaned) {
            localStorage.setItem(LLM_STORY_STATE_PREFIX + String(bookId), cleaned);
        }
    } catch (e) {}
}

function llmLoadContextBridge(bookId) {
    if (!bookId || !llmReadBoolConfig("use_context_bridge", true)) return "";
    try {
        var raw = localStorage.getItem(LLM_CONTEXT_BRIDGE_PREFIX + String(bookId));
        return raw ? String(raw).trim() : "";
    } catch (e) {
        return "";
    }
}

function llmSaveContextBridge(bookId, translatedText, minChars) {
    if (!bookId || !translatedText || !llmReadBoolConfig("use_context_bridge", true)) return;
    try {
        var cleaned = String(translatedText).replace(/\r\n/g, "\n").trim();
        var minLen = typeof minChars === "number" && minChars > 0 ? minChars : 80;
        if (cleaned.length < minLen) return;
        var paragraphs = cleaned.split(/\n+/).filter(function (p) { return p.trim().length > 0; });
        var tail = "";
        for (var i = paragraphs.length - 1; i >= 0; i--) {
            var p = paragraphs[i].trim();
            if (!tail) {
                tail = p;
            } else if (tail.length + p.length + 1 <= LLM_CONTEXT_BRIDGE_MAX_CHARS) {
                tail = p + "\n" + tail;
            } else {
                break;
            }
        }
        if (tail.length > LLM_CONTEXT_BRIDGE_MAX_CHARS) {
            tail = tail.substring(tail.length - LLM_CONTEXT_BRIDGE_MAX_CHARS).trim();
        }
        if (tail) {
            localStorage.setItem(LLM_CONTEXT_BRIDGE_PREFIX + String(bookId), tail);
        }
    } catch (e) {}
}

// DeepSeek làm 1 lượt gọi JSON gọn nhẹ để CÙNG LÚC cập nhật trạng thái mạch truyện (story_state) và học tên riêng mới (memory)
// Luôn non-fatal: nếu DeepSeek lỗi hoặc chậm thì bỏ qua êm ái, không bao giờ làm hỏng bản dịch chương!
function llmPeekSyncCounter(bookId) {
    var key = LLM_DS_SYNC_COUNT_PREFIX + String(bookId);
    var count = 0;
    try {
        var raw = parseInt(String(localStorage.getItem(key) || ""), 10);
        if (!isNaN(raw) && raw >= 0) count = raw;
    } catch (e) {}
    return count + 1;
}

function llmCommitSyncCounter(bookId, nextCount) {
    try {
        localStorage.setItem(LLM_DS_SYNC_COUNT_PREFIX + String(bookId), String(nextCount));
    } catch (e) {}
}

function llmDeepSeekSyncContextAndMemory(bookId, original, translated, sourceName, targetName, memoryPrompt, syncTimeoutMs) {
    if (!bookId || !llmHasDeepSeek() || !llmReadBoolConfig("deepseek_context_engine", true)) {
        return { storyState: "", memory: [], mode: "off" };
    }

    var useBridge = llmReadBoolConfig("use_context_bridge", true);
    var intervalRaw = parseInt(llmReadConfig("deepseek_memory_interval", "3"), 10);
    var interval = isNaN(intervalRaw) || intervalRaw < 0 ? 3 : intervalRaw;
    var count = llmPeekSyncCounter(bookId);
    var includeMemory = interval > 0 && (count % interval === 1 || interval === 1);
    if (!useBridge && !includeMemory) {
        return { storyState: "", memory: [], mode: "off" };
    }

    var prevState = llmLoadStoryState(bookId);
    var instruction;
    var userText = "";
    var maxTokens;

    if (includeMemory) {
        instruction = "Bạn là bộ não điều phối ngữ cảnh cho hệ thống dịch truyện từ " + sourceName + " sang " + targetName + ". " +
            "Dựa trên TRẠNG THÁI CŨ (nếu có), NGUYÊN VĂN và BẢN DỊCH chương vừa xong, hãy trả về DUY NHẤT 1 đối tượng JSON hợp lệ (không Markdown) gồm 2 trường:\n" +
            "1) \"story_state\" (chuỗi tiếng Việt súc tích tối đa 140 từ): gồm 2 phần rõ ràng: [BỐI CẢNH] bối cảnh/phó bản và tình tiết kết chương; [XƯNG HÔ] chỉ ghi danh xưng và cặp khóa cứng (CHỈ dùng ta - ngươi hoặc ta - ngài, vd: Lâm Ngự -> Phùng lão sư: gọi Phùng lão sư, ta - ngài). CẤM ghi tôi/tớ/cậu/bạn/anh-em/chú-cháu/con-mẹ vào story_state.\n" +
            "2) \"memory\" (mảng tối đa 15 phần tử): chỉ gồm tên riêng, địa danh, tổ chức, đạo cụ hoặc thuật ngữ MỚI chưa có trong bộ nhớ; mỗi phần tử có {source, target, kind, note} với source là chuỗi chính xác trong nguyên văn, kind thuộc character|place|organization|term.";
        if (memoryPrompt) instruction += "\n\nBỘ NHỚ HIỆN CÓ:\n" + memoryPrompt;
        if (prevState) userText += "TRẠNG THÁI NGỮ CẢNH CŨ:\n" + prevState + "\n\n";
        userText += "NGUYÊN VĂN:\n" + String(original || "").substring(0, 10000) +
            "\n\nBẢN DỊCH:\n" + String(translated || "").substring(0, 10000);
        maxTokens = 1536;
    } else {
        // Chế độ tiết kiệm ~50% input token: CHỈ gửi bản dịch tiếng Việt để cập nhật mạch truyện & xưng hô
        instruction = "Bạn là bộ não điều phối ngữ cảnh truyện. Dựa trên TRẠNG THÁI CŨ (nếu có) và BẢN DỊCH chương vừa xong, hãy trả về DUY NHẤT 1 đối tượng JSON hợp lệ (không Markdown) có dạng {\"story_state\": \"<tóm tắt mạch truyện tiếng Việt>\"} (tối đa 140 từ tiếng Việt): gồm 2 phần [BỐI CẢNH] bối cảnh/phó bản & tình tiết kết chương và [XƯNG HÔ] chỉ ghi danh xưng và cặp khóa cứng ta - ngươi hoặc ta - ngài (CẤM ghi tôi/tớ/cậu/bạn/anh-em/chú-cháu/con-mẹ; nếu bản dịch vừa rồi lọt thì tự chuẩn hóa lại về ta - ngươi). Nếu chương quá ngắn hoặc là lời tác giả không có tình tiết mới, hãy giữ nguyên TRẠNG THÁI NGỮ CẢNH CŨ.";
        if (prevState) userText += "TRẠNG THÁI NGỮ CẢNH CŨ:\n" + prevState + "\n\n";
        userText += "BẢN DỊCH CHƯƠNG VỪA XONG:\n" + String(translated || "").substring(0, 10000);
        maxTokens = 512;
    }

    try {
        var res = llmDeepSeekRequest(instruction, userText, { temperature: 0.1, maxTokens: maxTokens, json: true }, syncTimeoutMs || 25000);
        if (res.error || !res.text) return { storyState: "", memory: [], mode: includeMemory ? "full" : "lite" };
        var parsed = llmExtractJsonObject(res.text);
        if (!parsed) return { storyState: "", memory: [], mode: includeMemory ? "full" : "lite" };
        llmCommitSyncCounter(bookId, count);
        var nextState = parsed && typeof parsed.story_state === "string" ? parsed.story_state.trim() : "";
        if (nextState) llmSaveStoryState(bookId, nextState);
        var mem = includeMemory && parsed && Array.isArray(parsed.memory) ? parsed.memory : [];
        return { storyState: nextState, memory: mem, mode: includeMemory ? "full" : "lite" };
    } catch (e) {
        return { storyState: "", memory: [], mode: includeMemory ? "full" : "lite" };
    }
}

// === Quản lý trạng thái Key & Quota theo cặp (Key, Model) cho Google Gemini Free Tier ===
function llmKeyFingerprint(apiKey) {
    var str = String(apiKey || "");
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    var tail = str.length >= 4 ? str.substring(str.length - 4) : str;
    return "k" + hash.toString(36) + "_" + tail;
}

function llmNextPacificMidnightMs(now) {
    var ptOffsetMs = -8 * 3600000;
    var ptNow = now + ptOffsetMs;
    var dayMs = 86400000;
    var nextPtMidnight = (Math.floor(ptNow / dayMs) + 1) * dayMs;
    var targetUtc = nextPtMidnight - ptOffsetMs + 60000;
    var diff = targetUtc - now;
    if (diff < 300000) return now + 300000;
    if (diff > dayMs + 60000) return now + dayMs;
    return targetUtc;
}

function llmLoadState(now) {
    var state = { cursor: 0, stickyByBook: {}, authDead: {}, modelDead: {}, modelOverload: {}, buckets: {} };
    try {
        var raw = localStorage.getItem(LLM_STATE_KEY);
        if (!raw) return state;
        var parsed = JSON.parse(String(raw));
        if (!parsed || typeof parsed !== "object") return state;
        if (typeof parsed.cursor === "number" && parsed.cursor >= 0) state.cursor = parsed.cursor;
        if (parsed.stickyByBook && typeof parsed.stickyByBook === "object") state.stickyByBook = parsed.stickyByBook;
        if (parsed.authDead && typeof parsed.authDead === "object") {
            for (var fp in parsed.authDead) {
                if (parsed.authDead.hasOwnProperty(fp) && Number(parsed.authDead[fp]) > now) {
                    state.authDead[fp] = Number(parsed.authDead[fp]);
                }
            }
        }
        if (parsed.modelDead && typeof parsed.modelDead === "object") {
            for (var dm in parsed.modelDead) {
                if (parsed.modelDead.hasOwnProperty(dm) && Number(parsed.modelDead[dm]) > now) {
                    state.modelDead[dm] = Number(parsed.modelDead[dm]);
                }
            }
        }
        if (parsed.modelOverload && typeof parsed.modelOverload === "object") {
            for (var om in parsed.modelOverload) {
                if (!parsed.modelOverload.hasOwnProperty(om)) continue;
                var ov = parsed.modelOverload[om];
                if (ov && typeof ov === "object" && (Number(ov.until || 0) > now || Number(ov.streak || 0) > 0)) {
                    state.modelOverload[om] = {
                        streak: Number(ov.streak || 0),
                        until: Number(ov.until || 0) > now ? Number(ov.until) : 0
                    };
                }
            }
        }
        if (parsed.buckets && typeof parsed.buckets === "object") {
            for (var bKey in parsed.buckets) {
                if (!parsed.buckets.hasOwnProperty(bKey)) continue;
                var b = parsed.buckets[bKey];
                if (!b || typeof b !== "object") continue;
                var recent = [];
                if (Array.isArray(b.ts)) {
                    for (var i = 0; i < b.ts.length; i++) {
                        if (now - Number(b.ts[i]) < 60000) recent.push(Number(b.ts[i]));
                    }
                }
                var coolUntil = b.coolUntil && Number(b.coolUntil) > now ? Number(b.coolUntil) : 0;
                if (recent.length > 0 || coolUntil > 0) {
                    state.buckets[bKey] = {
                        ts: recent,
                        lastAt: recent.length > 0 ? recent[recent.length - 1] : (Number(b.lastAt) || 0),
                        coolUntil: coolUntil,
                        coolReason: coolUntil > 0 ? String(b.coolReason || "") : ""
                    };
                }
            }
        }
    } catch (e) {}
    return state;
}

function llmSaveState(state) {
    try {
        var now = new Date().getTime();
        var compact = { cursor: state.cursor || 0, stickyByBook: {}, authDead: {}, modelDead: {}, modelOverload: {}, buckets: {} };
        var bookKeys = [];
        for (var bk in state.stickyByBook) {
            if (state.stickyByBook.hasOwnProperty(bk)) bookKeys.push(bk);
        }
        var startBk = Math.max(0, bookKeys.length - 50);
        for (var i = startBk; i < bookKeys.length; i++) {
            compact.stickyByBook[bookKeys[i]] = state.stickyByBook[bookKeys[i]];
        }
        for (var fp in state.authDead) {
            if (state.authDead.hasOwnProperty(fp) && Number(state.authDead[fp]) > now) {
                compact.authDead[fp] = Number(state.authDead[fp]);
            }
        }
        if (state.modelDead) {
            for (var dm in state.modelDead) {
                if (state.modelDead.hasOwnProperty(dm) && Number(state.modelDead[dm]) > now) {
                    compact.modelDead[dm] = Number(state.modelDead[dm]);
                }
            }
        }
        if (state.modelOverload) {
            for (var om in state.modelOverload) {
                if (!state.modelOverload.hasOwnProperty(om)) continue;
                var ov = state.modelOverload[om];
                if (ov && (Number(ov.until || 0) > now || Number(ov.streak || 0) > 0)) {
                    compact.modelOverload[om] = {
                        streak: Number(ov.streak || 0),
                        until: Number(ov.until || 0) > now ? Number(ov.until) : 0
                    };
                }
            }
        }
        for (var bKey in state.buckets) {
            if (!state.buckets.hasOwnProperty(bKey)) continue;
            var b = state.buckets[bKey];
            if (!b) continue;
            var recent = [];
            if (Array.isArray(b.ts)) {
                for (var t = Math.max(0, b.ts.length - 20); t < b.ts.length; t++) {
                    if (now - Number(b.ts[t]) < 60000) recent.push(Number(b.ts[t]));
                }
            }
            var coolUntil = b.coolUntil && Number(b.coolUntil) > now ? Number(b.coolUntil) : 0;
            if (recent.length > 0 || coolUntil > 0) {
                compact.buckets[bKey] = {
                    ts: recent,
                    lastAt: recent.length > 0 ? recent[recent.length - 1] : (Number(b.lastAt) || 0),
                    coolUntil: coolUntil,
                    coolReason: coolUntil > 0 ? String(b.coolReason || "") : ""
                };
            }
        }
        localStorage.setItem(LLM_STATE_KEY, JSON.stringify(compact));
    } catch (e) {}
}

function llmResetKeyState(clearLogs) {
    try {
        var keepCursor = 0;
        try {
            var raw = localStorage.getItem(LLM_STATE_KEY);
            if (raw) {
                var parsed = JSON.parse(String(raw));
                if (parsed && typeof parsed.cursor === "number" && parsed.cursor >= 0) {
                    keepCursor = parsed.cursor;
                }
            }
        } catch (eRead) {}
        if (clearLogs) {
            localStorage.removeItem(LLM_STATE_KEY);
            localStorage.removeItem(LLM_ERROR_LOG_KEY);
        } else {
            localStorage.setItem(LLM_STATE_KEY, JSON.stringify({
                cursor: keepCursor,
                stickyByBook: {},
                authDead: {},
                modelDead: {},
                modelOverload: {},
                buckets: {}
            }));
        }
    } catch (e) {}
}

function llmRecordError(stage, detail) {
    try {
        var list = llmLoadRecentErrors();
        var msg = String(detail || "").replace(/[\r\n\t]+/g, " ").trim();
        if (msg.length > 180) msg = msg.substring(0, 180) + "...";
        list.push({
            at: new Date().getTime(),
            stage: String(stage || "ERROR"),
            detail: msg
        });
        if (list.length > LLM_MAX_ERROR_LOG) {
            list = list.slice(list.length - LLM_MAX_ERROR_LOG);
        }
        localStorage.setItem(LLM_ERROR_LOG_KEY, JSON.stringify(list));
    } catch (e) {}
}

function llmLoadRecentErrors() {
    try {
        var raw = localStorage.getItem(LLM_ERROR_LOG_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function llmBucketKey(fp, apiModel) {
    return fp + "::" + String(apiModel || LLM_DEFAULT_MODEL);
}

function llmModelLimits(apiModel) {
    var info = LLM_MODEL_INFO[apiModel];
    if (info) return { safeRpm: info.safeRpm, minIntervalMs: info.minIntervalMs };
    return { safeRpm: 5, minIntervalMs: 12000 };
}

function llmBuildKeyPlan(apiKeys, apiModel, bookId, state, now) {
    var total = apiKeys.length;
    var stickyMode = !llmReadBoolConfig("sequential_key_order", true);
    var limits = llmModelLimits(apiModel);
    var bookSlot = bookId || "_global";

    var ready = [];
    var paced = [];
    var cooling = [];

    for (var idx = 0; idx < total; idx++) {
        var fp = llmKeyFingerprint(apiKeys[idx]);
        var bKey = llmBucketKey(fp, apiModel);
        var bucket = state.buckets[bKey] || { ts: [], lastAt: 0, coolUntil: 0, coolReason: "" };

        var deadUntil = state.authDead[fp] || 0;
        var coolUntil = Math.max(deadUntil, bucket.coolUntil || 0);
        if (coolUntil > now) {
            cooling.push({
                index: idx,
                fp: fp,
                bKey: bKey,
                until: coolUntil,
                reason: deadUntil >= (bucket.coolUntil || 0) ? "auth" : (bucket.coolReason || "cooldown")
            });
            continue;
        }

        var rpmCount = bucket.ts.length;
        var sinceLast = bucket.lastAt ? (now - bucket.lastAt) : 999999999;
        var item = {
            index: idx,
            fp: fp,
            bKey: bKey,
            rpmCount: rpmCount,
            lastAt: bucket.lastAt || 0,
            sinceLast: sinceLast,
            jitter: Math.random()
        };

        if (rpmCount < limits.safeRpm && sinceLast >= limits.minIntervalMs) {
            ready.push(item);
        } else {
            paced.push(item);
        }
    }

    var queue = [];
    if (stickyMode) {
        var preferredFp = state.stickyByBook[bookSlot] || "";
        var stickyReadyIndex = -1;
        for (var r = 0; r < ready.length; r++) {
            if (ready[r].fp === preferredFp) {
                stickyReadyIndex = r;
                break;
            }
        }
        if (stickyReadyIndex >= 0) {
            queue.push(ready[stickyReadyIndex]);
            ready.splice(stickyReadyIndex, 1);
        }
        ready.sort(function (a, b) {
            if (a.rpmCount !== b.rpmCount) return a.rpmCount - b.rpmCount;
            if (Math.abs(a.lastAt - b.lastAt) > 2000) return a.lastAt - b.lastAt;
            return a.jitter - b.jitter;
        });
        for (var r2 = 0; r2 < ready.length; r2++) queue.push(ready[r2]);

        paced.sort(function (a, b) {
            if (a.rpmCount !== b.rpmCount) return a.rpmCount - b.rpmCount;
            if (Math.abs(a.lastAt - b.lastAt) > 2000) return a.lastAt - b.lastAt;
            return a.jitter - b.jitter;
        });
        for (var p = 0; p < paced.length; p++) queue.push(paced[p]);
    } else {
        var startIndex = state.cursor % total;
        var readyMap = {};
        var pacedMap = {};
        for (var a1 = 0; a1 < ready.length; a1++) readyMap[ready[a1].index] = ready[a1];
        for (var a2 = 0; a2 < paced.length; a2++) pacedMap[paced[a2].index] = paced[a2];
        for (var offset1 = 0; offset1 < total; offset1++) {
            var rrIdx1 = (startIndex + offset1) % total;
            if (readyMap[rrIdx1]) queue.push(readyMap[rrIdx1]);
        }
        for (var offset2 = 0; offset2 < total; offset2++) {
            var rrIdx2 = (startIndex + offset2) % total;
            if (pacedMap[rrIdx2]) queue.push(pacedMap[rrIdx2]);
        }
    }

    if (queue.length > 0) {
        return { queue: queue, allCooling: false, allRpdOrAuth: false, soonestWaitSec: 0 };
    }

    cooling.sort(function (a, b) { return a.until - b.until; });
    var allLongLocked = true;
    for (var c = 0; c < cooling.length; c++) {
        if (cooling[c].reason !== "rpd" && cooling[c].reason !== "auth" && cooling[c].reason !== "limit_zero") {
            allLongLocked = false;
            break;
        }
    }
    var soonest = cooling[0];
    var waitSec = Math.max(1, Math.ceil((soonest.until - now) / 1000));
    return {
        queue: [soonest],
        allCooling: true,
        allRpdOrAuth: allLongLocked,
        soonestWaitSec: waitSec
    };
}

function llmParseRetryDelayMs(response, rawText, defaultMs) {
    try {
        if (response && response.headers) {
            var retryAfter = (typeof response.headers.get === "function") ? (response.headers.get("retry-after") || response.headers.get("Retry-After")) : (response.headers["retry-after"] || response.headers["Retry-After"]);
            if (retryAfter) {
                var secHeader = parseFloat(String(retryAfter));
                if (!isNaN(secHeader) && secHeader > 0) {
                    return Math.min(Math.max(Math.round(secHeader * 1000), 5000), 180000);
                }
            }
        }
    } catch (e) {}

    var match = String(rawText || "").match(/retry(?:\s+in|\s+after)?\s+([0-9]+(?:\.[0-9]+)?)\s*s/i);
    if (match) {
        var secBody = parseFloat(match[1]);
        if (!isNaN(secBody) && secBody > 0) {
            return Math.min(Math.max(Math.round(secBody * 1000), 5000), 180000);
        }
    }
    return defaultMs;
}

function llmClassifyError(status, rawText, parsedData, now) {
    var message = "";
    var errStatus = "";
    var detailDump = "";

    if (parsedData && parsedData.error) {
        if (parsedData.error.message) message = String(parsedData.error.message);
        if (parsedData.error.status) errStatus = String(parsedData.error.status);
        if (Array.isArray(parsedData.error.details)) {
            try { detailDump = JSON.stringify(parsedData.error.details); } catch (e) {}
        }
    }

    var combined = (message + " " + errStatus + " " + detailDump + " " + String(rawText || "")).toLowerCase();

    var isKeyAuthError =
        status === 401 ||
        status === 403 ||
        combined.indexOf("api_key_invalid") >= 0 ||
        combined.indexOf("api key not valid") >= 0 ||
        combined.indexOf("api_key_expired") >= 0 ||
        combined.indexOf("api_key_service_blocked") >= 0 ||
        combined.indexOf("permission_denied") >= 0 ||
        combined.indexOf("consumer_suspended") >= 0 ||
        combined.indexOf("reported as leaked") >= 0;

    if (isKeyAuthError) {
        return {
            rotate: true,
            kind: "auth",
            cooldownUntil: now + LLM_COOLDOWN_AUTH_MS,
            message: message || "API key không hợp lệ hoặc bị từ chối quyền truy cập"
        };
    }

    if (status === 429 || combined.indexOf("resource_exhausted") >= 0 || combined.indexOf("quota") >= 0) {
        var isLimitZero =
            combined.indexOf("limit: 0") >= 0 ||
            combined.indexOf("\"quotavalue\":\"0\"") >= 0 ||
            combined.indexOf("limit:0") >= 0;
        if (isLimitZero) {
            return {
                rotate: true,
                kind: "limit_zero",
                cooldownUntil: llmNextPacificMidnightMs(now),
                message: message || "Model này không khả dụng trên Free Tier (limit: 0)"
            };
        }

        var isDailyQuota =
            combined.indexOf("generaterequestsperday") >= 0 ||
            combined.indexOf("per day") >= 0 ||
            combined.indexOf("perday") >= 0 ||
            combined.indexOf("rpd") >= 0 ||
            combined.indexOf("daily") >= 0;

        if (isDailyQuota) {
            return {
                rotate: true,
                kind: "rpd",
                cooldownUntil: llmNextPacificMidnightMs(now),
                message: message || "Project đã hết hạn mức ngày (RPD) cho model này (reset 00:00 giờ PT / ~15:00 VN)"
            };
        }

        return {
            rotate: true,
            kind: "rpm",
            cooldownUntil: 0,
            message: message || "Chạm giới hạn tốc độ phút (RPM/TPM)"
        };
    }

    if (status === 404) {
        return {
            rotate: false,
            cascadeModel: true,
            kind: "not_found",
            cooldownUntil: 0,
            message: (message || "Không tìm thấy model") + " (hãy kiểm tra Model hoặc bật tự chuyển model Free Tier)"
        };
    }

    if (status === 400) {
        return {
            rotate: false,
            kind: "bad_request",
            cooldownUntil: 0,
            message: message || "Yêu cầu không hợp lệ (HTTP 400)"
        };
    }

    if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
        return {
            rotate: true,
            kind: "server",
            cooldownUntil: now + LLM_COOLDOWN_SERVER_MS,
            message: message || "Máy chủ Google đang quá tải tạm thời"
        };
    }

    return {
        rotate: false,
        kind: "other",
        cooldownUntil: 0,
        message: message || ("HTTP " + status)
    };
}

function llmExtractGeminiOutput(data) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
        var blockReason = String(data.promptFeedback.blockReason);
        return {
            text: "",
            finishReason: blockReason,
            error: "Gemini chặn nội dung đầu vào (" + blockReason + ")"
        };
    }

    var candidates = data && Array.isArray(data.candidates) ? data.candidates : [];
    if (candidates.length === 0) {
        return {
            text: "",
            finishReason: "",
            error: "Gemini không trả về kết quả nào (candidates rỗng)"
        };
    }

    var candidate = candidates[0] || {};
    var rawFinish = candidate.finishReason ? String(candidate.finishReason) : "";
    var normalizedFinish = rawFinish === "MAX_TOKENS" ? "max_tokens" : rawFinish;

    var parts = candidate.content && Array.isArray(candidate.content.parts)
        ? candidate.content.parts
        : [];
    var textChunks = [];
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part || part.thought === true) continue;
        if (typeof part.text === "string" && part.text.length > 0) {
            textChunks.push(part.text);
        }
    }

    var text = llmStripThinkTags(textChunks.join(""));
    if (!text) {
        if (rawFinish && rawFinish !== "STOP" && rawFinish !== "MAX_TOKENS") {
            return {
                text: "",
                finishReason: normalizedFinish,
                error: "Gemini từ chối trả về bản dịch (" + rawFinish + ")"
            };
        }
        return {
            text: "",
            finishReason: normalizedFinish,
            error: "Gemini trả về nội dung rỗng"
        };
    }

    return { text: text, finishReason: normalizedFinish, error: "" };
}

function llmGetCandidateModels(requestSpec) {
    var primary = requestSpec && requestSpec._model ? requestSpec._model : LLM_DEFAULT_MODEL;
    var models = [primary];
    if (!llmReadBoolConfig("free_tier_model_cascade", true)) return models;
    if (requestSpec && requestSpec._isCustom) return models;

    var info = LLM_MODEL_INFO[primary];
    if (info && Array.isArray(info.cascade)) {
        for (var i = 0; i < info.cascade.length; i++) {
            if (models.indexOf(info.cascade[i]) === -1) models.push(info.cascade[i]);
        }
    }
    return models;
}

function llmRequest(apiKeys, requestSpec, timeout) {
    if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
        return { text: "", finishReason: "", error: "Không có Gemini API key khả dụng", keyIndex: -1, modelUsed: "" };
    }

    var now = new Date().getTime();
    var deadline = now + LLM_MAX_WALL_MS;
    var state = llmLoadState(now);
    var bookId = requestSpec && requestSpec._bookId ? requestSpec._bookId : "";
    var bookSlot = bookId || "_global";
    var candidateModels = llmGetCandidateModels(requestSpec);

    var stickyMode = !llmReadBoolConfig("sequential_key_order", true);
    var maxQuotaRotationsPerModel = apiKeys.length;
    var lastError = "";
    var totalNetworkErrors = 0;
    var totalServerErrors = 0;
    var totalAttempts = 0;
    var soonestWaitSec = 0;

    for (var mIdx = 0; mIdx < candidateModels.length; mIdx++) {
        var loopNow = new Date().getTime();
        if (totalAttempts >= LLM_MAX_TOTAL_ATTEMPTS || loopNow >= deadline) break;
        var apiModel = candidateModels[mIdx];
        if (state.modelDead && state.modelDead[apiModel] && Number(state.modelDead[apiModel]) > loopNow) {
            continue;
        }
        // Circuit Breaker: tạm tránh model nặng đang quá tải 503/504/timeout trong 10 phút khi còn model dự phòng
        var ovInfo = state.modelOverload && state.modelOverload[apiModel] ? state.modelOverload[apiModel] : null;
        if (ovInfo && Number(ovInfo.until || 0) > loopNow && mIdx < candidateModels.length - 1) {
            continue;
        }
        var plan = llmBuildKeyPlan(apiKeys, apiModel, bookId, state, loopNow);

        // Nếu toàn bộ key của model hiện tại đang cooling và còn model dự phòng (hoặc tất cả key đều 401/403/RPD) -> bỏ qua ngay, không bắn lặp vào key chết
        if (plan.allCooling && (mIdx < candidateModels.length - 1 || plan.allRpdOrAuth)) {
            if (!soonestWaitSec || plan.soonestWaitSec < soonestWaitSec) soonestWaitSec = plan.soonestWaitSec;
            continue;
        }

        var payloadObj;
        if (mIdx === 0 && requestSpec && requestSpec.payload) {
            payloadObj = requestSpec.payload;
        } else if (requestSpec && requestSpec._userText !== undefined) {
            payloadObj = llmCreatePayloadForModel(
                apiModel,
                LLM_MODEL_INFO[apiModel],
                false,
                requestSpec._systemPrompt,
                requestSpec._userText,
                requestSpec._options
            );
        } else {
            payloadObj = requestSpec;
        }

        var endpoint = llmBuildEndpoint(apiModel);
        var payload = JSON.stringify(payloadObj);
        var queue = plan.queue;
        var modelAttempts = 0;
        var modelServerErrors = 0;
        var modelNetworkErrors = 0;
        var quotaRotations = 0;

        for (var i = 0; i < queue.length; i++) {
            var remainingMs = deadline - new Date().getTime();
            if (modelAttempts >= LLM_MAX_ATTEMPTS_PER_MODEL || totalAttempts >= LLM_MAX_TOTAL_ATTEMPTS || remainingMs < 8000) break;
            modelAttempts++;
            totalAttempts++;
            var item = queue[i];
            var keyIndex = item.index;
            var apiKey = apiKeys[keyIndex];
            var reqTime = new Date().getTime();

            // Đánh dấu key đang chạy TRƯỚC khi gọi fetch để chống các luồng song song bốc trùng 1 project
            var bucket = state.buckets[item.bKey] || { ts: [], lastAt: 0, coolUntil: 0, coolReason: "" };
            bucket.ts.push(reqTime);
            bucket.lastAt = reqTime;
            state.buckets[item.bKey] = bucket;
            if (!stickyMode) state.cursor = (keyIndex + 1) % apiKeys.length;
            llmSaveState(state);

            var hasFallbackModel = mIdx < candidateModels.length - 1;
            var perAttemptCap = hasFallbackModel ? Math.min(timeout || 40000, 38000) : (timeout || 50000);
            var response;
            try {
                response = fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": apiKey
                    },
                    body: payload,
                    timeout: Math.min(perAttemptCap, remainingMs)
                });
            } catch (e) {
                var catchTime = new Date().getTime();
                if (bucket.ts.length > 0 && bucket.ts[bucket.ts.length - 1] === reqTime) {
                    bucket.ts.pop();
                    bucket.lastAt = bucket.ts.length > 0 ? bucket.ts[bucket.ts.length - 1] : 0;
                }
                if (state.stickyByBook[bookSlot] === item.fp) delete state.stickyByBook[bookSlot];
                modelNetworkErrors++;
                totalNetworkErrors++;
                lastError = "Gemini [" + apiModel + "] lỗi kết nối/timeout (key #" + (keyIndex + 1) + "): " + String(e);
                if (hasFallbackModel && (catchTime - reqTime) >= 18000 && (deadline - catchTime) >= 15000) {
                    bucket.coolUntil = catchTime + 60000;
                    bucket.coolReason = "timeout";
                    llmSaveState(state);
                    break;
                }
                if (modelNetworkErrors >= LLM_MAX_NETWORK_RETRIES || totalNetworkErrors >= LLM_MAX_TOTAL_NETWORK_RETRIES) {
                    llmSaveState(state);
                    if (hasFallbackModel && totalNetworkErrors < LLM_MAX_TOTAL_NETWORK_RETRIES && (deadline - catchTime) >= 15000) break;
                    return { text: "", finishReason: "", error: lastError, keyIndex: -1, modelUsed: apiModel };
                }
                continue;
            }

            var respTime = new Date().getTime();
            var rawText = "";
            try { rawText = String(response.text() || ""); } catch (eRead) {}

            var data = null;
            try { data = rawText ? JSON.parse(rawText) : null; } catch (eParse) {}

            if (!response.ok) {
                var errInfo = llmClassifyError(response.status, rawText, data, respTime);
                var gemRespSec = Math.round((respTime - reqTime) / 1000);
                lastError = "Gemini [" + apiModel + "] HTTP " + response.status + " (" + gemRespSec + "s, key #" + (keyIndex + 1) + "): " + errInfo.message;

                if (errInfo.kind === "auth" || errInfo.kind === "server" || errInfo.kind === "not_found") {
                    if (bucket.ts.length > 0 && bucket.ts[bucket.ts.length - 1] === reqTime) {
                        bucket.ts.pop();
                        bucket.lastAt = bucket.ts.length > 0 ? bucket.ts[bucket.ts.length - 1] : 0;
                    }
                }

                if (errInfo.kind === "auth") {
                    state.authDead[item.fp] = errInfo.cooldownUntil;
                    if (state.stickyByBook[bookSlot] === item.fp) delete state.stickyByBook[bookSlot];
                    // Không đốt lượt thử vào key chết 401/403 để nhảy thẳng sang key sống tiếp theo
                    if (modelAttempts > 0) modelAttempts--;
                    if (totalAttempts > 0) totalAttempts--;
                    llmSaveState(state);
                } else if (errInfo.kind === "rpm") {
                    bucket.coolUntil = respTime + llmParseRetryDelayMs(response, rawText, LLM_COOLDOWN_RPM_MS);
                    bucket.coolReason = "rpm";
                    if ((respTime - reqTime) < 8000 && quotaRotations < maxQuotaRotationsPerModel) {
                        quotaRotations++;
                        if (modelAttempts > 0) modelAttempts--;
                        if (totalAttempts > 0) totalAttempts--;
                    }
                    if (quotaRotations % 5 === 1) llmSaveState(state);
                } else if (errInfo.kind === "rpd" || errInfo.kind === "limit_zero") {
                    bucket.coolUntil = errInfo.cooldownUntil;
                    bucket.coolReason = errInfo.kind;
                    if ((respTime - reqTime) < 8000 && quotaRotations < maxQuotaRotationsPerModel) {
                        quotaRotations++;
                        if (modelAttempts > 0) modelAttempts--;
                        if (totalAttempts > 0) totalAttempts--;
                    }
                    if (quotaRotations % 5 === 1) llmSaveState(state);
                } else if (errInfo.cooldownUntil > 0) {
                    bucket.coolUntil = errInfo.cooldownUntil;
                    bucket.coolReason = errInfo.kind;
                }

                if (errInfo.kind === "not_found") {
                    if (!state.modelDead) state.modelDead = {};
                    state.modelDead[apiModel] = respTime + LLM_COOLDOWN_MODEL_DEAD_MS;
                    llmSaveState(state);
                }

                if (errInfo.kind === "server") {
                    modelServerErrors++;
                    totalServerErrors++;
                    var leftMs = deadline - respTime;
                    if (state.stickyByBook[bookSlot] === item.fp) {
                        delete state.stickyByBook[bookSlot];
                    }
                    // HTTP 504/408: nếu đang ở model chậm (4-hydrogen/3.8-flash/3.6-flash) -> nhảy thẳng sang flash-lite để kịp ngân sách; tránh 2 lần 504 liên tiếp
                    if (response.status === 504 || response.status === 408) {
                        bucket.coolUntil = respTime + 60000;
                        bucket.coolReason = "timeout";
                        if (apiModel.indexOf("flash-lite") < 0) {
                            if (!state.modelOverload) state.modelOverload = {};
                            var curOv = state.modelOverload[apiModel] || { streak: 0, until: 0 };
                            curOv.streak = Number(curOv.streak || 0) + 1;
                            if (curOv.streak >= 2 || (respTime - reqTime) >= 25000) {
                                curOv.until = respTime + LLM_COOLDOWN_MODEL_OVERLOAD_MS;
                            }
                            state.modelOverload[apiModel] = curOv;
                        }
                        llmSaveState(state);
                        if (hasFallbackModel && leftMs >= 12000 && totalServerErrors < LLM_MAX_TOTAL_SERVER_RETRIES) {
                            if (apiModel.indexOf("flash-lite") < 0) {
                                for (var fIdx = mIdx + 1; fIdx < candidateModels.length; fIdx++) {
                                    if (candidateModels[fIdx].indexOf("flash-lite") >= 0) {
                                        mIdx = fIdx - 1;
                                        break;
                                    }
                                }
                            }
                            break;
                        }
                        if (!hasFallbackModel && modelServerErrors < LLM_MAX_SERVER_RETRIES && leftMs >= 12000) {
                            continue;
                        }
                        return { text: "", finishReason: "", error: lastError, keyIndex: keyIndex, modelUsed: apiModel };
                    }
                    if (modelServerErrors >= LLM_MAX_SERVER_RETRIES) {
                        llmSaveState(state);
                        if (mIdx < candidateModels.length - 1 && totalServerErrors < LLM_MAX_TOTAL_SERVER_RETRIES) {
                            break; // Trượt sang model dự phòng khi model hiện tại quá tải 500/502/503
                        }
                        return { text: "", finishReason: "", error: lastError, keyIndex: keyIndex, modelUsed: apiModel };
                    }
                }

                if (errInfo.cascadeModel && mIdx < candidateModels.length - 1) {
                    break;
                }
                if (errInfo.rotate) continue;

                llmSaveState(state);
                return { text: "", finishReason: "", error: lastError, keyIndex: keyIndex, modelUsed: apiModel };
            }

            if (!data) {
                lastError = "Gemini [" + apiModel + "] trả về JSON không hợp lệ (key #" + (keyIndex + 1) + ")";
                modelServerErrors++;
                totalServerErrors++;
                if (modelServerErrors < LLM_MAX_SERVER_RETRIES) continue;
                llmSaveState(state);
                if (mIdx < candidateModels.length - 1 && totalServerErrors < LLM_MAX_TOTAL_SERVER_RETRIES) {
                    break;
                }
                return { text: "", finishReason: "", error: lastError, keyIndex: keyIndex, modelUsed: apiModel };
            }

            bucket.coolUntil = 0;
            bucket.coolReason = "";
            delete state.authDead[item.fp];
            if (state.modelOverload && state.modelOverload[apiModel]) {
                delete state.modelOverload[apiModel];
            }
            state.stickyByBook[bookSlot] = item.fp;
            llmSaveState(state);

            var parsed = llmExtractGeminiOutput(data);
            return {
                text: parsed.text,
                finishReason: parsed.finishReason,
                error: parsed.error,
                keyIndex: keyIndex,
                modelUsed: apiModel
            };
        }
    }

    llmSaveState(state);
    return {
        text: "",
        finishReason: "",
        error: lastError || (soonestWaitSec
            ? "Toàn bộ API key & model Gemini Free Tier đang chạm hạn mức (sớm nhất mở lại sau ~" + soonestWaitSec + "s)."
            : "Không có Gemini API key khả dụng"),
        keyIndex: -1,
        modelUsed: ""
    };
}
