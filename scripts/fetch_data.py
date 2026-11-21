"""야후파이낸스에서 tickers.txt 목록의 일봉 데이터를 받아 data/*.json 으로 저장 (GitHub Actions에서 실행)"""
import json, os, sys
import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tickers_file = os.path.join(ROOT, "tickers.txt")
extra = [t.strip().upper() for t in (sys.argv[1] if len(sys.argv) > 1 else "").split(",") if t.strip()]

lines = open(tickers_file, encoding="utf-8").read().splitlines()
tickers = [t.strip().upper() for t in lines if t.strip() and not t.startswith("#")]
new = [t for t in extra if t not in tickers]
if new:
    with open(tickers_file, "a", encoding="utf-8") as f:
        f.write("# 추가\n" + "\n".join(new) + "\n")
    tickers += new

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
bench = {}
for line in open(os.path.join(ROOT, "benchmarks.txt"), encoding="utf-8"):
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().upper().split("=", 1)
        bench[k] = v
ok, got = [], set()
for t in tickers + sorted(set(bench.values()) - set(tickers)):
    try:
        df = yf.Ticker(t).history(period="max", auto_adjust=False)  # 액면분할 반영 가격
        df = df.dropna(subset=["Close"])
        if df.empty:
            print(f"[skip] {t}: 데이터 없음"); continue
        rows = [[d.strftime("%Y-%m-%d"), round(r.Open, 4), round(r.High, 4), round(r.Low, 4), round(r.Close, 4)]
                for d, r in df.iterrows()]
        with open(os.path.join(ROOT, "data", f"{t}.json"), "w") as f:
            json.dump({"ticker": t, "rows": rows}, f, separators=(",", ":"))
        got.add(t)
        if t in tickers: ok.append(t)
        print(f"[ok] {t}: {rows[0][0]} ~ {rows[-1][0]} ({len(rows)}일)")
    except Exception as e:
        print(f"[fail] {t}: {e}")

with open(os.path.join(ROOT, "data", "tickers.json"), "w") as f:
    json.dump(ok, f)
with open(os.path.join(ROOT, "data", "benchmarks.json"), "w") as f:
    json.dump({k: v for k, v in bench.items() if v in got}, f)
