#pragma GCC optimize("O3")

#include <napi.h>
#include <vector>
#include <cmath>
#include <algorithm>
#include <limits>
#include <stdexcept>
#include <string>

static const double NaN = std::numeric_limits<double>::quiet_NaN();

// ---------------------------------------------------------------------------
// Helpers: JS <-> C++ conversion
// ---------------------------------------------------------------------------

static double jsValToDouble(const Napi::Value& val) {
    if (val.IsNull() || val.IsUndefined()) return NaN;
    if (val.IsNumber()) return val.As<Napi::Number>().DoubleValue();
    return NaN;
}

static std::vector<double> jsArrayToVec(const Napi::Array& arr) {
    size_t len = arr.Length();
    std::vector<double> out(len);
    for (size_t i = 0; i < len; i++) {
        out[i] = jsValToDouble(arr.Get(i));
    }
    return out;
}

struct Candle {
    double open, high, low, close, volume;
};

static Candle jsObjToCandle(const Napi::Object& obj) {
    Candle c;
    c.open   = obj.Has("open")   ? jsValToDouble(obj.Get("open"))   : NaN;
    c.high   = obj.Has("high")   ? jsValToDouble(obj.Get("high"))   : NaN;
    c.low    = obj.Has("low")    ? jsValToDouble(obj.Get("low"))    : NaN;
    c.close  = obj.Has("close")  ? jsValToDouble(obj.Get("close"))  : NaN;
    c.volume = obj.Has("volume") ? jsValToDouble(obj.Get("volume")) : NaN;
    return c;
}

static std::vector<Candle> jsCandleArrayToVec(const Napi::Array& arr) {
    size_t len = arr.Length();
    std::vector<Candle> out(len);
    for (size_t i = 0; i < len; i++) {
        Napi::Value v = arr.Get(i);
        if (v.IsObject()) {
            out[i] = jsObjToCandle(v.As<Napi::Object>());
        } else {
            out[i] = {NaN, NaN, NaN, NaN, NaN};
        }
    }
    return out;
}

static Napi::Array vecToJsArray(Napi::Env env, const std::vector<double>& vec) {
    Napi::Array arr = Napi::Array::New(env, vec.size());
    for (size_t i = 0; i < vec.size(); i++) {
        if (std::isnan(vec[i])) {
            arr.Set(i, env.Null());
        } else {
            arr.Set(i, Napi::Number::New(env, vec[i]));
        }
    }
    return arr;
}

static Napi::Array intVecToJsArray(Napi::Env env, const std::vector<int>& vec) {
    Napi::Array arr = Napi::Array::New(env, vec.size());
    for (size_t i = 0; i < vec.size(); i++) {
        arr.Set(i, Napi::Number::New(env, vec[i]));
    }
    return arr;
}

// ---------------------------------------------------------------------------
// Core C++ indicator implementations
// ---------------------------------------------------------------------------

static std::vector<double> core_sma(const std::vector<double>& arr, int n) {
    size_t len = arr.size();
    std::vector<double> out(len, NaN);
    for (size_t i = (size_t)(n - 1); i < len; i++) {
        double s = 0.0;
        for (int j = 0; j < n; j++) s += arr[i - j];
        out[i] = s / n;
    }
    return out;
}

static std::vector<double> core_ema(const std::vector<double>& arr, int n) {
    size_t len = arr.size();
    std::vector<double> out(len, NaN);
    double k = 2.0 / (n + 1);
    double prev = NaN;
    for (size_t i = 0; i < len; i++) {
        if ((int)i < n - 1) continue;
        if (std::isnan(prev)) {
            double s = 0.0;
            for (int j = 0; j < n; j++) s += arr[i - j];
            prev = s / n;
        } else {
            prev = arr[i] * k + prev * (1.0 - k);
        }
        out[i] = prev;
    }
    return out;
}

