'use strict';

const express = require('express');
const path    = require('path');
const net     = require('net');

// ── Helpers ─────────────────────────────────────────────────────────────────

function sseChunk(res, text) {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
}

function sseDone(res) {
    res.write('data: [DONE]\n\n');
    res.end();
}

function sseError(res, msg) {
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

// Convert Gemini-format history to OpenAI/Claude format
function toOpenAIHistory(history, systemPrompt) {
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const h of (history || [])) {
        const role    = h.role === 'model' ? 'assistant' : 'user';
        const content = Array.isArray(h.parts) ? h.parts.map(p => p.text || '').join('') : (h.content || '');
        msgs.push({ role, content });
    }
    return msgs;
}

// ── AI providers ─────────────────────────────────────────────────────────────

async function streamGemini(res, { key, message, cosplay, history }) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genai = new GoogleGenerativeAI(key);
    const model = genai.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: cosplay || undefined,
    });
    const chat = model.startChat({ history: history || [] });
    const result = await chat.sendMessageStream(message);
    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) sseChunk(res, text);
    }
    sseDone(res);
}

async function streamOpenAI(res, { key, message, cosplay, history }) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: key });
    const msgs   = toOpenAIHistory(history, cosplay);
    msgs.push({ role: 'user', content: message });
    const stream = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: msgs,
        stream: true,
    });
    for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) sseChunk(res, text);
    }
    sseDone(res);
}

async function streamClaude(res, { key, message, cosplay, history }) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: key });
    const msgs      = toOpenAIHistory(history, null);  // no system in messages
    msgs.push({ role: 'user', content: message });
    const stream = client.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens: 4096,
        system: cosplay || undefined,
        messages: msgs,
    });
    for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            sseChunk(res, event.delta.text);
        }
    }
    sseDone(res);
}

// ── Port helper ───────────────────────────────────────────────────────────────

function findFreePort(start) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(start, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => findFreePort(start + 1).then(resolve).catch(reject));
    });
}

// ── Express app ───────────────────────────────────────────────────────────────

function startServer(cfg) {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    app.post('/api/ai/chat', async (req, res) => {
        const { message, cosplay, history } = req.body || {};
        if (!message) { res.status(400).json({ error: 'message required' }); return; }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        try {
            const args = { key: cfg.key, message, cosplay, history };
            if (cfg.provider === 'gemini')   await streamGemini(res, args);
            else if (cfg.provider === 'openai') await streamOpenAI(res, args);
            else if (cfg.provider === 'claude') await streamClaude(res, args);
            else sseError(res, 'Unknown provider: ' + cfg.provider);
        } catch (err) {
            console.error('[AI error]', err.message);
            sseError(res, err.message || 'AI request failed');
        }
    });

    // Allow re-running setup: POST /api/reset-config
    app.post('/api/reset-config', (req, res) => {
        const os   = require('os');
        const fs   = require('fs');
        const cfgPath = require('path').join(os.homedir(), '.caloogy-config.json');
        try { fs.unlinkSync(cfgPath); } catch {}
        res.json({ ok: true });
        setTimeout(() => process.exit(0), 200);
    });

    return new Promise((resolve, reject) => {
        findFreePort(3000).then(port => {
            app.listen(port, () => resolve(port));
        }).catch(reject);
    });
}

module.exports = { startServer };
