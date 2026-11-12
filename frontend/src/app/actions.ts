"use server";

export type Stock = {
  ticker: string;
  category: string;
  price: number;
  chg_pct: number;
  vol_ratio: number;
  rsi: number;
  adx: number;
  vwap: number;
  per: number;
  pbv: number;
  roe: number;
  div_yield: number;
  der: number;
  macd_status: string;
  score: number;
  buy_price: number;
  sell_price: number;
  stop_loss: number;
  gain_pct: number;
  sl_pct: number;
  rrr: number;
  signal: string;
  reason: string;
  update_time: string;
};

export type ScreenerResponse = {
  market_open: boolean;
  server_time: string;
  source: string;
  stocks: Stock[];
};

// Penyimpanan Cache di Memori Server Vercel (Hemat Limit API < 10%)
let serverCacheStocks: Stock[] = [];
let lastFullScanTimestamp = 0;

function getWibDate(): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 7 * 3600000);
}

function nowWibStr(): string {
  const wib = getWibDate();
  const yyyy = wib.getFullYear();
  const mm = String(wib.getMonth() + 1).padStart(2, "0");
  const dd = String(wib.getDate()).padStart(2, "0");
  const hh = String(wib.getHours()).padStart(2, "0");
  const min = String(wib.getMinutes()).padStart(2, "0");
  const ss = String(wib.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} WIB`;
}

function isIdxMarketOpen(): boolean {
  const wib = getWibDate();
  const day = wib.getDay(); // 0 = Minggu, 6 = Sabtu
  if (day === 0 || day === 6) return false;
  const totalMinutes = wib.getHours() * 60 + wib.getMinutes();
  return totalMinutes >= 8 * 60 + 55 && totalMinutes <= 16 * 60 + 15;
}

function getIdxTick(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

function roundToIdxTick(price: number): number {
  if (price <= 0) return 0;
  const tick = getIdxTick(price);
  return Math.max(1, Math.round(price / tick) * tick);
}

function safeNum(val: unknown, fallback = 0): number {
  if (typeof val === "number" && !Number.isNaN(val) && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

// 35 Kolom Resmi TradingView Indonesia (IDX) Real-Time
const TV_COLUMNS = [
  "name",
  "close",
  "open",
  "high",
  "low",
  "change",
  "volume",
  "average_volume_10d_calc",
  "Value.Traded",
  "VWAP",
  "RSI",
  "EMA9",
  "EMA20",
  "SMA50",
  "SMA200",
  "MACD.macd",
  "MACD.signal",
  "Stoch.K",
  "Stoch.D",
  "ADX",
  "ADX+DI",
  "ADX-DI",
  "ATR",
  "BB.lower",
  "BB.upper",
  "Pivot.M.Classic.S1",
  "Pivot.M.Classic.R1",
  "High.1M",
  "market_cap_basic",
  "price_earnings_ttm",
  "price_book_fq",
  "return_on_equity",
  "dividends_yield_current",
  "debt_to_equity",
  "Recommend.All",
];

function evaluateIdxStockUltimate(d: unknown[], isCustom = false): Stock | null {
  const ticker = String(d[0] ?? "").trim().toUpperCase();
  const closePrice = safeNum(d[1], 0);
  if (!ticker || closePrice <= 0) return null;

  const realPrice = roundToIdxTick(closePrice);
  const tick = getIdxTick(realPrice);
  const minFloor = realPrice <= 50 ? 1 : 50;

  const openPrice = safeNum(d[2], realPrice);
  const highToday = safeNum(d[3], realPrice);
  const lowToday = safeNum(d[4], realPrice);
  const chgPct = Number(safeNum(d[5], 0).toFixed(2));
  const volume = safeNum(d[6], 0);
  const avgVol10d = safeNum(d[7], volume > 0 ? volume : 1);
  const volRatio = avgVol10d > 0 ? Number((volume / avgVol10d).toFixed(2)) : 1.0;
  const txVal = safeNum(d[8], realPrice * volume);

  if (!isCustom && txVal < 350_000_000) return null;
  if (!isCustom && chgPct <= -9.5 && realPrice === roundToIdxTick(lowToday)) {
    return null;
  }

  const vwap = roundToIdxTick(safeNum(d[9], realPrice));
  const rsi = Number(safeNum(d[10], 50).toFixed(1));
  const ema9 = safeNum(d[11], realPrice);
  const ema20 = safeNum(d[12], realPrice);
  const sma50 = safeNum(d[13], ema20);
  const sma200 = safeNum(d[14], sma50);
  const macdVal = safeNum(d[15], 0);
  const macdSig = safeNum(d[16], 0);
  const stochK = safeNum(d[17], 50);
  const stochD = safeNum(d[18], 50);
  const adx = Number(safeNum(d[19], 20).toFixed(1));
  const plusDi = safeNum(d[20], 20);
  const minusDi = safeNum(d[21], 20);
  const atrRp = safeNum(d[22], realPrice * 0.025);
  const bbUpper = safeNum(d[24], realPrice * 1.05);
  const pivotR1 = safeNum(d[26], realPrice * 1.05);
  const high1m = safeNum(d[27], realPrice * 1.06);
  const mcap = safeNum(d[28], 0);
  const per = Number(safeNum(d[29], 0).toFixed(2));
  const pbv = Number(safeNum(d[30], 0).toFixed(2));
  const roe = Number(safeNum(d[31], 0).toFixed(2));
  const divYield = Number(safeNum(d[32], 0).toFixed(2));
  const der = Number(safeNum(d[33], 0).toFixed(2));
  const tvRec = safeNum(d[34], 0);

  const atrPct =
    atrRp > 0 ? Math.max(1.0, Math.min(15.0, (atrRp / realPrice) * 100.0)) : 2.5;
  const macdBullish = macdVal > macdSig;
  const stochBullish = stochK >= stochD;
  const dmiBullish = plusDi >= minusDi;
  const aboveVwap = realPrice >= vwap;
  const greenCandle = realPrice >= openPrice;

  const candleRange = Math.max(tick, highToday - lowToday);
  const closeStrength =
    highToday > lowToday ? (realPrice - lowToday) / candleRange : 0.6;

  const macdStatus =
    macdBullish && macdVal > 0
      ? "GOLDEN BULLISH"
      : macdBullish
      ? "BULLISH CROSS"
      : "CONSOLIDATION";

  // 1. Skor Investing
  let investScore = 0;
  if (mcap >= 15_000_000_000_000) investScore += 17;
  else if (mcap >= 4_000_000_000_000) investScore += 10;
  if (txVal >= 10_000_000_000) investScore += 8;
  else if (txVal >= 2_500_000_000) investScore += 4;

  if (roe >= 15) investScore += 18;
  else if (roe >= 9) investScore += 12;
  else if (roe > 0) investScore += 5;
  if (der >= 0 && der <= 1.5) investScore += 7;

  if (per > 0 && per <= 14) investScore += 12;
  else if (per > 14 && per <= 22) investScore += 7;
  if (pbv > 0 && pbv <= 2) investScore += 7;
  else if (pbv > 2 && pbv <= 3.5) investScore += 4;
  if (divYield >= 4) investScore += 6;
  else if (divYield >= 1.5) investScore += 3;

  if (realPrice >= sma200) investScore += 12;
  else if (realPrice >= sma200 * 0.92) investScore += 8;
  if (realPrice >= sma50) investScore += 8;
  if (atrPct <= 3.8) investScore += 5;

  // 2. Skor Swing
  let swingScore = 0;
  if (realPrice >= ema9 && ema9 >= ema20) swingScore += 22;
  else if (realPrice >= ema20) swingScore += 15;
  if (ema20 >= sma50) swingScore += 15;
  if (macdBullish) swingScore += 18;
  if (dmiBullish && adx >= 20) swingScore += 18;
  else if (dmiBullish) swingScore += 10;
  if (rsi >= 44 && rsi <= 67) swingScore += 15;
  else if (rsi >= 32 && rsi < 44 && stochBullish) swingScore += 13;
  if (volRatio >= 1.0) swingScore += Math.min(12, volRatio * 6);

  // 3. Skor Scalping
  let scalpScore = 0;
  if (aboveVwap) scalpScore += 22;
  if (greenCandle && closeStrength >= 0.6) scalpScore += 15;
  if (volRatio >= 1.2) scalpScore += Math.min(25, volRatio * 10);
  if (atrPct >= 2.5) scalpScore += Math.min(18, atrPct * 4.5);
  if (chgPct >= 0.5 && chgPct <= 14.0) scalpScore += 12;
  if (stochBullish || tvRec > 0.1) scalpScore += 8;

  // 4. Penentuan Kategori
  const isFundamentalPrime =
    mcap >= 4_000_000_000_000 && roe >= 8 && per > 0 && per <= 28 && realPrice >= 300;

  let category = "Scalping";
  let finalScore = 60;

  if (isFundamentalPrime && investScore >= 64 && atrPct <= 4.0) {
    category = "Investing";
    finalScore = Number(Math.min(99, investScore).toFixed(1));
  } else if (
    (volRatio >= 1.4 || atrPct >= 3.2 || realPrice <= 300) &&
    scalpScore >= swingScore &&
    scalpScore >= 54
  ) {
    category = "Scalping";
    finalScore = Number(Math.min(99, scalpScore).toFixed(1));
  } else if (swingScore >= 56) {
    category = "Swing";
    finalScore = Number(Math.min(99, swingScore).toFixed(1));
  } else if (scalpScore >= 52) {
    category = "Scalping";
    finalScore = Number(Math.min(99, scalpScore).toFixed(1));
  } else if (investScore >= 56) {
    category = "Investing";
    finalScore = Number(Math.min(99, investScore).toFixed(1));
  } else if (isCustom) {
    if (investScore >= swingScore && investScore >= scalpScore) {
      category = "Investing";
      finalScore = Number(Math.max(50, Math.min(99, investScore)).toFixed(1));
    } else if (swingScore >= scalpScore) {
      category = "Swing";
      finalScore = Number(Math.max(50, Math.min(99, swingScore)).toFixed(1));
    } else {
      category = "Scalping";
      finalScore = Number(Math.max(50, Math.min(99, scalpScore)).toFixed(1));
    }
  } else {
    return null;
  }

  // 5. Kalkulasi Trading Plan
  let buyPrice = realPrice;
  let sellPrice = realPrice;
  let stopLoss = realPrice;
  let signal = "HOLD";
  let reason = "";

  if (category === "Scalping") {
    if (aboveVwap && vwap >= realPrice * 0.975) {
      buyPrice = Math.max(minFloor, roundToIdxTick((realPrice + vwap) / 2));
    } else {
      buyPrice = realPrice > minFloor ? Math.max(minFloor, realPrice - tick) : realPrice;
    }
    const slPctRaw = Math.max(1.5, Math.min(3.6, atrPct * 0.75)) / 100;
    stopLoss = Math.max(
      minFloor,
      Math.min(buyPrice - tick, roundToIdxTick(buyPrice * (1 - slPctRaw)))
    );
    const riskRp = Math.max(tick, buyPrice - stopLoss);
    const tpTarget = buyPrice + Math.max(Math.round(riskRp * 1.75), Math.round(atrRp * 1.45));
    sellPrice = Math.max(buyPrice + 2 * tick, roundToIdxTick(tpTarget));

    signal =
      aboveVwap && volRatio >= 1.4
        ? "VWAP_BREAKOUT"
        : aboveVwap
        ? "MOMENTUM_SCALP"
        : "SCALP_REBOUND";
    const vwapInfo = aboveVwap
      ? `Harga > VWAP (${vwap.toLocaleString("id-ID")})`
      : `Area VWAP (${vwap.toLocaleString("id-ID")})`;
    reason = `${vwapInfo} | RVOL ${volRatio}x | ATR ${atrPct.toFixed(1)}% | Stoch ${stochK.toFixed(0)}`;
  } else if (category === "Swing") {
    const supportRef = realPrice >= ema9 ? Math.max(ema9, ema20) : ema20;
    if (realPrice > supportRef && supportRef >= realPrice * 0.96) {
      buyPrice = Math.max(minFloor, roundToIdxTick((realPrice + supportRef) / 2));
    } else {
      buyPrice = Math.max(minFloor, roundToIdxTick(realPrice * 0.99));
    }
    const slPctRaw = Math.max(2.5, Math.min(5.2, atrPct * 1.25)) / 100;
    stopLoss = Math.max(
      minFloor,
      Math.min(buyPrice - 2 * tick, roundToIdxTick(buyPrice * (1 - slPctRaw)))
    );
    const riskRp = Math.max(tick * 2, buyPrice - stopLoss);
    const minTpRrr = buyPrice + riskRp * 2.1;
    const techRes = Math.max(
      pivotR1,
      high1m,
      bbUpper,
      buyPrice * (1 + (atrPct * 2.8) / 100)
    );
    sellPrice = Math.max(
      buyPrice + 3 * tick,
      roundToIdxTick(Math.max(minTpRrr, Math.min(techRes, buyPrice * 1.18)))
    );

    signal =
      macdBullish && dmiBullish && adx >= 20 ? "STRONG_UPTREND" : "SWING_PULLBACK";
    reason = `MACD ${macdStatus} | ADX ${adx.toFixed(0)} (+DI) | EMA20 (${roundToIdxTick(
      ema20
    ).toLocaleString("id-ID")}) | RSI ${rsi.toFixed(0)}`;
  } else {
    buyPrice = Math.max(minFloor, roundToIdxTick(realPrice * 0.985));
    stopLoss = Math.max(
      minFloor,
      Math.min(buyPrice - 2 * tick, roundToIdxTick(buyPrice * 0.94))
    );
    const riskRp = Math.max(tick * 2, buyPrice - stopLoss);
    const minTpInv = buyPrice + riskRp * 2.6;
    const valTarget = Math.max(high1m * 1.06, pivotR1 * 1.05, buyPrice * 1.16);
    sellPrice = Math.max(buyPrice + 4 * tick, roundToIdxTick(Math.max(minTpInv, valTarget)));

    signal =
      divYield >= 3.5 && per > 0 && per <= 15
        ? "UNDERVALUED_DIVIDEND"
        : per > 0 && per <= 15 && roe >= 12
        ? "UNDERVALUED_GROWTH"
        : "BLUECHIP_LEADER";
    const perStr = per > 0 ? `${per.toFixed(1)}x` : "N/A";
    const pbvStr = pbv > 0 ? `${pbv.toFixed(2)}x` : "N/A";
    const divStr = divYield > 0 ? `Div ${divYield.toFixed(1)}%` : `DER ${der.toFixed(1)}x`;
    reason = `PER ${perStr} | PBV ${pbvStr} | ROE ${roe.toFixed(1)}% | ${divStr}`;
  }

  const gainPct =
    buyPrice > 0 ? Number((((sellPrice - buyPrice) / buyPrice) * 100).toFixed(1)) : 0;
  const slPct =
    buyPrice > 0 ? Number((((buyPrice - stopLoss) / buyPrice) * 100).toFixed(1)) : 0;
  const rrr = slPct > 0 ? Number((gainPct / slPct).toFixed(1)) : 2.0;

  return {
    ticker,
    category,
    price: realPrice,
    chg_pct: chgPct,
    vol_ratio: volRatio,
    rsi,
    adx,
    vwap,
    per,
    pbv,
    roe,
    div_yield: divYield,
    der,
    macd_status: macdStatus,
    score: finalScore,
    buy_price: buyPrice,
    sell_price: sellPrice,
    stop_loss: stopLoss,
    gain_pct: gainPct,
    sl_pct: slPct,
    rrr,
    signal,
    reason,
    update_time: nowWibStr(),
  };
}

async function queryTradingViewScanner(specificTickers?: string[]): Promise<Stock[]> {
  const url = "https://scanner.tradingview.com/indonesia/scan";
  const isCustom = Boolean(specificTickers && specificTickers.length > 0);

  const payload = isCustom
    ? {
        symbols: {
          tickers: specificTickers!.map(
            (t) => `IDX:${t.trim().toUpperCase().replace(".JK", "")}`
          ),
          query: { types: [] },
        },
        columns: TV_COLUMNS,
      }
    : {
        filter: [
          { left: "close", operation: "greater", right: 1 },
          { left: "Value.Traded", operation: "greater", right: 350000000 },
        ],
        options: { lang: "id" },
        markets: ["indonesia"],
        symbols: { query: { types: [] }, tickers: [] },
        columns: TV_COLUMNS,
        sort: { sortBy: "Value.Traded", sortOrder: "desc" },
        range: [0, 600],
      };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`TradingView Scanner HTTP ${res.status}`);
  }

  const json = (await res.json()) as { data?: Array<{ d?: unknown[] }> };
  const rows = json.data ?? [];
  const results: Stock[] = [];

  for (const item of rows) {
    const d = item.d ?? [];
    if (d.length < TV_COLUMNS.length) continue;
    const tickerName = String(d[0] ?? "").trim().toUpperCase();
    if (!isCustom && (tickerName.length !== 4 || !/^[A-Z]+$/.test(tickerName))) {
      continue;
    }
    const evaluated = evaluateIdxStockUltimate(d, isCustom);
    if (evaluated) {
      results.push(evaluated);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export async function getInitialRecommendationsAction(): Promise<ScreenerResponse> {
  const nowMs = Date.now();
  // Gunakan Cache Server jika baru dipindai dalam 5 menit terakhir (0% Pemakaian Limit)
  if (serverCacheStocks.length > 0 && nowMs - lastFullScanTimestamp < 5 * 60 * 1000) {
    return {
      market_open: isIdxMarketOpen(),
      server_time: nowWibStr(),
      source: "TradingView IDX Official Cache",
      stocks: serverCacheStocks,
    };
  }
  return await refreshFullMarketScanAction();
}

export async function refreshFullMarketScanAction(): Promise<ScreenerResponse> {
  const results = await queryTradingViewScanner();
  if (results.length > 0) {
    serverCacheStocks = results;
    lastFullScanTimestamp = Date.now();
  }
  return {
    market_open: isIdxMarketOpen(),
    server_time: nowWibStr(),
    source: "TradingView IDX Official Real-Time",
    stocks: serverCacheStocks,
  };
}

export async function addCustomTickerAction(ticker: string): Promise<Stock> {
  const clean = ticker.trim().toUpperCase().replace(".JK", "");
  const results = await queryTradingViewScanner([clean]);
  if (results.length === 0) {
    throw new Error(`Kode saham ${clean} tidak ditemukan di TradingView IDX.`);
  }
  const stock = results[0];
  serverCacheStocks = [
    stock,
    ...serverCacheStocks.filter((s) => s.ticker !== stock.ticker),
  ];
  return stock;
}

export async function updateLiveBatchAction(tickers: string[]): Promise<{
  market_open: boolean;
  server_time: string;
  updated: Stock[];
}> {
  if (!tickers || tickers.length === 0) {
    return { market_open: isIdxMarketOpen(), server_time: nowWibStr(), updated: [] };
  }
  const updated = await queryTradingViewScanner(tickers);
  const mapUpdated = new Map(updated.map((u) => [u.ticker, u]));
  serverCacheStocks = serverCacheStocks.map((item) =>
    mapUpdated.has(item.ticker)
      ? { ...mapUpdated.get(item.ticker)!, category: item.category }
      : item
  );
  return {
    market_open: isIdxMarketOpen(),
    server_time: nowWibStr(),
    updated,
  };
}