// EMA over a vector that may contain NaN — filters out NaNs like TRIX smoothOnce
static std::vector<double> core_ema_sparse(const std::vector<double>& src, int n) {
    size_t len = src.size();
    std::vector<double> out(len, NaN);
    double k = 2.0 / (n + 1);

    std::vector<double> vals;
    std::vector<size_t> idxs;
    for (size_t i = 0; i < len; i++) {
        if (!std::isnan(src[i])) {
            vals.push_back(src[i]);
            idxs.push_back(i);
        }
    }
    if ((int)vals.size() < n) return out;

    double sum = 0.0;
    for (int i = 0; i < n; i++) sum += vals[i];
    double prev = sum / n;
    out[idxs[n - 1]] = prev;
    for (size_t i = (size_t)n; i < vals.size(); i++) {
        prev = vals[i] * k + prev * (1.0 - k);
        out[idxs[i]] = prev;
    }
    return out;
}

static std::vector<double> core_rsi(const std::vector<double>& arr, int n) {
    size_t len = arr.size();
    std::vector<double> out(len, NaN);
    if ((int)len <= n) return out;

    double ag = 0.0, al = 0.0;
    for (int i = 1; i <= n; i++) {
        double d = arr[i] - arr[i - 1];
        if (d > 0) ag += d; else al -= d;
    }
    ag /= n; al /= n;

    for (size_t i = (size_t)n; i < len; i++) {
        if (i > (size_t)n) {
            double d = arr[i] - arr[i - 1];
            ag = (ag * (n - 1) + std::max(d, 0.0)) / n;
            al = (al * (n - 1) + std::max(-d, 0.0)) / n;
        }
        double rs = (al == 0.0) ? 1e9 : ag / al;
        out[i] = 100.0 - 100.0 / (1.0 + rs);
    }
    return out;
}

struct MacdResult {
    std::vector<double> macd, signal;
};

static MacdResult core_macd(const std::vector<double>& closes, int fast, int slow, int sig) {
    size_t len = closes.size();
    auto fEma = core_ema(closes, fast);
    auto sEma = core_ema(closes, slow);

    std::vector<double> macdLine(len, NaN);
    for (size_t i = 0; i < len; i++) {
        if (!std::isnan(fEma[i]) && !std::isnan(sEma[i])) {
            macdLine[i] = fEma[i] - sEma[i];
        }
    }

    std::vector<double> sigLine(len, NaN);
    double k = 2.0 / (sig + 1);
    double prev = NaN;
    int cnt = 0;
    for (size_t i = 0; i < len; i++) {
        if (std::isnan(macdLine[i])) continue;
        cnt++;
        prev = std::isnan(prev) ? macdLine[i] : macdLine[i] * k + prev * (1.0 - k);
        if (cnt >= sig) sigLine[i] = prev;
    }

    return {macdLine, sigLine};
}

struct BollingerBar {
    double upper, middle, lower;
    bool valid;
};

static std::vector<BollingerBar> core_bollinger(const std::vector<double>& arr, int n, double mult) {
    size_t len = arr.size();
    std::vector<BollingerBar> out(len, {0.0, 0.0, 0.0, false});
    for (size_t i = (size_t)(n - 1); i < len; i++) {
        double sum = 0.0;
        for (int j = 0; j < n; j++) sum += arr[i - j];
        double mean = sum / n;
        double vsum = 0.0;
        for (int j = 0; j < n; j++) {
            double diff = arr[i - j] - mean;
            vsum += diff * diff;
        }
        double std_ = std::sqrt(vsum / n);
        out[i] = {mean + mult * std_, mean, mean - mult * std_, true};
    }
    return out;
}

struct DonchianBar {
    double high, low;
    bool valid;
};

