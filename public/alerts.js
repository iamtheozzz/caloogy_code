'use strict';

(function () {

var _alertsEmailConfigured = false;

var TYPE_LABELS = {
    price_change:  'Price Spike',
    rsi_threshold: 'RSI Extreme',
    price_vs_sma:  'SMA Cross',
    macd_cross:    'MACD Cross',
    bb_breakout:   'BB Breakout',
};

var COINS = [
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT',
    'ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','UNIUSDT','LTCUSDT',
    'ATOMUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT',
    'TRXUSDT','MATICUSDT','FILUSDT','ICPUSDT','INJUSDT','TONUSDT',
    'PEPEUSDT','SHIBUSDT','WIFUSDT','JUPUSDT','BONKUSDT','RENDERUSDT',
    'FETUSDT','HBARUSDT','VETUSDT',
];

// ── API helpers ───────────────────────────────────────────────────────────────

function apiGet(url) {
    return fetch(url).then(function (r) { return r.json(); });
}
function apiPost(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
}
function apiDelete(url) {
    return fetch(url, { method: 'DELETE' }).then(function (r) { return r.json(); });
}
function apiPut(url, body) {
    return fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
}

// ── Render alerts list ────────────────────────────────────────────────────────

function renderAlerts(alerts) {
    var list = document.getElementById('ccAlertsList');
    if (!list) return;

    if (alerts.length === 0) {
        list.innerHTML = '<div class="cc-alerts-empty">No alerts configured. Click <b>+ Add Alert</b> to get started.</div>';
        return;
    }

    list.innerHTML = alerts.map(function (a) {
        var last = a.lastTriggered
            ? 'Last: ' + new Date(a.lastTriggered).toLocaleString()
            : 'Never triggered';
        var params = describeRule(a);
        return '<div class="cc-alert-row" data-id="' + a.id + '">' +
            '<div class="cc-alert-info">' +
                '<span class="cc-alert-coin">' + a.symbol.replace('USDT','') + '</span>' +
                '<span class="cc-alert-type">' + (TYPE_LABELS[a.type] || a.type) + '</span>' +
                '<span class="cc-alert-params">' + params + '</span>' +
            '</div>' +
            '<div class="cc-alert-meta">' + last + '</div>' +
            '<div class="cc-alert-actions">' +
                '<button class="cc-alert-toggle ' + (a.enabled ? 'cc-alert-on' : 'cc-alert-off') + '" data-id="' + a.id + '" data-enabled="' + a.enabled + '">' +
                    (a.enabled ? 'ON' : 'OFF') +
                '</button>' +
                '<button class="cc-alert-del" data-id="' + a.id + '">✕</button>' +
            '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('.cc-alert-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id      = btn.dataset.id;
            var enabled = btn.dataset.enabled === 'true';
            apiPut('/api/alerts/' + id, { enabled: !enabled }).then(function () { loadAlerts(); });
        });
    });
    list.querySelectorAll('.cc-alert-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
            apiDelete('/api/alerts/' + btn.dataset.id).then(function () { loadAlerts(); });
        });
    });
}

function describeRule(a) {
    switch (a.type) {
        case 'price_change':  return '±' + (a.pct || 5) + '% in ' + (a.lookback || 3) + ' candles';
        case 'rsi_threshold': return 'RSI ' + (a.direction === 'above' ? '>' : '<') + ' ' + (a.threshold || (a.direction === 'above' ? 70 : 30));
        case 'price_vs_sma':  return 'Price ' + (a.direction === 'cross_above' ? 'crosses above' : 'crosses below') + ' SMA' + (a.period || 20);
        case 'macd_cross':    return 'MACD ' + (a.direction === 'cross_above' ? 'crosses above' : 'crosses below') + ' Signal';
        case 'bb_breakout':   return 'Price breaks ' + (a.direction === 'above_upper' ? 'above upper' : 'below lower') + ' band';
        default: return '';
    }
}

function loadAlerts() {
    apiGet('/api/alerts').then(function (alerts) {
        renderAlerts(alerts);
        var badge = document.getElementById('ccAlertsCount');
        if (badge) badge.textContent = alerts.length;
    });
}

// ── Add alert form ────────────────────────────────────────────────────────────

