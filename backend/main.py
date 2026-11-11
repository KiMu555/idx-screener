from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import urllib.request
import json
import math
import sqlite3
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timezone, timedelta

app = FastAPI(title="IDX TradingView Quant & Fundamental API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_FILE = "idx_data.db"
WIB_TZ = timezone(timedelta(hours=7))

class AddTickerRequest(BaseModel):
    ticker: str

class BatchLiveRequest(BaseModel):
    tickers: List[str]

def now_wib_str() -> str:
    return datetime.now(WIB_TZ).strftime("%Y-%m-%d %H:%M:%S WIB")

def is_idx_market_open() -> bool:
    """Mengecek apakah pasar saham BEI sedang buka (Senin-Jumat, 08:55 - 16:15 WIB)"""
    now = datetime.now(WIB_TZ)
    if now.weekday() >= 5:  # Sabtu (5) & Minggu (6) libur
        return False
    minutes_now = now.hour * 60 + now.minute
    return (8 * 60 + 55) <= minutes_now <= (16 * 60 + 15)

def get_idx_tick(price: float) -> int:
    if price < 200: return 1
    if price < 500: return 2
    if price < 2000: return 5
    if price < 5000: return 10
    return 25

def round_to_idx_tick(price: float) -> int:
    if price <= 0:
        return 0
    tick = get_idx_tick(price)
    return max(1, int(round(price / tick) * tick))

def safe_float(val, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        f = float(val)
        return default if math.isnan(f) or math.isinf(f) else f
    except Exception:
        return default

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("PRAGMA table_info(stock_recs)")
    columns = [col[1] for col in c.fetchall()]
    
    required_cols = {"vwap", "per", "pbv", "roe", "div_yield", "der", "adx", "macd_status", "rrr", "sl_pct"}
    if not required_cols.issubset(set(columns)):
        c.execute("DROP TABLE IF EXISTS stock_recs")
        
    c.execute('''CREATE TABLE IF NOT EXISTS stock_recs (
                    ticker TEXT PRIMARY KEY,
                    category TEXT,
                    price REAL,
                    chg_pct REAL,
                    vol_ratio REAL,
                    rsi REAL,
                    adx REAL,
                    vwap REAL,
                    per REAL,
                    pbv REAL,
                    roe REAL,
                    div_yield REAL,
                    der REAL,
                    macd_status TEXT,
                    score REAL,
                    buy_price REAL,
                    sell_price REAL,
                    stop_loss REAL,
                    gain_pct REAL,
                    sl_pct REAL,
                    rrr REAL,
                    signal TEXT,
                    reason TEXT,
                    update_time TEXT
                )''')
    conn.commit()
    conn.close()

# 30 Kolom Resmi TradingView Indonesia (IDX) Real-Time
TV_COLUMNS = [
    "name",                         # 0: Kode Saham
    "close",                        # 1: Harga Real-Time / Penutupan
    "open",                         # 2: Harga Pembukaan Hari Ini
    "high",                         # 3: Harga Tertinggi Hari Ini
    "low",                          # 4: Harga Terendah Hari Ini
    "change",                       # 5: Perubahan Harian (%)
    "volume",                       # 6: Volume Hari Ini
    "average_volume_10d_calc",      # 7: Rata-rata Volume 10 Hari
    "Value.Traded",                 # 8: Nilai Transaksi Rupiah Hari Ini
    "VWAP",                         # 9: Volume Weighted Average Price
    "RSI",                          # 10: RSI (14)
    "EMA9",                         # 11: Exponential Moving Average 9
    "EMA20",                        # 12: Exponential Moving Average 20
    "SMA50",                        # 13: Simple Moving Average 50
    "SMA200",                       # 14: Simple Moving Average 200
    "MACD.macd",                    # 15: Garis MACD
    "MACD.signal",                  # 16: Garis Signal MACD
    "Stoch.K",                      # 17: Stochastic %K
    "Stoch.D",                      # 18: Stochastic %D
    "ADX",                          # 19: Kekuatan Tren ADX (14)
    "ADX+DI",                       # 20: Bullish Directional Indicator (+DI)
    "ADX-DI",                       # 21: Bearish Directional Indicator (-DI)
    "ATR",                          # 22: Volatilitas Average True Range (Rp)
    "BB.lower",                     # 23: Lower Bollinger Band
    "BB.upper",                     # 24: Upper Bollinger Band
    "Pivot.M.Classic.S1",           # 25: Classic Pivot Support 1
    "Pivot.M.Classic.R1",           # 26: Classic Pivot Resistance 1
    "High.1M",                      # 27: Resistance Tertinggi 1 Bulan
    "market_cap_basic",             # 28: Market Cap (Rp)
    "price_earnings_ttm",           # 29: PER (TTM)
    "price_book_fq",                # 30: PBV
    "return_on_equity",             # 31: ROE (%)
    "dividends_yield_current",      # 32: Dividend Yield (%)
    "debt_to_equity",               # 33: DER (Debt to Equity Ratio)
    "Recommend.All"                 # 34: Konsensus Indikator TradingView
]

def evaluate_idx_stock_ultimate(d: list, is_custom: bool = False):
    """
    Algoritma Kuantitatif & Fundamental Terbaik (35 Parameter TradingView IDX):
    Menghitung Skor, Kategori, Harga Beli, Target Jual (TP), dan Stop Loss (CL).
    """
    ticker = str(d[0]).strip().upper()
    close_price = safe_float(d[1], 0.0)
    if close_price <= 0:
        return None

    real_price = round_to_idx_tick(close_price)
    tick = get_idx_tick(real_price)
    min_floor = 1 if real_price <= 50 else 50

    open_price = safe_float(d[2], real_price)
    high_today = safe_float(d[3], real_price)
    low_today = safe_float(d[4], real_price)
    chg_pct = round(safe_float(d[5], 0.0), 2)
    volume = safe_float(d[6], 0.0)
    avg_vol_10d = safe_float(d[7], volume if volume > 0 else 1.0)
    vol_ratio = round(volume / avg_vol_10d, 2) if avg_vol_10d > 0 else 1.0
    tx_val = safe_float(d[8], real_price * volume)

    # Filter likuiditas ketat: minimal transaksi Rp 350 Juta/hari agar ritel tidak nyangkut
    if not is_custom and tx_val < 350_000_000:
        return None

    # Filter Anti-ARB & Anti-Pucuk Ekstrem untuk keamanan pengguna
    if not is_custom and chg_pct <= -9.5 and real_price == round_to_idx_tick(low_today):
        return None  # Hindari saham yang sedang mengunci Auto Reject Bawah (ARB)

    vwap = round_to_idx_tick(safe_float(d[9], real_price))
    rsi = round(safe_float(d[10], 50.0), 1)
    ema9 = safe_float(d[11], real_price)
    ema20 = safe_float(d[12], real_price)
    sma50 = safe_float(d[13], ema20)
    sma200 = safe_float(d[14], sma50)
    macd_val = safe_float(d[15], 0.0)
    macd_sig = safe_float(d[16], 0.0)
    stoch_k = safe_float(d[17], 50.0)
    stoch_d = safe_float(d[18], 50.0)
    adx = round(safe_float(d[19], 20.0), 1)
    plus_di = safe_float(d[20], 20.0)
    minus_di = safe_float(d[21], 20.0)
    atr_rp = safe_float(d[22], real_price * 0.025)
    bb_lower = safe_float(d[23], real_price * 0.95)
    bb_upper = safe_float(d[24], real_price * 1.05)
    pivot_s1 = safe_float(d[25], real_price * 0.96)
    pivot_r1 = safe_float(d[26], real_price * 1.05)
    high_1m = safe_float(d[27], real_price * 1.06)
    mcap = safe_float(d[28], 0.0)
    per = round(safe_float(d[29], 0.0), 2)
    pbv = round(safe_float(d[30], 0.0), 2)
    roe = round(safe_float(d[31], 0.0), 2)
    div_yield = round(safe_float(d[32], 0.0), 2)
    der = round(safe_float(d[33], 0.0), 2)
    tv_rec = safe_float(d[34], 0.0)

    atr_pct = max(1.0, min(15.0, (atr_rp / real_price) * 100.0)) if atr_rp > 0 else 2.5
    macd_bullish = macd_val > macd_sig
    stoch_bullish = stoch_k >= stoch_d
    dmi_bullish = plus_di >= minus_di  # Pembuktian bahwa arah tren ADX adalah NAIK (Bullish)
    above_vwap = real_price >= vwap
    green_candle = real_price >= open_price

    # Posisi penutupan candle hari ini (1.0 = tutup di High, 0.0 = tutup di Low)
    candle_range = max(tick, high_today - low_today)
    close_strength = (real_price - low_today) / candle_range if high_today > low_today else 0.6

    if macd_bullish and macd_val > 0:
        macd_status = "GOLDEN BULLISH"
    elif macd_bullish:
        macd_status = "BULLISH CROSS"
    else:
        macd_status = "CONSOLIDATION"

    # =========================================================================
    # 1. SKOR INVESTING (Valuasi PER, PBV, ROE, Dividen, DER + Tren MA50/MA200)
    # =========================================================================
    invest_score = 0.0
    # A. Skala Institusi & Likuiditas (Maks 25 Poin)
    if mcap >= 15_000_000_000_000:
        invest_score += 17.0
    elif mcap >= 4_000_000_000_000:
        invest_score += 10.0
    if tx_val >= 10_000_000_000:
        invest_score += 8.0
    elif tx_val >= 2_500_000_000:
        invest_score += 4.0

    # B. Profitabilitas ROE & Kesehatan Utang DER (Maks 25 Poin)
    if roe >= 15.0:
        invest_score += 18.0
    elif roe >= 9.0:
        invest_score += 12.0
    elif roe > 0:
        invest_score += 5.0
    if 0 <= der <= 1.5:
        invest_score += 7.0  # Rasio utang aman

    # C. Valuasi Harga PER, PBV & Dividend Yield (Maks 25 Poin)
    if 0 < per <= 14.0:
        invest_score += 12.0
    elif 14.0 < per <= 22.0:
        invest_score += 7.0
    if 0 < pbv <= 2.0:
        invest_score += 7.0
    elif 2.0 < pbv <= 3.5:
        invest_score += 4.0
    if div_yield >= 4.0:
        invest_score += 6.0  # Dividen tinggi di atas deposito
    elif div_yield >= 1.5:
        invest_score += 3.0

    # D. Struktur Tren Jangka Panjang MA50 & MA200 (Maks 25 Poin)
    if real_price >= sma200:
        invest_score += 12.0
    elif real_price >= sma200 * 0.92:
        invest_score += 8.0
    if real_price >= sma50:
        invest_score += 8.0
    if atr_pct <= 3.8:
        invest_score += 5.0

    # =========================================================================
    # 2. SKOR SWING TRADING (Multi-MA Ribbon + MACD + ADX Bullish + RSI/Stoch)
    # =========================================================================
    swing_score = 0.0
    if real_price >= ema9 and ema9 >= ema20:
        swing_score += 22.0
    elif real_price >= ema20:
        swing_score += 15.0
    if ema20 >= sma50:
        swing_score += 15.0
    if macd_bullish:
        swing_score += 18.0
    if dmi_bullish and adx >= 20.0:
        swing_score += 18.0  # Tren Bullish Kuat Terkonfirmasi (+DI > -DI)
    elif dmi_bullish:
        swing_score += 10.0
    if 44.0 <= rsi <= 67.0:
        swing_score += 15.0  # Zona momentum optimal (belum Overbought)
    elif 32.0 <= rsi < 44.0 and stoch_bullish:
        swing_score += 13.0  # Golden Pullback / Rebound Support
    if vol_ratio >= 1.0:
        swing_score += min(12.0, vol_ratio * 6.0)

    # =========================================================================
    # 3. SKOR SCALPING (VWAP + RVOL + Candle Strength + ATR + Momentum)
    # =========================================================================
    scalp_score = 0.0
    if above_vwap:
        scalp_score += 22.0
    if green_candle and close_strength >= 0.6:
        scalp_score += 15.0  # Buyer mendominasi penutupan candle
    if vol_ratio >= 1.2:
        scalp_score += min(25.0, vol_ratio * 10.0)
    if atr_pct >= 2.5:
        scalp_score += min(18.0, atr_pct * 4.5)
    if 0.5 <= chg_pct <= 14.0:
        scalp_score += 12.0  # Naik aktif tapi belum terkunci ARA ekstrem
    if stoch_bullish or tv_rec > 0.1:
        scalp_score += 8.0

    # =========================================================================
    # 4. SELEKSI KATEGORI ORGANIK TERBAIK
    # =========================================================================
    is_fundamental_prime = (mcap >= 4_000_000_000_000 and roe >= 8.0 and 0 < per <= 28.0 and real_price >= 300)

    if is_fundamental_prime and invest_score >= 64.0 and atr_pct <= 4.0:
        category = "Investing"
        final_score = round(min(99.0, invest_score), 1)
    elif (vol_ratio >= 1.4 or atr_pct >= 3.2 or real_price <= 300) and scalp_score >= swing_score and scalp_score >= 54.0:
        category = "Scalping"
        final_score = round(min(99.0, scalp_score), 1)
    elif swing_score >= 56.0:
        category = "Swing"
        final_score = round(min(99.0, swing_score), 1)
    elif scalp_score >= 52.0:
        category = "Scalping"
        final_score = round(min(99.0, scalp_score), 1)
    elif invest_score >= 56.0:
        category = "Investing"
        final_score = round(min(99.0, invest_score), 1)
    elif is_custom:
        best_cat, best_sc = max(
            [("Scalping", scalp_score), ("Swing", swing_score), ("Investing", invest_score)],
            key=lambda x: x[1]
        )
        category = best_cat
        final_score = round(max(50.0, min(99.0, best_sc)), 1)
    else:
        return None

    # =========================================================================
    # 5. RUMUS HARGA BELI, TARGET JUAL (TP), DAN STOP LOSS (CL) PRESISI
    # =========================================================================
    if category == "Scalping":
        # Area Beli mengacu pada konfluensi Harga Pasar & VWAP
        if above_vwap and vwap >= real_price * 0.975:
            buy_price = max(min_floor, round_to_idx_tick((real_price + vwap) / 2.0))
        else:
            buy_price = max(min_floor, real_price - tick) if real_price > min_floor else real_price

        sl_pct_raw = max(1.5, min(3.6, atr_pct * 0.75)) / 100.0
        stop_loss = max(min_floor, min(buy_price - tick, round_to_idx_tick(buy_price * (1.0 - sl_pct_raw))))
        risk_rp = max(tick, buy_price - stop_loss)

        # Target Scalping mengacu pada ekspansi ATR & RRR minimal 1 : 1.7
        tp_target = buy_price + max(int(risk_rp * 1.75), int(atr_rp * 1.45))
        sell_price = max(buy_price + (2 * tick), round_to_idx_tick(tp_target))

        signal = "VWAP_BREAKOUT" if (above_vwap and vol_ratio >= 1.4) else ("MOMENTUM_SCALP" if above_vwap else "SCALP_REBOUND")
        vwap_info = f"Harga > VWAP ({vwap:,})" if above_vwap else f"Area VWAP ({vwap:,})"
        reason = f"{vwap_info} | RVOL {vol_ratio}x | ATR {atr_pct:.1f}% | Stoch {stoch_k:.0f}"

    elif category == "Swing":
        # Area Beli mengacu pada Support Dinamis EMA9 & EMA20
        support_ref = max(ema9, ema20) if real_price >= ema9 else ema20
        if real_price > support_ref and support_ref >= real_price * 0.96:
            buy_price = max(min_floor, round_to_idx_tick((real_price + support_ref) / 2.0))
        else:
            buy_price = max(min_floor, round_to_idx_tick(real_price * 0.99))

        sl_pct_raw = max(2.5, min(5.2, atr_pct * 1.25)) / 100.0
        stop_loss = max(min_floor, min(buy_price - (2 * tick), round_to_idx_tick(buy_price * (1.0 - sl_pct_raw))))
        risk_rp = max(tick * 2, buy_price - stop_loss)

        # Target Swing mengacu pada Pivot R1, High 1M, & Bollinger Upper (RRR >= 1 : 2.1)
        min_tp_rrr = buy_price + (risk_rp * 2.1)
        tech_res = max(pivot_r1, high_1m, bb_upper, buy_price * (1.0 + (atr_pct * 2.8) / 100.0))
        sell_price = max(buy_price + (3 * tick), round_to_idx_tick(max(min_tp_rrr, min(tech_res, buy_price * 1.18))))

        signal = "STRONG_UPTREND" if (macd_bullish and dmi_bullish and adx >= 20) else "SWING_PULLBACK"
        reason = f"MACD {macd_status} | ADX {adx:.0f} (+DI) | EMA20 ({round_to_idx_tick(ema20):,}) | RSI {rsi:.0f}"

    else:  # Investing
        buy_price = max(min_floor, round_to_idx_tick(real_price * 0.985))
        stop_loss = max(min_floor, min(buy_price - (2 * tick), round_to_idx_tick(buy_price * 0.94)))
        risk_rp = max(tick * 2, buy_price - stop_loss)

        # Target Investing mengacu pada valuasi fundamental & RRR >= 1 : 2.6
        min_tp_inv = buy_price + (risk_rp * 2.6)
        val_target = max(high_1m * 1.06, pivot_r1 * 1.05, buy_price * 1.16)
        sell_price = max(buy_price + (4 * tick), round_to_idx_tick(max(min_tp_inv, val_target)))

        signal = "UNDERVALUED_DIVIDEND" if (div_yield >= 3.5 and 0 < per <= 15.0) else ("UNDERVALUED_GROWTH" if (0 < per <= 15.0 and roe >= 12.0) else "BLUECHIP_LEADER")
        per_str = f"{per:.1f}x" if per > 0 else "N/A"
        pbv_str = f"{pbv:.2f}x" if pbv > 0 else "N/A"
        div_str = f"Div {div_yield:.1f}%" if div_yield > 0 else f"DER {der:.1f}x"
        reason = f"PER {per_str} | PBV {pbv_str} | ROE {roe:.1f}% | {div_str}"

    gain_pct = round(((sell_price - buy_price) / buy_price) * 100, 1) if buy_price > 0 else 0.0
    sl_pct = round(((buy_price - stop_loss) / buy_price) * 100, 1) if buy_price > 0 else 0.0
    rrr = round(gain_pct / sl_pct, 1) if sl_pct > 0 else 2.0

    return {
        "ticker": ticker,
        "category": category,
        "price": real_price,
        "chg_pct": chg_pct,
        "vol_ratio": vol_ratio,
        "rsi": rsi,
        "adx": adx,
        "vwap": vwap,
        "per": per,
        "pbv": pbv,
        "roe": roe,
        "div_yield": div_yield,
        "der": der,
        "macd_status": macd_status,
        "score": final_score,
        "buy_price": buy_price,
        "sell_price": sell_price,
        "stop_loss": stop_loss,
        "gain_pct": gain_pct,
        "sl_pct": sl_pct,
        "rrr": rrr,
        "signal": signal,
        "reason": reason,
        "update_time": now_wib_str()
    }

def fetch_from_tradingview_idx(specific_tickers: List[str] = None):
    """
    100% Koneksi Langsung ke TradingView Indonesia (IDX) Official Scanner API.
    Mendukung pemindaian seluruh bursa (900 saham) maupun Batch Live Update.
    """
    url = "https://scanner.tradingview.com/indonesia/scan"

    if specific_tickers:
        clean_list = [f"IDX:{t.strip().upper().replace('.JK', '')}" for t in specific_tickers if t.strip()]
        payload = {
            "symbols": {"tickers": clean_list, "query": {"types": []}},
            "columns": TV_COLUMNS
        }
    else:
        payload = {
            "filter": [
                {"left": "close", "operation": "greater", "right": 1},
                {"left": "Value.Traded", "operation": "greater", "right": 350000000}
            ],
            "options": {"lang": "id"},
            "markets": ["indonesia"],
            "symbols": {"query": {"types": []}, "tickers": []},
            "columns": TV_COLUMNS,
            "sort": {"sortBy": "Value.Traded", "sortOrder": "desc"},
            "range": [0, 600]
        }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=15) as response:
        resp_data = json.loads(response.read().decode("utf-8"))

    rows = resp_data.get("data", [])
    results = []
    is_custom_Flag = bool(specific_tickers)

    for item in rows:
        d = item.get("d", [])
        if len(d) < len(TV_COLUMNS):
            continue
        ticker_name = str(d[0]).strip().upper()
        # Filter hanya saham murni BEI (4 huruf alfabet), buang Waran (-W) atau Right (-R)
        if not is_custom_Flag and (len(ticker_name) != 4 or not ticker_name.isalpha()):
            continue

        evaluated = evaluate_idx_stock_ultimate(d, is_custom=is_custom_Flag)
        if evaluated:
            results.append(evaluated)

    return results

def save_stock_to_db(c, data: dict):
    c.execute("""INSERT OR REPLACE INTO stock_recs 
                 (ticker, category, price, chg_pct, vol_ratio, rsi, adx, vwap, per, pbv, roe, div_yield, der,
                  macd_status, score, buy_price, sell_price, stop_loss, gain_pct, sl_pct, rrr, signal, reason, update_time) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
              (data["ticker"], data["category"], data["price"], data["chg_pct"], data["vol_ratio"],
               data["rsi"], data["adx"], data["vwap"], data["per"], data["pbv"], data["roe"],
               data["div_yield"], data["der"], data["macd_status"], data["score"], data["buy_price"],
               data["sell_price"], data["stop_loss"], data["gain_pct"], data["sl_pct"], data["rrr"],
               data["signal"], data["reason"], data["update_time"]))

def calculate_eod_data():
    init_db()
    print("Menarik data Real-Time dari TradingView Indonesia (IDX)...")
    try:
        results = fetch_from_tradingview_idx()
        print(f"TradingView IDX OK -> {len(results)} saham potensial lolos seleksi Quant & Fundamental!")
    except Exception as e:
        print(f"Peringatan koneksi TradingView: {e}")
        results = []

    if not results:
        return

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("DELETE FROM stock_recs")
    for data in results:
        save_stock_to_db(c, data)
    conn.commit()
    conn.close()
    print("Database berhasil diperbarui 100% dari TradingView Indonesia!")

# Jadwal otomatis mengikuti Waktu Indonesia Barat (WIB)
scheduler = BackgroundScheduler(timezone=WIB_TZ)
scheduler.add_job(calculate_eod_data, 'cron', day_of_week='mon-fri', hour=9, minute=5)
scheduler.add_job(calculate_eod_data, 'cron', day_of_week='mon-fri', hour=12, minute=5)
scheduler.add_job(calculate_eod_data, 'cron', day_of_week='mon-fri', hour=16, minute=20)
scheduler.start()

@app.on_event("startup")
def startup_event():
    init_db()
    calculate_eod_data()

@app.get("/api/recommendations")
def get_recommendations():
    init_db()
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM stock_recs WHERE price IS NOT NULL ORDER BY score DESC")
    rows = c.fetchall()
    conn.close()
    return {
        "market_open": is_idx_market_open(),
        "server_time": now_wib_str(),
        "source": "TradingView IDX Official Real-Time",
        "stocks": [dict(ix) for ix in rows]
    }

@app.post("/api/refresh")
def manual_refresh():
    calculate_eod_data()
    return get_recommendations()

@app.post("/api/add_ticker")
def add_custom_ticker(req: AddTickerRequest):
    clean_t = req.ticker.strip().upper().replace(".JK", "")
    try:
        tv_res = fetch_from_tradingview_idx(specific_tickers=[clean_t])
        if not tv_res:
            raise ValueError("Not found")
        data = tv_res[0]
    except Exception:
        raise HTTPException(
            status_code=404,
            detail=f"Kode saham {clean_t} tidak ditemukan di TradingView IDX."
        )

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    save_stock_to_db(c, data)
    conn.commit()
    conn.close()
    return data

@app.post("/api/live_batch")
def update_live_batch(req: BatchLiveRequest):
    """
    Memperbarui seluruh saham di tab aktif sekaligus dalam 1 panggilan HTTP ke TradingView!
    Sangat cepat (< 1 detik) dan menggunakan < 1% limit kuota.
    """
    if not req.tickers:
        return {"updated": []}
    try:
        tv_res = fetch_from_tradingview_idx(specific_tickers=req.tickers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    for data in tv_res:
        save_stock_to_db(c, data)
    conn.commit()
    conn.close()
    return {
        "market_open": is_idx_market_open(),
        "server_time": now_wib_str(),
        "updated": tv_res
    }

@app.get("/api/live/{ticker}")
def get_live_price(ticker: str):
    clean_t = ticker.strip().upper().replace(".JK", "")
    try:
        tv_res = fetch_from_tradingview_idx(specific_tickers=[clean_t])
        if not tv_res:
            return {"ticker": clean_t, "live_price": 0, "status": "No Data"}
        data = tv_res[0]
    except Exception:
        return {"ticker": clean_t, "live_price": 0, "status": "No Data"}

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    save_stock_to_db(c, data)
    conn.commit()
    conn.close()

    data["live_price"] = data["price"]
    return data