static std::vector<DonchianBar> core_donchian(const std::vector<double>& closes, int n) {
    size_t len = closes.size();
    std::vector<DonchianBar> out(len, {0.0, 0.0, false});
    for (size_t i = (size_t)n; i < len; i++) {
        double hi = -std::numeric_limits<double>::infinity();
        double lo =  std::numeric_limits<double>::infinity();
        for (size_t j = i - n; j < i; j++) {
            if (closes[j] > hi) hi = closes[j];
            if (closes[j] < lo) lo = closes[j];
        }
        out[i] = {hi, lo, true};
    }
    return out;
}

struct StochasticResult {
    std::vector<double> k, d;
};

static StochasticResult core_stochastic(const std::vector<Candle>& candles, int kPeriod, int dPeriod) {
    size_t len = candles.size();
    std::vector<double> k(len, NaN);

    for (size_t i = (size_t)(kPeriod - 1); i < len; i++) {
        double hi = -std::numeric_limits<double>::infinity();
        double lo =  std::numeric_limits<double>::infinity();
        for (size_t j = i - kPeriod + 1; j <= i; j++) {
            if (candles[j].high > hi) hi = candles[j].high;
            if (candles[j].low  < lo) lo = candles[j].low;
        }
        k[i] = (hi == lo) ? 50.0 : (candles[i].close - lo) / (hi - lo) * 100.0;
    }

    std::vector<double> d(len, NaN);
    int start = kPeriod + dPeriod - 2;
    for (size_t i = (size_t)start; i < len; i++) {
        double sum = 0.0;
        bool valid = true;
        for (size_t j = i - dPeriod + 1; j <= i; j++) {
            if (std::isnan(k[j])) { valid = false; break; }
            sum += k[j];
        }
        if (valid) d[i] = sum / dPeriod;
    }

    return {k, d};
}

struct ADXResult {
    std::vector<double> diP, diM, adx;
};

static ADXResult core_adx(const std::vector<Candle>& candles, int period) {
    size_t n = candles.size();
    std::vector<double> tr(n, 0.0), dmP(n, 0.0), dmM(n, 0.0);

    for (size_t i = 1; i < n; i++) {
        double hd = candles[i].high - candles[i-1].high;
        double ld = candles[i-1].low - candles[i].low;
        double pc = candles[i-1].close;
        tr[i] = std::max({candles[i].high - candles[i].low,
                          std::abs(candles[i].high - pc),
                          std::abs(candles[i].low  - pc)});
        dmP[i] = (hd > ld && hd > 0) ? hd : 0.0;
        dmM[i] = (ld > hd && ld > 0) ? ld : 0.0;
    }

    auto wilderSmooth = [&](const std::vector<double>& arr) -> std::vector<double> {
        std::vector<double> out(n, NaN);
        double sum = 0.0;
        for (int i = 1; i <= period; i++) sum += arr[i];
        out[period] = sum;
        for (size_t i = (size_t)(period + 1); i < n; i++) {
            out[i] = out[i-1] - out[i-1] / period + arr[i];
        }
        return out;
    };

    auto sTR  = wilderSmooth(tr);
    auto sDMp = wilderSmooth(dmP);
    auto sDMm = wilderSmooth(dmM);

    std::vector<double> diP(n, NaN), diM(n, NaN), dx(n, NaN);
    for (size_t i = (size_t)period; i < n; i++) {
        if (!sTR[i] || std::isnan(sTR[i])) continue;
        diP[i] = sDMp[i] / sTR[i] * 100.0;
        diM[i] = sDMm[i] / sTR[i] * 100.0;
        double s = diP[i] + diM[i];
        dx[i] = (s == 0.0) ? 0.0 : std::abs(diP[i] - diM[i]) / s * 100.0;
    }

    std::vector<double> adxOut(n, NaN);
    std::vector<double> dxVals;
    std::vector<size_t> dxIdx;
    for (size_t i = 0; i < n; i++) {
        if (!std::isnan(dx[i])) {
            dxVals.push_back(dx[i]);
            dxIdx.push_back(i);
        }
    }
    if ((int)dxVals.size() >= period) {
        double s2 = 0.0;
        for (int i = 0; i < period; i++) s2 += dxVals[i];
        adxOut[dxIdx[period - 1]] = s2 / period;
        for (size_t i = (size_t)period; i < dxVals.size(); i++) {
            adxOut[dxIdx[i]] = (adxOut[dxIdx[i-1]] * (period - 1) + dxVals[i]) / period;
        }
    }

    return {diP, diM, adxOut};
}

