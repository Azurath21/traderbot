const GEMINI_API_KEY = 'AIzaSyBFChF21jntZY8Jt0gpAn5JQcZPz7weYtA';
const LSTM_API_URL = '';

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('analyzeBtn').addEventListener('click', handleAnalysis);
    document.getElementById('tickerInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAnalysis();
        }
    });
});

async function handleAnalysis() {
    const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
    const timeframe = document.getElementById('timeframeSelect').value;
    
    if (!ticker) {
        showError('Please enter a stock ticker symbol');
        return;
    }
    
    showLoading();
    hideError();
    hideResults();
    hideLstmPrediction();
    
    try {
        const [stockData, lstmPrediction] = await Promise.all([
            fetchYahooFinanceData(ticker, timeframe),
            fetchLstmPrediction(ticker)
        ]);
        
        const analysis = calculateAllIndicators(stockData);
        const aiExplanation = await getGeminiAnalysis(ticker, analysis, stockData, lstmPrediction);
        
        displayResults(ticker, stockData, analysis, aiExplanation);
        if (lstmPrediction) {
            displayLstmPrediction(lstmPrediction);
        }
        hideLoading();
        showResults();
    } catch (error) {
        console.error('Analysis error:', error);
        hideLoading();
        showError(error.message);
    }
}

