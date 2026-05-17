#include <napi.h>
#include <string>
#include <vector>
#include <sstream>
#include <stdexcept>
#include <cmath>
#include <cstring>
#include <algorithm>
#include <ctime>
#include <cctype>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static std::string trimStr(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

static std::string toLower(const std::string& s) {
    std::string out = s;
    for (char& c : out) c = (char)std::tolower((unsigned char)c);
    return out;
}

static std::string removeQuotes(const std::string& s) {
    std::string out = s;
    // remove leading quote
    if (!out.empty() && (out.front() == '"' || out.front() == '\'')) out.erase(out.begin());
    // remove trailing quote
    if (!out.empty() && (out.back()  == '"' || out.back()  == '\'')) out.pop_back();
    return out;
}

static bool isAllDigits(const std::string& s) {
    for (char c : s) if (!std::isdigit((unsigned char)c)) return false;
    return true;
}

// Parse timestamp: 13 digits = unix ms, 10 digits = unix s, else ISO date
static bool parseTimestamp(const std::string& raw, int64_t& out) {
    if (raw.empty()) return false;
    std::string s = trimStr(raw);
    if (s.empty()) return false;

    if (isAllDigits(s) && s.size() == 13) {
        try { out = std::stoll(s); return true; } catch (...) { return false; }
    }
    if (isAllDigits(s) && s.size() == 10) {
        try { out = std::stoll(s) * 1000LL; return true; } catch (...) { return false; }
    }

    // Replace YYYY/MM/DD -> YYYY-MM-DD
    std::string ds = s;
    // pattern: 4 digits / 2 digits / 2 digits at start
    if (ds.size() >= 10 && std::isdigit((unsigned char)ds[0]) && ds[4] == '/') {
        ds[4] = '-';
        if (ds.size() >= 7 && ds[7] == '/') ds[7] = '-';
    }

    // Try parsing with strptime
    struct tm t;
    memset(&t, 0, sizeof(t));
    t.tm_isdst = 0;

    // Try several formats
    const char* formats[] = {
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        nullptr
    };

    bool parsed = false;
    for (int fi = 0; formats[fi] != nullptr; fi++) {
        memset(&t, 0, sizeof(t));
        t.tm_isdst = 0;
        const char* ret = strptime(ds.c_str(), formats[fi], &t);
        if (ret != nullptr) {
            parsed = true;
            break;
        }
    }

    if (!parsed) return false;

    // Convert UTC to epoch seconds using timegm (POSIX, available on macOS/Linux)
#if defined(_WIN32)
    time_t epoch = _mkgmtime(&t);
#else
    time_t epoch = timegm(&t);
#endif
    if (epoch == (time_t)-1) return false;
    out = (int64_t)epoch * 1000LL;
    return true;
}

static std::vector<std::string> splitLine(const std::string& line, char delim = ',') {
    std::vector<std::string> cells;
    std::string cur;
    for (char c : line) {
        if (c == delim) {
            cells.push_back(cur);
            cur.clear();
        } else {
            cur += c;
        }
    }
    cells.push_back(cur);
    return cells;
}

// Normalize line endings and split into lines
static std::vector<std::string> splitLines(const std::string& text) {
    // Normalize \r\n and \r to \n
    std::string normalized;
    normalized.reserve(text.size());
    for (size_t i = 0; i < text.size(); i++) {
        if (text[i] == '\r') {
            normalized += '\n';
            if (i + 1 < text.size() && text[i+1] == '\n') i++;
        } else {
            normalized += text[i];
        }
    }

    std::vector<std::string> lines;
    std::istringstream ss(normalized);
    std::string line;
    while (std::getline(ss, line)) {
        line = trimStr(line);
        if (!line.empty()) lines.push_back(line);
    }
    return lines;
}

static int findCol(const std::vector<std::string>& headers, const std::vector<std::string>& names) {
    for (const auto& name : names) {
        for (int i = 0; i < (int)headers.size(); i++) {
            if (headers[i] == name) return i;
        }
    }
    return -1;
}

struct Candle {
    int64_t ts;
    double open, high, low, close, volume;
};

struct ParseResult {
    std::vector<Candle> candles;
    int skipped;
    int ohlcViolations;
    std::vector<std::string> errors;
    std::vector<std::string> warnings;
};

