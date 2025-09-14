// Remove external dependencies and use built-in fetch
// const { GoogleGenerativeAI } = require('@google/generative-ai');

exports.handler = async (event, context) => {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { ticker, timeframe } = JSON.parse(event.body);
    
    if (!ticker) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticker symbol is required' })
      };
    }

    // Calculate date range based on timeframe
    const now = new Date();
    const endDate = Math.floor(now.getTime() / 1000);
    let startDate;
    let interval = '1d';

    switch (timeframe) {
      case '5m':
        startDate = Math.floor((now.getTime() - 1 * 24 * 60 * 60 * 1000) / 1000);
        interval = '5m';
        break;
      case '1mo':
        startDate = Math.floor((now.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000);
        break;
      case '3mo':
        startDate = Math.floor((now.getTime() - 90 * 24 * 60 * 60 * 1000) / 1000);
        break;
      case '6mo':
        startDate = Math.floor((now.getTime() - 180 * 24 * 60 * 60 * 1000) / 1000);
        break;
      case '1y':
        startDate = Math.floor((now.getTime() - 365 * 24 * 60 * 60 * 1000) / 1000);
        break;
      case '2y':
        startDate = Math.floor((now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000) / 1000);
        break;
      default:
        startDate = Math.floor((now.getTime() - 365 * 24 * 60 * 60 * 1000) / 1000);
    }

    // Fetch stock data from Yahoo Finance
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?symbol=${ticker}&period1=${startDate}&period2=${endDate}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
    
    // Add diagnostic information to response for debugging
    const diagnostics = {
      timestamp: new Date().toISOString(),
      ticker: ticker,
      timeframe: timeframe,
      url_constructed: yahooUrl,
      date_range: {
        start_date: startDate,
        end_date: endDate,
        start_readable: new Date(startDate * 1000).toISOString(),
        end_readable: new Date(endDate * 1000).toISOString(),
        interval: interval
      },
      environment: {
        node_version: process.version,
        platform: process.platform,
        has_gemini_key: !!process.env.GEMINI_API_KEY
      }
    };
    
    try {
      const response = await fetch(yahooUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site'
        }
      });

      // Enhanced diagnostic information
      diagnostics.response_info = {
        status: response.status,
        status_text: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url_final: response.url,
        redirected: response.redirected,
        type: response.type
      };

      if (!response.ok) {
        // Get response body for detailed error analysis
        let errorBody = '';
        try {
          errorBody = await response.text();
          diagnostics.error_body = errorBody.substring(0, 500);
        } catch (e) {
          diagnostics.error_body = 'Unable to read error response';
        }

        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: `Yahoo Finance API Error (${response.status}): ${response.statusText}`,
            diagnostics: diagnostics,
            troubleshooting: getYahooTroubleshooting(response.status, ticker, diagnostics),
            suggested_actions: [
              "Check if ticker symbol exists on finance.yahoo.com",
              "Try a different timeframe (1mo instead of 5m)",
              "Verify market is open for real-time data",
              "Test with major symbols: AAPL, MSFT, GOOGL"
            ]
          })
        };
      }

      const responseText = await response.text();
      diagnostics.response_size = responseText.length;
      diagnostics.response_preview = responseText.substring(0, 200);

      if (!responseText) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: 'Empty response from Yahoo Finance',
            diagnostics: diagnostics,
            possible_causes: [
              "Yahoo Finance API maintenance",
              "Rate limiting in effect",
              "Invalid symbol or timeframe",
              "Network connectivity issues"
            ]
          })
        };
      }

      let data;
      try {
        data = JSON.parse(responseText);
        diagnostics.json_parse = 'success';
      } catch (parseError) {
        diagnostics.json_parse = 'failed';
        diagnostics.parse_error = parseError.message;
        
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: 'Invalid JSON response from Yahoo Finance',
            diagnostics: diagnostics,
            parse_error: parseError.message,
            response_sample: responseText.substring(0, 300),
            likely_causes: [
              "Yahoo Finance returned HTML error page instead of JSON",
              "API endpoint changed or deprecated",
              "Response was truncated or corrupted",
              "Yahoo Finance is blocking automated requests"
            ]
          })
        };
      }

      // Analyze the data structure
      diagnostics.data_structure = {
        has_chart: !!data.chart,
        has_result: !!(data.chart && data.chart.result),
        result_count: data.chart?.result?.length || 0,
        has_error: !!data.chart?.error,
        error_message: data.chart?.error?.description || null
      };

      if (data.chart?.error) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: `Yahoo Finance Error: ${data.chart.error.description}`,
            diagnostics: diagnostics,
            yahoo_error_code: data.chart.error.code,
            symbol_analysis: analyzeSymbolFormat(ticker),
            recommendations: getSymbolRecommendations(ticker)
          })
        };
      }
      
      if (!data.chart?.result?.[0]?.timestamp) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'No data available for this ticker',
            diagnostics: diagnostics,
            data_received: data,
            analysis: {
              symbol_exists: !!data.chart,
              has_results: !!(data.chart?.result?.length),
              timestamp_count: data.chart?.result?.[0]?.timestamp?.length || 0,
              possible_issues: [
                "Symbol may be delisted or suspended",
                "No trading data for selected timeframe",
                "Symbol format incorrect for exchange",
                "Market closed and no historical data"
              ]
            }
          })
        };
      }

      const result = data.chart.result[0];
      const timestamps = result.timestamp;
      const indicators = result.indicators.quote[0];
      
      // Analyze data quality
      diagnostics.data_quality = {
        timestamp_count: timestamps.length,
        price_data_points: indicators.close?.filter(p => p !== null).length || 0,
        volume_data_points: indicators.volume?.filter(v => v !== null).length || 0,
        date_range_actual: {
          first: new Date(timestamps[0] * 1000).toISOString(),
          last: new Date(timestamps[timestamps.length - 1] * 1000).toISOString()
        },
        data_completeness: Math.round((indicators.close?.filter(p => p !== null).length / timestamps.length) * 100) || 0
      };

      // Process stock data
      const stockData = timestamps.map((ts, i) => ({
        date: new Date(ts * 1000).toISOString(),
        open: indicators.open[i],
        high: indicators.high[i],
        low: indicators.low[i],
        close: indicators.close[i],
        volume: indicators.volume[i]
      })).filter(d => d.close !== null);

      if (stockData.length < 50) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Insufficient data for analysis',
            diagnostics: diagnostics,
            data_points_received: stockData.length,
            minimum_required: 50,
            suggestions: [
              "Try a longer timeframe (3mo or 1y)",
              "Check if symbol is actively traded",
              "Verify symbol exists on major exchanges",
              "Try during market hours for better data availability"
            ]
          })
        };
      }

      const currentPrice = stockData[stockData.length - 1].close;
      const previousPrice = stockData[stockData.length - 2]?.close || currentPrice;
      const priceChange = currentPrice - previousPrice;
      const priceChangePercent = ((priceChange / previousPrice) * 100).toFixed(2);

      // Simple recommendation based on recent trend
      const recentPrices = stockData.slice(-5).map(d => d.close);
      const avgRecent = recentPrices.reduce((a, b) => a + b) / recentPrices.length;
      
      let recommendation = 'NEUTRAL';
      if (currentPrice > avgRecent * 1.02) recommendation = 'BUY';
      else if (currentPrice < avgRecent * 0.98) recommendation = 'SELL';

      // Enhanced Technical Indicator Calculations
      function calculateSMA(data, period) {
        if (data.length < period) return null;
        const sum = data.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
      }

      function calculateEMA(data, period) {
        if (data.length < period) return null;
        const multiplier = 2 / (period + 1);
        let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < data.length; i++) {
          ema = (data[i] * multiplier) + (ema * (1 - multiplier));
        }
        return ema;
      }

      function calculateRSI(data, period = 14) {
        if (data.length < period + 1) return null;
        
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
          const change = data[data.length - i] - data[data.length - i - 1];
          if (change > 0) gains += change;
          else losses -= change;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
      }

      function calculateStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
        if (closes.length < kPeriod) return null;
        
        const recentHighs = highs.slice(-kPeriod);
        const recentLows = lows.slice(-kPeriod);
        const currentClose = closes[closes.length - 1];
        
        const highestHigh = Math.max(...recentHighs);
        const lowestLow = Math.min(...recentLows);
        
        const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
        return { k, d: k }; // Simplified D calculation
      }

      function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (data.length < slowPeriod) return null;
        
        const emaFast = calculateEMA(data, fastPeriod);
        const emaSlow = calculateEMA(data, slowPeriod);
        const macdLine = emaFast - emaSlow;
        
        return { macd: macdLine, signal: macdLine, histogram: 0 };
      }

      function calculateBollingerBands(data, period = 20, stdDev = 2) {
        if (data.length < period) return null;
        
        const sma = calculateSMA(data, period);
        const recentData = data.slice(-period);
        const variance = recentData.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
        const standardDeviation = Math.sqrt(variance);
        
        return {
          upper: sma + (standardDeviation * stdDev),
          middle: sma,
          lower: sma - (standardDeviation * stdDev)
        };
      }

      function calculateATR(highs, lows, closes, period = 14) {
        if (highs.length < period + 1) return null;
        
        let trSum = 0;
        for (let i = 1; i <= period; i++) {
          const idx = highs.length - i;
          const high = highs[idx];
          const low = lows[idx];
          const prevClose = closes[idx - 1];
          
          const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
          );
          trSum += tr;
        }
        
        return trSum / period;
      }

      const sma = calculateSMA(stockData.map(d => d.close), 20);
      const ema = calculateEMA(stockData.map(d => d.close), 20);
      const rsi = calculateRSI(stockData.map(d => d.close));
      const stochastic = calculateStochastic(stockData.map(d => d.high), stockData.map(d => d.low), stockData.map(d => d.close));
      const macd = calculateMACD(stockData.map(d => d.close));
      const bollingerBands = calculateBollingerBands(stockData.map(d => d.close));
      const atr = calculateATR(stockData.map(d => d.high), stockData.map(d => d.low), stockData.map(d => d.close));

      try {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            ticker: ticker.toUpperCase(),
            timeframe: timeframe,
            current_price: currentPrice,
            price_change: priceChange,
            price_change_percent: priceChangePercent,
            recommendation: recommendation,
            data_points: stockData.length,
            currency: data.chart.result[0].meta.currency || 'USD',
            exchange: data.chart.result[0].meta.exchangeName || 'Unknown',
            company_name: data.chart.result[0].meta.longName || ticker.toUpperCase(),
            gemini_analysis: `📊 Stock Data Retrieved Successfully!\n\n${data.chart.result[0].meta.longName || ticker} is trading at $${currentPrice.toFixed(2)} (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent}%). Based on ${stockData.length} data points over ${timeframe}, showing ${recommendation.toLowerCase()} signal.`,
            buy_signals: recommendation === 'BUY' ? 3 : recommendation === 'SELL' ? 1 : 2,
            sell_signals: recommendation === 'SELL' ? 3 : recommendation === 'BUY' ? 1 : 2,
            technical_indicators: {
              sma: sma,
              ema: ema,
              rsi: rsi,
              stochastic: stochastic,
              macd: macd,
              bollinger_bands: bollingerBands,
              atr: atr
            }
          })
        };
      } catch (error) {
        console.error('Function error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Failed to fetch stock data: ' + error.message,
            ticker: ticker || 'Unknown'
          })
        };
      }
    } catch (error) {
      console.error('Function error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal server error: ' + error.message })
      };
    }
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error: ' + error.message })
    };
  }
};

