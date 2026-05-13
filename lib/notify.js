'use strict';

// ── Gmail ─────────────────────────────────────────────────────────────────────

async function sendEmail(cfg, subject, body) {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: cfg.email, pass: cfg.gmailPass },
    });
    await t.sendMail({
        from:    `"Caloogy Code" <${cfg.email}>`,
        to:      cfg.email,
        subject,
        text:    body,
    });
}

// ── Discord ───────────────────────────────────────────────────────────────────

async function sendDiscord(webhookUrl, subject, body) {
    const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: `**${subject}**\n\`\`\`\n${body}\n\`\`\`` }),
    });
    if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function sendTelegram(cfg, subject, body) {
    const url = `https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`;
    const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            chat_id:    cfg.telegramChatId,
            text:       `*${subject}*\n\`\`\`\n${body}\n\`\`\``,
            parse_mode: 'Markdown',
        }),
    });
    if (!res.ok) throw new Error(`Telegram API failed: ${res.status}`);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function notify(cfg, { subject, body }) {
    const tasks = [];
    if (cfg.email && cfg.gmailPass)
        tasks.push(sendEmail(cfg, subject, body).catch(e => console.error('[Notify] Gmail error:', e.message)));
    if (cfg.discordWebhook)
        tasks.push(sendDiscord(cfg.discordWebhook, subject, body).catch(e => console.error('[Notify] Discord error:', e.message)));
    if (cfg.telegramToken && cfg.telegramChatId)
        tasks.push(sendTelegram(cfg, subject, body).catch(e => console.error('[Notify] Telegram error:', e.message)));
    await Promise.all(tasks);
}

async function sendTestNotify(cfg) {
    const subject = '[Caloogy] Test notification — alerts are working';
    const body    = `This is a test from Caloogy Code.\nYour alerts will be sent to this channel.\nTime: ${new Date().toUTCString()}`;
    await notify(cfg, { subject, body });
}

module.exports = { notify, sendTestNotify };
