#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC_DIR = path.join(__dirname, "..", "gemini-deepseek-hybrid", "src");

function loadSandbox(cfg, store, fetchHandler, extra) {
    const ctx = Object.assign({
        localConfig: { getItem: (k) => (k in cfg ? cfg[k] : null) },
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        },
        localDatabase: { count: () => 0, list: () => [], get: () => null, upsertAll: () => 0, clear: () => true },
        localBook: {
            getInfo: () => ({ id: "book_test", lastReadChapterIndex: 10 }),
            getNames: () => ({}),
            getQtNames: () => ({}),
            getQtVietPhrases: () => ({})
        },
        Qt: {
            translate: () => ({ translateText: "Lâm Ngự học trưởng... ta thích ngươi!\nHọc muội thẹn thùng nhìn hắn." })
        },
        Response: {
            success: (d) => ({ ok: true, data: d }),
            error: (e) => ({ ok: false, error: e })
        },
        fetch: fetchHandler || (() => { throw new Error("Unexpected fetch"); }),
        load: (f) => vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), "utf8"), ctx),
        console
    }, extra || {});
    vm.createContext(ctx);
    return ctx;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// 1. Static ES5/Rhino compatibility scan
test("1. Static ES5/Rhino syntax scan across all src/*.js", () => {
    const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".js")).sort();
    assert.ok(files.length >= 15, "Expected >= 15 JS files");
    const forbidden = [
        { name: "let/const", re: /(?:^|[\s;{(])(?:let|const)\s+[A-Za-z_$]/m },
        { name: "optional chaining ?.", re: /\?\.[A-Za-z_$\[(]/ },
        { name: "nullish coalescing ??", re: /\?\?/ },
        { name: "async/await", re: /\b(?:async\s+function|await\s+)/ },
        { name: ".includes(", re: /\.includes\s*\(/ },
        { name: ".startsWith/.endsWith", re: /\.(?:startsWith|endsWith|replaceAll|padStart)\s*\(/ }
    ];
    for (const f of files) {
        const raw = fs.readFileSync(path.join(SRC_DIR, f), "utf8");
        const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/[^\n]*/g, "")
            .replace(/"(?:\\.|[^"\\])*"/g, '""')
            .replace(/'(?:\\.|[^'\\])*'/g, "''");
        for (const rule of forbidden) {
            assert.strictEqual(rule.re.test(stripped), false, `${f} contains forbidden ES6+ syntax: ${rule.name}`);
        }
    }
    return `${files.length} JS files clean ES5/Rhino`;
});

// 2. Circuit Breaker modelOverload
test("2. Circuit Breaker skips overloaded heavy model on next chapter", () => {
    let now = 1700000000000;
    function FakeDate() { return { getTime: () => now }; }
    FakeDate.now = () => now;
    const store = {};
    const called = [];
    const ctx = loadSandbox(
        { free_tier_model_cascade: "true", sequential_key_order: "true" },
        store,
        (url) => {
            const m = url.match(/\/models\/([^:]+):generateContent/)[1];
            called.push(m);
            if (m === "gemini-4-hydrogen") { now += 30000; return { ok: false, status: 504, text: () => "" }; }
            now += 5000;
            return { ok: true, status: 200, text: () => JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "OK" }] } }] }) };
        },
        { Date: FakeDate }
    );
    ctx.load("llm.js");
    const keys = Array.from({ length: 60 }, (_, i) => "AIza60_" + (i + 1));
    assert.strictEqual(ctx.llmRequest(keys, ctx.llmBuildBody("gemini-4-hydrogen", "s", "t", {}), 55000).error, "");
    assert.strictEqual(ctx.llmRequest(keys, ctx.llmBuildBody("gemini-4-hydrogen", "s", "t", {}), 55000).error, "");
    assert.deepStrictEqual(called, ["gemini-4-hydrogen", "gemini-3.5-flash-lite", "gemini-3.8-flash"]);
    return called.join(" -> ");
});

// 3. Full 60-key sequential rotation past 35 RPD keys
test("3. Full 60-key rotation sweeps 35 RPD keys to Key #36", () => {
    const store = {};
    let tries = 0;
    const ctx = loadSandbox(
        { sequential_key_order: "true", free_tier_model_cascade: "true" },
        store,
        (url, opts) => {
            tries++;
            const n = parseInt(opts.headers["x-goog-api-key"].split("_")[1], 10);
            if (n <= 35) return { ok: false, status: 429, text: () => JSON.stringify({ error: { message: "GenerateRequestsPerDay" } }) };
            return { ok: true, status: 200, text: () => JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "OK 36" }] } }] }) };
        }
    );
    ctx.load("llm.js");
    const keys = Array.from({ length: 60 }, (_, i) => "AIza60_" + (i + 1));
    assert.strictEqual(ctx.llmRequest(keys, ctx.llmBuildBody("gemini-3.5-flash-lite", "s", "t", {}), 55000).error, "");
    assert.strictEqual(tries, 36);
    return "Swept 35 RPD -> Key #36 OK";
});