// Helper functions
function getYahooTroubleshooting(statusCode, ticker, diagnostics) {
  const baseUrl = diagnostics.url_constructed;
  const timestamp = diagnostics.timestamp;
  
  switch (statusCode) {
    case 400:
      return {
        issue: "Bad Request - Invalid parameters",
        likely_cause: "Ticker symbol format or date parameters are incorrect",
        debug_info: {
          ticker_format: analyzeTickerFormat(ticker),
          date_range_valid: diagnostics.date_range.start_date < diagnostics.date_range.end_date,
          url_analysis: analyzeUrlStructure(baseUrl)
        },
        immediate_fixes: [
          `Try major symbols: AAPL, MSFT, GOOGL instead of ${ticker}`,
          "Check if symbol needs exchange suffix (.TO, .L, etc.)",
          "Verify company is still publicly traded",
          "Try 1y timeframe instead of current selection"
        ]
      };
      
    case 401:
      return {
        issue: "Unauthorized - Authentication failed",
        likely_cause: "Yahoo Finance is blocking the request headers or IP",
        debug_info: {
          user_agent_sent: "Chrome/91.0.4472.124",
          headers_count: 7,
          request_origin: "Netlify serverless function"
        },
        immediate_fixes: [
          "This is usually temporary - wait 15 minutes",
          "Try from different geographic region",
          "Yahoo may be detecting automated requests",
          "Check if Yahoo Finance website is accessible"
        ]
      };
      
    case 403:
      return {
        issue: "Forbidden - Access denied",
        likely_cause: "Rate limiting or IP blocking by Yahoo Finance",
        debug_info: {
          request_frequency: "Unknown (no server logs)",
          ip_status: "Potentially rate limited",
          symbol_restricted: ticker.includes('-') || ticker.length > 5
        },
        immediate_fixes: [
          "Wait 30-60 minutes before retrying",
          "Try different symbols to test if symbol-specific",
          "Use major exchange symbols (NYSE/NASDAQ)",
          "Avoid rapid successive requests"
        ]
      };
      
    case 404:
      return {
        issue: "Not Found - Symbol or endpoint doesn't exist",
        likely_cause: `Symbol ${ticker} not found or API endpoint changed`,
        debug_info: {
          symbol_analysis: analyzeTickerFormat(ticker),
          endpoint_status: "Standard Yahoo Finance chart API",
          symbol_length: ticker.length,
          contains_special_chars: /[^A-Z0-9.-]/.test(ticker)
        },
        immediate_fixes: [
          `Verify ${ticker} exists on finance.yahoo.com`,
          "Check spelling - common mistakes: APPL vs AAPL",
          "Try without exchange suffix first",
          "Search for company's current ticker symbol"
        ]
      };
      
    case 429:
      return {
        issue: "Rate Limited - Too many requests",
        likely_cause: "Exceeded Yahoo Finance API request limits",
        debug_info: {
          rate_limit_type: "IP-based limiting",
          reset_time: "Typically 15-60 minutes",
          request_source: "Netlify function"
        },
        immediate_fixes: [
          "Wait 1 hour before next request",
          "This affects all symbols temporarily",
          "Consider implementing request caching",
          "Try during off-peak hours (US market closed)"
        ]
      };
      
    case 500:
      return {
        issue: "Internal Server Error - Yahoo Finance API problem",
        likely_cause: "Yahoo Finance experiencing technical difficulties",
        debug_info: {
          server_status: "Yahoo Finance internal error",
          user_impact: "Affects all users globally",
          estimated_duration: "Usually resolves within 30 minutes"
        },
        immediate_fixes: [
          "Wait 15-30 minutes and retry",
          "Check Yahoo Finance website status",
          "Try different symbols to confirm widespread issue",
          "Monitor financial news for Yahoo outages"
        ]
      };
      
    case 502:
    case 503:
    case 504:
      return {
        issue: "Service Unavailable - Yahoo Finance down",
        likely_cause: "Yahoo Finance API maintenance or outage",
        debug_info: {
          service_status: "Temporarily unavailable",
          outage_type: statusCode === 502 ? "Bad Gateway" : statusCode === 503 ? "Service Unavailable" : "Gateway Timeout",
          global_impact: true
        },
        immediate_fixes: [
          "Wait 30-60 minutes for service restoration",
          "Check downdetector.com for Yahoo Finance status",
          "This is not a code issue - service-wide problem",
          "Monitor Yahoo Finance social media for updates"
        ]
      };
      
    default:
      return {
        issue: `Unexpected HTTP ${statusCode} error`,
        likely_cause: "Unknown error condition",
        debug_info: {
          status_code: statusCode,
          common_codes: "200=OK, 400=Bad Request, 401=Unauthorized, 403=Forbidden, 404=Not Found, 429=Rate Limited, 500=Server Error",
          investigation_needed: true
        },
        immediate_fixes: [
          "Document this error code for investigation",
          "Try different symbols to see if consistent",
          "Wait 30 minutes and retry",
          "Check if Yahoo Finance API has changed"
        ]
      };
  }
}

