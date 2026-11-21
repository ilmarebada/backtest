// 무한매수법 백테스트 엔진 (브라우저/Node 공용)
// bars: [{d:'2020-01-02', o, h, l, c}] 날짜 오름차순
(function (root) {
  const DEFAULTS = {
    seed: 10000,          // 시작 원금($)
    splits: 40,           // 분할 수
    targetPct: 15,        // 익절 목표(평단 대비 %)
    buyMode: 'laoer',     // 'laoer' = 평단 LOC + 큰수(평단+star%) LOC / 'prevclose' = 전일종가 -a%, -b% LOC
    starPct: 10,          // laoer 모드: 큰수 LOC = 평단 × (1+star%)
    locA: 1, locB: 5,     // prevclose 모드: 전일종가 -a%, -b%
    exhaust: 'quarter',   // 분할 소진 시: 'quarter'(1/4 손절) / 'stop'(전량 손절) / 'hold'(버티기)
    compound: true,       // 익절 후 늘어난 자산으로 재시작(복리)
    feePct: 0.07,         // 매매 수수료(%)
    maFilter: 0,          // 새 사이클 시작 조건: 종가 > N일 이동평균 (0=끔)
    stopLossPct: 0        // 평단 대비 -X% 도달 시 전량 손절 (0=끔)
  };

  function run(bars, opt) {
    const p = Object.assign({}, DEFAULTS, opt || {});
    const fee = p.feePct / 100;
    let cash = p.seed, shares = 0, cost = 0, T = 0, unit = 0;
    let cycle = null, peak = p.seed, mdd = 0;
    const cycles = [], trades = [], equity = [];
    const ma = movingAvg(bars, p.maFilter);

    const buy = (i, price, amount, why) => {
      amount = Math.min(amount, cash / (1 + fee));
      let q = Math.floor(amount / price);
      if (q < 1 && why === '첫 매수' && cash >= price * (1 + fee)) q = 1;
      if (q < 1) return 0;
      const v = q * price;
      cash -= v * (1 + fee); shares += q; cost += v; if (cycle) cycle.pnl -= v * fee;
      trades.push({ d: bars[i].d, side: '매수', price, q, why });
      return q;
    };
    const sell = (i, price, q, why) => {
      if (q < 1) return;
      const avg = cost / shares, v = q * price;
      cash += v * (1 - fee);
      cycle.pnl += (price - avg) * q - v * fee;
      cost -= avg * q; shares -= q;
      trades.push({ d: bars[i].d, side: '매도', price, q, why });
    };
    const closeCycle = (i, result) => {
      cycle.end = bars[i].d; cycle.days = i - cycle.i0; cycle.result = result;
      cycle.ret = cycle.pnl / cycle.seed * 100; cycles.push(cycle); cycle = null; T = 0; cost = 0;
    };

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (!shares) {
        const ok = !p.maFilter || (ma[i] != null && b.c > ma[i]);
        if (ok) {
          const base = p.compound ? cash : Math.min(cash, p.seed);
          unit = base / p.splits;
          cycle = { start: b.d, i0: i, seed: base, pnl: 0, cuts: 0 };
          if (buy(i, b.c, unit, '첫 매수')) T = 1; else cycle = null;
        }
      } else {
        const avg = cost / shares;
        const tp = avg * (1 + p.targetPct / 100);
        const sl = p.stopLossPct ? avg * (1 - p.stopLossPct / 100) : 0;
        if (b.h >= tp) {                                  // 익절 (지정가)
          sell(i, Math.max(b.o, tp), shares, '익절'); closeCycle(i, '익절');
        } else if (sl && b.l <= sl) {                      // 손절 (지정가)
          sell(i, Math.min(b.o, sl), shares, '손절'); closeCycle(i, '손절');
        } else {
          let lim1, lim2;
          if (p.buyMode === 'laoer') { lim1 = avg; lim2 = avg * (1 + p.starPct / 100); }
          else { const pc = bars[i - 1].c; lim1 = pc * (1 - p.locA / 100); lim2 = pc * (1 - p.locB / 100); }
          if (T < p.splits) {
            if (b.c <= lim1 && buy(i, b.c, unit / 2, 'LOC①')) T += 0.5;
            if (b.c <= lim2 && buy(i, b.c, unit / 2, 'LOC②')) T += 0.5;
          }
          if (T >= p.splits || cash < unit / 2) {          // 분할 소진
            if (p.exhaust === 'quarter') { sell(i, b.c, Math.floor(shares / 4), '쿼터손절'); cycle.cuts++; T = Math.min(T, p.splits) * 0.75; }
            else if (p.exhaust === 'stop') { sell(i, b.c, shares, '소진손절'); closeCycle(i, '손절'); }
            if (shares === 0 && cycle) closeCycle(i, '손절');
          }
        }
      }
      const eq = cash + shares * b.c;
      peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1);
      equity.push({ d: b.d, v: eq, t: T });
    }
    if (cycle) { cycle.end = '진행 중'; cycle.days = bars.length - 1 - cycle.i0; cycle.result = '진행 중'; cycle.ret = null; cycles.push(cycle); }

    const bh = buyHold(bars, p.seed, fee);
    return { params: p, equity, trades, cycles, stats: stats(bars, equity, p.seed, mdd, cycles), bh };
  }

  function stats(bars, equity, seed, mdd, cycles) {
    const end = equity.length ? equity[equity.length - 1].v : seed;
    const yrs = Math.max((new Date(bars[bars.length - 1].d) - new Date(bars[0].d)) / 3.156e10, 1 / 365);
    const done = cycles.filter(c => c.result !== '진행 중');
    const wins = done.filter(c => c.pnl > 0);
    return {
      final: end, ret: (end / seed - 1) * 100, cagr: (Math.pow(end / seed, 1 / yrs) - 1) * 100, mdd: mdd * 100,
      cycles: done.length, wins: wins.length, winRate: done.length ? wins.length / done.length * 100 : 0,
      avgDays: wins.length ? wins.reduce((s, c) => s + c.days, 0) / wins.length : 0
    };
  }

  function buyHold(bars, seed, fee) {
    const q = Math.floor(seed / (bars[0].c * (1 + fee)));
    const left = seed - q * bars[0].c * (1 + fee);
    let peak = seed, mdd = 0;
    const equity = bars.map(b => { const v = left + q * b.c; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); return { d: b.d, v }; });
    const end = equity[equity.length - 1].v;
    const yrs = Math.max((new Date(bars[bars.length - 1].d) - new Date(bars[0].d)) / 3.156e10, 1 / 365);
    return { equity, ret: (end / seed - 1) * 100, cagr: (Math.pow(end / seed, 1 / yrs) - 1) * 100, mdd: mdd * 100, final: end };
  }

  function movingAvg(bars, n) {
    const out = new Array(bars.length).fill(null);
    if (!n) return out;
    let s = 0;
    for (let i = 0; i < bars.length; i++) {
      s += bars[i].c; if (i >= n) s -= bars[i - n].c;
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }

  const api = { run, DEFAULTS };
  if (typeof module !== 'undefined') module.exports = api; else root.IBM = api;
})(this);