static std::vector<double> core_williamsr(const std::vector<Candle>& candles, int period) {
    size_t len = candles.size();
    std::vector<double> out(len, NaN);
    for (size_t i = (size_t)(period - 1); i < len; i++) {
        double hi = -std::numeric_limits<double>::infinity();
        double lo =  std::numeric_limits<double>::infinity();
        for (size_t j = i - period + 1; j <= i; j++) {
            if (candles[j].high > hi) hi = candles[j].high;
            if (candles[j].low  < lo) lo = candles[j].low;
        }
        out[i] = (hi == lo) ? -50.0 : (hi - candles[i].close) / (hi - lo) * -100.0;
    }
    return out;
}

static std::vector<double> core_vwap(const std::vector<Candle>& candles, int period) {
    size_t len = candles.size();
    std::vector<double> out(len, NaN);
    for (size_t i = (size_t)(period - 1); i < len; i++) {
        double sumPV = 0.0, sumV = 0.0;
        for (size_t j = i - period + 1; j <= i; j++) {
            double tp = (candles[j].high + candles[j].low + candles[j].close) / 3.0;
            sumPV += tp * candles[j].volume;
            sumV  += candles[j].volume;
        }
        out[i] = (sumV == 0.0) ? NaN : sumPV / sumV;
    }
    return out;
}

static std::vector<double> core_obv(const std::vector<Candle>& candles) {
    size_t len = candles.size();
    std::vector<double> out(len, 0.0);
    if (len == 0) return out;
    out[0] = candles[0].volume;
    for (size_t i = 1; i < len; i++) {
        if (candles[i].close > candles[i-1].close)
            out[i] = out[i-1] + candles[i].volume;
        else if (candles[i].close < candles[i-1].close)
            out[i] = out[i-1] - candles[i].volume;
        else
            out[i] = out[i-1];
    }
    return out;
}

static std::vector<double> core_cci(const std::vector<Candle>& candles, int period) {
    size_t len = candles.size();
    std::vector<double> out(len, NaN);
    for (size_t i = (size_t)(period - 1); i < len; i++) {
        std::vector<double> tps;
        tps.reserve(period);
        for (size_t j = i - period + 1; j <= i; j++) {
            tps.push_back((candles[j].high + candles[j].low + candles[j].close) / 3.0);
        }
        double sum = 0.0;
        for (double v : tps) sum += v;
        double mean = sum / period;
        double madSum = 0.0;
        for (double v : tps) madSum += std::abs(v - mean);
        double mad = madSum / period;
        out[i] = (mad == 0.0) ? 0.0 : (tps.back() - mean) / (0.015 * mad);
    }
    return out;
}

static std::vector<double> core_roc(const std::vector<double>& closes, int period) {
    size_t len = closes.size();
    std::vector<double> out(len, NaN);
    for (size_t i = (size_t)period; i < len; i++) {
        if (closes[i - period] == 0.0) continue;
        out[i] = (closes[i] - closes[i - period]) / closes[i - period] * 100.0;
    }
    return out;
}

static std::vector<double> core_cmo(const std::vector<double>& closes, int period) {
    size_t len = closes.size();
    std::vector<double> out(len, NaN);
    for (size_t i = (size_t)period; i < len; i++) {
        double up = 0.0, down = 0.0;
        for (size_t j = i - period + 1; j <= i; j++) {
            double d = closes[j] - closes[j-1];
            if (d > 0) up += d; else down -= d;
        }
        out[i] = ((up + down) == 0.0) ? 0.0 : (up - down) / (up + down) * 100.0;
    }
    return out;
}

