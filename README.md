# Yahoo Finance Stock Scraper Web Platform

A modern web-based platform for scraping historical stock data from Yahoo Finance. This application provides an intuitive interface to fetch pricing data for any ticker symbol with customizable timeframes.

## Features

- **Real-time Stock Data**: Fetch historical stock data for any ticker symbol
- **Multiple Timeframes**: Support for 1 minute, 5 minutes, 1 day, and 3 months intervals
- **Custom Date Ranges**: Select specific start and end dates for data retrieval
- **Interactive Charts**: Beautiful Chart.js visualizations of stock price movements
- **Data Export**: Export data to CSV format for further analysis
- **Responsive Design**: Modern, mobile-friendly interface
- **Real-time Statistics**: Display key metrics like price changes, highs, lows, and volume

## Installation

1. **Clone or navigate to the project directory:**
   ```bash
   cd yahoo_scraper_web
   ```

2. **Install required dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the application:**
   ```bash
   python app.py
   ```

4. **Open your browser and navigate to:**
   ```
   http://localhost:5000
   ```

## Usage

1. **Enter Stock Ticker**: Input any valid stock symbol (e.g., AAPL, TSLA, MSFT)
2. **Select Interval**: Choose from available intervals:
   - 1 Day (recommended for long-term analysis)
   - 5 Minutes (for intraday analysis, ~80 days history)
   - 1 Minute (for short-term analysis, ~4-5 days history)
   - 3 Months (for quarterly analysis)
3. **Set Date Range**: Optionally specify start and end dates
4. **Get Data**: Click "Get Stock Data" to fetch and display results
5. **Export**: Use the "Export CSV" button to download data

## API Endpoints

### POST /api/stock-data
Fetch stock data for a given ticker and timeframe.

**Request Body:**
```json
{
    "ticker": "AAPL",
    "start_date": "2023-01-01",
    "end_date": "2024-01-01",
    "interval": "1d"
}
```

**Response:**
```json
{
    "success": true,
    "ticker": "AAPL",
    "interval": "1d",
    "data": [...],
    "total_records": 252
}
```

### POST /api/export-csv
Export stock data as CSV format.

## Data Fields

Each data point includes:
- **Date**: Trading date and time
- **Open**: Opening price
- **High**: Highest price during the period
- **Low**: Lowest price during the period
- **Close**: Closing price
- **Volume**: Trading volume
- **Adj Close**: Adjusted closing price (accounts for dividends and splits)

## Technical Details

- **Backend**: Flask web framework
- **Frontend**: Bootstrap 5, Chart.js for visualizations
- **Data Source**: Yahoo Finance API endpoints
- **Data Processing**: Pandas for data manipulation
- **Export**: CSV format support

## Supported Intervals

- **1m**: 1 minute intervals (limited to ~4-5 days of history)
- **5m**: 5 minute intervals (limited to ~80 days of history)
- **1d**: Daily intervals (full historical data available)
- **3mo**: 3 month intervals (full historical data available)

## Error Handling

The application includes comprehensive error handling for:
- Invalid ticker symbols
- Network connectivity issues
- Data availability problems
- Invalid date ranges
- API rate limiting

## Security Notes

- No API keys required (uses public Yahoo Finance endpoints)
- Rate limiting recommended for production use
- Consider implementing caching for frequently requested data

## Browser Compatibility

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is for educational and research purposes only. Please respect Yahoo Finance's terms of service and avoid overusing their servers.