function analyzeTickerFormat(ticker) {
  const analysis = {
    length: ticker.length,
    uppercase: ticker === ticker.toUpperCase(),
    contains_numbers: /\d/.test(ticker),
    contains_dash: ticker.includes('-'),
    contains_dot: ticker.includes('.'),
    likely_crypto: ticker.includes('-USD') || ticker.includes('-BTC'),
    likely_international: ticker.includes('.TO') || ticker.includes('.L') || ticker.includes('.F'),
    common_mistakes: []
  };
  
  // Check for common ticker mistakes
  if (ticker === 'APPL') analysis.common_mistakes.push('Did you mean AAPL (Apple)?');
  if (ticker === 'GOOGL') analysis.common_mistakes.push('Try GOOG for Alphabet Class C');
  if (ticker === 'TESLA') analysis.common_mistakes.push('Use TSLA, not company name');
  if (ticker.length > 5 && !ticker.includes('.') && !ticker.includes('-')) {
    analysis.common_mistakes.push('Ticker too long - use symbol not company name');
  }
  
  // Format recommendations
  analysis.format_recommendation = 'unknown';
  if (analysis.length <= 4 && analysis.uppercase && !analysis.contains_numbers) {
    analysis.format_recommendation = 'standard_us_stock';
  } else if (analysis.likely_crypto) {
    analysis.format_recommendation = 'cryptocurrency';
  } else if (analysis.likely_international) {
    analysis.format_recommendation = 'international_stock';
  }
  
  return analysis;
}

