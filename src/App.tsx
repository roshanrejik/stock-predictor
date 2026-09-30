import { useState } from "react";
import "./App.css";

const POLYGON_WORKER_URL = import.meta.env.VITE_POLYGON_WORKER_URL || "https://polygon-api-worker.roshanrejik.workers.dev/";
const WORKER_URL = import.meta.env.VITE_WORKER_URL || "http://localhost:8788";

/** Get date range: today and 30 days ago in YYYY-MM-DD */
function getDateRange() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(startDate), endDate: fmt(endDate) };
}

interface PolygonResult {
  ticker: string;
  c: number;
  h: number;
  l: number;
  o: number;
  v: number;
  t: number;
}

/** Fetch aggregated stock data from Polygon Worker API for a single ticker */
async function fetchStockData(ticker: string) {
  const dates = getDateRange();
  const url = `${POLYGON_WORKER_URL}?ticker=${ticker}&startDate=${dates.startDate}&endDate=${dates.endDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon Worker API error for ${ticker}: ${res.status}`);
  const data = await res.json();
  if (!data.results || data.resultsCount === 0) throw new Error(`No data found for ticker: ${ticker}`);
  return data.results as PolygonResult[];
}

/** Format Polygon data into a readable string for GPT */
function formatStockDataForGPT(ticker: string, results: PolygonResult[]): string {
  const latest = results[results.length - 1];
  const earliest = results[0];
  const highestClose = Math.max(...results.map((r) => r.c));
  const lowestClose = Math.min(...results.map((r) => r.c));
  const avgVolume = Math.round(results.reduce((sum, r) => sum + r.v, 0) / results.length);
  const priceChange = ((latest.c - earliest.c) / earliest.c * 100).toFixed(2);

  return `
Ticker: ${ticker}
Period: Last 30 days (${results.length} trading days)
Latest Close: $${latest.c.toFixed(2)}
Open (start of period): $${earliest.o.toFixed(2)}
30-Day High: $${highestClose.toFixed(2)}
30-Day Low: $${lowestClose.toFixed(2)}
Price Change: ${priceChange}%
Avg Daily Volume: ${avgVolume.toLocaleString()}
  `.trim();
}

/** Call the Cloudflare Worker to get GPT-4 prediction */
async function callWorkerForPrediction(stockDataSummary: string): Promise<string> {
  const messages = [
    {
      role: "system",
      content: `You are "Dodgy Dave", a hilariously overconfident, slightly shady stock market analyst who speaks in a fun, informal, cockney-ish style. You give entertaining (but clearly not real) stock predictions. 

Your reports should:
- Be entertaining and funny
- Include made-up "insider tips" and wild predictions
- Use stock data provided to sound semi-credible
- Always end with a disclaimer that this is not real financial advice
- Use emojis liberally
- Format nicely with headers and bullet points in HTML (use <h3>, <p>, <ul>, <li>, <strong>, <em> tags)`,
    },
    {
      role: "user",
      content: `Based on the following stock data, generate a short, entertaining prediction report for each stock:\n\n${stockDataSummary}`,
    },
  ];

  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || `Worker error: ${res.status}`);
  }

  const data = await res.json() as { content: string };
  if (!data.content) throw new Error("No response from GPT-4");
  return data.content;
}

function App() {
  const [tickerInput, setTickerInput] = useState("");
  const [tickersArr, setTickersArr] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [report, setReport] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"action" | "loading" | "output">("action");

  const addTicker = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = tickerInput.trim().toUpperCase();
    if (!ticker) return;
    if (tickersArr.length >= 3) return;
    if (tickersArr.includes(ticker)) return;
    setTickersArr([...tickersArr, ticker]);
    setTickerInput("");
  };

  const removeTicker = (t: string) => {
    setTickersArr(tickersArr.filter((x) => x !== t));
  };

  const generateReport = async () => {
    if (tickersArr.length === 0) return;

    setLoading(true);
    setError("");
    setReport("");
    setView("loading");
    setLoadingMsg("Querying Stocks API...");

    try {
      // 1. Fetch stock data for all tickers from Polygon
      const allStockData: string[] = [];
      for (const ticker of tickersArr) {
        setLoadingMsg(`Fetching data for ${ticker}...`);
        const results = await fetchStockData(ticker);
        allStockData.push(formatStockDataForGPT(ticker, results));
      }

      // 2. Send stock data to Cloudflare Worker → GPT-4
      setLoadingMsg("Asking Dodgy Dave for his predictions...");
      const content = await callWorkerForPrediction(allStockData.join("\n\n---\n\n"));

      setReport(content);
      setView("output");
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong!");
      setView("action");
    } finally {
      setLoading(false);
    }
  };

  const resetApp = () => {
    setView("action");
    setReport("");
    setError("");
    setTickersArr([]);
    setTickerInput("");
  };

  return (
    <div className="app">
      <header>
        <img src="/logo-dave.png" alt="Dodgy Dave's Stock Predictions" className="logo" />
      </header>

      <main>
        {/* ACTION PANEL */}
        {view === "action" && (
          <section className="action-panel">
            <form id="ticker-input-form" onSubmit={addTicker}>
              <label htmlFor="ticker-input">
                Add up to 3 stock tickers below to get a super accurate stock
                predictions report 👇
              </label>
              <div className="form-input-control">
                <input
                  type="text"
                  id="ticker-input"
                  placeholder="MSFT"
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value)}
                  disabled={tickersArr.length >= 3}
                  maxLength={5}
                />
                <button
                  className="add-ticker-btn"
                  type="submit"
                  disabled={tickersArr.length >= 3 || !tickerInput.trim()}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </form>

            <div className="ticker-choice-display">
              {tickersArr.length === 0 ? (
                <p className="placeholder-text">Your tickers will appear here...</p>
              ) : (
                <div className="ticker-tags">
                  {tickersArr.map((t) => (
                    <span key={t} className="ticker-tag">
                      {t}
                      <button className="remove-ticker" onClick={() => removeTicker(t)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="error">{error}</p>}

            <button
              className="generate-report-btn"
              type="button"
              onClick={generateReport}
              disabled={tickersArr.length === 0 || loading}
            >
              Generate Report
            </button>
            <p className="tag-line">Always correct 15% of the time!</p>
          </section>
        )}

        {/* LOADING PANEL */}
        {view === "loading" && (
          <section className="loading-panel">
            <div className="spinner" />
            <p className="loading-msg">{loadingMsg}</p>
          </section>
        )}

        {/* OUTPUT PANEL */}
        {view === "output" && (
          <section className="output-panel">
            <h2>Your Report 😜</h2>
            <div
              className="report-content"
              dangerouslySetInnerHTML={{ __html: report }}
            />
            <button className="back-btn" onClick={resetApp}>
              Start Over
            </button>
          </section>
        )}
      </main>

      <footer>
        <p>&copy; This is not real financial advice!</p>
      </footer>
    </div>
  );
}

export default App;