async function fetchLstmPrediction(ticker) {
    try {
        const response = await fetch(`${LSTM_API_URL}/api/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: ticker })
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.warn('LSTM API error:', error);
            return null;
        }
        
        return await response.json();
    } catch (error) {
        console.warn('LSTM API not available:', error.message);
        return null;
    }
}

function displayLstmPrediction(prediction) {
    const container = document.getElementById('lstmPrediction');
    const isUp = prediction.direction === 'UP';
    
    const arrow = document.getElementById('lstmArrow');
    arrow.className = `fas fa-arrow-${isUp ? 'up' : 'down'} lstm-direction-arrow ${isUp ? 'up' : 'down'}`;
    
    const directionEl = document.getElementById('lstmDirection');
    directionEl.textContent = prediction.direction;
    directionEl.className = `lstm-stat-value ${isUp ? 'up' : 'down'}`;
    
    document.getElementById('lstmCurrentPrice').textContent = `$${prediction.current_price.toFixed(2)}`;
    
    const targetEl = document.getElementById('lstmTargetPrice');
    targetEl.textContent = `$${prediction.target_price.toFixed(2)}`;
    targetEl.className = `lstm-stat-value ${isUp ? 'up' : 'down'}`;
    
    const changeEl = document.getElementById('lstmChange');
    const changeSign = prediction.predicted_change_pct >= 0 ? '+' : '';
    changeEl.textContent = `${changeSign}${prediction.predicted_change_pct.toFixed(2)}%`;
    changeEl.className = `lstm-stat-value ${isUp ? 'up' : 'down'}`;
    
    document.getElementById('lstmConfidence').textContent = `${prediction.confidence.toFixed(1)}%`;
    
    const strengthEl = document.getElementById('lstmStrength');
    strengthEl.textContent = prediction.strength;
    strengthEl.className = `lstm-strength ${prediction.strength.toLowerCase()}`;
    
    const trainedDate = new Date(prediction.model_trained_at).toLocaleDateString();
    document.getElementById('lstmMeta').textContent = 
        `Model Accuracy: ${prediction.model_accuracy}% | AUC: ${prediction.model_auc} | Trained: ${trainedDate}`;
    
    container.classList.remove('loading');
    container.classList.add('loaded');
}

function hideLstmPrediction() {
    const container = document.getElementById('lstmPrediction');
    container.classList.remove('loaded', 'loading');
}

async function fetchYahooFinanceData(ticker, timeframe) {
    const now = Math.floor(Date.now() / 1000);
    const timeframes = {
        '3mo': { period1: now - (90 * 24 * 60 * 60), interval: '1d' },
        '1y': { period1: now - (365 * 24 * 60 * 60), interval: '1d' },
        '5y': { period1: now - (5 * 365 * 24 * 60 * 60), interval: '1d' },
        'max': { period1: 0, interval: '1d' }
    };
    
    const config = timeframes[timeframe] || timeframes['1y'];
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${config.period1}&period2=${now}&interval=${config.interval}&includePrePost=false`;
    
    const corsProxies = [
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?'
    ];
    
    let response = null;
    let lastError = null;
    
    for (const proxy of corsProxies) {
        try {
            const url = proxy + encodeURIComponent(yahooUrl);
            response = await fetch(url);
            if (response.ok) break;
        } catch (e) {
            lastError = e;
            continue;
        }
    }
    
    if (!response || !response.ok) {
        throw new Error(`Failed to fetch data for ${ticker}. ${lastError?.message || 'Check if the ticker symbol is valid.'}`);
    }
    
    const data = await response.json();
    if (!data.chart?.result?.[0]) throw new Error(`No data found for ${ticker}`);
    
    const result = data.chart.result[0];
    const meta = result.meta;
    const quote = result.indicators.quote[0];
    const timestamps = result.timestamp || [];
    
    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (quote.close[i] !== null) {
            prices.push({
                date: new Date(timestamps[i] * 1000),
                open: quote.open[i],
                high: quote.high[i],
                low: quote.low[i],
                close: quote.close[i],
                volume: quote.volume[i]
            });
        }
    }
    
    if (prices.length < 50) throw new Error(`Insufficient data for ${ticker}. Need at least 50 data points.`);
    
    return {
        ticker,
        companyName: meta.longName || meta.shortName || ticker,
        currency: meta.currency || 'USD',
        exchange: meta.exchangeName || 'Unknown',
        prices,
        currentPrice: prices[prices.length - 1].close,
        previousClose: prices[prices.length - 2]?.close || prices[prices.length - 1].close
    };
}

function calculateAllIndicators(data) {
    const closes = data.prices.map(p => p.close);
    const highs = data.prices.map(p => p.high);
    const lows = data.prices.map(p => p.low);
    const volumes = data.prices.map(p => p.volume);
    const currentPrice = closes[closes.length - 1];
    
    const movingAverages = calculateMovingAverages(closes, currentPrice);
    const technicalIndicators = calculateTechnicalIndicators(closes, highs, lows, volumes, currentPrice);
    
    const maBuy = movingAverages.filter(ma => ma.smaAction === 'Buy').length + 
                  movingAverages.filter(ma => ma.emaAction === 'Buy').length;
    const maSell = movingAverages.filter(ma => ma.smaAction === 'Sell').length + 
                   movingAverages.filter(ma => ma.emaAction === 'Sell').length;
    
    const techBuy = technicalIndicators.filter(t => t.action === 'Buy' || t.action === 'Oversold').length;
    const techSell = technicalIndicators.filter(t => t.action === 'Sell' || t.action === 'Overbought').length;
    const techNeutral = technicalIndicators.filter(t => t.action === 'Neutral' || t.action === 'High Volatility').length;
    
    const totalBuy = maBuy + techBuy;
    const totalSell = maSell + techSell;
    
    return {
        movingAverages,
        technicalIndicators,
        summary: {
            maBuy, maSell,
            techBuy, techSell, techNeutral,
            totalBuy, totalSell,
            maVerdict: getVerdict(maBuy, maSell),
            techVerdict: getVerdict(techBuy, techSell),
            overallVerdict: getVerdict(totalBuy, totalSell)
        }
    };
}

function calculateMovingAverages(closes, currentPrice) {
    const periods = [5, 10, 20, 50, 100, 200];
    const results = [];
    
    for (const period of periods) {
        if (closes.length >= period) {
            const sma = calcSMA(closes, period);
            const ema = calcEMA(closes, period);
            results.push({
                name: `MA${period}`,
                period,
                sma: sma,
                smaAction: currentPrice > sma ? 'Buy' : 'Sell',
                ema: ema,
                emaAction: currentPrice > ema ? 'Buy' : 'Sell'
            });
        }
    }
    return results;
}

function calculateTechnicalIndicators(closes, highs, lows, volumes, currentPrice) {
    const indicators = [];
    
    const rsiVal = calcRSI(closes, 14);
    const rsiScore = rsiVal < 30 ? (30 - rsiVal) * 3.33 : rsiVal > 70 ? (70 - rsiVal) * 3.33 : (50 - rsiVal) * 0.5;
    indicators.push({ name: 'RSI(14)', value: rsiVal, action: rsiVal < 30 ? 'Oversold' : rsiVal > 70 ? 'Overbought' : 'Neutral', score: Math.max(-100, Math.min(100, rsiScore)) });
    
    const stoch = calcStochastic(closes, highs, lows, 9);
    const stochScore = stoch.k < 20 ? (20 - stoch.k) * 5 : stoch.k > 80 ? (80 - stoch.k) * 5 : (50 - stoch.k) * 0.5;
    indicators.push({ name: 'STOCH(9,6)', value: stoch.k, action: stoch.k < 20 ? 'Oversold' : stoch.k > 80 ? 'Overbought' : 'Neutral', score: Math.max(-100, Math.min(100, stochScore)) });
    
    const stochRsi = calcStochRSI(closes, 14);
    const stochRsiScore = (50 - stochRsi) * 2;
    indicators.push({ name: 'STOCHRSI(14)', value: stochRsi, action: stochRsi < 20 ? 'Buy' : stochRsi > 80 ? 'Sell' : 'Neutral', score: Math.max(-100, Math.min(100, stochRsiScore)) });
    
    const macd = calcMACD(closes, 12, 26, 9);
    const macdScore = Math.max(-100, Math.min(100, macd.histogram * 20));
    indicators.push({ name: 'MACD(12,26)', value: macd.histogram, action: macd.histogram > 0 ? 'Buy' : 'Sell', score: macdScore });
    
    const adx = calcADX(closes, highs, lows, 14);
    const priceUp = closes[closes.length-1] > closes[closes.length-2];
    const adxScore = adx > 25 ? (priceUp ? Math.min(100, adx * 2) : Math.max(-100, -adx * 2)) : 0;
    indicators.push({ name: 'ADX(14)', value: adx, action: adx > 25 ? (priceUp ? 'Buy' : 'Sell') : 'Neutral', score: adxScore });
    
    const williamsR = calcWilliamsR(closes, highs, lows, 14);
    const wrScore = williamsR < -80 ? (-80 - williamsR) * 5 : williamsR > -20 ? (-20 - williamsR) * 5 : (williamsR + 50) * -1;
    indicators.push({ name: 'Williams %R', value: williamsR, action: williamsR < -80 ? 'Oversold' : williamsR > -20 ? 'Overbought' : 'Sell', score: Math.max(-100, Math.min(100, wrScore)) });
    
    const cci = calcCCI(closes, highs, lows, 14);
    const cciScore = Math.max(-100, Math.min(100, -cci * 0.5));
    indicators.push({ name: 'CCI(14)', value: cci, action: cci < -100 ? 'Buy' : cci > 100 ? 'Sell' : 'Neutral', score: cciScore });
    
    const atr = calcATR(closes, highs, lows, 14);
    const atrPct = (atr / currentPrice) * 100;
    indicators.push({ name: 'ATR(14)', value: atr, action: atrPct > 3 ? 'High Volatility' : 'Neutral', score: 0 });
    
    const highsLows = calcHighsLows(closes, highs, lows, 14);
    const hlScore = Math.max(-100, Math.min(100, highsLows));
    indicators.push({ name: 'Highs/Lows(14)', value: highsLows, action: highsLows > 0 ? 'Buy' : 'Sell', score: hlScore });
    
    const ultimateOsc = calcUltimateOscillator(closes, highs, lows, 7, 14, 28);
    const uoScore = (50 - ultimateOsc) * 2;
    indicators.push({ name: 'Ultimate Oscillator', value: ultimateOsc, action: ultimateOsc < 30 ? 'Buy' : ultimateOsc > 70 ? 'Sell' : 'Neutral', score: Math.max(-100, Math.min(100, uoScore)) });
    
    const roc = calcROC(closes, 12);
    const rocScore = Math.max(-100, Math.min(100, roc * 10));
    indicators.push({ name: 'ROC', value: roc, action: roc > 0 ? 'Buy' : 'Sell', score: rocScore });
    
    const bullBear = calcBullBearPower(closes, highs, lows, 13);
    const bbScore = Math.max(-100, Math.min(100, bullBear * 5));
    indicators.push({ name: 'Bull/Bear Power(13)', value: bullBear, action: bullBear > 0 ? 'Buy' : 'Sell', score: bbScore });
    
    return indicators;
}

function calcSMA(data, period) {
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
    return ema;
}

function calcRSI(closes, period) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    if (losses === 0) return 100;
    return 100 - (100 / (1 + (gains / period) / (losses / period)));
}