// 4. Master DeepSeek toggle OFF blocks DeepSeek calls
test("4. Master toggle enable_deepseek=false blocks DeepSeek completely", () => {
    let dsCalled = 0;
    const ctx = loadSandbox(
        { api_key_lines: "AIza1", deepseek_api_key_lines: "sk-1", enable_deepseek: "false", free_tier_model_cascade: "false" },
        {},
        (url) => {
            if (url.includes("gitapihub")) dsCalled++;
            return { ok: false, status: 503, text: () => "{}" };
        }
    );
    ctx.load("translate.js");
    const res = ctx.execute("测试", "zh-CN", "vi", "chapterContent", "gemini-3.5-flash-lite", "vo-han-luu");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(dsCalled, 0);
    return "0 DeepSeek calls when OFF";
});

// 5. QT-Polish + Recency <hard_pronoun_lock> + TTS sanitizer + <qt_draft> unwrap
test("5. QT-Polish + Recency <hard_pronoun_lock> + TTS sanitizer", () => {
    let capturedSys = "";
    const ctx = loadSandbox(
        { api_key_lines: "AIza1", enable_deepseek: "false", qt_polish_mode: "true", qt_polish_include_raw: "false" },
        { gemini_story_state_v1_book_test: "Bối cảnh câu lạc bộ kịch nói." },
        (url, opts) => {
            capturedSys = JSON.parse(opts.body).systemInstruction.parts[0].text;
            return {
                ok: true,
                status: 200,
                text: () => JSON.stringify({
                    candidates: [{
                        finishReason: "STOP",
                        content: { parts: [{ text: "<qt_draft>【Thông báo】—hết!10 giây.Hắn nói: “Ngươi học 《Thái Cổ Thần Quyết》?”\n——————\nHết.</qt_draft>" }] }
                    }]
                })
            };
        }
    );
    ctx.load("translate.js");
    const res = ctx.execute("“林御学长……我喜欢你！”\n学妹害羞地看着他。", "zh-CN", "vi", "chapterContent", "gemini-3.5-flash-lite", "vo-han-luu");
    assert.strictEqual(res.ok, true);
    assert.ok(capturedSys.lastIndexOf("<hard_pronoun_lock>") > capturedSys.lastIndexOf("<story_state>"));
    assert.ok(res.data.includes("【Thông báo】 — hết! 10 giây. Hắn nói:"));
    assert.ok(res.data.includes("'Thái Cổ Thần Quyết'"));
    assert.ok(!res.data.includes("\n—\n"));
    return "QT-Polish + TTS clean";
});

// 6. Action guards: capture-context blocks when 3.3=OFF; reset-keys preserves cursor & logs
test("6. Action guards (capture-context 3.3 OFF, reset-keys preserves cursor/logs)", () => {
    const store1 = { gemini_story_state_v1_book_test: "Keep old state" };
    const ctx1 = loadSandbox({ use_context_bridge: "false", deepseek_api_key_lines: "sk-1" }, store1);
    ctx1.load("capture-context.js");
    assert.strictEqual(ctx1.execute().ok, false);
    assert.strictEqual(store1.gemini_story_state_v1_book_test, "Keep old state");

    const store2 = {
        gemini_ft_state_v2: JSON.stringify({ cursor: 27, authDead: { k1: 9999999999999 }, buckets: {} }),
        gemini_recent_errors_v1: JSON.stringify([{ at: 1, stage: "ERR", detail: "Keep" }])
    };
    const ctx2 = loadSandbox({}, store2);
    ctx2.load("reset-keys.js");
    assert.strictEqual(ctx2.execute().ok, true);
    assert.strictEqual(JSON.parse(store2.gemini_ft_state_v2).cursor, 27);
    assert.ok(store2.gemini_recent_errors_v1.includes("Keep"));
    return "All action guards OK";
});