static ParseResult doParseCSV(const std::string& text) {
    ParseResult result;
    result.skipped = 0;
    result.ohlcViolations = 0;

    auto lines = splitLines(text);
    if (lines.size() < 2) {
        throw std::runtime_error("CSV must have a header row and at least one data row.");
    }

    // Parse header
    auto rawHeaders = splitLine(lines[0]);
    std::vector<std::string> headers;
    for (auto& h : rawHeaders) {
        std::string cleaned = trimStr(h);
        // Remove quotes from header
        if (!cleaned.empty() && (cleaned.front() == '"' || cleaned.front() == '\'')) cleaned.erase(cleaned.begin());
        if (!cleaned.empty() && (cleaned.back()  == '"' || cleaned.back()  == '\'')) cleaned.pop_back();
        headers.push_back(toLower(cleaned));
    }

    int dateIdx   = findCol(headers, {"date","datetime","timestamp","time","ts"});
    int openIdx   = findCol(headers, {"open","o"});
    int highIdx   = findCol(headers, {"high","h"});
    int lowIdx    = findCol(headers, {"low","l"});
    int closeIdx  = findCol(headers, {"close","c","price"});
    int volumeIdx = findCol(headers, {"volume","vol","v"});

    if (dateIdx < 0)
        throw std::runtime_error("Cannot detect date column. Rename a column to date/datetime/timestamp and retry.");
    if (closeIdx < 0)
        throw std::runtime_error("Cannot detect close column. Rename a column to close/price and retry.");

    for (size_t i = 1; i < lines.size(); i++) {
        auto rawCells = splitLine(lines[i]);

        // Trim and remove surrounding quotes from each cell
        std::vector<std::string> cells;
        for (auto& c : rawCells) {
            cells.push_back(removeQuotes(trimStr(c)));
        }

        // Parse timestamp
        int64_t ts = 0;
        std::string dateCell = (dateIdx < (int)cells.size()) ? cells[dateIdx] : "";
        if (!parseTimestamp(dateCell, ts)) {
            result.skipped++;
            continue;
        }

        // Parse close
        std::string closeCell = (closeIdx < (int)cells.size()) ? cells[closeIdx] : "";
        double close = 0.0;
        try { close = std::stod(closeCell); } catch (...) { close = std::numeric_limits<double>::quiet_NaN(); }
        if (std::isnan(close)) {
            result.skipped++;
            continue;
        }

        // Parse open
        double open = close;
        if (openIdx >= 0 && openIdx < (int)cells.size()) {
            try {
                double v = std::stod(cells[openIdx]);
                if (!std::isnan(v) && v != 0.0) open = v;
            } catch (...) {}
        }

        // Parse high
        double high = close;
        if (highIdx >= 0 && highIdx < (int)cells.size()) {
            try {
                double v = std::stod(cells[highIdx]);
                if (!std::isnan(v) && v != 0.0) high = v;
            } catch (...) {}
        }

        // Parse low
        double low = close;
        if (lowIdx >= 0 && lowIdx < (int)cells.size()) {
            try {
                double v = std::stod(cells[lowIdx]);
                if (!std::isnan(v) && v != 0.0) low = v;
            } catch (...) {}
        }

        // Parse volume
        double volume = 0.0;
        if (volumeIdx >= 0 && volumeIdx < (int)cells.size()) {
            try {
                double v = std::stod(cells[volumeIdx]);
                if (!std::isnan(v) && v != 0.0) volume = v;
            } catch (...) {}
        }

        // OHLC validation
        if (high < low) {
            result.ohlcViolations++;
            result.errors.push_back(
                "Row " + std::to_string(i + 1) + ": high(" + std::to_string(high) + ") < low(" + std::to_string(low) + ")"
            );
        }

        result.candles.push_back({ts, open, high, low, close, volume});
    }

    // Check ordering
    int outOfOrder = 0;
    for (size_t i = 1; i < result.candles.size(); i++) {
        if (result.candles[i].ts <= result.candles[i-1].ts) outOfOrder++;
    }
    if (outOfOrder > 0) {
        result.warnings.push_back(
            std::to_string(outOfOrder) + " out-of-order timestamp(s) detected (auto-sorted)"
        );
        std::stable_sort(result.candles.begin(), result.candles.end(),
            [](const Candle& a, const Candle& b) { return a.ts < b.ts; });
    }

    return result;
}

// ---------------------------------------------------------------------------
// NAPI wrapper
// ---------------------------------------------------------------------------

static Napi::Value WrapParseCSV(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected a string argument").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string text = info[0].As<Napi::String>().Utf8Value();

    ParseResult res;
    try {
        res = doParseCSV(text);
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Build candles array
    Napi::Array candlesArr = Napi::Array::New(env, res.candles.size());
    for (size_t i = 0; i < res.candles.size(); i++) {
        const Candle& c = res.candles[i];
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("ts",     Napi::Number::New(env, (double)c.ts));
        obj.Set("open",   Napi::Number::New(env, c.open));
        obj.Set("high",   Napi::Number::New(env, c.high));
        obj.Set("low",    Napi::Number::New(env, c.low));
        obj.Set("close",  Napi::Number::New(env, c.close));
        obj.Set("volume", Napi::Number::New(env, c.volume));
        candlesArr.Set(i, obj);
    }

    // Build errors array
    Napi::Array errorsArr = Napi::Array::New(env, res.errors.size());
    for (size_t i = 0; i < res.errors.size(); i++) {
        errorsArr.Set(i, Napi::String::New(env, res.errors[i]));
    }

    // Build warnings array
    Napi::Array warningsArr = Napi::Array::New(env, res.warnings.size());
    for (size_t i = 0; i < res.warnings.size(); i++) {
        warningsArr.Set(i, Napi::String::New(env, res.warnings[i]));
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("candles",        candlesArr);
    result.Set("skipped",        Napi::Number::New(env, res.skipped));
    result.Set("ohlcViolations", Napi::Number::New(env, res.ohlcViolations));
    result.Set("errors",         errorsArr);
    result.Set("warnings",       warningsArr);
    return result;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("parseCSV", Napi::Function::New(env, WrapParseCSV));
    return exports;
}

NODE_API_MODULE(caloogy_csv, Init)