// WMA that handles NaN inputs: if any value in window is NaN, output is NaN
static std::vector<double> core_wma_nan(const std::vector<double>& arr, int n) {
    size_t len = arr.size();
    std::vector<double> out(len, NaN);
    double denom = (double)n * (n + 1) / 2.0;
    for (size_t i = (size_t)(n - 1); i < len; i++) {
        double sum = 0.0;
        bool valid = true;
        for (int j = 0; j < n; j++) {
            if (std::isnan(arr[i - j])) { valid = false; break; }
            sum += arr[i - j] * (n - j);
        }
        if (valid) out[i] = sum / denom;
    }
    return out;
}

static std::vector<double> core_hullma(const std::vector<double>& closes, int period) {
    int half  = std::max(2, (int)std::round((double)period / 2.0));
    int sqrtn = std::max(2, (int)std::round(std::sqrt((double)period)));

    auto wHalf = core_wma_nan(closes, half);
    auto wFull = core_wma_nan(closes, period);

    size_t len = closes.size();
    std::vector<double> diff(len, NaN);
    for (size_t i = 0; i < len; i++) {
        if (!std::isnan(wHalf[i]) && !std::isnan(wFull[i])) {
            diff[i] = 2.0 * wHalf[i] - wFull[i];
        }
    }

    return core_wma_nan(diff, sqrtn);
}

struct SupertrendResult {
    std::vector<int> dir;
};

static SupertrendResult core_supertrend(const std::vector<Candle>& candles, int period, double mult) {
    size_t len = candles.size();
    std::vector<int> dir(len, 0);
    if (len == 0) return {dir};

    std::vector<double> tr(len, 0.0);
    tr[0] = candles[0].high - candles[0].low;
    for (size_t i = 1; i < len; i++) {
        double pc = candles[i-1].close;
        tr[i] = std::max({candles[i].high - candles[i].low,
                          std::abs(candles[i].high - pc),
                          std::abs(candles[i].low  - pc)});
    }

    std::vector<double> atr(len, NaN);
    double sum = 0.0;
    for (int i = 0; i < period; i++) sum += tr[i];
    atr[period - 1] = sum / period;
    for (size_t i = (size_t)period; i < len; i++) {
        atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period;
    }

    std::vector<double> upper(len, NaN), lower(len, NaN);

    for (size_t i = (size_t)(period - 1); i < len; i++) {
        double hl2 = (candles[i].high + candles[i].low) / 2.0;
        double bu = hl2 + mult * atr[i];
        double bl = hl2 - mult * atr[i];
        if (i == (size_t)(period - 1)) {
            upper[i] = bu; lower[i] = bl; dir[i] = 1;
        } else {
            upper[i] = (bu < upper[i-1] || candles[i-1].close > upper[i-1]) ? bu : upper[i-1];
            lower[i] = (bl > lower[i-1] || candles[i-1].close < lower[i-1]) ? bl : lower[i-1];
            if (dir[i-1] == -1) {
                dir[i] = candles[i].close > upper[i] ?  1 : -1;
            } else {
                dir[i] = candles[i].close < lower[i] ? -1 :  1;
            }
        }
    }

    return {dir};
}

struct KeltnerResult {
    std::vector<double> upper, lower;
};

