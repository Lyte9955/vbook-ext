load('prompts.js');
load('llm.js');

function execute() {
    try {
        var gemKeys = llmReadGeminiKeys();
        var dsKeys = llmReadDeepSeekKeys();
        var dsEnabled = llmReadBoolConfig("enable_deepseek", true);
        var qtPolishOn = llmReadBoolConfig("qt_polish_mode", false);
        var now = new Date().getTime();
        var state = llmLoadState(now);

        var activeFps = {};
        var deadAuth = 0;
        var deadAuthMap = {};
        var deadKeyNums = [];
        for (var kIdx = 0; kIdx < gemKeys.length; kIdx++) {
            var kFp = llmKeyFingerprint(gemKeys[kIdx]);
            activeFps[kFp] = true;
            if (state.authDead[kFp] && Number(state.authDead[kFp]) > now) {
                deadAuth++;
                deadAuthMap[kFp] = true;
                deadKeyNums.push("#" + (kIdx + 1));
            }
        }

        var coolingByModel = {};
        for (var bKey in state.buckets) {
            if (!state.buckets.hasOwnProperty(bKey)) continue;
            var parts = bKey.split("::");
            var fpPart = parts[0];
            if (!activeFps[fpPart] || deadAuthMap[fpPart]) continue;
            var b = state.buckets[bKey];
            if (b && b.coolUntil && Number(b.coolUntil) > now) {
                var mName = parts.length > 1 ? parts[1] : "unknown";
                if (!coolingByModel[mName]) coolingByModel[mName] = { rpd: 0, rpm: 0, server: 0, other: 0 };
                if (b.coolReason === "rpd" || b.coolReason === "limit_zero") coolingByModel[mName].rpd++;
                else if (b.coolReason === "rpm") coolingByModel[mName].rpm++;
                else if (b.coolReason === "timeout" || b.coolReason === "server") coolingByModel[mName].server++;
                else coolingByModel[mName].other++;
            }
        }

        var lines = [];
        lines.push("Phiên bản extension: v39");
        var aliveKeys = Math.max(0, gemKeys.length - deadAuth);
        var nextCursorPos = gemKeys.length > 0 ? ((state.cursor % gemKeys.length) + 1) : 0;
        lines.push("Gemini API keys: " + gemKeys.length + " key (sống: " + aliveKeys + ", lỗi 401/403: " + deadAuth + ")");
        if (gemKeys.length > 0) {
            lines.push("Con trỏ gọi tuần tự kế tiếp: #" + nextCursorPos + "/" + gemKeys.length);
        }
        if (deadKeyNums.length > 0) {
            lines.push("Vị trí key lỗi 401/403: " + deadKeyNums.join(", "));
        }
        var deadDs = 0;
        if (state.dsAuthDead) {
            for (var dIdx = 0; dIdx < dsKeys.length; dIdx++) {
                var dFp = llmKeyFingerprint(dsKeys[dIdx]);
                if (state.dsAuthDead[dFp] && Number(state.dsAuthDead[dFp]) > now) {
                    deadDs++;
                }
            }
        }
        var dsStatusText = dsEnabled ? "ĐANG BẬT" : "ĐANG TẮT";
        var dsCtxEngineOn = llmReadBoolConfig("deepseek_context_engine", false);
        var dsModeNote = dsEnabled ? (dsCtxEngineOn ? " | Ngữ cảnh: DeepSeek" : " | Chỉ cứu hộ (Ngữ cảnh: Gemini)") : "";
        var dsDeadNote = deadDs > 0 ? (" | Tạm ngắt 401/402/403: " + deadDs + "/" + dsKeys.length) : "";
        lines.push("DeepSeek / Gitapihub: " + dsStatusText + " (" + dsKeys.length + " key" + dsModeNote + dsDeadNote + ")");
        lines.push("Chế độ QT-Polish (dịch thô QT -> AI làm mượt): " + (qtPolishOn ? "ĐANG BẬT" : "ĐANG TẮT"));

        var hasCooling = false;
        for (var m in coolingByModel) {
            if (!coolingByModel.hasOwnProperty(m)) continue;
            hasCooling = true;
            var c = coolingByModel[m];
            var busy = c.rpd + c.rpm + c.server + c.other;
            var readyCnt = Math.max(0, aliveKeys - busy);
            lines.push("- " + m + ": SẴN SÀNG " + readyCnt + "/" + gemKeys.length +
                " | RPD: " + c.rpd + " | RPM: " + c.rpm + " | 503/504: " + c.server +
                (c.other > 0 ? (" | Khác: " + c.other) : ""));
        }
        if (!hasCooling) lines.push("- Toàn bộ " + aliveKeys + "/" + gemKeys.length + " key Gemini đều SẴN SÀNG.");

        if (state.modelOverload) {
            var ovList = [];
            for (var om in state.modelOverload) {
                if (!state.modelOverload.hasOwnProperty(om)) continue;
                var ov = state.modelOverload[om];
                if (ov && Number(ov.until || 0) > now) {
                    var remMin = Math.max(1, Math.ceil((Number(ov.until) - now) / 60000));
                    ovList.push(om + " (còn ~" + remMin + "p)");
                }
            }
            if (ovList.length > 0) {
                lines.push("- Model đang tạm tránh do quá tải 504: " + ovList.join(", "));
            }
        }
        if (state.modelDead) {
            var deadModels = [];
            for (var dm in state.modelDead) {
                if (state.modelDead.hasOwnProperty(dm) && Number(state.modelDead[dm]) > now) deadModels.push(dm);
            }
            if (deadModels.length > 0) {
                lines.push("- Model tạm bỏ qua (404): " + deadModels.join(", "));
            }
        }

        try {
            var info = localBook.getInfo();
            if (info && info.id) {
                var bid = String(info.id);
                var bridgeOn = llmReadBoolConfig("use_context_bridge", true);
                var rawStory = "";
                try { rawStory = String(localStorage.getItem(LLM_STORY_STATE_PREFIX + bid) || "").trim(); } catch (eS) {}
                var rawTail = "";
                try { rawTail = String(localStorage.getItem(LLM_CONTEXT_BRIDGE_PREFIX + bid) || "").trim(); } catch (eT) {}
                if (!bridgeOn) {
                    lines.push("Ngữ cảnh truyện: mục 3.3 đang TẮT (trong kho còn " + rawStory.length + " ký tự)");
                } else {
                    var ctxEngineLabel = (dsEnabled && dsCtxEngineOn && deadDs < dsKeys.length) ? "DeepSeek" : "Gemini Flash-Lite";
                    lines.push("Ngữ cảnh truyện (story_state, " + ctxEngineLabel + "): " + (rawStory ? rawStory.length + " ký tự" : "chưa có"));
                    lines.push("Cầu nối cuối chương: " + (rawTail ? rawTail.length + " ký tự" : "chưa có"));
                }
                var syncCnt = "";
                try { syncCnt = String(localStorage.getItem(LLM_DS_SYNC_COUNT_PREFIX + bid) || ""); } catch (eSc) {}
                if (syncCnt) lines.push("Số lượt đồng bộ ngữ cảnh: " + syncCnt);
            }
        } catch (eBook) {}

        if (typeof llmLoadRecentErrors === "function") {
            var recentErrors = llmLoadRecentErrors();
            if (recentErrors.length > 0) {
                lines.push("Nhật ký " + recentErrors.length + " lỗi/cứu hộ gần nhất:");
                for (var eIdx = recentErrors.length - 1; eIdx >= 0; eIdx--) {
                    var rec = recentErrors[eIdx];
                    var ageSec = Math.max(0, Math.floor((now - Number(rec.at || now)) / 1000));
                    var ageText = ageSec < 60
                        ? (ageSec + "s trước")
                        : (ageSec < 3600 ? (Math.floor(ageSec / 60) + "p trước") : (Math.floor(ageSec / 3600) + "g trước"));
                    lines.push("- [" + ageText + "][" + (rec.stage || "ERR") + "] " + (rec.detail || ""));
                }
            } else {
                lines.push("Nhật ký lỗi gần đây: không có lỗi nào.");
            }
        }

        var report = lines.join("\n");
        console.log(report);
        return Response.success(report);
    } catch (e) {
        return Response.error("Không thể kiểm tra trạng thái: " + String(e));
    }
}