function calcStochastic(closes, highs, lows, kPeriod) {
    const highestHigh = Math.max(...highs.slice(-kPeriod));
    const lowestLow = Math.min(...lows.slice(-kPeriod));
    const k = ((closes[closes.length - 1] - lowestLow) / (highestHigh - lowestLow)) * 100;
    return { k: isNaN(k) ? 50 : k };
}

function calcStochRSI(closes, period) {
    const rsiValues = [];
    for (let i = period; i < closes.length; i++) rsiValues.push(calcRSI(closes.slice(i - period, i + 1), period));
    if (rsiValues.length < period) return 50;
    const recentRsi = rsiValues.slice(-period);
    const maxRsi = Math.max(...recentRsi), minRsi = Math.min(...recentRsi);
    if (maxRsi === minRsi) return 50;
    return ((rsiValues[rsiValues.length - 1] - minRsi) / (maxRsi - minRsi)) * 100;
}

function calcMACD(closes, fast, slow, signal) {
    const macdLine = calcEMA(closes, fast) - calcEMA(closes, slow);
    const macdValues = [];
    for (let i = slow; i < closes.length; i++) macdValues.push(calcEMA(closes.slice(0, i + 1), fast) - calcEMA(closes.slice(0, i + 1), slow));
    const signalLine = macdValues.length >= signal ? macdValues.slice(-signal).reduce((a, b) => a + b, 0) / signal : macdLine;
    return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function calcADX(closes, highs, lows, period) {
    if (closes.length < period * 2) return 25;
    const trueRanges = [], plusDM = [], minusDM = [];
    for (let i = 1; i < closes.length; i++) {
        trueRanges.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
        const upMove = highs[i] - highs[i-1], downMove = lows[i-1] - lows[i];
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const smoothTR = trueRanges.slice(-period).reduce((a, b) => a + b, 0);
    const plusDI = (plusDM.slice(-period).reduce((a, b) => a + b, 0) / smoothTR) * 100;
    const minusDI = (minusDM.slice(-period).reduce((a, b) => a + b, 0) / smoothTR) * 100;
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return isNaN(dx) ? 25 : dx;
}

function calcWilliamsR(closes, highs, lows, period) {
    const highestHigh = Math.max(...highs.slice(-period));
    const lowestLow = Math.min(...lows.slice(-period));
    return ((highestHigh - closes[closes.length - 1]) / (highestHigh - lowestLow)) * -100;
}

function calcCCI(closes, highs, lows, period) {
    const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    const recentTP = typicalPrices.slice(-period);
    const smaTP = recentTP.reduce((a, b) => a + b, 0) / period;
    const meanDev = recentTP.reduce((sum, tp) => sum + Math.abs(tp - smaTP), 0) / period;
    return (typicalPrices[typicalPrices.length - 1] - smaTP) / (0.015 * meanDev);
}

function calcATR(closes, highs, lows, period) {
    const trueRanges = [];
    for (let i = 1; i < closes.length; i++) trueRanges.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcHighsLows(closes, highs, lows, period) {
    const highestHigh = Math.max(...highs.slice(-period));
    const lowestLow = Math.min(...lows.slice(-period));
    return ((closes[closes.length - 1] - (highestHigh + lowestLow) / 2) / (highestHigh - lowestLow)) * 100;
}

function calcUltimateOscillator(closes, highs, lows, short, medium, long) {
    if (closes.length < long + 1) return 50;
    const bp = [], tr = [];
    for (let i = 1; i < closes.length; i++) {
        bp.push(closes[i] - Math.min(lows[i], closes[i - 1]));
        tr.push(Math.max(highs[i], closes[i - 1]) - Math.min(lows[i], closes[i - 1]));
    }
    const avgS = bp.slice(-short).reduce((a,b)=>a+b,0) / tr.slice(-short).reduce((a,b)=>a+b,0);
    const avgM = bp.slice(-medium).reduce((a,b)=>a+b,0) / tr.slice(-medium).reduce((a,b)=>a+b,0);
    const avgL = bp.slice(-long).reduce((a,b)=>a+b,0) / tr.slice(-long).reduce((a,b)=>a+b,0);
    return ((avgS * 4) + (avgM * 2) + avgL) / 7 * 100;
}

function calcROC(closes, period) {
    return ((closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period]) * 100;
}

function calcBullBearPower(closes, highs, lows, period) {
    const ema = calcEMA(closes, period);
    return (highs[highs.length - 1] - ema) + (lows[lows.length - 1] - ema);
}

function getVerdict(buy, sell) {
    const total = buy + sell;
    if (total === 0) return 'Neutral';
    const ratio = buy / total;
    if (ratio >= 0.7) return 'Strong Buy';
    if (ratio >= 0.55) return 'Buy';
    if (ratio <= 0.3) return 'Strong Sell';
    if (ratio <= 0.45) return 'Sell';
    return 'Neutral';
}

async function getGeminiAnalysis(ticker, analysis, stockData, lstmPrediction = null) {
    const sortedIndicators = [...analysis.technicalIndicators].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const strongestBullish = sortedIndicators.filter(i => i.score > 20).slice(0, 3);
    const strongestBearish = sortedIndicators.filter(i => i.score < -20).slice(0, 3);
    
    const maScores = analysis.movingAverages.map(ma => {
        const smaScore = ma.smaAction === 'Buy' ? 50 : -50;
        const emaScore = ma.emaAction === 'Buy' ? 50 : -50;
        return { name: ma.name, score: (smaScore + emaScore) / 2 };
    });
    const strongestMABullish = maScores.filter(m => m.score > 0).slice(0, 2);
    const strongestMABearish = maScores.filter(m => m.score < 0).slice(0, 2);
    
    const lstmSection = lstmPrediction ? `
LSTM AI PREDICTION (5-Day Forecast):
- Direction: ${lstmPrediction.direction}
- Current Price: $${lstmPrediction.current_price.toFixed(2)}
- Target Price: $${lstmPrediction.target_price.toFixed(2)}
- Predicted Change: ${lstmPrediction.predicted_change_pct >= 0 ? '+' : ''}${lstmPrediction.predicted_change_pct.toFixed(2)}%
- Confidence: ${lstmPrediction.confidence.toFixed(1)}%
- Signal Strength: ${lstmPrediction.strength}
- Model Accuracy: ${lstmPrediction.model_accuracy}%
` : '';
    
    const prompt = `You are a professional stock analyst. Provide a complete analysis for ${ticker} (${stockData.companyName}).

Current Price: $${stockData.currentPrice.toFixed(2)}
Price Change: ${((stockData.currentPrice - stockData.previousClose) / stockData.previousClose * 100).toFixed(2)}%
${lstmSection}
OVERALL VERDICT: ${analysis.summary.overallVerdict}

MOVING AVERAGES: ${analysis.summary.maVerdict} (Buy: ${analysis.summary.maBuy}, Sell: ${analysis.summary.maSell})
${analysis.movingAverages.map(ma => `${ma.name}: SMA=${ma.sma.toFixed(2)} (${ma.smaAction}), EMA=${ma.ema.toFixed(2)} (${ma.emaAction})`).join('\n')}

TECHNICAL INDICATORS WITH SCORES (-100=Strong Sell, +100=Strong Buy):
${analysis.technicalIndicators.map(t => `${t.name}: ${t.value.toFixed(2)} (${t.action}) [Score: ${t.score.toFixed(0)}]`).join('\n')}

STRONGEST BULLISH SIGNALS:
${strongestBullish.length > 0 ? strongestBullish.map(i => `- ${i.name}: Score ${i.score.toFixed(0)}`).join('\n') : '- None significant'}
${strongestMABullish.length > 0 ? strongestMABullish.map(m => `- ${m.name} (MA): Score ${m.score.toFixed(0)}`).join('\n') : ''}

STRONGEST BEARISH SIGNALS:
${strongestBearish.length > 0 ? strongestBearish.map(i => `- ${i.name}: Score ${i.score.toFixed(0)}`).join('\n') : '- None significant'}
${strongestMABearish.length > 0 ? strongestMABearish.map(m => `- ${m.name} (MA): Score ${m.score.toFixed(0)}`).join('\n') : ''}

Write a 3-4 paragraph analysis that:
1. States the overall recommendation clearly${lstmPrediction ? ', integrating both technical indicators AND the LSTM AI prediction' : ''}
2. Specifically references the STRONGEST indicators by name that support this recommendation
3. ${lstmPrediction ? 'Discuss whether the LSTM prediction aligns with or conflicts with technical indicators' : 'Mentions any conflicting signals'}
4. Provides key price levels${lstmPrediction ? ` (including the LSTM target of $${lstmPrediction.target_price.toFixed(2)})` : ''} and risks

Be specific about which indicators are driving the recommendation.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 2500 } })
        });
        if (!response.ok) throw new Error('Gemini API error');
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || 'AI analysis unavailable.';
    } catch (error) {
        return `AI analysis unavailable. Overall verdict: ${analysis.summary.overallVerdict}`;
    }
}

function displayResults(ticker, stockData, analysis, aiExplanation) {
    document.getElementById('tickerDisplay').textContent = ticker;
    document.getElementById('companyName').textContent = stockData.companyName;
    document.getElementById('currentPrice').textContent = `$${stockData.currentPrice.toFixed(2)}`;
    
    const change = stockData.currentPrice - stockData.previousClose;
    const changePercent = (change / stockData.previousClose) * 100;
    const changeEl = document.getElementById('priceChange');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent.toFixed(2)}%)`;
    changeEl.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
    
    document.getElementById('dataInfo').textContent = `Data points: ${stockData.prices.length} | Updated: ${new Date().toLocaleString()}`;
    
    updateGauge('tech', analysis.summary.techVerdict, analysis.summary.techBuy, analysis.summary.techSell);
    updateGauge('summary', analysis.summary.overallVerdict, analysis.summary.totalBuy, analysis.summary.totalSell);
    updateGauge('ma', analysis.summary.maVerdict, analysis.summary.maBuy, analysis.summary.maSell);
    
    const overallEl = document.getElementById('overallSummary');
    overallEl.textContent = analysis.summary.overallVerdict;
    overallEl.style.color = getVerdictColor(analysis.summary.overallVerdict);
    
    document.getElementById('maSummaryLabel').textContent = analysis.summary.maVerdict;
    document.getElementById('maBuyCount').textContent = analysis.summary.maBuy;
    document.getElementById('maSellCount').textContent = analysis.summary.maSell;
    
    document.getElementById('techSummaryLabel').textContent = analysis.summary.techVerdict;
    document.getElementById('techBuyCount').textContent = analysis.summary.techBuy;
    document.getElementById('techNeutralCount').textContent = analysis.summary.techNeutral;
    document.getElementById('techSellCount').textContent = analysis.summary.techSell;
    
    document.getElementById('maTableBody').innerHTML = analysis.movingAverages.map(ma => `
        <tr><td class="name">${ma.name}</td><td class="value">${ma.sma.toFixed(2)}</td><td class="action-${ma.smaAction.toLowerCase()}">${ma.smaAction}</td><td class="value">${ma.ema.toFixed(2)}</td><td class="action-${ma.emaAction.toLowerCase()}">${ma.emaAction}</td></tr>
    `).join('');
    
    document.getElementById('maTableSummary').textContent = analysis.summary.maVerdict;
    document.getElementById('maTableBuy').textContent = analysis.summary.maBuy;
    document.getElementById('maTableSell').textContent = analysis.summary.maSell;
    
    document.getElementById('techTableBody').innerHTML = analysis.technicalIndicators.map(t => {
        const ac = t.action === 'Buy' || t.action === 'Oversold' ? 'buy' : t.action === 'Sell' || t.action === 'Overbought' ? 'sell' : 'neutral';
        return `<tr><td class="name">${t.name}</td><td class="value">${t.value.toFixed(t.name.includes('ATR') ? 4 : 2)}</td><td class="action-${ac}">${t.action}</td></tr>`;
    }).join('');
    
    document.getElementById('techTableSummary').textContent = analysis.summary.techVerdict;
    document.getElementById('techTableBuy').textContent = analysis.summary.techBuy;
    document.getElementById('techTableNeutral').textContent = analysis.summary.techNeutral;
    document.getElementById('techTableSell').textContent = analysis.summary.techSell;
    
    document.getElementById('aiAnalysisContent').textContent = aiExplanation;
}

function updateGauge(prefix, verdict, buy, sell) {
    const needle = document.getElementById(`${prefix}Needle`);
    const label = document.getElementById(`${prefix}Label`);
    const total = buy + sell;
    const ratio = total > 0 ? buy / total : 0.5;
    needle.style.transform = `translateX(-50%) rotate(${-90 + (ratio * 180)}deg)`;
    label.textContent = verdict;
    label.className = 'gauge-label ' + getLabelClass(verdict);
}

function getLabelClass(verdict) {
    switch (verdict) {
        case 'Strong Buy': return 'label-strong-buy';
        case 'Buy': return 'label-buy';
        case 'Strong Sell': return 'label-strong-sell';
        case 'Sell': return 'label-sell';
        default: return 'label-neutral';
    }
}

function getVerdictColor(verdict) {
    switch (verdict) {
        case 'Strong Buy': return '#26a69a';
        case 'Buy': return '#66bb6a';
        case 'Strong Sell': return '#ef5350';
        case 'Sell': return '#ffab40';
        default: return '#787b86';
    }
}

function showLoading() { document.getElementById('loadingSpinner').style.display = 'block'; }
function hideLoading() { document.getElementById('loadingSpinner').style.display = 'none'; }
function showError(msg) { const el = document.getElementById('errorMessage'); el.textContent = msg; el.style.display = 'block'; }
function hideError() { document.getElementById('errorMessage').style.display = 'none'; }
function showResults() { document.getElementById('resultsSection').style.display = 'block'; }
function hideResults() { document.getElementById('resultsSection').style.display = 'none'; }
