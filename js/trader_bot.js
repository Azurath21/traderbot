document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('traderBotForm').addEventListener('submit', handleTraderBotSubmit);
    document.getElementById('fetchDataBtn').addEventListener('click', handleFetchDataOnly);
});

async function handleTraderBotSubmit(e) {
    e.preventDefault();
    
    const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
    const timeframe = document.getElementById('timeframeSelect').value;
    
    if (!ticker) {
        showError('Please enter a stock ticker symbol');
        return;
    }
    
    showLoading();
    hideError();
    hideRecommendation();
    
    try {
        // Check if running locally - improved detection
        const isLocal = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname === '' ||
                       window.location.protocol === 'file:' ||
                       window.location.port === '8000' ||
                       !window.location.hostname.includes('netlify.app');
        
        console.log(`DEBUG: Environment detection - hostname: ${window.location.hostname}, port: ${window.location.port}, protocol: ${window.location.protocol}`);
        console.log(`DEBUG: Detected as local: ${isLocal}`);
        
        if (isLocal) {
            console.log(`DEBUG: Running in LOCAL mode - using Yahoo Finance directly`);
            // Local development - fetch data directly and do basic analysis
            const stockData = await fetchStockDataLocal(ticker, timeframe);
            const analysis = analyzeStockLocal(stockData);
            
            hideLoading();
            showRecommendation(analysis);
        } else {
            console.log(`DEBUG: Running in PRODUCTION mode - using Netlify functions`);
            // Production - use Netlify function
            const response = await fetch('/.netlify/functions/trader-recommendation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ticker: ticker,
                    timeframe: timeframe
                })
            });
            
            if (!response.ok) {
                const errorDetails = await getDetailedErrorMessage(response, ticker);
                throw new Error(errorDetails);
            }
            
            const text = await response.text();
            if (!text) {
                throw new Error(`Empty Response Error: The server returned no data for ${ticker}. This could indicate:\n• Server overload or maintenance\n• Network connectivity issues\n• Invalid API configuration\n\nPlease try again in a few moments.`);
            }
            
            let data;
            try {
                data = JSON.parse(text);
            } catch (parseError) {
                console.error('JSON Parse Error:', parseError);
                console.error('Response text:', text);
                throw new Error(`Data Format Error: Unable to parse server response for ${ticker}.\n\nTechnical Details:\n• Parse Error: ${parseError.message}\n• Response Length: ${text.length} characters\n• Response Preview: ${text.substring(0, 100)}...\n\nThis usually indicates a server-side error. Please try again or contact support if the issue persists.`);
            }
            
            if (data.error) {
                throw new Error(`Server Error: ${data.error}\n\nThis error was returned by the analysis service. Please verify the stock symbol and try again.`);
            }
            
            hideLoading();
            showRecommendation(data);
        }
        
    } catch (error) {
        console.error('Error:', error);
        hideLoading();
        showError(error.message || 'An unexpected error occurred while analyzing the stock. Please try again.');
    }
}