static KeltnerResult core_keltner(const std::vector<Candle>& candles, int period, double mult) {
    size_t len = candles.size();
    std::vector<double> closes(len);
    for (size_t i = 0; i < len; i++) closes[i] = candles[i].close;

    auto emaLine = core_ema(closes, period);

    std::vector<double> tr(len, 0.0);
    tr[0] = candles[0].high - candles[0].low;
    for (size_t i = 1; i < len; i++) {
        double pc = candles[i-1].close;
        tr[i] = std::max({candles[i].high - candles[i].low,
                          std::abs(candles[i].high - pc),
                          std::abs(candles[i].low  - pc)});
    }
    auto atrLine = core_ema(tr, period);

    std::vector<double> upper(len, NaN), lower(len, NaN);
    for (size_t i = 0; i < len; i++) {
        if (!std::isnan(emaLine[i]) && !std::isnan(atrLine[i])) {
            upper[i] = emaLine[i] + mult * atrLine[i];
            lower[i] = emaLine[i] - mult * atrLine[i];
        }
    }
    return {upper, lower};
}

struct PSARResult {
    std::vector<int> dir;
};

static PSARResult core_psar(const std::vector<Candle>& candles, double step, double maxStep) {
    size_t len = candles.size();
    std::vector<int> dir(len, 0);
    if (len < 2) return {dir};

    bool bull = true;
    double sar = candles[0].low;
    double ep  = candles[0].high;
    double af  = step;
    dir[0] = 1;

    for (size_t i = 1; i < len; i++) {
        double prevSar = sar;
        double prevEp  = ep;

        if (bull) {
            sar = prevSar + af * (prevEp - prevSar);
            double minLow = candles[i-1].low;
            if (i >= 2 && candles[i-2].low < minLow) minLow = candles[i-2].low;
            sar = std::min(sar, minLow);
            if (candles[i].low < sar) {
                bull = false; sar = prevEp; ep = candles[i].low; af = step; dir[i] = -1;
            } else {
                dir[i] = 1;
                if (candles[i].high > ep) {
                    ep = candles[i].high;
                    af = std::min(af + step, maxStep);
                }
            }
        } else {
            sar = prevSar + af * (prevEp - prevSar);
            double maxHigh = candles[i-1].high;
            if (i >= 2 && candles[i-2].high > maxHigh) maxHigh = candles[i-2].high;
            sar = std::max(sar, maxHigh);
            if (candles[i].high > sar) {
                bull = true; sar = prevEp; ep = candles[i].high; af = step; dir[i] = 1;
            } else {
                dir[i] = -1;
                if (candles[i].low < ep) {
                    ep = candles[i].low;
                    af = std::min(af + step, maxStep);
                }
            }
        }
    }
    return {dir};
}

struct IchimokuResult {
    std::vector<double> tenkan, kijun;
};

static IchimokuResult core_ichimoku(const std::vector<Candle>& candles, int tenkanPer, int kijunPer) {
    size_t len = candles.size();
    std::vector<double> t(len, NaN), k(len, NaN);

    auto midPt = [&](int period, size_t i) -> double {
        double hi = -std::numeric_limits<double>::infinity();
        double lo =  std::numeric_limits<double>::infinity();
        for (size_t j = i - period + 1; j <= i; j++) {
            if (candles[j].high > hi) hi = candles[j].high;
            if (candles[j].low  < lo) lo = candles[j].low;
        }
        return (hi + lo) / 2.0;
    };

    for (size_t i = 0; i < len; i++) {
        if ((int)i >= tenkanPer - 1) t[i] = midPt(tenkanPer, i);
        if ((int)i >= kijunPer  - 1) k[i] = midPt(kijunPer,  i);
    }
    return {t, k};
}

static std::vector<double> core_trix(const std::vector<double>& closes, int period) {
    // smoothOnce: EMA over sparse (non-NaN) values
    auto smoothOnce = [&](const std::vector<double>& src) -> std::vector<double> {
        return core_ema_sparse(src, period);
    };

    auto e1 = smoothOnce(closes);
    auto e2 = smoothOnce(e1);
    auto e3 = smoothOnce(e2);

    size_t len = closes.size();
    std::vector<double> trix(len, NaN);
    for (size_t i = 1; i < len; i++) {
        if (!std::isnan(e3[i]) && !std::isnan(e3[i-1]) && e3[i-1] != 0.0) {
            trix[i] = (e3[i] - e3[i-1]) / e3[i-1] * 100.0;
        }
    }
    return trix;
}

