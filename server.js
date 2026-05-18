'use strict';

const express = require('express');
const path    = require('path');
const net     = require('net');

// ── C++ native addons (optional — graceful JS fallback if not built) ──────────
let _ind = null, _csv = null;
try { _ind = require('./build/Release/caloogy_indicators.node'); } catch {}
try { _csv = require('./build/Release/caloogy_csv.node');        } catch {}

// ── Server-side backtest engine (uses C++ indicators when available) ──────────

function _indSma(arr, n) {
    if (_ind) return _ind.sma(arr, n);
    const out = new Array(arr.length).fill(null);
    for (let i = n - 1; i < arr.length; i++) {
        let s = 0; for (let j = 0; j < n; j++) s += arr[i - j]; out[i] = s / n;
    }
    return out;
}
function _indEma(arr, n) {
    if (_ind) return _ind.ema(arr, n);
    const k = 2 / (n + 1), out = new Array(arr.length).fill(null);
    let prev = null;
    for (let i = 0; i < arr.length; i++) {
        if (i < n - 1) continue;
        if (prev === null) { let s = 0; for (let j = 0; j < n; j++) s += arr[i - j]; prev = s / n; }
        else prev = arr[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}
function _indRsi(arr, n) {
    if (_ind) return _ind.rsi(arr, n);
    const out = new Array(arr.length).fill(null);
    let ag = 0, al = 0;
    for (let i = 1; i <= n; i++) { const d = arr[i] - arr[i-1]; if (d > 0) ag += d; else al -= d; }
    ag /= n; al /= n;
    for (let i = n; i < arr.length; i++) {
        if (i > n) { const d = arr[i]-arr[i-1]; ag=(ag*(n-1)+Math.max(d,0))/n; al=(al*(n-1)+Math.max(-d,0))/n; }
        out[i] = 100 - 100 / (1 + (al === 0 ? 1e9 : ag / al));
    }
    return out;
}
function _indMacd(closes, fast, slow, sig) {
    if (_ind) return _ind.macd(closes, fast, slow, sig);
    const fE = _indEma(closes, fast), sE = _indEma(closes, slow);
    const ml = closes.map((_, i) => fE[i] != null && sE[i] != null ? fE[i] - sE[i] : null);
    const sl = new Array(closes.length).fill(null);
    const k = 2 / (sig + 1); let prev = null, cnt = 0;
    for (let i = 0; i < closes.length; i++) {
        if (ml[i] == null) continue; cnt++;
        prev = prev == null ? ml[i] : ml[i] * k + prev * (1 - k);
        if (cnt >= sig) sl[i] = prev;
    }
    return { macd: ml, signal: sl };
}
function _indBoll(arr, n, mult) {
    if (_ind) return _ind.bollinger(arr, n, mult);
    const out = new Array(arr.length).fill(null);
    for (let i = n - 1; i < arr.length; i++) {
        let sum = 0; for (let j = 0; j < n; j++) sum += arr[i-j]; const mean = sum / n;
        let vs = 0; for (let j = 0; j < n; j++) vs += (arr[i-j]-mean)**2;
        const std = Math.sqrt(vs / n);
        out[i] = { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
    }
    return out;
}
function _indDonch(closes, n) {
    if (_ind) return _ind.donchian(closes, n);
    const out = new Array(closes.length).fill(null);
    for (let i = n; i < closes.length; i++) {
        let hi = -Infinity, lo = Infinity;
        for (let j = i-n; j < i; j++) { if (closes[j] > hi) hi = closes[j]; if (closes[j] < lo) lo = closes[j]; }
        out[i] = { high: hi, low: lo };
    }
    return out;
}
function _indStoch(candles, kP, dP) {
    if (_ind) return _ind.stochastic(candles, kP, dP);
    const k = new Array(candles.length).fill(null);
    for (let i = kP-1; i < candles.length; i++) {
        let hi = -Infinity, lo = Infinity;
        for (let j = i-kP+1; j <= i; j++) { if (candles[j].high > hi) hi=candles[j].high; if (candles[j].low < lo) lo=candles[j].low; }
        k[i] = hi === lo ? 50 : (candles[i].close - lo) / (hi - lo) * 100;
    }
    const d = new Array(candles.length).fill(null);
    for (let i = kP+dP-2; i < candles.length; i++) {
        let sum = 0, ok = true;
        for (let j = i-dP+1; j <= i; j++) { if (k[j] == null) { ok=false; break; } sum += k[j]; }
        if (ok) d[i] = sum / dP;
    }
    return { k, d };
}
function _indSupertrend(candles, period, mult) {
    if (_ind) return _ind.supertrend(candles, period, mult);
    const tr = candles.map((c,i) => { if (!i) return c.high-c.low; const pc=candles[i-1].close; return Math.max(c.high-c.low,Math.abs(c.high-pc),Math.abs(c.low-pc)); });
    const atr = new Array(candles.length).fill(null);
    let sum = 0; for (let i = 0; i < period; i++) sum += tr[i]; atr[period-1] = sum/period;
    for (let i = period; i < candles.length; i++) atr[i] = (atr[i-1]*(period-1)+tr[i])/period;
    const upper=new Array(candles.length).fill(null), lower=new Array(candles.length).fill(null), dir=new Array(candles.length).fill(0);
    for (let i = period-1; i < candles.length; i++) {
        const hl2=(candles[i].high+candles[i].low)/2, bu=hl2+mult*atr[i], bl=hl2-mult*atr[i];
        if (i===period-1) { upper[i]=bu; lower[i]=bl; dir[i]=1; }
        else {
            upper[i]=(bu<upper[i-1]||candles[i-1].close>upper[i-1])?bu:upper[i-1];
            lower[i]=(bl>lower[i-1]||candles[i-1].close<lower[i-1])?bl:lower[i-1];
            if (dir[i-1]===-1) dir[i]=candles[i].close>upper[i]?1:-1;
            else dir[i]=candles[i].close<lower[i]?-1:1;
        }
    }
    return { dir };
}
function _indCCI(candles, period) {
    if (_ind) return _ind.cci(candles, period);
    const out = new Array(candles.length).fill(null);
    for (let i = period-1; i < candles.length; i++) {
        const tps = []; for (let j=i-period+1; j<=i; j++) tps.push((candles[j].high+candles[j].low+candles[j].close)/3);
        const mean = tps.reduce((a,b)=>a+b,0)/period;
        const mad  = tps.reduce((a,b)=>a+Math.abs(b-mean),0)/period;
        out[i] = mad===0?0:(tps[tps.length-1]-mean)/(0.015*mad);
    }
    return out;
}
function _indROC(closes, period) {
    if (_ind) return _ind.roc(closes, period);
    return closes.map((c,i) => i<period||closes[i-period]===0?null:(c-closes[i-period])/closes[i-period]*100);
}
function _indIchimoku(candles, tenkan, kijun) {
    if (_ind) return _ind.ichimoku(candles, tenkan, kijun);
    function mid(arr, p, i) { let hi=-Infinity, lo=Infinity; for (let j=i-p+1;j<=i;j++){if(arr[j].high>hi)hi=arr[j].high;if(arr[j].low<lo)lo=arr[j].low;} return (hi+lo)/2; }
    const t=new Array(candles.length).fill(null), k=new Array(candles.length).fill(null);
    for (let i=0;i<candles.length;i++){if(i>=tenkan-1)t[i]=mid(candles,tenkan,i);if(i>=kijun-1)k[i]=mid(candles,kijun,i);}
    return { tenkan:t, kijun:k };
}
function _indPSAR(candles, step, maxStep) {
    if (_ind) return _ind.psar(candles, step, maxStep);
    const dir=new Array(candles.length).fill(0); if (candles.length<2) return {dir};
    let bull=true, sar=candles[0].low, ep=candles[0].high, af=step; dir[0]=1;
    for (let i=1;i<candles.length;i++){
        const pSar=sar, pEp=ep;
        if(bull){sar=pSar+af*(pEp-pSar);sar=Math.min(sar,candles[i-1].low,i>=2?candles[i-2].low:candles[i-1].low);if(candles[i].low<sar){bull=false;sar=pEp;ep=candles[i].low;af=step;dir[i]=-1;}else{dir[i]=1;if(candles[i].high>ep){ep=candles[i].high;af=Math.min(af+step,maxStep);}}}
        else{sar=pSar+af*(pEp-pSar);sar=Math.max(sar,candles[i-1].high,i>=2?candles[i-2].high:candles[i-1].high);if(candles[i].high>sar){bull=true;sar=pEp;ep=candles[i].high;af=step;dir[i]=1;}else{dir[i]=-1;if(candles[i].low<ep){ep=candles[i].low;af=Math.min(af+step,maxStep);}}}
    }
    return { dir };
}
function _indWilliamsR(candles, period) {
    if (_ind) return _ind.williamsr(candles, period);
    const out=new Array(candles.length).fill(null);
    for (let i=period-1;i<candles.length;i++){let hi=-Infinity,lo=Infinity;for(let j=i-period+1;j<=i;j++){if(candles[j].high>hi)hi=candles[j].high;if(candles[j].low<lo)lo=candles[j].low;}out[i]=hi===lo?-50:(hi-candles[i].close)/(hi-lo)*-100;}
    return out;
}
function _indADX(candles, period) {
    if (_ind) return _ind.adx(candles, period);
    const n=candles.length, tr=new Array(n).fill(0), dmP=new Array(n).fill(0), dmM=new Array(n).fill(0);
    for (let i=1;i<n;i++){const hd=candles[i].high-candles[i-1].high,ld=candles[i-1].low-candles[i].low,pc=candles[i-1].close;tr[i]=Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-pc),Math.abs(candles[i].low-pc));dmP[i]=hd>ld&&hd>0?hd:0;dmM[i]=ld>hd&&ld>0?ld:0;}
    function ws(arr){const out=new Array(n).fill(null);let sum=0;for(let i=1;i<=period;i++)sum+=arr[i];out[period]=sum;for(let i=period+1;i<n;i++)out[i]=out[i-1]-out[i-1]/period+arr[i];return out;}
    const sTR=ws(tr),sDMp=ws(dmP),sDMm=ws(dmM),diP=new Array(n).fill(null),diM=new Array(n).fill(null),dx=new Array(n).fill(null);
    for(let i=period;i<n;i++){if(!sTR[i])continue;diP[i]=sDMp[i]/sTR[i]*100;diM[i]=sDMm[i]/sTR[i]*100;const s=diP[i]+diM[i];dx[i]=s===0?0:Math.abs(diP[i]-diM[i])/s*100;}
    const adxOut=new Array(n).fill(null),dxV=[],dxI=[];
    for(let i=0;i<n;i++){if(dx[i]!==null){dxV.push(dx[i]);dxI.push(i);}}
    if(dxV.length>=period){let s2=0;for(let i=0;i<period;i++)s2+=dxV[i];adxOut[dxI[period-1]]=s2/period;for(let i=period;i<dxV.length;i++)adxOut[dxI[i]]=(adxOut[dxI[i-1]]*(period-1)+dxV[i])/period;}
    return {diP,diM,adx:adxOut};
}
function _indKeltner(candles, period, mult) {
    if (_ind) return _ind.keltner(candles, period, mult);
    const closes=candles.map(c=>c.close),em=_indEma(closes,period);
    const tr=candles.map((c,i)=>!i?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)));
    const atr=_indEma(tr,period),upper=new Array(candles.length).fill(null),lower=new Array(candles.length).fill(null);
    for(let i=0;i<candles.length;i++){if(em[i]!=null&&atr[i]!=null){upper[i]=em[i]+mult*atr[i];lower[i]=em[i]-mult*atr[i];}}
    return {upper,lower};
}
function _indTRIX(closes, period) {
    if (_ind) return _ind.trix(closes, period);
    const k=2/(period+1);
    function sm(src){const out=new Array(src.length).fill(null),vs=[],is=[];for(let i=0;i<src.length;i++){if(src[i]!=null){vs.push(src[i]);is.push(i);}}if(vs.length<period)return out;let sum=0;for(let i=0;i<period;i++)sum+=vs[i];let prev=sum/period;out[is[period-1]]=prev;for(let i=period;i<vs.length;i++){prev=vs[i]*k+prev*(1-k);out[is[i]]=prev;}return out;}
    const e3=sm(sm(sm(closes))),trix=new Array(closes.length).fill(null);
    for(let i=1;i<closes.length;i++){if(e3[i]!=null&&e3[i-1]!=null&&e3[i-1]!==0)trix[i]=(e3[i]-e3[i-1])/e3[i-1]*100;}
    return trix;
}
function _indCMO(closes, period) {
    if (_ind) return _ind.cmo(closes, period);
    const out=new Array(closes.length).fill(null);
    for(let i=period;i<closes.length;i++){let up=0,dn=0;for(let j=i-period+1;j<=i;j++){const d=closes[j]-closes[j-1];if(d>0)up+=d;else dn-=d;}out[i]=(up+dn)===0?0:(up-dn)/(up+dn)*100;}
    return out;
}
function _indHullMA(closes, period) {
    if (_ind) return _ind.hullma(closes, period);
    function wma(arr,n){const den=n*(n+1)/2,out=new Array(arr.length).fill(null);for(let i=n-1;i<arr.length;i++){let sum=0,ok=true;for(let j=0;j<n;j++){if(arr[i-j]==null){ok=false;break;}sum+=arr[i-j]*(n-j);}if(ok)out[i]=sum/den;}return out;}
    const h=Math.max(2,Math.round(period/2)),sq=Math.max(2,Math.round(Math.sqrt(period)));
    const wH=wma(closes,h),wF=wma(closes,period),diff=closes.map((_,i)=>wH[i]!=null&&wF[i]!=null?2*wH[i]-wF[i]:null);
    return wma(diff,sq);
}
function _indOBV(candles) {
    if (_ind) return _ind.obv(candles);
    const out=new Array(candles.length).fill(0);out[0]=candles[0].volume;
    for(let i=1;i<candles.length;i++){if(candles[i].close>candles[i-1].close)out[i]=out[i-1]+candles[i].volume;else if(candles[i].close<candles[i-1].close)out[i]=out[i-1]-candles[i].volume;else out[i]=out[i-1];}
    return out;
}
function _indVWAP(candles, period) {
    if (_ind) return _ind.vwap(candles, period);
    const out=new Array(candles.length).fill(null);
    for(let i=period-1;i<candles.length;i++){let spv=0,sv=0;for(let j=i-period+1;j<=i;j++){const tp=(candles[j].high+candles[j].low+candles[j].close)/3;spv+=tp*candles[j].volume;sv+=candles[j].volume;}out[i]=sv===0?null:spv/sv;}
    return out;
}
function _indMeanRevSma(closes,period){return _indSma(closes,period);}