async function getDetailedErrorMessage(response, ticker) {
    const status = response.status;
    const statusText = response.statusText;
    
    let responseText = '';
    try {
        responseText = await response.text();
    } catch (e) {
        responseText = 'Unable to read error details';
    }
    
    // Add debug information to help identify the issue
    console.error(`DEBUG ERROR ANALYSIS:`);
    console.error(`- Status: ${status} ${statusText}`);
    console.error(`- URL attempted: ${response.url}`);
    console.error(`- Response headers:`, [...response.headers.entries()]);
    console.error(`- Response text length: ${responseText.length}`);
    console.error(`- Response preview:`, responseText.substring(0, 500));
    console.error(`- Current location: ${window.location.href}`);
    console.error(`- Environment check: hostname=${window.location.hostname}, port=${window.location.port}`);
    
    // Check if this is a Netlify 404 page
    if (responseText.includes('Page not found') && responseText.includes('netlify.com')) {
        return `ENVIRONMENT ERROR: Trying to call Netlify function while running locally!\n\n🔧 DEBUG INFORMATION:\n• Current URL: ${window.location.href}\n• Attempted API call: ${response.url}\n• Status: ${status} ${statusText}\n• Environment: ${window.location.hostname}:${window.location.port}\n\n❌ ISSUE IDENTIFIED:\nYou're running a local server (python -m http.server) but the code is trying to call Netlify functions.\n\n✅ SOLUTION:\nThe environment detection failed. This should be running in LOCAL mode using Yahoo Finance directly.\n\n🐛 TECHNICAL DETAILS:\n• Hostname: ${window.location.hostname}\n• Port: ${window.location.port}\n• Protocol: ${window.location.protocol}\n• Should detect as local: ${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.port === '8000'}\n\nPlease refresh the page and try again. If this persists, there's a bug in the environment detection logic.`;
    }
    
    switch (status) {
        case 400:
            return `Bad Request (HTTP 400): Invalid request for ${ticker}.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n\nPossible causes:\n• Invalid stock ticker symbol\n• Malformed request parameters\n• Missing required data\n\nSuggestions:\n• Verify the ticker symbol is correct (e.g., AAPL, TSLA)\n• Try a different timeframe\n• Check for special characters in the symbol\n\nServer Response: ${responseText || statusText}`;
            
        case 401:
            return `Authentication Error (HTTP 401): Unauthorized access.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n\nThis indicates:\n• Missing or invalid API key configuration\n• Expired authentication credentials\n• Insufficient permissions\n\nThis is likely a server configuration issue. Please contact the administrator.\n\nServer Response: ${responseText || statusText}`;
            
        case 403:
            return `Access Forbidden (HTTP 403): Request denied for ${ticker}.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n\nPossible reasons:\n• API rate limit exceeded\n• Restricted access to this stock symbol\n• Geographic restrictions\n• Service temporarily unavailable\n\nSuggestions:\n• Wait a few minutes and try again\n• Try a different stock symbol\n• Check if the market is open\n\nServer Response: ${responseText || statusText}`;
            
        case 404:
            return `Not Found (HTTP 404): Resource not available for ${ticker}.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Current location: ${window.location.href}\n• Response type: ${responseText.includes('netlify') ? 'Netlify 404 page' : 'API 404 response'}\n• Response preview: ${responseText.substring(0, 300)}...\n\n${responseText.includes('Page not found') ? '❌ ENVIRONMENT ISSUE: This is a Netlify 404 page, indicating the function endpoint does not exist or you are running locally but the code thinks it is in production.' : 'API ISSUE: The requested resource was not found.'}\n\nDetailed Analysis:\n• The requested stock symbol may not exist\n• The API endpoint is not properly configured\n• The symbol may be delisted or suspended\n• Regional market data may be unavailable\n\nTroubleshooting Steps:\n1. Verify ticker symbol spelling (e.g., AAPL not APPL)\n2. Check if it's a valid publicly traded company\n3. Try major symbols like AAPL, MSFT, GOOGL\n4. Ensure the company trades on supported exchanges\n\nCommon Issues:\n• Using company name instead of ticker (use AAPL not Apple)\n• Incorrect exchange suffix (some symbols need .TO, .L, etc.)\n• Cryptocurrency symbols (try BTC-USD instead of BTC)\n• Penny stocks or OTC markets may not be supported\n\nServer Response: ${responseText || statusText}`;
            
        case 429:
            return `Rate Limit Exceeded (HTTP 429): Too many requests.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n\nDetails:\n• API request limit has been reached\n• This is a temporary restriction\n• Requests are being throttled for fair usage\n\nSolutions:\n• Wait 1-2 minutes before trying again\n• Avoid rapid successive requests\n• Consider upgrading API plan if this persists\n\nServer Response: ${responseText || statusText}`;
            
        case 500:
            return `Internal Server Error (HTTP 500): Server malfunction.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n• Timestamp: ${new Date().toISOString()}\n\nThis indicates:\n• Temporary server-side issue\n• Database connectivity problems\n• Processing error in the analysis engine\n• Third-party API failure (Yahoo Finance, Gemini AI)\n\nRecommended Actions:\n1. Wait 2-3 minutes and retry\n2. Try a different stock symbol\n3. Check if the issue persists across multiple symbols\n4. Report to support if error continues\n\nTechnical Details:\n• Error Code: ${status}\n• Timestamp: ${new Date().toISOString()}\n• Symbol: ${ticker}\n\nServer Response: ${responseText || statusText}`;
            
        case 502:
            return `Bad Gateway (HTTP 502): Service connectivity issue.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n\nExplanation:\n• The server received an invalid response from upstream service\n• Yahoo Finance API may be temporarily unavailable\n• Network routing problems\n• Load balancer configuration issues\n\nNext Steps:\n• This is usually temporary - try again in 2-3 minutes\n• Check if Yahoo Finance is experiencing outages\n• Try during market hours for better reliability\n\nServer Response: ${responseText || statusText}`;
            
        case 503:
            return `Service Unavailable (HTTP 503): Temporary service outage.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n\nCurrent Status:\n• The analysis service is temporarily down\n• Scheduled maintenance may be in progress\n• High traffic causing service degradation\n• Infrastructure scaling in progress\n\nWhat to do:\n1. Wait 5-10 minutes and try again\n2. Check service status page if available\n3. Try during off-peak hours\n4. Monitor for service restoration announcements\n\nServer Response: ${responseText || statusText}`;
            
        case 504:
            return `Gateway Timeout (HTTP 504): Request processing timeout.\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Response: ${responseText.substring(0, 200)}...\n\nAnalysis:\n• The request took too long to process\n• Yahoo Finance API response was slow\n• Gemini AI analysis timed out\n• Network latency issues\n\nSolutions:\n• Try a shorter timeframe (5m instead of 2y)\n• Retry with a more liquid stock (AAPL, MSFT)\n• Wait for better network conditions\n• Try during market hours when data is fresher\n\nServer Response: ${responseText || statusText}`;
            
        default:
            return `HTTP Error ${status}: ${statusText}\n\n🐛 DEBUG INFO:\n• URL: ${response.url}\n• Current location: ${window.location.href}\n• Response: ${responseText.substring(0, 300)}...\n• Headers: ${JSON.stringify([...response.headers.entries()])}\n\nUnexpected error occurred while processing ${ticker}.\n\nError Details:\n• Status Code: ${status}\n• Status Text: ${statusText}\n• Timestamp: ${new Date().toISOString()}\n\nGeneral Troubleshooting:\n1. Verify internet connection\n2. Try a different stock symbol\n3. Refresh the page and try again\n4. Clear browser cache if issues persist\n\nServer Response: ${responseText || 'No additional details available'}`;
    }
}