// ---------------------------------------------------------------------------
// NAPI wrapper functions
// ---------------------------------------------------------------------------

static Napi::Value WrapSMA(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int n = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto out = core_sma(vec, n);
    return vecToJsArray(env, out);
}

static Napi::Value WrapEMA(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int n = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto out = core_ema(vec, n);
    return vecToJsArray(env, out);
}

static Napi::Value WrapRSI(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int n = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto out = core_rsi(vec, n);
    return vecToJsArray(env, out);
}

static Napi::Value WrapMACD(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int fast = info[1].As<Napi::Number>().Int32Value();
    int slow = info[2].As<Napi::Number>().Int32Value();
    int sig  = info[3].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto res = core_macd(vec, fast, slow, sig);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("macd",   vecToJsArray(env, res.macd));
    obj.Set("signal", vecToJsArray(env, res.signal));
    return obj;
}

static Napi::Value WrapBollinger(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int n       = info[1].As<Napi::Number>().Int32Value();
    double mult = info[2].As<Napi::Number>().DoubleValue();
    auto vec = jsArrayToVec(arr);
    auto res = core_bollinger(vec, n, mult);

    Napi::Array out = Napi::Array::New(env, res.size());
    for (size_t i = 0; i < res.size(); i++) {
        if (!res[i].valid) {
            out.Set(i, env.Null());
        } else {
            Napi::Object o = Napi::Object::New(env);
            o.Set("upper",  Napi::Number::New(env, res[i].upper));
            o.Set("middle", Napi::Number::New(env, res[i].middle));
            o.Set("lower",  Napi::Number::New(env, res[i].lower));
            out.Set(i, o);
        }
    }
    return out;
}

static Napi::Value WrapDonchian(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int n = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto res = core_donchian(vec, n);

    Napi::Array out = Napi::Array::New(env, res.size());
    for (size_t i = 0; i < res.size(); i++) {
        if (!res[i].valid) {
            out.Set(i, env.Null());
        } else {
            Napi::Object o = Napi::Object::New(env);
            o.Set("high", Napi::Number::New(env, res[i].high));
            o.Set("low",  Napi::Number::New(env, res[i].low));
            out.Set(i, o);
        }
    }
    return out;
}

static Napi::Value WrapStochastic(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int kPeriod = info[1].As<Napi::Number>().Int32Value();
    int dPeriod = info[2].As<Napi::Number>().Int32Value();
    auto candles = jsCandleArrayToVec(arr);
    auto res = core_stochastic(candles, kPeriod, dPeriod);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("k", vecToJsArray(env, res.k));
    obj.Set("d", vecToJsArray(env, res.d));
    return obj;
}

static Napi::Value WrapADX(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto candles = jsCandleArrayToVec(arr);
    auto res = core_adx(candles, period);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("diP", vecToJsArray(env, res.diP));
    obj.Set("diM", vecToJsArray(env, res.diM));
    obj.Set("adx", vecToJsArray(env, res.adx));
    return obj;
}

static Napi::Value WrapWilliamsR(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto candles = jsCandleArrayToVec(arr);
    auto out = core_williamsr(candles, period);
    return vecToJsArray(env, out);
}

static Napi::Value WrapVWAP(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto candles = jsCandleArrayToVec(arr);
    auto out = core_vwap(candles, period);
    return vecToJsArray(env, out);
}

static Napi::Value WrapOBV(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    auto candles = jsCandleArrayToVec(arr);
    auto out = core_obv(candles);
    return vecToJsArray(env, out);
}

static Napi::Value WrapCCI(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto candles = jsCandleArrayToVec(arr);
    auto out = core_cci(candles, period);
    return vecToJsArray(env, out);
}

static Napi::Value WrapROC(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto out = core_roc(vec, period);
    return vecToJsArray(env, out);
}