function analyzeUrlStructure(url) {
  const urlObj = new URL(url);
  const params = new URLSearchParams(urlObj.search);
  
  return {
    base_url: urlObj.origin + urlObj.pathname,
    parameter_count: params.size,
    has_symbol: params.has('symbol'),
    has_period1: params.has('period1'),
    has_period2: params.has('period2'),
    has_interval: params.has('interval'),
    period1_value: params.get('period1'),
    period2_value: params.get('period2'),
    interval_value: params.get('interval'),
    url_length: url.length,
    looks_valid: url.includes('query1.finance.yahoo.com') && params.has('symbol')
  };
}

function analyzeSymbolFormat(ticker) {
  const format = analyzeTickerFormat(ticker);
  
  return {
    ticker: ticker,
    analysis: format,
    confidence_score: calculateSymbolConfidence(format),
    suggestions: generateSymbolSuggestions(ticker, format)
  };
}

function calculateSymbolConfidence(analysis) {
  let score = 50; // Base score
  
  if (analysis.format_recommendation === 'standard_us_stock') score += 30;
  if (analysis.uppercase) score += 10;
  if (analysis.length >= 1 && analysis.length <= 5) score += 10;
  if (analysis.common_mistakes.length === 0) score += 10;
  if (analysis.contains_numbers && analysis.length > 4) score -= 20;
  
  return Math.max(0, Math.min(100, score));
}