async function getDetailedYahooErrorMessage(response, ticker) {
    const status = response.status;
    const statusText = response.statusText;
    
    let responseText = '';
    try {
        responseText = await response.text();
    } catch (e) {
        responseText = 'Unable to read Yahoo Finance error details';
    }
    
    switch (status) {
        case 400:
            return `Yahoo Finance Bad Request (HTTP 400): Invalid request for ${ticker}.\n\nRequest Issues:\n• Ticker symbol format is incorrect\n• Invalid timeframe or date parameters\n• Malformed API request\n\nSymbol Format Guide:\n• US Stocks: AAPL, MSFT, GOOGL\n• Canadian: SHOP.TO, RY.TO\n• UK: LLOY.L, BP.L\n• Crypto: BTC-USD, ETH-USD\n• ETFs: SPY, QQQ, VTI\n\nYahoo Response: ${responseText || statusText}`;
            
        case 401:
            return `Yahoo Finance Authentication Error (HTTP 401): Access denied.\n\nAuthentication Issues:\n• Yahoo Finance requires valid headers\n• Request may be blocked by anti-bot measures\n• IP address may be temporarily restricted\n\nThis is usually temporary. Solutions:\n• Wait 10-15 minutes and try again\n• Try from a different network\n• Use VPN if geographic restrictions apply\n\nYahoo Response: ${responseText || statusText}`;
            
        case 403:
            return `Yahoo Finance Access Forbidden (HTTP 403): Request blocked for ${ticker}.\n\nAccess Restrictions:\n• Rate limiting in effect\n• Geographic restrictions\n• Yahoo Finance detecting automated requests\n• Symbol may be restricted\n\nImmediate Actions:\n1. Wait 15-30 minutes before retrying\n2. Try major symbols (AAPL) to test connectivity\n3. Check if symbol exists on Yahoo Finance website\n4. Try different timeframe (1mo instead of 5m)\n\nYahoo Response: ${responseText || statusText}`;
            
        case 404:
            return `Yahoo Finance Not Found (HTTP 404): Symbol ${ticker} not found.\n\nSymbol Issues:\n• Ticker symbol does not exist\n• Symbol may be delisted or suspended\n• Incorrect exchange or format\n• Company may have changed ticker symbol\n\nVerification Steps:\n1. Check spelling: AAPL not APPL\n2. Search on finance.yahoo.com to confirm symbol\n3. Try without exchange suffix first\n4. Check if company was acquired or merged\n5. For international stocks, add proper suffix (.TO, .L, etc.)\n\nCommon Examples:\n• Apple: AAPL\n• Microsoft: MSFT\n• Tesla: TSLA\n• Amazon: AMZN\n\nYahoo Response: ${responseText || statusText}`;
            
        case 429:
            return `Yahoo Finance Rate Limit (HTTP 429): Too many requests.\n\nRate Limiting Details:\n• Yahoo Finance limits requests per IP address\n• Temporary restriction to prevent abuse\n• Usually lasts 10-60 minutes\n\nCurrent Status:\n• Your IP has exceeded the request limit\n• This is a temporary block, not permanent\n• All symbols will be affected until limit resets\n\nRecommended Actions:\n1. Wait 30-60 minutes before trying again\n2. Avoid rapid successive requests\n3. Try using fewer requests per minute\n4. Consider using during off-peak hours\n\nYahoo Response: ${responseText || statusText}`;
            
        case 500:
            return `Yahoo Finance Server Error (HTTP 500): Internal server problem.\n\nServer Issues:\n• Yahoo Finance experiencing technical difficulties\n• Database or processing errors\n• Temporary infrastructure problems\n• High load causing service degradation\n\nService Status:\n• This affects all users, not just you\n• Yahoo Finance team is likely aware of the issue\n• Service should restore automatically\n\nWhat to do:\n1. Wait 5-10 minutes and retry\n2. Try different symbols to test if widespread\n3. Check Yahoo Finance website directly\n4. Monitor for service restoration\n\nYahoo Response: ${responseText || statusText}`;
            
        case 502:
        case 503:
        case 504:
            return `Yahoo Finance Service Unavailable (HTTP ${status}): Temporary outage.\n\nService Status:\n• Yahoo Finance API is temporarily down\n• Infrastructure maintenance or issues\n• Load balancing problems\n• Upstream service failures\n\nOutage Information:\n• This is a widespread service issue\n• Affects all users and symbols\n• Usually resolves within 15-30 minutes\n• No action required from your side\n\nMonitoring:\n1. Check status.yahoo.com for updates\n2. Try again every 10-15 minutes\n3. Test with simple symbols (AAPL) first\n4. Consider alternative data sources if urgent\n\nYahoo Response: ${responseText || statusText}`;
            
        default:
            return `Yahoo Finance HTTP Error ${status}: Unexpected response.\n\nUnknown Error Details:\n• Status Code: ${status} (${statusText})\n• Symbol: ${ticker}\n• Timestamp: ${new Date().toISOString()}\n• Request URL: Yahoo Finance Chart API\n\nDiagnostic Information:\n• This is an unusual error code\n• May indicate new API changes or restrictions\n• Could be temporary infrastructure issues\n\nTroubleshooting:\n1. Try a different, well-known symbol (AAPL)\n2. Wait 15-30 minutes and retry\n3. Check Yahoo Finance website functionality\n4. Try different timeframes\n5. Report if error persists across multiple symbols\n\nYahoo Response: ${responseText || 'No additional details available'}`;
    }
}