static Napi::Value WrapCMO(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto out = core_cmo(vec, period);
    return vecToJsArray(env, out);
}

static Napi::Value WrapTRIX(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto out = core_trix(vec, period);
    return vecToJsArray(env, out);
}

static Napi::Value WrapHullMA(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period = info[1].As<Napi::Number>().Int32Value();
    auto vec = jsArrayToVec(arr);
    auto out = core_hullma(vec, period);
    return vecToJsArray(env, out);
}

static Napi::Value WrapSupertrend(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period    = info[1].As<Napi::Number>().Int32Value();
    double mult   = info[2].As<Napi::Number>().DoubleValue();
    auto candles = jsCandleArrayToVec(arr);
    auto res = core_supertrend(candles, period, mult);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("dir", intVecToJsArray(env, res.dir));
    return obj;
}

static Napi::Value WrapKeltner(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int period  = info[1].As<Napi::Number>().Int32Value();
    double mult = info[2].As<Napi::Number>().DoubleValue();
    auto candles = jsCandleArrayToVec(arr);
    auto res = core_keltner(candles, period, mult);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("upper", vecToJsArray(env, res.upper));
    obj.Set("lower", vecToJsArray(env, res.lower));
    return obj;
}

static Napi::Value WrapPSAR(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    double step    = info[1].As<Napi::Number>().DoubleValue();
    double maxStep = info[2].As<Napi::Number>().DoubleValue();
    auto candles = jsCandleArrayToVec(arr);
    auto res = core_psar(candles, step, maxStep);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("dir", intVecToJsArray(env, res.dir));
    return obj;
}

static Napi::Value WrapIchimoku(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array arr = info[0].As<Napi::Array>();
    int tenkan = info[1].As<Napi::Number>().Int32Value();
    int kijun  = info[2].As<Napi::Number>().Int32Value();
    auto candles = jsCandleArrayToVec(arr);
    auto res = core_ichimoku(candles, tenkan, kijun);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("tenkan", vecToJsArray(env, res.tenkan));
    obj.Set("kijun",  vecToJsArray(env, res.kijun));
    return obj;
}

// ---------------------------------------------------------------------------
// Module init
// ---------------------------------------------------------------------------

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("sma",         Napi::Function::New(env, WrapSMA));
    exports.Set("ema",         Napi::Function::New(env, WrapEMA));
    exports.Set("rsi",         Napi::Function::New(env, WrapRSI));
    exports.Set("macd",        Napi::Function::New(env, WrapMACD));
    exports.Set("bollinger",   Napi::Function::New(env, WrapBollinger));
    exports.Set("donchian",    Napi::Function::New(env, WrapDonchian));
    exports.Set("stochastic",  Napi::Function::New(env, WrapStochastic));
    exports.Set("adx",         Napi::Function::New(env, WrapADX));
    exports.Set("williamsr",   Napi::Function::New(env, WrapWilliamsR));
    exports.Set("vwap",        Napi::Function::New(env, WrapVWAP));
    exports.Set("obv",         Napi::Function::New(env, WrapOBV));
    exports.Set("cci",         Napi::Function::New(env, WrapCCI));
    exports.Set("roc",         Napi::Function::New(env, WrapROC));
    exports.Set("cmo",         Napi::Function::New(env, WrapCMO));
    exports.Set("trix",        Napi::Function::New(env, WrapTRIX));
    exports.Set("hullma",      Napi::Function::New(env, WrapHullMA));
    exports.Set("supertrend",  Napi::Function::New(env, WrapSupertrend));
    exports.Set("keltner",     Napi::Function::New(env, WrapKeltner));
    exports.Set("psar",        Napi::Function::New(env, WrapPSAR));
    exports.Set("ichimoku",    Napi::Function::New(env, WrapIchimoku));
    return exports;
}

NODE_API_MODULE(caloogy_indicators, Init)
