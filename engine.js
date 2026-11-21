// 라오어 무한매수법 V4.0 (일반모드 + 리버스모드) 백테스트 엔진 — 브라우저/Node 공용
// bars: [{d, o, h, l, c}] 날짜 오름차순. 모든 LOC는 종가 체결, 지정가 매도는 장중 고가 도달 시 체결로 가정.
(function (root) {
  const DEFAULTS = {
    seed: 10000,      // 시작 원금($)
    splits: 20,       // 분할 수 (20 / 40)
    targetPct: 20,    // 목표 수익률 = 별% 시작값 (TQQQ 15, SOXL 20)
    ladder: true,     // 하락 대비 추가 LOC(사다리): 1회매수금 ÷ (수량+k) 가격에 1주씩
    ladderN: 99,      // 사다리 칸 수(라오어: 아래로 쭉)
    bigPct: 0,        // (선택) 큰수 매수 한도: 주문가가 전일종가+20% 초과 시 전일종가+bigPct%로 합산 주문. 0 = 끔
    ladderRound: 'round', // 사다리 가격 센트 처리: round(반올림) / floor(내림)
    firstPct: 10,     // 처음매수 큰수 = 전일종가 × (1+firstPct%)
    firstQty: 'prev', // 처음매수 수량 기준: prev(1회매수금÷전일종가) / big(1회매수금÷큰수가격, 라오어 표)
    compound: true,   // 사이클 종료 후 전체 잔금으로 재시작(복리) / false = 원금 한도(단리)
    feePct: 0.07,     // 매매 수수료(%)
    maFilter: 0,      // (선택) 새 사이클 시작 조건: 종가 > N일 이동평균, 0 = 끔
    from: '', to: ''  // 매매 기간(이전 데이터는 전일종가·이동평균·5일평균 계산에만 사용)
  };
  const r2 = x => Math.round(x * 100) / 100;
  // 메인 LOC(가격 px, 수량 q) + 사다리(amt ÷ (q+k) 가격에 1주씩). 종가 c에서 체결되는 총 수량
  function fillQty(p, amt, q, px, c, prev) {
    if (c > px) return 0;
    if (prev && p.bigPct && px > prev * 1.2 && c > prev * (1 + p.bigPct / 100)) return 0;   // 큰수 주문도 못 미친 급등일
    if (!p.ladder) return q;
    let n = q;
    for (let k = 1; k <= p.ladderN; k++) {
      const raw = amt / (q + k), rung = p.ladderRound === 'floor' ? Math.floor(raw * 100) / 100 : r2(raw);
      if (rung >= px || c > rung) break; n++;
    }
    return n;
  }

  function run(bars, opt) {
    const p = Object.assign({}, DEFAULTS, opt || {});
    const N = p.splits, tg = p.targetPct / 100, fee = p.feePct / 100;
    const revDiv = N / 2, revMul = 1 - 2 / N;           // 20분할: 1/10·×0.9 / 40분할: 1/20·×0.95
    let reserve = p.seed, cash = 0, shares = 0, cost = 0, T = 0;
    let mode = 'none', revDay = 0, cycle = null, peak = p.seed, mdd = 0;
    const cycles = [], trades = [], equity = [];
    const ma = movingAvg(bars, p.maFilter);

    const log = (i, side, price, q, why, dT) => trades.push({ d: bars[i].d, side, price, q, why, dT, T });
    const buy = (i, q, why) => {
      const px = bars[i].c;
      q = Math.min(q, Math.floor(cash / (px * (1 + fee))));
      if (q < 1) return 0;
      cash -= q * px * (1 + fee); shares += q; cost += q * px; cycle.pnl -= q * px * fee;
      cycle.buys++; return q;
    };
    const sell = (i, q, px) => {
      q = Math.min(q, shares); if (q < 1) return 0;
      const avg = cost / shares;
      cash += q * px * (1 - fee); cycle.pnl += (px - avg) * q - q * px * fee;
      cost -= avg * q; shares -= q; if (!shares) cost = 0;
      return q;
    };
    const endCycle = i => {
      Object.assign(cycle, { end: bars[i].d, days: i - cycle.i0, ret: cycle.pnl / cycle.seed * 100 });
      cycles.push(cycle); cycle = null; reserve += cash; cash = 0; T = 0; mode = 'none';
    };

    let i0 = bars.findIndex(b => !p.from || b.d >= p.from), i1 = bars.length - 1;
    while (p.to && i1 > 0 && bars[i1].d > p.to) i1--;
    if (i0 < 0 || i1 - i0 < 1) throw new Error('기간 안에 데이터가 없어요.');
    const span = bars.slice(i0, i1 + 1);
    for (let i = i0; i <= i1; i++) {
      const b = bars[i];
      if (mode === 'none') {                                   // ── 처음 매수
        if (!p.maFilter || (ma[i] != null && b.c > ma[i])) {
          const alloc = p.compound ? reserve : Math.min(reserve, p.seed);
          reserve -= alloc; cash = alloc;
          cycle = { start: b.d, i0: i, seed: alloc, pnl: 0, buys: 0, quarters: 0, reverses: 0 };
          const prev = i ? bars[i - 1].c : b.c, big = r2(prev * (1 + p.firstPct / 100)), unit0 = cash / N;
          const q0 = Math.floor(unit0 / (p.firstQty === 'big' ? big : prev));
          const q = buy(i, fillQty(p, unit0, q0, big, b.c, prev), '처음매수');
          if (q) { T = 1; mode = 'normal'; log(i, '매수', b.c, q, '처음매수', '+1'); }
          else { reserve += cash; cash = 0; cycle = null; }
        }
      } else if (mode === 'normal') {                          // ── 일반모드
        const avg = cost / shares, unit = cash / (N - T);
        const starPct = tg * (1 - 2 * T / N);
        const star = r2(avg * (1 + starPct)), buyPx = r2(star - 0.01);
        const tp = r2(avg * (1 + tg)), q4 = Math.floor(shares / 4);
        let soldAll = false, limit = false, quarter = false, inc = 0;
        if (b.h >= tp) {                                       // 3/4 지정가 매도
          const px = Math.max(b.o, tp);
          log(i, '매도', px, sell(i, shares - q4, px), '지정가 익절', '×0.25'); limit = true;
        }
        if (b.c >= star && q4 > 0) {                           // 1/4 쿼터매도 (별지점 LOC)
          log(i, '매도', b.c, sell(i, q4, b.c), '쿼터매도', '×0.75'); quarter = true; cycle.quarters++;
        }
        if (!shares) soldAll = true;
        else if (!quarter) {                                   // LOC 매수
          if (T < N / 2) {                                     // 전반전: 절반 별지점 + 절반 평단 (+사다리)
            const sQ = Math.floor(unit / 2 / buyPx), aQ = Math.max(0, Math.floor(unit / avg) - sQ), avgPx = r2(avg);
            if (b.c <= avgPx) { const q = buy(i, fillQty(p, unit, sQ + aQ, avgPx, b.c, bars[i - 1].c)); if (q) { inc = 1; log(i, '매수', b.c, q, '평단+별지점 LOC', '+1'); } }
            else if (b.c <= buyPx && fillQty(p, unit, sQ, buyPx, b.c, bars[i - 1].c)) { const q = buy(i, sQ); if (q) { inc = 0.5; log(i, '매수', b.c, q, '별지점 LOC', '+0.5'); } }
          } else {                                             // 후반전: 전체 별지점 (+사다리)
            const q = buy(i, fillQty(p, unit, Math.floor(unit / buyPx), buyPx, b.c, bars[i - 1].c));
            if (q) { inc = 1; log(i, '매수', b.c, q, '별지점 LOC(후반전)', '+1'); }
          }
        }
        if (soldAll) { endCycle(i); }
        else {
          if (limit) T = T * 0.25 + inc; else if (quarter) T *= 0.75; else T += inc;
          if (trades.length && trades[trades.length - 1].d === b.d) trades[trades.length - 1].T = T;
          if (T > N - 1) { mode = 'reverse'; revDay = 0; cycle.reverses++; }
        }
      } else {                                                 // ── 리버스모드
        revDay++;
        const sQ = Math.floor(shares / revDiv);
        if (revDay === 1) {                                    // 첫날: 무조건 MOC 매도
          const q = sell(i, sQ, b.c); T *= revMul; log(i, '매도', b.c, q, '리버스 첫날 MOC', '×' + revMul);
        } else {
          const star = r2(bars.slice(Math.max(0, i - 5), i).reduce((s, x) => s + x.c, 0) / 5), buyPx = r2(star - 0.01);
          const amt = cash / 4;
          if (Math.floor(amt / buyPx) < 1) {                   // 1주도 못 사면 MOC 매도만
            const q = sell(i, sQ, b.c); T *= revMul; log(i, '매도', b.c, q, '리버스 MOC(잔금 부족)', '×' + revMul);
          } else if (b.c >= star) {                            // 별지점(5일 평균) 위: LOC 매도
            const q = sell(i, sQ, b.c); T *= revMul; log(i, '매도', b.c, q, '리버스매도 LOC', '×' + revMul);
          } else if (b.c <= buyPx) {                           // 별지점 아래: 쿼터매수
            const q = buy(i, fillQty(p, amt, Math.floor(amt / buyPx), buyPx, b.c, bars[i - 1].c));
            if (q) { const d = (N - T) * 0.25; T += d; log(i, '매수', b.c, q, '리버스 쿼터매수', '+' + d.toFixed(3)); }
          }
        }
        if (trades.length && trades[trades.length - 1].d === b.d) trades[trades.length - 1].T = T;
        if (!shares) endCycle(i);
        else if (b.c > (cost / shares) * (1 - tg)) {           // 복귀: 종가 > 평단 × (1 − 목표%)
          mode = 'normal'; if (T > N - 1) { mode = 'reverse'; revDay = 0; }
        }
      }
      const eq = reserve + cash + shares * b.c;
      peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1);
      equity.push({ d: b.d, v: eq, t: T, m: mode });
    }
    if (cycle) cycles.push(Object.assign(cycle, { end: '진행 중', days: i1 - cycle.i0, ret: null }));
    const state = shares ? { mode, T, shares, avg: cost / shares, cash, unit: mode === 'normal' ? cash / (N - T) : cash / 4 } : null;
    return { params: p, equity, trades, cycles, state, stats: stats(span, equity, p.seed, mdd, cycles), bh: buyHold(span, p.seed, fee) };
  }

  function years(bars) { return Math.max((new Date(bars[bars.length - 1].d) - new Date(bars[0].d)) / 3.156e10, 1 / 365); }
  function stats(bars, equity, seed, mdd, cycles) {
    const end = equity.length ? equity[equity.length - 1].v : seed;
    const done = cycles.filter(c => c.ret != null), wins = done.filter(c => c.pnl > 0);
    return {
      final: end, years: years(bars), ret: (end / seed - 1) * 100, cagr: (Math.pow(end / seed, 1 / years(bars)) - 1) * 100, mdd: mdd * 100,
      cycles: done.length, wins: wins.length, winRate: done.length ? wins.length / done.length * 100 : 0,
      avgDays: done.length ? done.reduce((s, c) => s + c.days, 0) / done.length : 0,
      reverses: cycles.reduce((s, c) => s + c.reverses, 0)
    };
  }
  function buyHold(bars, seed, fee) {
    const q = Math.floor(seed / (bars[0].c * (1 + fee))), left = seed - q * bars[0].c * (1 + fee);
    let peak = seed, mdd = 0;
    const equity = bars.map(b => { const v = left + q * b.c; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); return { d: b.d, v }; });
    const end = equity[equity.length - 1].v;
    return { equity, final: end, years: years(bars), ret: (end / seed - 1) * 100, cagr: (Math.pow(end / seed, 1 / years(bars)) - 1) * 100, mdd: mdd * 100 };
  }
  function movingAvg(bars, n) {
    const out = new Array(bars.length).fill(null); if (!n) return out;
    let s = 0;
    for (let i = 0; i < bars.length; i++) { s += bars[i].c; if (i >= n) s -= bars[i - n].c; if (i >= n - 1) out[i] = s / n; }
    return out;
  }

  const api = { run, DEFAULTS };
  if (typeof module !== 'undefined') module.exports = api; else root.IBM = api;
})(this);