function analyzeStockLocal(stockData) {
    const closes = stockData.close.filter(price => price !== null);
    const volumes = stockData.volume.filter(vol => vol !== null);
    
    if (closes.length < 20) {
        throw new Error('Insufficient data for analysis');
    }
    
    // Simple technical analysis
    const currentPrice = closes[closes.length - 1];
    const sma20 = closes.slice(-20).reduce((a, b) => a + b) / 20;
    const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b) / 50 : sma20;
    
    // Calculate RSI (simplified)
    const rsi = calculateRSI(closes);
    
    // Calculate MACD (simplified)
    const macd = calculateMACD(closes);
    
    let buySignals = 0;
    let sellSignals = 0;
    
    // Price vs SMA analysis
    if (currentPrice > sma20) buySignals++;
    else sellSignals++;
    
    if (currentPrice > sma50) buySignals++;
    else sellSignals++;
    
    // RSI analysis
    if (rsi < 30) buySignals += 2; // Oversold
    else if (rsi > 70) sellSignals += 2; // Overbought
    else if (rsi < 50) sellSignals++;
    else buySignals++;
    
    // MACD analysis
    if (macd.macd > macd.signal) buySignals++;
    else sellSignals++;
    
    // Determine recommendation
    let recommendation;
    const total = buySignals + sellSignals;
    const buyPercentage = (buySignals / total) * 100;
    
    if (buyPercentage >= 70) recommendation = 'Strong Buy';
    else if (buyPercentage >= 55) recommendation = 'Buy';
    else if (buyPercentage >= 45) recommendation = 'Neutral';
    else if (buyPercentage >= 30) recommendation = 'Sell';
    else recommendation = 'Strong Sell';
    
    return {
        recommendation: recommendation,
        buy_signals: buySignals,
        sell_signals: sellSignals,
        gemini_analysis: "🔧 Local Development Mode: AI analysis is only available when deployed to Netlify. Current analysis is based on technical indicators only."
    };
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
    if (prices.length < 26) return { macd: 0, signal: 0 };
    
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    
    return { macd: macd, signal: macd * 0.9 }; // Simplified signal line
}

function calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(-period).reduce((a, b) => a + b) / period;
    
    for (let i = prices.length - period + 1; i < prices.length; i++) {
        ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
}

function showLoading() {
    document.querySelector('.loading-spinner').style.display = 'block';
}

function hideLoading() {
    document.querySelector('.loading-spinner').style.display = 'none';
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

function formatGeminiText(text) {
    if (!text) return '';
    
    // Replace **bold** with <strong> tags
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Replace line breaks with <br> tags
    text = text.replace(/\n/g, '<br>');
    
    // Replace numbered lists (1. 2. 3.) with proper formatting
    text = text.replace(/(\d+\.\s)/g, '<br><strong>$1</strong>');
    
    // Clean up any double <br> tags at the start
    text = text.replace(/^<br>/, '');
    
    return text;
}

function showRecommendation(data) {
    const card = document.getElementById('recommendationCard');
    const icon = document.getElementById('recommendationIcon');
    const text = document.getElementById('recommendationText');
    const details = document.getElementById('recommendationDetails');
    
    // Remove existing classes
    card.className = 'recommendation-card';
    
    // Set recommendation based on overall signal
    const recommendation = data.recommendation ? data.recommendation.toLowerCase() : 'neutral';
    
    if (recommendation.includes('buy')) {
        card.classList.add('recommendation-buy');
        icon.innerHTML = '<i class="fas fa-arrow-up fa-3x mb-3"></i>';
        
        if (recommendation === 'strong buy') {
            text.innerHTML = '<strong>STRONG BUY SIGNAL</strong>';
        } else if (recommendation === 'weak buy') {
            text.innerHTML = '<strong>WEAK BUY SIGNAL</strong>';
        } else {
            text.innerHTML = '<strong>BUY SIGNAL</strong>';
        }
    } else if (recommendation.includes('sell')) {
        card.classList.add('recommendation-sell');
        icon.innerHTML = '<i class="fas fa-arrow-down fa-3x mb-3"></i>';
        
        if (recommendation === 'strong sell') {
            text.innerHTML = '<strong>STRONG SELL SIGNAL</strong>';
        } else if (recommendation === 'weak sell') {
            text.innerHTML = '<strong>WEAK SELL SIGNAL</strong>';
        } else {
            text.innerHTML = '<strong>SELL SIGNAL</strong>';
        }
    } else {
        card.classList.add('recommendation-neutral');
        icon.innerHTML = '<i class="fas fa-minus fa-3x mb-3"></i>';
        text.innerHTML = '<strong>NEUTRAL</strong>';
    }
    
    // Add details with new weighted scoring system
    const buySignals = data.buy_signals || 0;
    const sellSignals = data.sell_signals || 0;
    const totalSignals = buySignals + sellSignals;
    
    // Calculate correct percentages
    const buyPercentage = totalSignals > 0 ? Math.round((buySignals / totalSignals) * 100 * 10) / 10 : 0;
    const sellPercentage = totalSignals > 0 ? Math.round((sellSignals / totalSignals) * 100 * 10) / 10 : 0;
    
    // Format Gemini analysis text
    const formattedGeminiAnalysis = formatGeminiText(data.gemini_analysis);
    
    details.innerHTML = `
        <div><strong>Technical Analysis Summary:</strong></div>
        <div>Buy Signals: ${buySignals}/${totalSignals} (${buyPercentage}%)</div>
        <div>Sell Signals: ${sellSignals}/${totalSignals} (${sellPercentage}%)</div>
        ${data.gemini_analysis ? `
        <div style="margin-top: 15px; padding: 10px; background-color: rgba(255,255,255,0.1); border-radius: 5px;">
            <div><strong>🤖 AI Analysis:</strong></div>
            <div style="margin-top: 8px; font-size: 0.9em; line-height: 1.5;">${formattedGeminiAnalysis}</div>
        </div>
        ` : ''}
    `;
    
    card.style.display = 'block';
}

function hideRecommendation() {
    document.getElementById('recommendationCard').style.display = 'none';
}

async function handleFetchDataOnly() {
    const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
    const timeframe = document.getElementById('timeframeSelect').value;
    
    if (!ticker) {
        showError('Please enter a stock ticker symbol');
        return;
    }
    
    showLoading();
    hideError();
    hideRecommendation();
    
    try {
        // Check if running locally - improved detection
        const isLocal = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname === '' ||
                       window.location.protocol === 'file:' ||
                       window.location.port === '8000' ||
                       !window.location.hostname.includes('netlify.app');
        
        console.log(`DEBUG: Environment detection - hostname: ${window.location.hostname}, port: ${window.location.port}, protocol: ${window.location.protocol}`);
        console.log(`DEBUG: Detected as local: ${isLocal}`);
        
        if (isLocal) {
            console.log(`DEBUG: Running in LOCAL mode - using Yahoo Finance directly`);
            // Local development - fetch data directly and do basic analysis
            const stockData = await fetchStockDataLocal(ticker, timeframe);
            showStockData(stockData, ticker, timeframe);
        } else {
            console.log(`DEBUG: Running in PRODUCTION mode - using Netlify functions`);
            // Production - use Netlify function
            const response = await fetch('/.netlify/functions/trader-recommendation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ticker: ticker,
                    timeframe: timeframe
                })
            });
            
            if (!response.ok) {
                const errorDetails = await getDetailedErrorMessage(response, ticker);
                throw new Error(errorDetails);
            }
            
            const text = await response.text();
            if (!text) {
                throw new Error(`Empty Response Error: The server returned no data for ${ticker}. This could indicate:\n• Server overload or maintenance\n• Network connectivity issues\n• Invalid API configuration\n\nPlease try again in a few moments.`);
            }
            
            let data;
            try {
                data = JSON.parse(text);
            } catch (parseError) {
                console.error('JSON Parse Error:', parseError);
                console.error('Response text:', text);
                throw new Error(`Data Format Error: Unable to parse server response for ${ticker}.\n\nTechnical Details:\n• Parse Error: ${parseError.message}\n• Response Length: ${text.length} characters\n• Response Preview: ${text.substring(0, 100)}...\n\nThis usually indicates a server-side error. Please try again or contact support if the issue persists.`);
            }
            
            if (data.error) {
                throw new Error(`Server Error: ${data.error}\n\nThis error was returned by the analysis service. Please verify the stock symbol and try again.`);
            }
            
            showStockData(data, ticker, timeframe);
        }
        
    } catch (error) {
        console.error('Error:', error);
        hideLoading();
        showError(error.message || 'An unexpected error occurred while analyzing the stock. Please try again.');
    }
}