function _runBacktest(candles, strategy, params) {
    const closes = candles.map(c => c.close);
    const times  = candles.map(c => Math.floor(c.ts / 1000));
    const sigs   = new Array(candles.length).fill(null);

    switch (strategy) {
        case 'ma_cross': {
            const {fast=9,slow=21}=params;
            const fl=_indEma(closes,fast),sl=_indEma(closes,slow);
            for(let i=1;i<candles.length;i++){if(fl[i]==null||fl[i-1]==null||sl[i]==null)continue;if(fl[i]>sl[i]&&fl[i-1]<=sl[i-1])sigs[i]='buy';else if(fl[i]<sl[i]&&fl[i-1]>=sl[i-1])sigs[i]='sell';}
            break;
        }
        case 'rsi_bands': {
            const {ob=70,os=30}=params;
            const rv=_indRsi(closes,14);
            for(let i=1;i<candles.length;i++){if(rv[i]==null||rv[i-1]==null)continue;if(rv[i-1]<=os&&rv[i]>os)sigs[i]='buy';else if(rv[i-1]>=ob&&rv[i]<ob)sigs[i]='sell';}
            break;
        }
        case 'bb_bounce': {
            const {period=20}=params;
            const bb=_indBoll(closes,period,2.0);
            for(let i=1;i<candles.length;i++){if(!bb[i]||!bb[i-1])continue;if(closes[i-1]<bb[i-1].lower&&closes[i]>=bb[i].lower)sigs[i]='buy';else if(closes[i-1]<bb[i-1].upper&&closes[i]>=bb[i].upper)sigs[i]='sell';}
            break;
        }
        case 'macd': {
            const {fast=12,slow=26,sig=9}=params;
            const md=_indMacd(closes,fast,slow,sig);
            for(let i=1;i<candles.length;i++){if(md.macd[i]==null||md.signal[i]==null||md.macd[i-1]==null||md.signal[i-1]==null)continue;if(md.macd[i]>md.signal[i]&&md.macd[i-1]<=md.signal[i-1])sigs[i]='buy';else if(md.macd[i]<md.signal[i]&&md.macd[i-1]>=md.signal[i-1])sigs[i]='sell';}
            break;
        }
        case 'donchian': {
            const {period=20}=params;
            const dc=_indDonch(closes,period);
            for(let i=1;i<candles.length;i++){if(!dc[i])continue;if(closes[i]>dc[i].high)sigs[i]='buy';else if(closes[i]<dc[i].low)sigs[i]='sell';}
            break;
        }
        case 'mean_rev': {
            const {period=20,dev=0.02}=params;
            const ms=_indMeanRevSma(closes,period);
            for(let i=1;i<candles.length;i++){if(ms[i]==null||ms[i-1]==null)continue;const d=(closes[i]-ms[i])/ms[i],pd=(closes[i-1]-ms[i-1])/ms[i-1];if(pd<-dev&&d>=-dev)sigs[i]='buy';else if(pd<0&&d>=0)sigs[i]='sell';}
            break;
        }
        case 'stoch': {
            const {k:kP=14,d:dP=3,ob=80,os=20}=params;
            const st=_indStoch(candles,kP,dP);
            for(let i=1;i<candles.length;i++){if(st.k[i]==null||st.k[i-1]==null)continue;if(st.k[i-1]<=os&&st.k[i]>os)sigs[i]='buy';else if(st.k[i-1]>=ob&&st.k[i]<ob)sigs[i]='sell';}
            break;
        }
        case 'supertrend': {
            const {period=10,mult=3}=params;
            const sv=_indSupertrend(candles,period,mult);
            for(let i=1;i<candles.length;i++){if(sv.dir[i]===0||sv.dir[i-1]===0)continue;if(sv.dir[i-1]!==1&&sv.dir[i]===1)sigs[i]='buy';else if(sv.dir[i-1]!==-1&&sv.dir[i]===-1)sigs[i]='sell';}
            break;
        }
        case 'cci': {
            const {period=20,thresh=100}=params;
            const cv=_indCCI(candles,period);
            for(let i=1;i<candles.length;i++){if(cv[i]==null||cv[i-1]==null)continue;if(cv[i-1]<=-thresh&&cv[i]>-thresh)sigs[i]='buy';else if(cv[i-1]>=thresh&&cv[i]<thresh)sigs[i]='sell';}
            break;
        }
        case 'roc': {
            const {period=10}=params;
            const rv=_indROC(closes,period);
            for(let i=1;i<candles.length;i++){if(rv[i]==null||rv[i-1]==null)continue;if(rv[i-1]<=0&&rv[i]>0)sigs[i]='buy';else if(rv[i-1]>=0&&rv[i]<0)sigs[i]='sell';}
            break;
        }
        case 'ichimoku': {
            const {tenkan=9,kijun=26}=params;
            const ich=_indIchimoku(candles,tenkan,kijun);
            for(let i=1;i<candles.length;i++){if(ich.tenkan[i]==null||ich.kijun[i]==null||ich.tenkan[i-1]==null||ich.kijun[i-1]==null)continue;if(ich.tenkan[i-1]<=ich.kijun[i-1]&&ich.tenkan[i]>ich.kijun[i])sigs[i]='buy';else if(ich.tenkan[i-1]>=ich.kijun[i-1]&&ich.tenkan[i]<ich.kijun[i])sigs[i]='sell';}
            break;
        }
        case 'psar': {
            const {step=0.02,maxStep=0.2}=params;
            const ps=_indPSAR(candles,step,maxStep);
            for(let i=1;i<candles.length;i++){if(ps.dir[i-1]!==1&&ps.dir[i]===1)sigs[i]='buy';else if(ps.dir[i-1]!==-1&&ps.dir[i]===-1)sigs[i]='sell';}
            break;
        }
        case 'williams_r': {
            const {period=14,ob=-20,os=-80}=params;
            const wr=_indWilliamsR(candles,period);
            for(let i=1;i<candles.length;i++){if(wr[i]==null||wr[i-1]==null)continue;if(wr[i-1]<=os&&wr[i]>os)sigs[i]='buy';else if(wr[i-1]>=ob&&wr[i]<ob)sigs[i]='sell';}
            break;
        }
        case 'adx': {
            const {period=14,thresh=25}=params;
            const av=_indADX(candles,period);
            for(let i=1;i<candles.length;i++){if(av.diP[i]==null||av.diM[i]==null||av.adx[i]==null||av.diP[i-1]==null||av.diM[i-1]==null)continue;if(av.adx[i]<thresh)continue;if(av.diP[i-1]<=av.diM[i-1]&&av.diP[i]>av.diM[i])sigs[i]='buy';else if(av.diP[i-1]>=av.diM[i-1]&&av.diP[i]<av.diM[i])sigs[i]='sell';}
            break;
        }
        case 'keltner': {
            const {period=20,mult=1.5}=params;
            const kc=_indKeltner(candles,period,mult);
            for(let i=1;i<candles.length;i++){if(kc.upper[i]==null||kc.lower[i]==null||kc.upper[i-1]==null||kc.lower[i-1]==null)continue;if(closes[i-1]<kc.lower[i-1]&&closes[i]>=kc.lower[i])sigs[i]='buy';else if(closes[i-1]<kc.upper[i-1]&&closes[i]>=kc.upper[i])sigs[i]='sell';}
            break;
        }
        case 'trix': {
            const {period=18}=params;
            const tx=_indTRIX(closes,period);
            for(let i=1;i<candles.length;i++){if(tx[i]==null||tx[i-1]==null)continue;if(tx[i-1]<=0&&tx[i]>0)sigs[i]='buy';else if(tx[i-1]>=0&&tx[i]<0)sigs[i]='sell';}
            break;
        }
        case 'cmo': {
            const {period=14,thresh=50}=params;
            const cv=_indCMO(closes,period);
            for(let i=1;i<candles.length;i++){if(cv[i]==null||cv[i-1]==null)continue;if(cv[i-1]<=-thresh&&cv[i]>-thresh)sigs[i]='buy';else if(cv[i-1]>=thresh&&cv[i]<thresh)sigs[i]='sell';}
            break;
        }
        case 'hull': {
            const {fast=9,slow=21}=params;
            const hF=_indHullMA(closes,fast),hS=_indHullMA(closes,slow);
            for(let i=1;i<candles.length;i++){if(hF[i]==null||hS[i]==null||hF[i-1]==null||hS[i-1]==null)continue;if(hF[i-1]<=hS[i-1]&&hF[i]>hS[i])sigs[i]='buy';else if(hF[i-1]>=hS[i-1]&&hF[i]<hS[i])sigs[i]='sell';}
            break;
        }
        case 'vwap': {
            const {period=20,thresh=0.02}=params;
            const vw=_indVWAP(candles,period);
            for(let i=1;i<candles.length;i++){if(vw[i]==null||vw[i-1]==null)continue;const d=(closes[i]-vw[i])/vw[i],pd=(closes[i-1]-vw[i-1])/vw[i-1];if(pd<-thresh&&d>=-thresh)sigs[i]='buy';else if(pd<thresh&&d>=thresh)sigs[i]='sell';}
            break;
        }
        case 'obv': {
            const {period=20}=params;
            const ov=_indOBV(candles),os2=_indSma(ov,period);
            for(let i=1;i<candles.length;i++){if(os2[i]==null||os2[i-1]==null)continue;if(ov[i-1]<=os2[i-1]&&ov[i]>os2[i])sigs[i]='buy';else if(ov[i-1]>=os2[i-1]&&ov[i]<os2[i])sigs[i]='sell';}
            break;
        }
    }

    let equity=1.0, inTrade=false, entry=0;
    const equityCurve=[], trades=[], buyX=[], buyY=[], sellX=[], sellY=[];
    for(let i=0;i<candles.length;i++){
        if(sigs[i]==='buy'&&!inTrade){inTrade=true;entry=closes[i];buyX.push(times[i]);buyY.push(closes[i]);}
        else if(sigs[i]==='sell'&&inTrade){const r=closes[i]/entry;equity*=r;trades.push(r);inTrade=false;sellX.push(times[i]);sellY.push(closes[i]);}
        equityCurve.push({time:times[i],value:equity});
    }
    const wins=trades.filter(r=>r>1).length;
    const winRate=trades.length>0?(wins/trades.length)*100:0;
    let peak=1, maxDD=0;
    for(const p of equityCurve){if(p.value>peak)peak=p.value;maxDD=Math.max(maxDD,(peak-p.value)/peak);}
    return {totalReturn:(equity-1)*100,tradeCount:trades.length,winRate,maxDD:maxDD*100,equityCurve,buyX,buyY,sellX,sellY};
}

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

const GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];

async function streamGemini(res, { key, model: modelOverride, message, cosplay, history }) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genai      = new GoogleGenerativeAI(key);
    const modelName  = modelOverride || GEMINI_MODELS[0];
    const model      = genai.getGenerativeModel({ model: modelName, systemInstruction: cosplay || undefined });
    const chat       = model.startChat({ history: history || [] });
    const result     = await chat.sendMessageStream(message);
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

const monitor = require('./lib/monitor');
const db      = require('./lib/db');

// Copy caloogy_utils.py to ~/.caloogy/ so Python scripts can import it
function installPythonUtils() {
    const src  = path.join(__dirname, 'lib', 'caloogy_utils.py');
    const dest = path.join(db.DB_DIR, 'caloogy_utils.py');
    try {
        require('fs').mkdirSync(db.DB_DIR, { recursive: true });
        require('fs').copyFileSync(src, dest);
    } catch (e) {
        console.warn('[DB] Could not install caloogy_utils.py:', e.message);
    }
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function parseCSVText(text) {
    if (_csv) return _csv.parseCSV(text);
    return _parseCSVTextJS(text);
}

function parseTimestamp(val) {
    if (val == null || val === '') return null;
    const s = String(val).trim();
    if (/^\d{13}$/.test(s)) return parseInt(s);               // Unix ms
    if (/^\d{10}$/.test(s)) return parseInt(s) * 1000;        // Unix seconds
    const d = new Date(s.replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3'));
    return isNaN(d) ? null : d.getTime();
}

function _parseCSVTextJS(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
        .map(l => l.trim()).filter(l => l.length);
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["']/g, ''));
    const findCol = (...names) => names.reduce((f, n) => f >= 0 ? f : headers.indexOf(n), -1);

    const dateIdx   = findCol('date','datetime','timestamp','time','ts');
    const openIdx   = findCol('open','o');
    const highIdx   = findCol('high','h');
    const lowIdx    = findCol('low','l');
    const closeIdx  = findCol('close','c','price');
    const volumeIdx = findCol('volume','vol','v');

    if (dateIdx  < 0) throw new Error('Cannot detect date column. Rename a column to date/datetime/timestamp and retry.');
    if (closeIdx < 0) throw new Error('Cannot detect close column. Rename a column to close/price and retry.');

    const candles = [], errors = [], warnings = [];
    let skipped = 0, ohlcViolations = 0;

    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        const ts    = parseTimestamp(cells[dateIdx]);
        const close = parseFloat(cells[closeIdx]);
        if (!ts || isNaN(close)) { skipped++; continue; }

        const open   = openIdx  >= 0 ? (parseFloat(cells[openIdx])   || close) : close;
        const high   = highIdx  >= 0 ? (parseFloat(cells[highIdx])   || close) : close;
        const low    = lowIdx   >= 0 ? (parseFloat(cells[lowIdx])    || close) : close;
        const volume = volumeIdx >= 0 ? (parseFloat(cells[volumeIdx]) || 0)    : 0;

        if (high < low) { ohlcViolations++; errors.push(`Row ${i+1}: high(${high}) < low(${low})`); }
        candles.push({ ts, open, high, low, close, volume });
    }

    // Sort by ts, detect out-of-order
    let outOfOrder = 0;
    for (let i = 1; i < candles.length; i++) {
        if (candles[i].ts <= candles[i-1].ts) outOfOrder++;
    }
    if (outOfOrder > 0) {
        warnings.push(`${outOfOrder} out-of-order timestamp(s) detected (auto-sorted)`);
        candles.sort((a, b) => a.ts - b.ts);
    }

    return { candles, skipped, ohlcViolations, errors, warnings };
}

function startServer(cfg) {
    const app = express();
    app.use(express.json({ limit: '20mb' }));  // larger limit for CSV uploads

    // Reject requests not originating from localhost
    app.use('/api', (req, res, next) => {
        const origin = req.headers.origin || '';
        const host   = req.headers.host   || '';
        const isLocal = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
        if (!isLocal || !isLocalHost) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    });

    app.use(express.static(path.join(__dirname, 'public')));

    app.post('/api/ai/chat', async (req, res) => {
        const { message, cosplay, history } = req.body || {};
        if (!message) { res.status(400).json({ error: 'message required' }); return; }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        try {
            const args = { key: cfg.key, model: cfg.model, message, cosplay, history };
            if (cfg.provider === 'gemini')   await streamGemini(res, args);
            else if (cfg.provider === 'openai') await streamOpenAI(res, args);
            else if (cfg.provider === 'claude') await streamClaude(res, args);
            else sseError(res, 'Unknown provider: ' + cfg.provider);
        } catch (err) {
            console.error('[AI error]', err.message);
            sseError(res, err.message || 'AI request failed');
        }
    });

    // ── Python script runner ──────────────────────────────────────────────────
    app.post('/api/run-python', (req, res) => {
        const { code, candles } = req.body;
        if (!code) return res.status(400).json({ error: 'code required' });

        const { spawn }  = require('child_process');
        const os         = require('os');
        const fs         = require('fs');
        const pathMod    = require('path');
        const tmpFile    = pathMod.join(os.tmpdir(), `caloogy_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

        try { fs.writeFileSync(tmpFile, code); } catch (e) {
            return res.status(500).json({ error: 'Failed to write temp script: ' + e.message });
        }

        const input = JSON.stringify({ candles: candles || [] });
        let stdout = '', stderr = '';

        const proc = spawn('python3', [tmpFile], {
            env: { ...process.env, CALOOGY_DB_PATH: db.DB_PATH },
        });
        const timer = setTimeout(() => {
            proc.kill();
            fs.unlink(tmpFile, () => {});
            res.status(400).json({ error: 'Timeout: script took longer than 10 seconds.' });
        }, 10000);

        proc.stdin.write(input);
        proc.stdin.end();
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });

        proc.on('close', code => {
            clearTimeout(timer);
            fs.unlink(tmpFile, () => {});
            if (res.headersSent) return;
            if (code !== 0) return res.status(400).json({ error: stderr.trim() || 'Python exited with error.' });
            try {
                res.json(JSON.parse(stdout));
            } catch {
                res.status(400).json({ error: 'Script must end with print(json.dumps({...})). Output was:\n' + stdout.slice(0, 300) });
            }
        });

        proc.on('error', err => {
            clearTimeout(timer);
            fs.unlink(tmpFile, () => {});
            if (res.headersSent) return;
            if (err.code === 'ENOENT') return res.status(500).json({ error: 'python3 not found. Install Python 3 from python.org.' });
            res.status(500).json({ error: err.message });
        });
    });

    // ── R script runner ──────────────────────────────────────────────────────
    app.post('/api/run-r', (req, res) => {
        const { code, candles } = req.body;
        if (!code) return res.status(400).json({ error: 'code required' });

        const { spawn }  = require('child_process');
        const os         = require('os');
        const fs         = require('fs');
        const pathMod    = require('path');
        const tmpFile    = pathMod.join(os.tmpdir(), `caloogy_${Date.now()}_${Math.random().toString(36).slice(2)}.R`);

        try { fs.writeFileSync(tmpFile, code); } catch (e) {
            return res.status(500).json({ error: 'Failed to write temp script: ' + e.message });
        }

        const rows = (candles || []).map(c =>
            [c.time, c.open, c.high, c.low, c.close, c.volume].join(',')
        );
        const csvInput = 'time,open,high,low,close,volume\n' + rows.join('\n');

        let stdout = '', stderr = '';
        const proc = spawn('Rscript', [tmpFile], {
            env: { ...process.env, CALOOGY_DB_PATH: db.DB_PATH },
        });
        const timer = setTimeout(() => {
            proc.kill();
            fs.unlink(tmpFile, () => {});
            res.status(400).json({ error: 'Timeout: R script took longer than 15 seconds.' });
        }, 15000);

        proc.stdin.write(csvInput);
        proc.stdin.end();
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });

        proc.on('close', code => {
            clearTimeout(timer);
            fs.unlink(tmpFile, () => {});
            if (res.headersSent) return;
            if (code !== 0) return res.status(400).json({ error: stderr.trim() || 'Rscript exited with error.' });
            try {
                res.json(JSON.parse(stdout));
            } catch {
                res.status(400).json({ error: 'Script must end with cat(toJSON(...)). Output was:\n' + stdout.slice(0, 300) });
            }
        });

        proc.on('error', err => {
            clearTimeout(timer);
            fs.unlink(tmpFile, () => {});
            if (res.headersSent) return;
            if (err.code === 'ENOENT') return res.status(500).json({ error: 'Rscript not found. Install R from r-project.org.' });
            res.status(500).json({ error: err.message });
        });
    });

    // ── C++ script runner ─────────────────────────────────────────────────────
    app.post('/api/run-cpp', (req, res) => {
        const { code, candles } = req.body;
        if (!code) return res.status(400).json({ error: 'code required' });

        const { spawnSync, spawn } = require('child_process');
        const os      = require('os');
        const fs      = require('fs');
        const pathMod = require('path');
        const id      = `caloogy_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const srcFile = pathMod.join(os.tmpdir(), `${id}.cpp`);
        const binFile = pathMod.join(os.tmpdir(), id);

        try { fs.writeFileSync(srcFile, code); } catch (e) {
            return res.status(500).json({ error: 'Failed to write temp source: ' + e.message });
        }

        // Compile — try c++ (cross-platform alias), fallback to g++, then clang++
        const compilers = ['c++', 'g++', 'clang++'];
        let compiled = false;
        let compileErr = '';
        for (const cc of compilers) {
            const r = spawnSync(cc, ['-O2', '-std=c++17', '-o', binFile, srcFile], { timeout: 20000 });
            if (r.error && r.error.code === 'ENOENT') continue;
            if (r.status === 0) { compiled = true; break; }
            compileErr = (r.stderr || '').toString().trim();
            break;
        }
        fs.unlink(srcFile, () => {});

        if (!compiled) {
            return res.status(400).json({
                error: compileErr || 'No C++ compiler found. Install Xcode Command Line Tools (macOS) or g++ (Linux).',
            });
        }

        const rows = (candles || []).map(c =>
            [c.time, c.open, c.high, c.low, c.close, c.volume].join(',')
        );
        const csvInput = 'time,open,high,low,close,volume\n' + rows.join('\n');

        let stdout = '', stderr = '';
        const proc = spawn(binFile, [], {});
        const timer = setTimeout(() => {
            proc.kill();
            fs.unlink(binFile, () => {});
            res.status(400).json({ error: 'Timeout: C++ binary took longer than 10 seconds.' });
        }, 10000);

        proc.stdin.write(csvInput);
        proc.stdin.end();
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });

        proc.on('close', code => {
            clearTimeout(timer);
            fs.unlink(binFile, () => {});
            if (res.headersSent) return;
            if (code !== 0) return res.status(400).json({ error: stderr.trim() || 'Binary exited with error.' });
            try {
                res.json(JSON.parse(stdout));
            } catch {
                res.status(400).json({ error: 'main() must write JSON to stdout. Output was:\n' + stdout.slice(0, 300) });
            }
        });

        proc.on('error', err => {
            clearTimeout(timer);
            fs.unlink(binFile, () => {});
            if (res.headersSent) return;
            res.status(500).json({ error: err.message });
        });
    });

    // ── Yahoo Finance proxy (avoids CORS for stock data) ─────────────────────
    app.get('/api/market/yahoo', async (req, res) => {
        const { symbol, interval, range } = req.query;
        if (!symbol || !interval || !range) {
            return res.status(400).json({ error: 'symbol, interval, range required' });
        }
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
            + `?interval=${interval}&range=${range}&includePrePost=false&events=`;
        try {
            const r = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            });
            if (!r.ok) throw new Error('yahoo ' + r.status);
            res.json(await r.json());
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // ── Database API ──────────────────────────────────────────────────────────

    app.get('/api/db/status', async (req, res) => {
        try {
            const meta = await db.listSyncMeta();
            const wasmReady = require('fs').existsSync(
                path.join(__dirname, 'public', 'wasm', 'caloogy_wasm.js'));
            res.json({ meta, size: db.dbFileSize(), path: db.DB_PATH, wasmReady });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/db/preview', async (req, res) => {
        const { symbol, interval } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            const rows = await db.queryCandles(symbol, interval, limit);
            res.json(rows);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/db/export', async (req, res) => {
        const { symbol, interval } = req.query;
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            const csv = await db.exportCSV(symbol, interval);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${symbol}_${interval}.csv"`);
            res.send(csv);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/db/symbol', async (req, res) => {
        const { symbol, interval } = req.query;
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            await db.deleteSymbol(symbol, interval);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/db/upload-csv', async (req, res) => {
        const { symbol, interval, csvContent } = req.body || {};
        if (!symbol || !interval || !csvContent) {
            return res.status(400).json({ error: 'symbol, interval, and csvContent required' });
        }
        try {
            const { candles, skipped, ohlcViolations, errors, warnings } = parseCSVText(csvContent);
            if (!candles.length) {
                return res.status(400).json({ error: 'No valid rows found in CSV.', errors });
            }
            const written = await db.upsertCandles(symbol.toUpperCase(), interval, candles, 'csv');
            res.json({ ok: true, written, skipped, ohlcViolations, errors, warnings });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/db/sync', async (req, res) => {
        const { symbol, interval } = req.body || {};
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            const candles = await monitor.fetchCandles(symbol, interval, 300);
            const written = await db.upsertCandles(symbol, interval, candles, 'api');
            res.json({ ok: true, written });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/db/sync-default', async (req, res) => {
        const CRYPTO  = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        const STOCKS  = ['AAPL', 'TSLA', 'GOOGL', 'NVDA'];
        const INTERVALS = ['1H', '4H', '1D'];

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = obj => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

        const tasks = [];
        for (const sym of CRYPTO) for (const iv of INTERVALS) tasks.push({ sym, iv });
        for (const sym of STOCKS)  for (const iv of INTERVALS) tasks.push({ sym, iv });

        const total = tasks.length;
        let done = 0;

        await Promise.all(tasks.map(async ({ sym, iv }) => {
            try {
                const candles = await monitor.fetchCandles(sym, iv, 300);
                const written = await db.upsertCandles(sym, iv, candles, 'api');
                send({ type: 'progress', symbol: sym, interval: iv, written, done: ++done, total });
            } catch (e) {
                send({ type: 'progress', symbol: sym, interval: iv, error: e.message, done: ++done, total });
            }
        }));

        send({ type: 'done', total });
        res.end();
    });

    app.post('/api/db/query', async (req, res) => {
        const { sql } = req.body || {};
        if (!sql) return res.status(400).json({ error: 'sql required' });
        const safe = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|PRAGMA|WITH)\b/i.test(sql.trim());
        if (!safe) return res.status(400).json({
            error: 'Read-only query interface. Use SELECT, SHOW, DESCRIBE, or EXPLAIN.'
        });
        try {
            const rows    = await db.runQuery(sql);
            const columns = rows.length ? Object.keys(rows[0]) : [];
            res.json({ columns, rows: rows.map(r => columns.map(c => r[c])), total: rows.length });
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    // ── Backtest API (C++ accelerated) ───────────────────────────────────────
    app.post('/api/backtest', (req, res) => {
        const { candles, strategy, params = {} } = req.body || {};
        if (!candles || !strategy) return res.status(400).json({ error: 'candles and strategy required' });
        if (candles.length < 10) return res.status(400).json({ error: 'Need at least 10 candles' });
        try {
            const result = _runBacktest(candles, strategy, params);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ── Alerts API ────────────────────────────────────────────────────────────
    app.get('/api/alerts', (req, res) => {
        res.json(monitor.readAlerts());
    });

    app.post('/api/alerts', (req, res) => {
        const rule = req.body;
        if (!rule || !rule.symbol || !rule.type) {
            return res.status(400).json({ error: 'symbol and type required' });
        }
        res.json(monitor.addAlert(rule));
    });

    app.delete('/api/alerts/:id', (req, res) => {
        monitor.removeAlert(req.params.id);
        res.json({ ok: true });
    });

    app.put('/api/alerts/:id', (req, res) => {
        monitor.updateAlert(req.params.id, req.body);
        res.json({ ok: true });
    });

    app.post('/api/alerts/test-notify', async (req, res) => {
        const hasEmail    = !!(cfg.email && cfg.gmailPass);
        const hasDiscord  = !!cfg.discordWebhook;
        const hasTelegram = !!(cfg.telegramToken && cfg.telegramChatId);
        if (!hasEmail && !hasDiscord && !hasTelegram) {
            return res.status(400).json({ error: 'No notification channel configured. Run caloogy --reconfigure.' });
        }
        try {
            await monitor.sendTestNotify(cfg);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Legacy alias
    app.post('/api/alerts/test-email', async (req, res) => {
        res.redirect(307, '/api/alerts/test-notify');
    });

    app.get('/api/alerts/config', (req, res) => {
        res.json({
            emailConfigured:    !!(cfg.email && cfg.gmailPass),
            discordConfigured:  !!cfg.discordWebhook,
            telegramConfigured: !!(cfg.telegramToken && cfg.telegramChatId),
            email: cfg.email || null,
        });
    });

    // Allow re-running setup: POST /api/reset-config
    app.post('/api/reset-config', (req, res) => {
        const os      = require('os');
        const fs      = require('fs');
        const cfgPath = require('path').join(os.homedir(), '.caloogy-config.json');
        try { fs.unlinkSync(cfgPath); } catch {}
        res.json({ ok: true });
        setTimeout(() => {
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 1000); // force-exit fallback
        }, 200);
    });

    // Initialize DB and install Python utils before starting
    try { db.getDB(); } catch (e) { console.warn('[DB] Init warning:', e.message); }
    installPythonUtils();

    // ── Live-candles SSE (fed by Go collector or future WS sources) ──────────
    const liveClients = new Set();

    app.get('/api/live-candles', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        liveClients.add(res);
        req.on('close', () => liveClients.delete(res));
    });

    function broadcastLive(candleObj) {
        const line = `data: ${JSON.stringify(candleObj)}\n\n`;
        liveClients.forEach(r => { try { r.write(line); } catch {} });
    }

    // ── Go collector socket bridge ────────────────────────────────────────────
    const COLLECTOR_SOCK = '/tmp/caloogy_collector.sock';
    let _collectorTimer = null;

    function connectCollector() {
        const sock = net.createConnection(COLLECTOR_SOCK);
        let buf = '';
        sock.on('connect', () => console.log('[collector] Go bridge connected'));
        sock.on('data', chunk => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.filter(Boolean).forEach(line => {
                try {
                    const bar = JSON.parse(line);
                    // only persist confirmed (closed) candles to DuckDB
                    if (bar.confirmed !== false) {
                        db.upsertCandles(bar.symbol, bar.interval, [{
                            ts: bar.ts, open: bar.open, high: bar.high,
                            low: bar.low, close: bar.close, volume: bar.volume,
                        }], 'live').catch(() => {});
                    }
                    // always push to browser SSE clients (confirmed + live)
                    broadcastLive(bar);
                } catch {}
            });
        });
        const retry = () => {
            clearTimeout(_collectorTimer);
            _collectorTimer = setTimeout(connectCollector, 5000);
        };
        sock.on('error', retry);
        sock.on('close', retry);
    }
    connectCollector();

    // ── Python backtest worker ────────────────────────────────────────────────
    let _worker        = null;
    let _workerReady   = false;
    let _workerBuf     = '';
    const _workerCbs   = new Map(); // _id → callback(msg)
    let _workerCbId    = 0;

    function startWorker() {
        const workerPath = path.join(__dirname, 'lib', 'worker.py');
        if (!require('fs').existsSync(workerPath)) return;

        // Add engine/ to PYTHONPATH so `import caloogy_engine` finds the .so
        const engineDir = path.join(__dirname, 'engine');
        const pyPath    = [engineDir, process.env.PYTHONPATH || ''].filter(Boolean).join(':');

        _worker = require('child_process').spawn(
            'python3', ['-u', workerPath],
            { env: { ...process.env, CALOOGY_DB_PATH: db.DB_PATH, PYTHONPATH: pyPath } }
        );
        _workerReady = false;
        _workerBuf   = '';

        _worker.stdout.on('data', d => {
            _workerBuf += d.toString();
            const lines = _workerBuf.split('\n');
            _workerBuf = lines.pop();
            lines.filter(Boolean).forEach(line => {
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'ready') { _workerReady = true; return; }
                    const cb = _workerCbs.get(msg._id);
                    if (cb) cb(msg);
                } catch {}
            });
        });
        _worker.stderr.on('data', d => console.error('[worker]', d.toString().trim()));
        _worker.on('close', () => {
            _workerReady = false;
            // reject any pending requests
            _workerCbs.forEach((cb) => cb({ type: 'error', msg: 'Worker crashed — restarting.' }));
            _workerCbs.clear();
            console.log('[worker] restarting in 3s…');
            setTimeout(startWorker, 3000);
        });
    }
    startWorker();

    // ── /api/backtest  (SSE, streamed from Python worker) ─────────────────────
    app.post('/api/backtest', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const sendSSE = obj => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

        if (!_worker || !_workerReady) {
            sendSSE({ type: 'error', msg: 'Backtest engine not ready. Is Python installed?' });
            return res.end();
        }

        const id  = ++_workerCbId;
        const cmd = { ...req.body, cmd: 'backtest', _id: id };

        _workerCbs.set(id, msg => {
            sendSSE(msg);
            if (msg.type === 'result' || msg.type === 'error') {
                _workerCbs.delete(id);
                res.end();
            }
        });

        try { _worker.stdin.write(JSON.stringify(cmd) + '\n'); }
        catch (e) { sendSSE({ type: 'error', msg: e.message }); res.end(); }

        req.on('close', () => _workerCbs.delete(id));
    });

    let server;
    return new Promise((resolve, reject) => {
        findFreePort(3000).then(port => {
            server = app.listen(port, '127.0.0.1', () => {
                monitor.startMonitor(cfg);
                resolve(port);
            });
        }).catch(reject);
    });
}

module.exports = { startServer };