// 7. v38: Gemini Flash-Lite handles story_state when 2.2=OFF, DeepSeek only rescues
test("7. v38: Gemini updates story_state when 2.2=OFF; DeepSeek rescues PROHIBITED_CONTENT", () => {
    const store = {};
    let dsCalls = 0;
    const gemModels = [];
    const longChapter = "第一章 测试内容。".repeat(30);
    const longVi = "Chương 1: Đây là đoạn văn bản đủ dài để kích hoạt bước cập nhật ngữ cảnh bằng Gemini Flash-Lite ở cuối chương, đảm bảo không tiêu tốn bất kỳ token nào của DeepSeek cho tác vụ định kỳ này khi mục 2.2 đang tắt. ".repeat(2);
    const ctx = loadSandbox(
        {
            api_key_lines: "AIza1",
            deepseek_api_key_lines: "sk-1",
            enable_deepseek: "true",
            deepseek_context_engine: "false",
            deepseek_rescue_fallback: "true",
            free_tier_model_cascade: "false"
        },
        store,
        (url, opts) => {
            if (url.includes("gitapihub")) {
                dsCalls++;
                return {
                    ok: true,
                    status: 200,
                    text: () => JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Bản dịch cứu hộ DeepSeek thành công." } }] })
                };
            }
            const m = url.match(/\/models\/([^:]+):generateContent/)[1];
            gemModels.push(m);
            const body = JSON.parse(opts.body);
            if (body.generationConfig && body.generationConfig.responseMimeType === "application/json") {
                return {
                    ok: true,
                    status: 200,
                    text: () => JSON.stringify({
                        candidates: [{
                            finishReason: "STOP",
                            content: { parts: [{ text: JSON.stringify({ story_state: "[BỐI CẢNH] Đang ở phòng thử nghiệm. [XƯNG HÔ] ta - ngươi.", memory: [] }) }] }
                        }]
                    })
                };
            }
            if (gemModels.length === 1) {
                return {
                    ok: true,
                    status: 200,
                    text: () => JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: longVi }] } }] })
                };
            }
            return {
                ok: true,
                status: 200,
                text: () => JSON.stringify({ candidates: [{ finishReason: "PROHIBITED_CONTENT" }] })
            };
        }
    );
    ctx.load("translate.js");
    const r1 = ctx.execute(longChapter, "zh-CN", "vi", "chapterContent", "gemini-3.8-flash", "vo-han-luu");
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(dsCalls, 0);
    assert.deepStrictEqual(gemModels, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    assert.ok(store.gemini_story_state_v1_book_test.includes("phòng thử nghiệm"));

    const r2 = ctx.execute("敏感测试", "zh-CN", "vi", "chapterContent", "gemini-3.8-flash", "vo-han-luu");
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(dsCalls, 1);
    assert.ok(r2.data.includes("DeepSeek"));
    return "0 DS on normal chapter + 1 DS rescue OK";
});

// 8. v38: DeepSeek HTTP 402 auto-cooldown + reset-keys clears dsAuthDead
test("8. v38: DeepSeek HTTP 402 auto-cooldown skips repeat calls; reset-keys clears it", () => {
    const store = {};
    let dsFetchCount = 0;
    const ctx = loadSandbox(
        { api_key_lines: "AIza1", deepseek_api_key_lines: "sk-empty", enable_deepseek: "true" },
        store,
        (url) => {
            if (url.includes("gitapihub")) {
                dsFetchCount++;
                return { ok: false, status: 402, text: () => JSON.stringify({ error: { message: "Insufficient balance" } }) };
            }
            return { ok: false, status: 503, text: () => "{}" };
        }
    );
    ctx.load("llm.js");
    const r1 = ctx.llmDeepSeekRequest("sys", "usr", {}, 20000);
    assert.ok(r1.error.includes("402"));
    assert.strictEqual(dsFetchCount, 1);
    assert.strictEqual(ctx.llmHasDeepSeek(), false);

    const r2 = ctx.llmDeepSeekRequest("sys", "usr", {}, 20000);
    assert.strictEqual(dsFetchCount, 1);
    assert.ok(r2.error.includes("Không có DeepSeek"));

    ctx.load("reset-keys.js");
    assert.strictEqual(ctx.execute().ok, true);
    assert.strictEqual(ctx.llmHasDeepSeek(), true);
    return "HTTP 402 cooldown + reset-keys OK";
});

// 9. v38: repairRemainingChinese falls back to Gemini Flash-Lite when DeepSeek errors
test("9. v38: repairRemainingChinese falls back to Gemini Flash-Lite on DeepSeek 402", () => {
    const store = {};
    let dsCalled = 0;
    let gemCalled = 0;
    const ctx = loadSandbox(
        { api_key_lines: "AIza1", deepseek_api_key_lines: "sk-empty", enable_deepseek: "true", deepseek_context_engine: "true" },
        store,
        (url) => {
            if (url.includes("gitapihub")) {
                dsCalled++;
                return { ok: false, status: 402, text: () => JSON.stringify({ error: { message: "Insufficient balance" } }) };
            }
            gemCalled++;
            return {
                ok: true,
                status: 200,
                text: () => JSON.stringify({
                    candidates: [{
                        finishReason: "STOP",
                        content: { parts: [{ text: JSON.stringify({ items: [{ id: "0", translation: "Ngọc" }] }) }] }
                    }]
                })
            };
        }
    );
    ctx.load("translate.js");
    const fixed = ctx.repairRemainingChinese("gemini-3.8-flash", ["AIza1"], "Hoàng玉 đứng đó.", "vi", "", 4096, "book_test", 25000);
    assert.strictEqual(dsCalled, 1);
    assert.strictEqual(gemCalled, 1);
    assert.strictEqual(fixed, "Hoàng Ngọc đứng đó.");
    return "Repair fallback DS->Gemini OK";
});

let passed = 0;
for (const t of tests) {
    try {
        const info = t.fn();
        console.log(`[PASS] ${t.name} -> ${info}`);
        passed++;
    } catch (e) {
        console.error(`[FAIL] ${t.name} -> ${e.message}`);
        process.exit(1);
    }
}
console.log(`\nALL ${passed}/${tests.length} TESTS PASSED!`);
