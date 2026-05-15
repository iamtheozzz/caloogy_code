'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const DB_DIR  = path.join(os.homedir(), '.caloogy');
const DB_PATH = path.join(DB_DIR, 'market.duckdb');

let _db = null;

function getDB() {
    if (_db) return _db;
    fs.mkdirSync(DB_DIR, { recursive: true });
    const duckdb = require('duckdb');
    _db = new duckdb.Database(DB_PATH);
    _ensureSchema();
    return _db;
}

function _run(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDB().run(sql, ...params, err => err ? reject(err) : resolve());
    });
}

function _normRow(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
}

function _all(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDB().all(sql, ...params, (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).map(_normRow));
        });
    });
}

function _ensureSchema() {
    const db = getDB();
    db.run(`CREATE TABLE IF NOT EXISTS candles (
        symbol   VARCHAR NOT NULL,
        interval VARCHAR NOT NULL,
        source   VARCHAR NOT NULL DEFAULT 'api',
        ts       BIGINT  NOT NULL,
        open     DOUBLE  NOT NULL,
        high     DOUBLE  NOT NULL,
        low      DOUBLE  NOT NULL,
        close    DOUBLE  NOT NULL,
        volume   DOUBLE  NOT NULL,
        PRIMARY KEY (symbol, interval, ts)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sync_meta (
        symbol    VARCHAR NOT NULL,
        interval  VARCHAR NOT NULL,
        source    VARCHAR NOT NULL DEFAULT 'api',
        first_ts  BIGINT  NOT NULL,
        last_ts   BIGINT  NOT NULL,
        row_count INTEGER NOT NULL,
        synced_at BIGINT  NOT NULL,
        PRIMARY KEY (symbol, interval)
    )`);
}

async function upsertCandles(symbol, interval, candles, source = 'api') {
    if (!candles || !candles.length) return 0;
    const db   = getDB();
    const stmt = `INSERT OR REPLACE INTO candles
        (symbol, interval, source, ts, open, high, low, close, volume)
        VALUES (?,?,?,?,?,?,?,?,?)`;
    let written = 0;
    for (const c of candles) {
        if (c.close == null) continue;
        await new Promise((resolve, reject) => {
            db.run(stmt, symbol, interval, source, c.ts, c.open, c.high, c.low, c.close, c.volume || 0,
                err => err ? reject(err) : resolve());
        });
        written++;
    }
    // update sync_meta
    const tsList = candles.filter(c => c.close != null).map(c => c.ts);
    if (tsList.length) {
        const firstTs = Math.min(...tsList);
        const lastTs  = Math.max(...tsList);
        await new Promise((resolve, reject) => {
            db.run(`INSERT OR REPLACE INTO sync_meta
                (symbol, interval, source, first_ts, last_ts, row_count, synced_at) VALUES (?,?,?,?,?,?,?)`,
                symbol, interval, source, firstTs, lastTs, written, Date.now(),
                err => err ? reject(err) : resolve());
        });
    }
    return written;
}

async function queryCandles(symbol, interval, limit = 300, since_ts = null) {
    let sql  = `SELECT ts,open,high,low,close,volume FROM candles
                WHERE symbol=? AND interval=?`;
    const params = [symbol, interval];
    if (since_ts != null) { sql += ' AND ts > ?'; params.push(since_ts); }
    sql += ' ORDER BY ts DESC LIMIT ?';
    params.push(limit);
    const rows = await _all(sql, params);
    return rows.reverse();
}

async function getLastTs(symbol, interval) {
    const rows = await _all(
        `SELECT last_ts FROM sync_meta WHERE symbol=? AND interval=?`,
        [symbol, interval]);
    return rows.length ? rows[0].last_ts : null;
}

async function listSyncMeta() {
    return _all(`SELECT symbol, interval, source, first_ts, last_ts, row_count, synced_at
                 FROM sync_meta ORDER BY symbol, interval`);
}

async function deleteSymbol(symbol, interval) {
    await _run(`DELETE FROM candles WHERE symbol=? AND interval=?`, [symbol, interval]);
    await _run(`DELETE FROM sync_meta WHERE symbol=? AND interval=?`, [symbol, interval]);
}

async function exportCSV(symbol, interval) {
    const rows = await _all(
        `SELECT ts,open,high,low,close,volume FROM candles
         WHERE symbol=? AND interval=? ORDER BY ts`,
        [symbol, interval]);
    if (!rows.length) return '';
    const header = 'ts,open,high,low,close,volume';
    const lines  = rows.map(r =>
        `${r.ts},${r.open},${r.high},${r.low},${r.close},${r.volume}`);
    return [header, ...lines].join('\n');
}

async function runQuery(sql, maxRows = 200) {
    // Limit result set size to prevent huge responses
    const rows = await _all(sql);
    return rows.slice(0, maxRows);
}

function dbFileSize() {
    try {
        const stat = fs.statSync(DB_PATH);
        const mb   = stat.size / 1024 / 1024;
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
    } catch { return '0 KB'; }
}

module.exports = { DB_PATH, DB_DIR, getDB, upsertCandles, queryCandles, getLastTs,
                   listSyncMeta, deleteSymbol, exportCSV, runQuery, dbFileSize };
