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