function buildParamFields(type) {
    var el = document.getElementById('ccAlertParams');
    if (!el) return;
    el.innerHTML = '';

    function row(label, html) {
        el.innerHTML += '<label class="cc-alert-field">' + label + html + '</label>';
    }
    function sel(name, opts) {
        return '<select class="cc-alert-sel" name="' + name + '">' +
            opts.map(function (o) { return '<option value="' + o.v + '">' + o.l + '</option>'; }).join('') +
        '</select>';
    }
    function num(name, def, min, max) {
        return '<input class="cc-alert-inp" type="number" name="' + name + '" value="' + def + '" min="' + (min||0) + '" max="' + (max||9999) + '">';
    }

    if (type === 'price_change') {
        row('Min change %', num('pct', 5, 1, 100));
        row('Lookback candles', num('lookback', 3, 1, 20));
    } else if (type === 'rsi_threshold') {
        row('Direction', sel('direction', [{v:'above',l:'Above (overbought)'},{v:'below',l:'Below (oversold)'}]));
        row('Threshold', num('threshold', 70, 1, 99));
    } else if (type === 'price_vs_sma') {
        row('Direction', sel('direction', [{v:'cross_above',l:'Crosses above SMA'},{v:'cross_below',l:'Crosses below SMA'}]));
        row('SMA period', num('period', 20, 5, 200));
    } else if (type === 'macd_cross') {
        row('Direction', sel('direction', [{v:'cross_above',l:'MACD crosses above Signal'},{v:'cross_below',l:'MACD crosses below Signal'}]));
    } else if (type === 'bb_breakout') {
        row('Direction', sel('direction', [{v:'above_upper',l:'Breaks above upper band'},{v:'below_lower',l:'Breaks below lower band'}]));
    }

    row('Cooldown (min)', num('cooldownMinutes', 60, 5, 1440));
}

function getFormRule() {
    var symbol = document.querySelector('[name="alertSymbol"]').value;
    var type   = document.querySelector('[name="alertType"]').value;
    var rule   = { symbol, type };
    document.querySelectorAll('#ccAlertParams [name]').forEach(function (inp) {
        var v = inp.value;
        rule[inp.name] = isNaN(v) || v === '' ? v : +v;
    });
    return rule;
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initAlerts() {
    var toggle  = document.getElementById('ccAlertsToggle');
    var body    = document.getElementById('ccAlertsBody');
    var addBtn  = document.getElementById('ccAlertAddBtn');
    var form    = document.getElementById('ccAlertForm');
    var saveBtn = document.getElementById('ccAlertSave');
    var cancelBtn = document.getElementById('ccAlertCancel');
    var testBtn = document.getElementById('ccAlertTestEmail');
    var typeEl  = document.querySelector('[name="alertType"]');

    if (!toggle) return;

    // Check email config
    apiGet('/api/alerts/config').then(function (cfg) {
        _alertsEmailConfigured = cfg.emailConfigured;
        var banner = document.getElementById('ccAlertsEmailBanner');
        if (banner) banner.style.display = cfg.emailConfigured ? 'none' : 'block';
        if (testBtn) testBtn.style.display = cfg.emailConfigured ? 'inline-block' : 'none';
    });

    // Toggle panel
    toggle.addEventListener('click', function () {
        var open = body.classList.toggle('cc-alerts-open');
        toggle.classList.toggle('open', open);
        if (open) loadAlerts();
    });

    // Type change → rebuild param fields
    if (typeEl) {
        typeEl.addEventListener('change', function () { buildParamFields(typeEl.value); });
        buildParamFields(typeEl.value);
    }

    // Add button → show form
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            form.style.display = form.style.display === 'none' ? 'block' : 'none';
        });
    }

    // Save
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            var rule = getFormRule();
            apiPost('/api/alerts', rule).then(function () {
                form.style.display = 'none';
                loadAlerts();
            });
        });
    }

    // Cancel
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () { form.style.display = 'none'; });
    }

    // Test email
    if (testBtn) {
        testBtn.addEventListener('click', function () {
            testBtn.disabled = true;
            testBtn.textContent = 'Sending…';
            apiPost('/api/alerts/test-email', {}).then(function (r) {
                testBtn.textContent = r.ok ? 'Sent ✓' : 'Failed: ' + r.error;
                setTimeout(function () { testBtn.textContent = 'Send test email'; testBtn.disabled = false; }, 3000);
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', initAlerts);

})();