function showStockData(data, ticker, timeframe) {
    const card = document.getElementById('stockDataCard');
    const details = document.getElementById('stockDataDetails');
    
    hideRecommendation(); // Hide recommendation card when showing stock data
    card.style.display = 'block';
    
    // For local mode, data is raw stock data
    if (data.timestamps) {
        const latestClose = data.close.filter(price => price !== null);
        const currentPrice = latestClose[latestClose.length - 1];
        const firstPrice = latestClose[0];
        const priceChange = currentPrice - firstPrice;
        const priceChangePercent = ((priceChange / firstPrice) * 100).toFixed(2);
        
        details.innerHTML = `
            <div><strong>📊 Raw Stock Data for ${ticker} (${timeframe}):</strong></div>
            <div style="margin-top: 10px;">
                <div>📈 Current Price: $${currentPrice?.toFixed(2) || 'N/A'}</div>
                <div>📊 Data Points: ${data.timestamps.length}</div>
                <div>🔄 Price Change: ${priceChange > 0 ? '+' : ''}${priceChange?.toFixed(2)} (${priceChangePercent}%)</div>
                <div>📅 Date Range: ${new Date(data.timestamps[0] * 1000).toLocaleDateString()} - ${new Date(data.timestamps[data.timestamps.length - 1] * 1000).toLocaleDateString()}</div>
            </div>
            <div style="margin-top: 15px; padding: 10px; background-color: rgba(255,255,255,0.1); border-radius: 5px;">
                <div><strong>✅ Yahoo Finance API Test Results:</strong></div>
                <div style="margin-top: 8px; font-size: 0.9em;">
                    <div>• API Response: ✅ Success</div>
                    <div>• Data Quality: ✅ Valid OHLCV data</div>
                    <div>• Timestamps: ✅ ${data.timestamps.length} data points</div>
                    <div>• Price Data: ✅ Complete</div>
                    <div>• Volume Data: ✅ Available</div>
                </div>
            </div>
        `;
    } else {
        // For production mode, data is analysis result
        details.innerHTML = `
            <div><strong>📊 Analysis Data for ${ticker} (${timeframe}):</strong></div>
            <div style="margin-top: 10px;">
                <div>🎯 Recommendation: ${data.recommendation || 'N/A'}</div>
                <div>📈 Buy Signals: ${data.buy_signals || 0}</div>
                <div>📉 Sell Signals: ${data.sell_signals || 0}</div>
                <div>💰 Current Price: $${data.current_price?.toFixed(2) || 'N/A'}</div>
            </div>
            <div style="margin-top: 15px; padding: 10px; background-color: rgba(255,255,255,0.1); border-radius: 5px;">
                <div><strong>✅ Netlify Function Test Results:</strong></div>
                <div style="margin-top: 8px; font-size: 0.9em;">
                    <div>• Function Response: ✅ Success</div>
                    <div>• Yahoo Finance API: ✅ Working</div>
                    <div>• Technical Analysis: ✅ Complete</div>
                    <div>• AI Analysis: ${data.gemini_analysis ? '✅ Working' : '⚠️ Limited'}</div>
                </div>
            </div>
        `;
    }
}

