/**
 * NEPSE AI ANALYZER — Technical Analysis Engine
 * Computes RSI, MACD, EMA, Bollinger Bands, Volume analysis, Support/Resistance
 * Returns composite AI signal with BUY/SELL/HOLD and confidence %
 */

const TechnicalAnalysis = (() => {

  // ── EMA (Exponential Moving Average) ─────────────────────────────────────
  function ema(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      emaVal = prices[i] * k + emaVal * (1 - k);
    }
    return Math.round(emaVal * 100) / 100;
  }

  function emaArray(prices, period) {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    const result = new Array(period - 1).fill(null);
    let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(Math.round(emaVal * 100) / 100);
    for (let i = period; i < prices.length; i++) {
      emaVal = prices[i] * k + emaVal * (1 - k);
      result.push(Math.round(emaVal * 100) / 100);
    }
    return result;
  }

  // ── SMA (Simple Moving Average) ──────────────────────────────────────────
  function sma(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return Math.round(slice.reduce((a, b) => a + b, 0) / period * 100) / 100;
  }

  // ── RSI (Relative Strength Index, 14-period) ──────────────────────────────
  function rsi(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period; i < changes.length; i++) {
      const gain = changes[i] > 0 ? changes[i] : 0;
      const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    // A perfectly flat series has neither gains nor losses, so report a
    // neutral RSI instead of incorrectly classifying it as overbought.
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    const rs = avgGain / avgLoss;
    return Math.round((100 - (100 / (1 + rs))) * 100) / 100;
  }

  // ── MACD ─────────────────────────────────────────────────────────────────
  function macd(prices) {
    if (prices.length < 26) return null;
    const ema12 = emaArray(prices, 12);
    const ema26 = emaArray(prices, 26);
    const macdLine = [];
    for (let i = 0; i < prices.length; i++) {
      if (ema12[i] !== null && ema26[i] !== null) {
        macdLine.push(Math.round((ema12[i] - ema26[i]) * 100) / 100);
      } else {
        macdLine.push(null);
      }
    }
    const validMacd = macdLine.filter(v => v !== null);
    const signalLine = validMacd.length >= 9 ? emaArray(validMacd, 9) : [];
    const lastMacd = validMacd.length > 0 ? validMacd[validMacd.length - 1] : 0;
    const lastSignal = signalLine.length > 0 ? signalLine[signalLine.length - 1] : 0;
    const prevMacd = validMacd.length > 1 ? validMacd[validMacd.length - 2] : 0;
    const prevSignal = signalLine.length > 1 ? signalLine[signalLine.length - 2] : 0;
    return {
      macd: Math.round(lastMacd * 100) / 100,
      signal: Math.round(lastSignal * 100) / 100,
      histogram: Math.round((lastMacd - lastSignal) * 100) / 100,
      crossover: (prevMacd < prevSignal && lastMacd > lastSignal) ? 'bullish' :
                 (prevMacd > prevSignal && lastMacd < lastSignal) ? 'bearish' : 'none'
    };
  }

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  function bollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    const upper = Math.round((mean + stdDev * std) * 100) / 100;
    const lower = Math.round((mean - stdDev * std) * 100) / 100;
    const mid = Math.round(mean * 100) / 100;
    const lastPrice = prices[prices.length - 1];
    const pctB = std > 0 ? Math.round(((lastPrice - lower) / (upper - lower)) * 100) : 50;
    return { upper, mid, lower, pctB, bandwidth: Math.round((upper - lower) / mid * 100 * 100) / 100 };
  }

  // ── Volume Analysis ───────────────────────────────────────────────────────
  function volumeAnalysis(volumes, currentVolume) {
    if (!volumes || volumes.length < 5) return { spike: false, ratio: 1 };
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(volumes.length, 20);
    // Missing/zero volume history has no usable baseline for a ratio.
    if (!Number.isFinite(avgVol) || avgVol <= 0 || !Number.isFinite(currentVolume) || currentVolume < 0) {
      return { spike: false, ratio: 1, avgVolume: 0 };
    }
    const ratio = Math.round((currentVolume / avgVol) * 100) / 100;
    return { spike: ratio > 1.8, ratio, avgVolume: Math.round(avgVol) };
  }

  // ── Support / Resistance ──────────────────────────────────────────────────
  function supportResistance(prices) {
    if (prices.length < 10) return { support: 0, resistance: 0 };
    const recent = prices.slice(-30);
    const support = Math.min(...recent);
    const resistance = Math.max(...recent);
    return {
      support: Math.round(support * 100) / 100,
      resistance: Math.round(resistance * 100) / 100
    };
  }

  // ── Generate realistic price history for a stock ─────────────────────────
  function generatePriceHistory(stock, days = 60) {
    const prices = [];
    const volumes = [];
    let price = stock.prevClose * (0.85 + Math.random() * 0.1);
    // charCodeAt(1) is NaN for single-character symbols, which silently
    // zeroed the trend bias on those stocks.
    const seed = stock.symbol.charCodeAt(0) + (stock.symbol.charCodeAt(1) || 0);
    const trend = (((seed % 7) || 0) - 3) * 0.002; // slight trend bias per stock

    for (let i = days; i >= 0; i--) {
      const volatility = stock.ltp * 0.018;
      const change = (Math.random() - 0.5 + trend) * volatility;
      price = Math.max(stock.ltp * 0.6, Math.min(stock.ltp * 1.5, price + change));
      prices.push(Math.round(price * 100) / 100);
      volumes.push(Math.floor(stock.volume * (0.4 + Math.random() * 1.4)));
    }
    // Force last price to match current ltp
    prices[prices.length - 1] = stock.ltp;
    return { prices, volumes };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN: Analyze a stock and produce BUY/SELL/HOLD signal
  // ─────────────────────────────────────────────────────────────────────────
  function analyzeStock(stock, priceHistory, volumeHistory) {
    // BUG FIX: generatePriceHistory(stock) was called twice, producing two
    // DIFFERENT random walks — volumes no longer corresponded to the prices
    // being analyzed. Generate once and reuse.
    const generated = generatePriceHistory(stock);
    const prices = priceHistory || generated.prices;
    const volumes = volumeHistory || generated.volumes;
    const currentPrice = prices[prices.length - 1];

    // Compute indicators
    const rsiVal = rsi(prices);
    const macdVal = macd(prices);
    const bb = bollingerBands(prices);
    const ema9Val = ema(prices, 9);
    const ema21Val = ema(prices, 21);
    const ema50Val = ema(prices, Math.min(50, prices.length - 1));
    const sma20Val = sma(prices, 20);
    const volAnalysis = volumeAnalysis(volumes, volumes[volumes.length - 1]);
    const sr = supportResistance(prices);

    // ── Scoring system ────────────────────────────────────────────────────
    // Each indicator contributes to a score: -1 (bearish) to +1 (bullish)
    let score = 0;
    let signals = [];
    const indicators = {};

    // RSI signal
    if (rsiVal !== null) {
      indicators.rsi = rsiVal;
      if (rsiVal < 30) {
        score += 1.5;
        signals.push({ ind: 'RSI', value: `${rsiVal}`, bias: 'bullish', reason: `RSI ${rsiVal} — deeply oversold, strong rebound expected` });
      } else if (rsiVal < 40) {
        score += 0.8;
        signals.push({ ind: 'RSI', value: `${rsiVal}`, bias: 'bullish', reason: `RSI ${rsiVal} — approaching oversold territory, buying opportunity` });
      } else if (rsiVal > 70) {
        score -= 1.5;
        signals.push({ ind: 'RSI', value: `${rsiVal}`, bias: 'bearish', reason: `RSI ${rsiVal} — overbought, potential pullback in 1-3 days` });
      } else if (rsiVal > 60) {
        score -= 0.5;
        signals.push({ ind: 'RSI', value: `${rsiVal}`, bias: 'bearish', reason: `RSI ${rsiVal} — approaching overbought, momentum may slow` });
      } else {
        score += 0.1;
        signals.push({ ind: 'RSI', value: `${rsiVal}`, bias: 'neutral', reason: `RSI ${rsiVal} — neutral momentum zone` });
      }
    }

    // MACD signal
    if (macdVal !== null) {
      indicators.macd = macdVal;
      if (macdVal.crossover === 'bullish') {
        score += 1.8;
        signals.push({ ind: 'MACD', value: `${macdVal.macd}`, bias: 'bullish', reason: `MACD bullish crossover — strong buy signal, uptrend beginning` });
      } else if (macdVal.crossover === 'bearish') {
        score -= 1.8;
        signals.push({ ind: 'MACD', value: `${macdVal.macd}`, bias: 'bearish', reason: `MACD bearish crossover — sell signal, downtrend beginning` });
      } else if (macdVal.histogram > 0) {
        score += 0.6;
        signals.push({ ind: 'MACD', value: `${macdVal.macd}`, bias: 'bullish', reason: `MACD histogram positive — bullish momentum continuing` });
      } else {
        score -= 0.6;
        signals.push({ ind: 'MACD', value: `${macdVal.macd}`, bias: 'bearish', reason: `MACD histogram negative — bearish pressure present` });
      }
    }

    // EMA crossover (9 vs 21)
    if (ema9Val !== null && ema21Val !== null) {
      indicators.ema9 = ema9Val;
      indicators.ema21 = ema21Val;
      if (ema9Val > ema21Val) {
        score += 0.8;
        signals.push({ ind: 'EMA 9/21', value: `${ema9Val}/${ema21Val}`, bias: 'bullish', reason: `EMA 9 (${ema9Val}) above EMA 21 (${ema21Val}) — golden cross, uptrend confirmed` });
      } else {
        score -= 0.8;
        signals.push({ ind: 'EMA 9/21', value: `${ema9Val}/${ema21Val}`, bias: 'bearish', reason: `EMA 9 (${ema9Val}) below EMA 21 (${ema21Val}) — death cross, downtrend` });
      }
    }

    // EMA 50 trend
    if (ema50Val !== null) {
      indicators.ema50 = ema50Val;
      if (currentPrice > ema50Val) {
        score += 0.5;
        signals.push({ ind: 'EMA 50', value: `${ema50Val}`, bias: 'bullish', reason: `Price above EMA 50 (${ema50Val}) — long-term uptrend intact` });
      } else {
        score -= 0.5;
        signals.push({ ind: 'EMA 50', value: `${ema50Val}`, bias: 'bearish', reason: `Price below EMA 50 (${ema50Val}) — long-term downtrend` });
      }
    }

    // Bollinger Bands
    if (bb !== null) {
      indicators.bb = bb;
      if (currentPrice < bb.lower) {
        score += 1.2;
        signals.push({ ind: 'Bollinger', value: `%B:${bb.pctB}%`, bias: 'bullish', reason: `Price at lower band (Rs.${bb.lower}) — oversold extreme, reversion to mean expected` });
      } else if (currentPrice > bb.upper) {
        score -= 1.2;
        signals.push({ ind: 'Bollinger', value: `%B:${bb.pctB}%`, bias: 'bearish', reason: `Price at upper band (Rs.${bb.upper}) — overbought extreme, pullback likely` });
      } else if (bb.pctB < 30) {
        score += 0.6;
        signals.push({ ind: 'Bollinger', value: `%B:${bb.pctB}%`, bias: 'bullish', reason: `Price near lower band — mild oversold, watch for bounce` });
      } else if (bb.pctB > 70) {
        score -= 0.6;
        signals.push({ ind: 'Bollinger', value: `%B:${bb.pctB}%`, bias: 'bearish', reason: `Price near upper band — mild overbought zone` });
      } else {
        signals.push({ ind: 'Bollinger', value: `%B:${bb.pctB}%`, bias: 'neutral', reason: `Price inside Bollinger Bands — no breakout signal` });
      }
    }

    // Volume analysis
    if (volAnalysis.spike) {
      // Volume spike in direction of trend
      const priceDir = stock.ltp > stock.prevClose ? 'bullish' : 'bearish';
      score += priceDir === 'bullish' ? 0.8 : -0.8;
      signals.push({
        ind: 'Volume', value: `${volAnalysis.ratio}x`,
        bias: priceDir,
        reason: `Volume ${volAnalysis.ratio}x above average — ${priceDir === 'bullish' ? 'strong buying interest' : 'heavy selling pressure'}`
      });
    } else {
      signals.push({ ind: 'Volume', value: `${volAnalysis.ratio}x`, bias: 'neutral', reason: `Volume ${volAnalysis.ratio}x average — normal trading activity` });
    }

    // P/E valuation check (bonus factor)
    if (stock.pe && stock.pe > 0) {
      if (stock.pe < 12) { score += 0.4; }
      else if (stock.pe > 25) { score -= 0.3; }
    }

    // ── Generate final signal ─────────────────────────────────────────────
    const maxScore = 8.0;
    const normalizedScore = Math.max(-1, Math.min(1, score / maxScore));
    let signal, confidence;

    if (normalizedScore > 0.25) {
      signal = 'BUY';
      confidence = Math.round(50 + normalizedScore * 45);
    } else if (normalizedScore < -0.25) {
      signal = 'SELL';
      confidence = Math.round(50 + Math.abs(normalizedScore) * 45);
    } else {
      signal = 'HOLD';
      confidence = Math.round(40 + (1 - Math.abs(normalizedScore) * 2) * 25);
    }
    confidence = Math.min(95, Math.max(45, confidence));

    // ── Price targets ─────────────────────────────────────────────────────
    const atr = prices.length > 14
      ? prices.slice(-14).reduce((acc, p, i, arr) => i === 0 ? 0 : acc + Math.abs(p - arr[i-1]), 0) / 13
      : currentPrice * 0.02;

    const targetDays = 4;
    let targetLow, targetHigh;
    if (signal === 'BUY') {
      targetLow  = Math.round((currentPrice + atr * 0.5 * targetDays) * 100) / 100;
      targetHigh = Math.round((currentPrice + atr * 1.5 * targetDays) * 100) / 100;
    } else if (signal === 'SELL') {
      targetHigh = Math.round((currentPrice - atr * 0.5 * targetDays) * 100) / 100;
      targetLow  = Math.round((currentPrice - atr * 1.5 * targetDays) * 100) / 100;
    } else {
      targetLow  = Math.round((currentPrice - atr * 0.5 * targetDays) * 100) / 100;
      targetHigh = Math.round((currentPrice + atr * 0.5 * targetDays) * 100) / 100;
    }

    // ── Reasoning text ────────────────────────────────────────────────────
    const bullishReasons = signals.filter(s => s.bias === 'bullish');
    const bearishReasons = signals.filter(s => s.bias === 'bearish');
    const reasoning = buildReasoning(stock, signal, bullishReasons, bearishReasons, rsiVal, macdVal, bb, sr);

    return {
      signal,
      confidence,
      score: Math.round(normalizedScore * 100) / 100,
      rsi: rsiVal,
      macd: macdVal,
      ema9: ema9Val,
      ema21: ema21Val,
      ema50: ema50Val,
      sma20: sma20Val,
      bollingerBands: bb,
      volume: volAnalysis,
      support: sr.support,
      resistance: sr.resistance,
      signals,
      targetLow,
      targetHigh,
      reasoning,
      priceHistory: prices,
      volumeHistory: volumes
    };
  }

  function buildReasoning(stock, signal, bullish, bearish, rsiVal, macdVal, bb, sr) {
    // changePct must stay a number: it used to be a string, so `"0.00" > 0`
    // evaluated true and a flat stock was reported as "gained 0.00%".
    const prevClose = Number(stock.prevClose);
    const ltp = Number(stock.ltp);
    const changePct = Number.isFinite(prevClose) && prevClose > 0
      ? (ltp - prevClose) / prevClose * 100
      : 0;
    const dirWord = changePct > 0 ? 'gained' : 'declined';
    const absPct = Math.abs(changePct).toFixed(2);
    let text = changePct === 0
      ? `<strong>${stock.symbol}</strong> is unchanged today (LTP: Rs.${stock.ltp}). `
      : `<strong>${stock.symbol}</strong> has ${dirWord} <strong>${absPct}%</strong> today (LTP: Rs.${stock.ltp}). `;

    if (signal === 'BUY') {
      text += `Technical indicators show a <strong class="green">bullish setup</strong> for the next 3–4 trading days. `;
      if (bullish.length > 0) {
        text += bullish.slice(0, 2).map(s => s.reason).join('. ') + '. ';
      }
      if (rsiVal && rsiVal < 45) text += `RSI at ${rsiVal} suggests room to move upward. `;
      text += `<strong>Support level</strong>: Rs.${sr.support} — watch for this floor. `;
      text += `<strong>Target range</strong>: Rs.${stock.ltp} → expect upward movement.`;
    } else if (signal === 'SELL') {
      text += `Technical indicators show a <strong class="red">bearish setup</strong> for the next 3–4 trading days. `;
      if (bearish.length > 0) {
        text += bearish.slice(0, 2).map(s => s.reason).join('. ') + '. ';
      }
      if (rsiVal && rsiVal > 60) text += `RSI at ${rsiVal} signals overbought conditions. `;
      text += `<strong>Resistance level</strong>: Rs.${sr.resistance} — potential ceiling. `;
      text += `Consider reducing exposure or setting tight stop-loss.`;
    } else {
      text += `Technical indicators are <strong class="gold">mixed/neutral</strong>. `;
      if (bullish.length > 0 && bearish.length > 0) {
        text += `${bullish[0].reason}. However, ${bearish[0].reason}. `;
      }
      text += `Wait for clearer directional signal before entering new positions. `;
      text += `Watch Rs.${sr.support} (support) and Rs.${sr.resistance} (resistance) for breakout confirmation.`;
    }
    return text;
  }

  // ── Market-wide AI analysis ───────────────────────────────────────────────
  function analyzeMarket(stocks, indexHistory) {
    // Run analysis on all stocks
    const analyses = stocks.map(stock => ({
      stock,
      result: analyzeStock(stock)
    }));

    const buyCount  = analyses.filter(a => a.result.signal === 'BUY').length;
    const sellCount = analyses.filter(a => a.result.signal === 'SELL').length;
    const holdCount = analyses.filter(a => a.result.signal === 'HOLD').length;
    const total = analyses.length || 1;

    const bullPct = Math.round((buyCount / total) * 100);
    const bearPct = Math.round((sellCount / total) * 100);

    // Index momentum
    let indexMomentum = 'neutral';
    if (indexHistory && indexHistory.length >= 5) {
      const recent = indexHistory.slice(-5).map(d => d.value);
      const cur = recent[recent.length - 1];
      const prev = recent[recent.length - 2];
      if (cur > prev * 1.005) indexMomentum = 'bullish';
      else if (cur < prev * 0.995) indexMomentum = 'bearish';
    }

    // Overall market signal
    let marketSignal;
    if (bullPct > 55) marketSignal = 'BULLISH';
    else if (bearPct > 55) marketSignal = 'BEARISH';
    else marketSignal = 'NEUTRAL';

    // Top picks
    const topBuys = analyses
      .filter(a => a.result.signal === 'BUY')
      .sort((a, b) => b.result.confidence - a.result.confidence)
      .slice(0, 5);
    const topSells = analyses
      .filter(a => a.result.signal === 'SELL')
      .sort((a, b) => b.result.confidence - a.result.confidence)
      .slice(0, 3);

    return {
      marketSignal,
      bullPct,
      bearPct,
      holdPct: 100 - bullPct - bearPct,
      buyCount, sellCount, holdCount,
      indexMomentum,
      topBuys,
      topSells,
      allAnalyses: analyses
    };
  }

  return { analyzeStock, analyzeMarket, generatePriceHistory, ema, sma, rsi, macd, bollingerBands };
})();