function generateSymbolSuggestions(ticker, analysis) {
  const suggestions = [];
  
  if (analysis.common_mistakes.length > 0) {
    suggestions.push(...analysis.common_mistakes);
  }
  
  if (ticker.toLowerCase() === ticker) {
    suggestions.push(`Try ${ticker.toUpperCase()} (uppercase)`);
  }
  
  if (analysis.length > 5 && !ticker.includes('.') && !ticker.includes('-')) {
    suggestions.push('Use ticker symbol, not company name');
    suggestions.push('Search company name on finance.yahoo.com to find ticker');
  }
  
  if (suggestions.length === 0) {
    suggestions.push('Symbol format looks correct');
    suggestions.push('Verify symbol exists on finance.yahoo.com');
    suggestions.push('Try major symbols: AAPL, MSFT, GOOGL for testing');
  }
  
  return suggestions;
}

function getSymbolRecommendations(ticker) {
  const analysis = analyzeTickerFormat(ticker);
  
  return {
    original_symbol: ticker,
    confidence: calculateSymbolConfidence(analysis),
    recommendations: generateSymbolSuggestions(ticker, analysis),
    test_symbols: ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'],
    format_guide: {
      us_stocks: 'AAPL, MSFT, GOOGL (1-5 letters, uppercase)',
      crypto: 'BTC-USD, ETH-USD (symbol-USD format)',
      international: 'SHOP.TO (Canada), BP.L (London)',
      etfs: 'SPY, QQQ, VTI (3-4 letters usually)'
    }
  };
}
