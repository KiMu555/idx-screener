"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Stock,
  getInitialRecommendationsAction,
  refreshFullMarketScanAction,
  addCustomTickerAction,
  updateLiveBatchAction,
} from "./actions";

export default function Dashboard() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [marketOpen, setMarketOpen] = useState<boolean>(false);
  const [serverTime, setServerTime] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("Scalping");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("score");
  const [capitalInput, setCapitalInput] = useState<string>("5000000");
  const [customTicker, setCustomTicker] = useState<string>("");
  const [addingTicker, setAddingTicker] = useState<boolean>(false);
  const [liveTickers, setLiveTickers] = useState<Record<string, boolean>>({});
  const [loadingLive, setLoadingLive] = useState<boolean>(false);
  const [autoLive, setAutoLive] = useState<boolean>(false);
  const [syncingDb, setSyncingDb] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    try {
      const data = await getInitialRecommendationsAction();
      setStocks(data.stocks || []);
      setMarketOpen(Boolean(data.market_open));
      setServerTime(data.server_time || "");
      setErrorMsg(null);
    } catch (err) {
      console.error("Error fetching recommendations:", err);
      setErrorMsg("Gagal menarik data dari TradingView IDX. Coba klik tombol Scan di kanan atas.");
    }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  const fetchLivePricesForCurrentTab = useCallback(async () => {
    const currentTabStocks = stocks
      .filter((s) => s.category === activeTab)
      .slice(0, 30);
    if (currentTabStocks.length === 0) return;

    setLoadingLive(true);
    try {
      const tickersToUpdate = currentTabStocks.map((s) => s.ticker);
      const resData = await updateLiveBatchAction(tickersToUpdate);
      const updatedList = resData.updated || [];

      if (resData.server_time) setServerTime(resData.server_time);
      setMarketOpen(Boolean(resData.market_open));

      setStocks((prev) => {
        const mapUpdated = new Map(updatedList.map((u) => [u.ticker, u]));
        return prev.map((item) =>
          mapUpdated.has(item.ticker)
            ? { ...item, ...mapUpdated.get(item.ticker)!, category: item.category }
            : item
        );
      });

      const newBadges: Record<string, boolean> = {};
      updatedList.forEach((u) => {
        newBadges[u.ticker] = true;
      });
      setLiveTickers((prev) => ({ ...prev, ...newBadges }));
    } catch (err) {
      console.error("Batch live error:", err);
    }
    setLoadingLive(false);
  }, [stocks, activeTab]);

  useEffect(() => {
    if (!autoLive) return;
    const interval = setInterval(() => {
      fetchLivePricesForCurrentTab();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoLive, fetchLivePricesForCurrentTab]);

  const handleSyncDatabase = async () => {
    setSyncingDb(true);
    setInfoMsg(
      "Menarik 35 Parameter Real-Time TradingView Indonesia (VWAP, EMA9/20, SMA50/200, MACD, ADX +DI/-DI, PER, PBV, ROE, Dividen, DER)..."
    );
    try {
      const data = await refreshFullMarketScanAction();
      setStocks(data.stocks || []);
      setServerTime(data.server_time || "");
      setMarketOpen(Boolean(data.market_open));
      setErrorMsg(null);
      setInfoMsg(
        `100% Data TradingView IDX Terkini! ${data.stocks.length} saham terbaik BEI berhasil lolos seleksi.`
      );
      setTimeout(() => setInfoMsg(null), 6000);
    } catch (err) {
      console.error("Sync error:", err);
      setErrorMsg("Gagal melakukan pemindaian pasar TradingView IDX.");
    }
    setSyncingDb(false);
  };

  const handleAddCustomTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTicker.trim()) return;
    setAddingTicker(true);
    setErrorMsg(null);
    try {
      const newStock = await addCustomTickerAction(customTicker);
      setStocks((prev) => {
        const filtered = prev.filter((s) => s.ticker !== newStock.ticker);
        return [newStock, ...filtered];
      });
      setActiveTab(newStock.category);
      setCustomTicker("");
      setInfoMsg(
        `Saham ${newStock.ticker} (Rp ${formatRupiah(newStock.price)}) dianalisis dari TradingView -> Kategori ${newStock.category} (Skor: ${newStock.score})!`
      );
      setTimeout(() => setInfoMsg(null), 5000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Kode saham tidak ditemukan di TradingView IDX.");
      }
    }
    setAddingTicker(false);
  };

  const formatRupiah = (val: number | null | undefined) => {
    const safeNumber = typeof val === "number" && !Number.isNaN(val) ? val : 0;
    return Math.round(safeNumber).toLocaleString("id-ID");
  };

  const userCapital = Math.max(0, Number(capitalInput.replace(/[^0-9]/g, "")) || 0);

  const filteredStocks = stocks
    .filter((s) => s.category === activeTab)
    .filter((s) => s.ticker.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "score") return (b.score || 0) - (a.score || 0);
      if (sortBy === "rrr") return (b.rrr || 0) - (a.rrr || 0);
      if (sortBy === "gain") return (b.gain_pct || 0) - (a.gain_pct || 0);
      if (sortBy === "vol") return (b.vol_ratio || 0) - (a.vol_ratio || 0);
      if (sortBy === "roe") return (b.roe || 0) - (a.roe || 0);
      if (sortBy === "div") return (b.div_yield || 0) - (a.div_yield || 0);
      if (sortBy === "price_asc") return (a.price || 0) - (b.price || 0);
      return a.ticker.localeCompare(b.ticker);
    });

  return (
    <div className="min-h-screen bg-gray-900 text-white p-3 sm:p-5 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header Responsif Smartphone, Tablet & Laptop */}
        <header className="mb-5 md:mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-blue-400 flex items-center gap-2 sm:gap-2.5 leading-tight">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-6 h-6 sm:w-8 sm:h-8 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <span>KIMU Indonesian Stock Market Screener</span>
              </h1>
              <span
                className={`text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 rounded-full border flex items-center gap-1.5 shrink-0 ${
                  marketOpen
                    ? "bg-green-900/60 text-green-300 border-green-500"
                    : "bg-gray-800 text-gray-300 border-gray-600"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    marketOpen ? "bg-green-400 animate-ping" : "bg-gray-400"
                  }`}
                />
                {marketOpen ? "IDX MARKET OPEN (LIVE)" : "IDX MARKET CLOSED (OFFICIAL EOD)"}
              </span>
            </div>
            <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
              Powered by TradingView Indonesia Official Real-Time Data (35 Parameter Teknikal & Fundamental)
              {serverTime && (
                <span className="block sm:inline sm:ml-2 text-gray-500 mt-0.5 sm:mt-0">
                  | {serverTime}
                </span>
              )}
            </p>
          </div>

          <button
            onClick={handleSyncDatabase}
            disabled={syncingDb}
            className="w-full sm:w-auto justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 border border-blue-400 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 self-stretch sm:self-start lg:self-center cursor-pointer transition shadow-lg shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={syncingDb ? "animate-spin shrink-0" : "shrink-0"}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
            {syncingDb
              ? "Memindai TradingView IDX..."
              : "Refresh Screener Sekarang"}
          </button>
        </header>

        {errorMsg && (
          <div className="mb-4 p-3 sm:p-4 bg-red-900/50 border border-red-500 rounded-lg text-red-200 text-xs sm:text-sm">
            ⚠️ <strong>Peringatan:</strong> {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div className="mb-4 p-3 sm:p-4 bg-blue-900/50 border border-blue-500 rounded-lg text-blue-200 text-xs sm:text-sm">
            ✅ {infoMsg}
          </div>
        )}

        {/* Panel Kontrol Responsif: 1 Kolom (HP), 2 Kolom (Tablet), 12 Kolom (Laptop) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 sm:gap-4 mb-5 md:mb-6 bg-gray-800/90 p-3.5 sm:p-4 rounded-lg border border-gray-700">
          <div className="lg:col-span-3">
            <label className="block text-xs text-gray-400 mb-1">
              Cari Kode Emiten
            </label>
            <input
              type="text"
              placeholder="Contoh: BBCA, ANTM, GOTO..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="lg:col-span-3">
            <label className="block text-xs text-gray-400 mb-1">
              Urutkan Berdasarkan
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="score">🔥 Skor Quant Tertinggi (Terbaik)</option>
              <option value="rrr">⚖️ Rasio Risk/Reward Terbaik</option>
              <option value="vol">📊 Lonjakan Volume (RVOL) Tertinggi</option>
              <option value="roe">📈 Profitabilitas ROE Tertinggi</option>
              <option value="div">💵 Dividend Yield (%) Tertinggi</option>
              <option value="gain">💰 Potensi Profit (%) Tertinggi</option>
              <option value="price_asc">🏷️ Harga Termurah ke Termahal</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <label className="block text-xs text-cyan-300 mb-1 font-semibold">
              Simulasi Modal Beli (Rp) — Hitung Lot Otomatis
            </label>
            <input
              type="number"
              step="500000"
              min="100000"
              value={capitalInput}
              onChange={(e) => setCapitalInput(e.target.value)}
              className="w-full bg-gray-900 border border-cyan-700 rounded-lg px-3 py-2 text-sm text-cyan-200 font-mono focus:outline-none focus:border-cyan-400"
            />
          </div>

          <form
            onSubmit={handleAddCustomTicker}
            className="lg:col-span-3 flex items-end gap-2"
          >
            <div className="flex-1 min-w-0">
              <label className="block text-xs text-gray-400 mb-1 truncate">
                Cek Saham BEI Lainnya (TradingView)
              </label>
              <input
                type="text"
                maxLength={6}
                placeholder="Kode (misal: CBDK)"
                value={customTicker}
                onChange={(e) => setCustomTicker(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 uppercase"
              />
            </div>
            <button
              type="submit"
              disabled={addingTicker}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 px-3.5 py-2 rounded-lg text-sm font-bold cursor-pointer transition whitespace-nowrap shrink-0"
            >
              {addingTicker ? "Cek..." : "+ Analisis"}
            </button>
          </form>
        </div>

        {/* Navigasi Tab & Tombol Live Responsif */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4 mb-4 border-b border-gray-700 pb-3">
          <div className="grid grid-cols-3 sm:flex gap-2 sm:gap-3 w-full md:w-auto">
            {["Scalping", "Swing", "Investing"].map((tab) => {
              const count = stocks.filter((s) => s.category === tab).length;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-2.5 sm:px-5 py-2 sm:py-2.5 font-semibold rounded-lg transition cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-xs sm:text-base ${
                    activeTab === tab
                      ? "bg-blue-600 text-white shadow-lg"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  <span>{tab}</span>
                  <span className="bg-gray-900/80 text-[10px] sm:text-xs px-2 sm:px-2.5 py-0.5 rounded-full font-bold whitespace-nowrap">
                    {count} Saham
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full md:w-auto">
            <button
              onClick={() => setAutoLive((prev) => !prev)}
              className={`px-3.5 py-2.5 sm:py-2 rounded-lg font-bold text-xs border transition cursor-pointer flex items-center justify-center gap-2 ${
                autoLive
                  ? "bg-emerald-900/80 text-emerald-300 border-emerald-500"
                  : "bg-gray-800 text-gray-400 border-gray-700 hover:text-white"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  autoLive ? "bg-emerald-400 animate-ping" : "bg-gray-500"
                }`}
              />
              {autoLive ? "Auto-Refresh 15s: ON" : "Auto-Refresh 15s: OFF"}
            </button>

            <button
              onClick={fetchLivePricesForCurrentTab}
              disabled={loadingLive}
              className="bg-green-600 hover:bg-green-500 disabled:bg-gray-600 px-4 py-2.5 sm:py-2 rounded-lg font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer shadow"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loadingLive ? "animate-spin shrink-0" : "shrink-0"}
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
              {loadingLive
                ? `Menarik Live TradingView...`
                : `Update Live Tab ${activeTab}`}
            </button>
          </div>
        </div>

        {/* TAMPILAN SMARTPHONE (< 768px): Kartu Responsif Tanpa Perlu Geser Tabel */}
        <div className="md:hidden space-y-3">
          {filteredStocks.map((stock, index) => {
            const signalText = stock.signal || "HOLD";
            const isLive = liveTickers[stock.ticker];
            const chg = stock.chg_pct || 0;
            const buyPrice = stock.buy_price || stock.price || 1;
            const costPerLot = buyPrice * 100;
            const maxLots = costPerLot > 0 ? Math.floor(userCapital / costPerLot) : 0;
            const estProfitRp =
              maxLots * 100 * ((stock.sell_price || buyPrice) - buyPrice);

            return (
              <div
                key={stock.ticker}
                className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-md space-y-3"
              >
                {/* Baris Atas Kartu: Emiten, Skor & Harga Real-Time */}
                <div className="flex items-start justify-between gap-2 border-b border-gray-700 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 font-mono text-xs">
                        #{index + 1}
                      </span>
                      <span className="font-bold text-lg text-blue-400">
                        {stock.ticker}
                      </span>
                      <span className="bg-blue-900/70 text-blue-200 border border-blue-600 text-xs px-2 py-0.5 rounded font-bold">
                        Skor {stock.score ?? 0}
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-emerald-300 block mt-0.5">
                      {signalText.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-base font-semibold text-white flex items-center justify-end gap-1.5">
                      <span>Rp {formatRupiah(stock.price)}</span>
                      {isLive && (
                        <span className="text-green-400 text-[10px] border border-green-400 px-1.5 py-0.5 rounded animate-pulse">
                          LIVE TV
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-0.5">
                      <span
                        className={`font-bold ${
                          chg > 0
                            ? "text-green-400"
                            : chg < 0
                            ? "text-red-400"
                            : "text-gray-400"
                        }`}
                      >
                        {chg > 0 ? `+${chg}%` : `${chg}%`}
                      </span>
                      <span className="text-gray-400 text-[11px] ml-1">
                        | VWAP: Rp {formatRupiah(stock.vwap)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Grid Trading Plan: Rekomendasi Beli, Target Jual (TP), Stop Loss & RRR */}
                <div className="grid grid-cols-2 gap-2.5 bg-gray-900/60 p-3 rounded-lg border border-gray-700/70 font-mono">
                  <div>
                    <div className="text-[10px] uppercase font-sans text-cyan-300 font-semibold">
                      Rekomendasi Beli & Lot
                    </div>
                    <div className="text-cyan-300 font-bold text-sm mt-0.5">
                      Rp {formatRupiah(stock.buy_price)}
                    </div>
                    <div className="text-[11px] text-cyan-100/80 font-sans mt-0.5">
                      Bisa Beli: <strong>{maxLots.toLocaleString("id-ID")} Lot</strong>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase font-sans text-green-300 font-semibold">
                      Target Jual (TP)
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-green-400 font-bold text-sm">
                        Rp {formatRupiah(stock.sell_price)}
                      </span>
                      {stock.gain_pct !== null && (
                        <span className="bg-green-900/70 text-green-300 border border-green-700 text-[10px] px-1.5 py-0.5 rounded font-sans font-bold">
                          +{stock.gain_pct}%
                        </span>
                      )}
                    </div>
                    {maxLots > 0 && (
                      <div className="text-[11px] text-green-300/80 font-sans mt-0.5">
                        Est. Cuan: +Rp {formatRupiah(estProfitRp)}
                      </div>
                    )}
                  </div>

                  <div className="col-span-2 pt-2 border-t border-gray-800 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase font-sans text-red-300 font-semibold">
                        Stop Loss & RRR
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-red-400 font-semibold text-sm">
                          Rp {formatRupiah(stock.stop_loss)}
                        </span>
                        {stock.sl_pct !== null && (
                          <span className="text-red-300 text-xs font-sans">
                            (-{stock.sl_pct}%)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-amber-300 font-sans font-semibold">
                      Risk/Reward = 1 : {stock.rrr ?? 2.0}
                    </div>
                  </div>
                </div>

                {/* Indikator TradingView & Fundamental */}
                <div>
                  <div className="text-xs font-semibold text-gray-200 mb-1.5">
                    {stock.reason}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="bg-gray-700 px-2 py-0.5 rounded text-gray-300">
                      RVOL: {stock.vol_ratio ?? 1}x
                    </span>
                    <span className="bg-gray-700 px-2 py-0.5 rounded text-gray-300">
                      RSI: {stock.rsi ?? 50}
                    </span>
                    <span className="bg-gray-700 px-2 py-0.5 rounded text-gray-300">
                      ADX: {stock.adx ?? 20}
                    </span>
                    {stock.roe !== null && stock.roe !== 0 && (
                      <span className="bg-indigo-900/60 border border-indigo-700 px-2 py-0.5 rounded text-indigo-200">
                        ROE: {stock.roe}%
                      </span>
                    )}
                    {stock.per !== null && stock.per > 0 && (
                      <span className="bg-indigo-900/60 border border-indigo-700 px-2 py-0.5 rounded text-indigo-200">
                        PER: {stock.per}x
                      </span>
                    )}
                    {stock.div_yield !== null && stock.div_yield > 0 && (
                      <span className="bg-emerald-900/60 border border-emerald-700 px-2 py-0.5 rounded text-emerald-200">
                        Div: {stock.div_yield}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredStocks.length === 0 && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center text-gray-400 text-sm">
              Sedang memindai data real-time dari TradingView Indonesia...
            </div>
          )}
        </div>

        {/* TAMPILAN TABLET & LAPTOP (>= 768px): Tabel Penuh Responsif */}
        <div className="hidden md:block bg-gray-800 rounded-lg shadow-lg overflow-x-auto border border-gray-700">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-700/90 text-gray-200 text-xs uppercase">
              <tr>
                <th className="p-3 lg:p-4 whitespace-nowrap">Rank</th>
                <th className="p-3 lg:p-4 whitespace-nowrap">Emiten & Skor Quant</th>
                <th className="p-3 lg:p-4 whitespace-nowrap">Harga Real-Time & VWAP</th>
                <th className="p-3 lg:p-4 text-cyan-300 whitespace-nowrap">Rekomendasi Beli & Lot</th>
                <th className="p-3 lg:p-4 text-green-300 whitespace-nowrap">Target Jual (TP)</th>
                <th className="p-3 lg:p-4 text-red-300 whitespace-nowrap">Stop Loss & RRR</th>
                <th className="p-3 lg:p-4">Indikator TradingView & Fundamental</th>
              </tr>
            </thead>
            <tbody>
              {filteredStocks.map((stock, index) => {
                const signalText = stock.signal || "HOLD";
                const isLive = liveTickers[stock.ticker];
                const chg = stock.chg_pct || 0;
                const buyPrice = stock.buy_price || stock.price || 1;
                const costPerLot = buyPrice * 100;
                const maxLots = costPerLot > 0 ? Math.floor(userCapital / costPerLot) : 0;
                const estProfitRp =
                  maxLots * 100 * ((stock.sell_price || buyPrice) - buyPrice);

                return (
                  <tr
                    key={stock.ticker}
                    className="border-b border-gray-700 hover:bg-gray-700/40 transition"
                  >
                    <td className="p-3 lg:p-4 text-gray-400 font-mono text-sm whitespace-nowrap">
                      #{index + 1}
                    </td>

                    <td className="p-3 lg:p-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-blue-400">
                          {stock.ticker}
                        </span>
                        <span className="bg-blue-900/70 text-blue-200 border border-blue-600 text-xs px-2 py-0.5 rounded font-bold">
                          Skor {stock.score ?? 0}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-emerald-300">
                        {signalText.replace(/_/g, " ")}
                      </span>
                    </td>

                    <td className="p-3 lg:p-4 font-mono whitespace-nowrap">
                      <div className="text-base font-semibold text-white flex items-center gap-2">
                        Rp {formatRupiah(stock.price)}
                        {isLive && (
                          <span className="text-green-400 text-[10px] border border-green-400 px-1.5 py-0.5 rounded animate-pulse">
                            LIVE TV
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs mt-0.5">
                        <span
                          className={`font-bold ${
                            chg > 0
                              ? "text-green-400"
                              : chg < 0
                              ? "text-red-400"
                              : "text-gray-400"
                          }`}
                        >
                          {chg > 0 ? `+${chg}%` : `${chg}%`}
                        </span>
                        <span className="text-gray-400 text-[11px]">
                          | VWAP: Rp {formatRupiah(stock.vwap)}
                        </span>
                      </div>
                    </td>

                    <td className="p-3 lg:p-4 font-mono whitespace-nowrap">
                      <div className="text-cyan-300 font-bold text-base">
                        Rp {formatRupiah(stock.buy_price)}
                      </div>
                      <div className="text-[11px] text-cyan-100/80 font-sans mt-0.5">
                        Bisa Beli: <strong>{maxLots.toLocaleString("id-ID")} Lot</strong>
                      </div>
                    </td>

                    <td className="p-3 lg:p-4 font-mono whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-green-400 font-bold text-base">
                          Rp {formatRupiah(stock.sell_price)}
                        </span>
                        {stock.gain_pct !== null && (
                          <span className="bg-green-900/70 text-green-300 border border-green-700 text-xs px-1.5 py-0.5 rounded font-sans font-bold">
                            +{stock.gain_pct}%
                          </span>
                        )}
                      </div>
                      {maxLots > 0 && (
                        <div className="text-[11px] text-green-300/80 font-sans mt-0.5">
                          Est. Cuan: +Rp {formatRupiah(estProfitRp)}
                        </div>
                      )}
                    </td>

                    <td className="p-3 lg:p-4 font-mono whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-red-400 font-semibold text-base">
                          Rp {formatRupiah(stock.stop_loss)}
                        </span>
                        {stock.sl_pct !== null && (
                          <span className="text-red-300 text-xs font-sans">
                            (-{stock.sl_pct}%)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-amber-300 font-sans font-semibold mt-0.5">
                        Risk/Reward = 1 : {stock.rrr ?? 2.0}
                      </div>
                    </td>

                    <td className="p-3 lg:p-4 min-w-[260px]">
                      <div className="text-xs font-semibold text-gray-200 mb-1.5">
                        {stock.reason}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        <span className="bg-gray-700 px-2 py-0.5 rounded text-gray-300">
                          RVOL: {stock.vol_ratio ?? 1}x
                        </span>
                        <span className="bg-gray-700 px-2 py-0.5 rounded text-gray-300">
                          RSI: {stock.rsi ?? 50}
                        </span>
                        <span className="bg-gray-700 px-2 py-0.5 rounded text-gray-300">
                          ADX: {stock.adx ?? 20}
                        </span>
                        {stock.roe !== null && stock.roe !== 0 && (
                          <span className="bg-indigo-900/60 border border-indigo-700 px-2 py-0.5 rounded text-indigo-200">
                            ROE: {stock.roe}%
                          </span>
                        )}
                        {stock.per !== null && stock.per > 0 && (
                          <span className="bg-indigo-900/60 border border-indigo-700 px-2 py-0.5 rounded text-indigo-200">
                            PER: {stock.per}x
                          </span>
                        )}
                        {stock.div_yield !== null && stock.div_yield > 0 && (
                          <span className="bg-emerald-900/60 border border-emerald-700 px-2 py-0.5 rounded text-emerald-200">
                            Div: {stock.div_yield}%
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredStocks.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">
                    Sedang memindai data real-time dari TradingView Indonesia...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}