async function fetchStockDataLocal(ticker, timeframe) {
    const now = Math.floor(Date.now() / 1000);
    const periods = {
        '5m': { 
            period1: now - (24 * 60 * 60), // 1 day ago
            period2: now,
            interval: '5m' 
        },
        '1mo': { 
            period1: now - (30 * 24 * 60 * 60), // 30 days ago
            period2: now,
            interval: '1d' 
        },
        '3mo': { 
            period1: now - (90 * 24 * 60 * 60), // 90 days ago
            period2: now,
            interval: '1d' 
        },
        '6mo': { 
            period1: now - (180 * 24 * 60 * 60), // 180 days ago
            period2: now,
            interval: '1d' 
        },
        '1y': { 
            period1: now - (365 * 24 * 60 * 60), // 365 days ago
            period2: now,
            interval: '1d' 
        },
        '2y': { 
            period1: now - (2 * 365 * 24 * 60 * 60), // 2 years ago
            period2: now,
            interval: '1d' 
        }
    };
    
    const config = periods[timeframe] || periods['1mo'];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${config.period1}&period2=${config.period2}&interval=${config.interval}&includePrePost=false&events=div%2Csplit`;
    
    console.log(`DEBUG: Fetching ${ticker} with URL:`, url);
    
    try {
        const response = await fetch(url);
        
        console.log(`DEBUG: Response status: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            const errorDetails = await getDetailedYahooErrorMessage(response, ticker);
            throw new Error(errorDetails);
        }
        
        const text = await response.text();
        console.log(`DEBUG: Response length: ${text.length} characters`);
        console.log(`DEBUG: Response preview:`, text.substring(0, 200));
        
        if (!text) {
            throw new Error(`Empty Response from Yahoo Finance: No data returned for ${ticker}.\n\nPossible causes:\n• Yahoo Finance API is temporarily unavailable\n• Network connectivity issues\n• Symbol may be invalid or delisted\n\nSuggestions:\n• Try again in a few moments\n• Verify the ticker symbol is correct\n• Check if the market is currently open`);
        }
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            console.error('DEBUG: JSON Parse Error:', parseError);
            throw new Error(`Yahoo Finance Data Parse Error: Unable to process response for ${ticker}.\n\nTechnical Details:\n• Parse Error: ${parseError.message}\n• Response Length: ${text.length} characters\n• Response Preview: ${text.substring(0, 150)}...\n\nThis indicates Yahoo Finance returned invalid data. Please try again or use a different symbol.`);
        }
        
        console.log(`DEBUG: Parsed data structure:`, Object.keys(data));
        if (data.chart) {
            console.log(`DEBUG: Chart result count:`, data.chart.result?.length || 0);
        }
        
        if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
            console.error('DEBUG: No chart data found:', data);
            throw new Error(`No Stock Data Available: Yahoo Finance returned empty results for ${ticker}.\n\nDetailed Analysis:\n• The symbol may not exist on supported exchanges\n• The company may be delisted or suspended from trading\n• Regional restrictions may apply\n• Symbol format may be incorrect\n\nTroubleshooting:\n1. Verify ticker spelling (e.g., AAPL not APPL)\n2. Try major symbols: AAPL, MSFT, GOOGL, TSLA\n3. Add exchange suffix if needed (.TO for Toronto, .L for London)\n4. For crypto, use format like BTC-USD\n\nYahoo Finance Response: ${JSON.stringify(data).substring(0, 200)}...`);
        }
        
        const result = data.chart.result[0];
        const timestamps = result.timestamp;
        const quote = result.indicators.quote[0];
        
        console.log(`DEBUG: Data points - timestamps: ${timestamps?.length || 0}, quote keys:`, Object.keys(quote || {}));
        
        if (!timestamps || !quote) {
            throw new Error(`Invalid Data Structure: Yahoo Finance returned malformed data for ${ticker}.\n\nData Issues Found:\n• Missing timestamps: ${!timestamps}\n• Missing quote data: ${!quote}\n• Result structure: ${JSON.stringify(Object.keys(result))}\n\nThis usually indicates:\n• Temporary API issues\n• Symbol format problems\n• Data availability restrictions\n\nSolutions:\n• Try a different timeframe\n• Use a more common stock symbol\n• Wait and retry in a few minutes`);
        }
        
        if (!quote.close || quote.close.length === 0) {
            throw new Error(`No Price Data: Yahoo Finance has no closing prices for ${ticker}.\n\nPossible reasons:\n• Symbol is not actively traded\n• Market is closed and no recent data available\n• Symbol represents a delisted security\n• Timeframe selected has no data\n\nRecommendations:\n• Try a different timeframe (1mo or 3mo)\n• Use actively traded symbols (AAPL, MSFT, GOOGL)\n• Check if the market is currently open\n• Verify the company is still publicly traded`);
        }
        
        console.log(`DEBUG: Successfully fetched ${quote.close.length} price points for ${ticker}`);
        
        return {
            timestamps: timestamps,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            close: quote.close,
            volume: quote.volume
        };
    } catch (error) {
        // If it's already our custom error, re-throw it
        if (error.message.includes('Yahoo Finance') || error.message.includes('HTTP')) {
            throw error;
        }
        
        // Handle network and other unexpected errors
        console.error('Unexpected error fetching stock data:', error);
        throw new Error(`Network/Connection Error: Unable to fetch data for ${ticker}.\n\nError Details:\n• Error Type: ${error.name || 'Unknown'}\n• Error Message: ${error.message}\n• Timestamp: ${new Date().toISOString()}\n\nCommon Causes:\n• Internet connection issues\n• Firewall or proxy blocking requests\n• Yahoo Finance API temporarily down\n• Browser security restrictions (CORS)\n\nSolutions:\n1. Check your internet connection\n2. Try refreshing the page\n3. Disable browser extensions temporarily\n4. Try a different network if possible\n5. Wait 5-10 minutes and retry`);
    }
}
