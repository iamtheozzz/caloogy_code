'use strict';

let _a = null;
try { _a = require('../build/Release/caloogy_indicators.node'); } catch {}

function sma(arr, n) {
    if (_a) return _a.sma(arr, n);
    return arr.map(function (_, i) {
        if (i < n - 1) return null;
        var s = 0;
        for (var j = 0; j < n; j++) s += arr[i - j];
        return s / n;
    });
}

function ema(arr, n) {
    if (_a) return _a.ema(arr, n);
    var k = 2 / (n + 1);
    var out = new Array(arr.length).fill(null);
    var prev = null;
    for (var i = 0; i < arr.length; i++) {
        if (i < n - 1) continue;
        if (prev === null) {
            var s = 0;
            for (var j = 0; j < n; j++) s += arr[i - j];
            prev = s / n;
        } else {
            prev = arr[i] * k + prev * (1 - k);
        }
        out[i] = prev;
    }
    return out;
}

function calcRsi(arr, n) {
    if (_a) return _a.rsi(arr, n || 14);
    n = n || 14;
    var out = new Array(arr.length).fill(null);
    var ag = 0, al = 0;
    for (var i = 1; i <= n; i++) {
        var d = arr[i] - arr[i - 1];
        if (d > 0) ag += d; else al -= d;
    }
    ag /= n; al /= n;
    for (var i = n; i < arr.length; i++) {
        if (i > n) {
            var d = arr[i] - arr[i - 1];
            ag = (ag * (n - 1) + Math.max(d, 0)) / n;
            al = (al * (n - 1) + Math.max(-d, 0)) / n;
        }
        var rs = al === 0 ? 1e9 : ag / al;
        out[i] = 100 - 100 / (1 + rs);
    }
    return out;
}

function calcMacd(closes, fast, slow, sig) {
    if (_a) return _a.macd(closes, fast || 12, slow || 26, sig || 9);
    fast = fast || 12; slow = slow || 26; sig = sig || 9;
    var fEma = ema(closes, fast);
    var sEma = ema(closes, slow);
    var macdLine = closes.map(function (_, i) {
        return (fEma[i] !== null && sEma[i] !== null) ? fEma[i] - sEma[i] : null;
    });
    var sigLine = new Array(closes.length).fill(null);
    var k = 2 / (sig + 1), prev = null, cnt = 0;
    for (var i = 0; i < closes.length; i++) {
        if (macdLine[i] === null) continue;
        cnt++;
        prev = prev === null ? macdLine[i] : macdLine[i] * k + prev * (1 - k);
        if (cnt >= sig) sigLine[i] = prev;
    }
    return { macd: macdLine, signal: sigLine };
}

function bollinger(arr, n, mult) {
    if (_a) return _a.bollinger(arr, n || 20, mult || 2.0);
    n = n || 20; mult = mult || 2.0;
    var out = new Array(arr.length).fill(null);
    for (var i = n - 1; i < arr.length; i++) {
        var sum = 0;
        for (var j = 0; j < n; j++) sum += arr[i - j];
        var mean = sum / n;
        var vsum = 0;
        for (var j = 0; j < n; j++) vsum += (arr[i - j] - mean) * (arr[i - j] - mean);
        var std = Math.sqrt(vsum / n);
        out[i] = { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
    }
    return out;
}

module.exports = { sma, ema, calcRsi, calcMacd, bollinger, _native: !!_a };
