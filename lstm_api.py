import os
from dotenv import load_dotenv
load_dotenv()
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
import numpy as np
import pandas as pd
import yfinance as yf
import ta
import joblib
import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import LSTM, Dense, Dropout, Input, Bidirectional, BatchNormalization
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.regularizers import l2
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score

app = Flask(__name__, static_folder='.')

MODEL_CACHE_DIR = 'cached_models'
os.makedirs(MODEL_CACHE_DIR, exist_ok=True)

CACHE_EXPIRY_DAYS = 7

PREDICTION_HORIZON = 5


def get_model_path(ticker):
    safe_ticker = ticker.replace('/', '_').replace('\\', '_').replace('^', '_')
    return os.path.join(MODEL_CACHE_DIR, f'{safe_ticker}_{PREDICTION_HORIZON}d')


def is_model_cached(ticker):
    path = get_model_path(ticker)
    model_file = f'{path}_model.keras'
    config_file = f'{path}_config.joblib'
    
    if not os.path.exists(model_file) or not os.path.exists(config_file):
        return False
    
    try:
        config = joblib.load(config_file)
        trained_at = datetime.fromisoformat(config.get('trained_at', '2000-01-01'))
        if datetime.now() - trained_at > timedelta(days=CACHE_EXPIRY_DAYS):
            return False
    except:
        return False
    
    return True


def fetch_stock_data(ticker, years=1):
    print(f"Fetching data for {ticker}...")
    end_date = datetime.now()
    start_date = end_date - timedelta(days=years * 365)
    
    df = yf.Ticker(ticker).history(start=start_date, end=end_date, interval='1d')
    
    if df.empty:
        raise ValueError(f"No data found for {ticker}")
    
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df = df[['Open', 'High', 'Low', 'Close', 'Volume']]
    df = df[~df.index.duplicated(keep='first')]
    
    return df


def calculate_indicators(df):
    close = df['Close']
    high = df['High']
    low = df['Low']
    volume = df['Volume']
    
    indicators = pd.DataFrame(index=df.index)
    
    indicators['Open'] = df['Open']
    indicators['High'] = df['High']
    indicators['Low'] = df['Low']
    indicators['Close'] = df['Close']
    indicators['Volume'] = df['Volume']
    
    for period in [5, 10, 20, 50]:
        if len(close) >= period:
            indicators[f'SMA_{period}'] = ta.trend.sma_indicator(close, window=period)
            indicators[f'EMA_{period}'] = ta.trend.ema_indicator(close, window=period)
    
    indicators['RSI'] = ta.momentum.rsi(close, window=14)
    
    macd = ta.trend.MACD(close)
    indicators['MACD'] = macd.macd()
    indicators['MACD_signal'] = macd.macd_signal()
    indicators['MACD_hist'] = macd.macd_diff()
    
    stoch = ta.momentum.StochasticOscillator(high, low, close)
    indicators['STOCH_k'] = stoch.stoch()
    indicators['STOCH_d'] = stoch.stoch_signal()
    
    bb = ta.volatility.BollingerBands(close)
    indicators['BB_high'] = bb.bollinger_hband()
    indicators['BB_low'] = bb.bollinger_lband()
    indicators['BB_pct'] = bb.bollinger_pband()
    
    indicators['ATR'] = ta.volatility.average_true_range(high, low, close)
    
    adx = ta.trend.ADXIndicator(high, low, close)
    indicators['ADX'] = adx.adx()
    
    indicators['Williams_R'] = ta.momentum.williams_r(high, low, close)
    
    indicators['CCI'] = ta.trend.cci(high, low, close)
    
    indicators['ROC'] = ta.momentum.roc(close, window=12)
    
    if volume.sum() > 0:
        indicators['OBV'] = ta.volume.on_balance_volume(close, volume)
    
    if len(close) >= 20:
        indicators['price_vs_SMA20'] = (close - indicators['SMA_20']) / indicators['SMA_20'] * 100
    
    indicators['return_1d'] = close.pct_change(1) * 100
    indicators['return_5d'] = close.pct_change(5) * 100
    
    indicators = indicators.ffill().bfill().dropna()
    
    return indicators


def prepare_lstm_data(df, sequence_length=20):
    future_return = df['Close'].pct_change(PREDICTION_HORIZON).shift(-PREDICTION_HORIZON) * 100
    direction = (future_return > 0).astype(int)
    
    scaler = StandardScaler()
    scaled = scaler.fit_transform(df)
    
    X, y_dir, y_pct = [], [], []
    
    for i in range(sequence_length, len(scaled) - PREDICTION_HORIZON):
        X.append(scaled[i-sequence_length:i])
        y_dir.append(direction.iloc[i])
        y_pct.append(future_return.iloc[i])
    
    X = np.array(X)
    y_dir = np.array(y_dir)
    y_pct = np.array(y_pct)
    
    valid = ~(np.isnan(y_dir) | np.isnan(y_pct))
    
    return X[valid], y_dir[valid], y_pct[valid], list(df.columns), scaler


def create_model(seq_len, n_features):
    inputs = Input(shape=(seq_len, n_features))
    
    x = Bidirectional(LSTM(64, return_sequences=True, kernel_regularizer=l2(0.001)))(inputs)
    x = BatchNormalization()(x)
    x = Dropout(0.3)(x)
    
    x = LSTM(32, return_sequences=False, kernel_regularizer=l2(0.001))(x)
    x = BatchNormalization()(x)
    x = Dropout(0.3)(x)
    
    x = Dense(32, activation='relu')(x)
    x = Dropout(0.2)(x)
    
    direction = Dense(1, activation='sigmoid', name='direction')(x)
    magnitude = Dense(1, activation='linear', name='magnitude')(x)
    
    model = Model(inputs=inputs, outputs=[direction, magnitude])
    model.compile(
        optimizer=Adam(learning_rate=0.001),
        loss={'direction': 'binary_crossentropy', 'magnitude': 'huber'},
        loss_weights={'direction': 1.0, 'magnitude': 0.3},
        metrics={'direction': 'accuracy', 'magnitude': 'mae'}
    )
    return model


def train_model(ticker, sequence_length=20, epochs=100):
    print(f"\n{'='*50}")
    print(f"TRAINING MODEL: {ticker} ({PREDICTION_HORIZON}-day prediction)")
    print(f"{'='*50}")
    
    df = fetch_stock_data(ticker, years=1)
    print(f"Data points: {len(df)}")
    
    indicators = calculate_indicators(df)
    print(f"Features: {len(indicators.columns)}")
    
    X, y_dir, y_pct, feature_names, scaler = prepare_lstm_data(indicators, sequence_length)
    print(f"Training samples: {len(X)}")
    
    if len(X) < 50:
        raise ValueError(f"Not enough data to train model. Need at least 50 samples, got {len(X)}")
    
    X_train, X_val, y_dir_train, y_dir_val, y_pct_train, y_pct_val = train_test_split(
        X, y_dir, y_pct, test_size=0.2, shuffle=False
    )
    
    model = create_model(X.shape[1], X.shape[2])
    
    callbacks = [
        EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True, verbose=0),
        ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6, verbose=0)
    ]
    
    history = model.fit(
        X_train, {'direction': y_dir_train, 'magnitude': y_pct_train},
        validation_data=(X_val, {'direction': y_dir_val, 'magnitude': y_pct_val}),
        epochs=epochs,
        batch_size=16,
        callbacks=callbacks,
        verbose=1
    )
    
    dir_probs, _ = model.predict(X_val, verbose=0)
    accuracy = accuracy_score(y_dir_val, (dir_probs.flatten() > 0.5).astype(int))
    try:
        auc = roc_auc_score(y_dir_val, dir_probs.flatten())
    except:
        auc = 0.5
    
    print(f"Validation Accuracy: {accuracy*100:.2f}%")
    print(f"Validation AUC: {auc:.4f}")
    
    path = get_model_path(ticker)
    model.save(f'{path}_model.keras')
    joblib.dump(scaler, f'{path}_scaler.joblib')
    joblib.dump({
        'ticker': ticker,
        'horizon': PREDICTION_HORIZON,
        'sequence_length': sequence_length,
        'feature_names': feature_names,
        'n_features': len(feature_names),
        'accuracy': float(accuracy),
        'auc': float(auc),
        'trained_at': datetime.now().isoformat(),
        'data_points': len(df),
        'epochs_trained': len(history.history['loss'])
    }, f'{path}_config.joblib')
    
    print(f"Model saved to {path}")
    
    return model, scaler, feature_names, {'accuracy': accuracy, 'auc': auc}


def load_cached_model(ticker):
    path = get_model_path(ticker)
    model = tf.keras.models.load_model(f'{path}_model.keras')
    scaler = joblib.load(f'{path}_scaler.joblib')
    config = joblib.load(f'{path}_config.joblib')
    return model, scaler, config


def make_prediction(ticker, force_retrain=False):
    if not force_retrain and is_model_cached(ticker):
        print(f"Using cached model for {ticker}")
        model, scaler, config = load_cached_model(ticker)
        feature_names = config['feature_names']
        sequence_length = config['sequence_length']
        metrics = {'accuracy': config['accuracy'], 'auc': config['auc']}
        trained_at = config['trained_at']
    else:
        print(f"Training new model for {ticker}")
        model, scaler, feature_names, metrics = train_model(ticker)
        config = joblib.load(f'{get_model_path(ticker)}_config.joblib')
        sequence_length = config['sequence_length']
        trained_at = config['trained_at']
    
    df = fetch_stock_data(ticker, years=1)
    indicators = calculate_indicators(df)
    
    recent_data = indicators[feature_names].iloc[-sequence_length:]
    scaled = scaler.transform(recent_data)
    X = scaled.reshape(1, sequence_length, len(feature_names))
    
    dir_prob, magnitude = model.predict(X, verbose=0)
    dir_prob = float(dir_prob[0][0])
    magnitude = float(magnitude[0][0])
    
    direction = 'UP' if dir_prob > 0.5 else 'DOWN'
    confidence = dir_prob * 100 if direction == 'UP' else (1 - dir_prob) * 100
    
    current_price = float(df['Close'].iloc[-1])
    predicted_change = magnitude if direction == 'UP' else -abs(magnitude)
    target_price = current_price * (1 + predicted_change / 100)
    
    if confidence > 70 and abs(magnitude) > 2:
        strength = 'STRONG'
    elif confidence > 55 and abs(magnitude) > 1:
        strength = 'MODERATE'
    else:
        strength = 'WEAK'
    
    return {
        'ticker': ticker,
        'horizon_days': PREDICTION_HORIZON,
        'direction': direction,
        'confidence': round(confidence, 2),
        'predicted_change_pct': round(predicted_change, 2),
        'strength': strength,
        'raw_probability': round(dir_prob, 4),
        'current_price': round(current_price, 2),
        'target_price': round(target_price, 2),
        'model_accuracy': round(metrics['accuracy'] * 100, 2),
        'model_auc': round(metrics['auc'], 4),
        'model_trained_at': trained_at,
        'data_as_of': df.index[-1].strftime('%Y-%m-%d')
    }


@app.route('/api/predict', methods=['POST', 'OPTIONS'])
def predict_endpoint():
    if request.method == 'OPTIONS':
        return '', 204
    
    try:
        data = request.json
        ticker = data.get('ticker', '').upper()
        force_retrain = data.get('force_retrain', False)
        
        if not ticker:
            return jsonify({'error': 'Ticker is required'}), 400
        
        result = make_prediction(ticker, force_retrain)
        return jsonify(result)
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/status', methods=['GET'])
def status_endpoint():
    return jsonify({
        'status': 'ok',
        'horizon_days': PREDICTION_HORIZON,
        'cached_models': len([f for f in os.listdir(MODEL_CACHE_DIR) if f.endswith('.keras')])
    })


@app.route('/api/cached', methods=['GET'])
def cached_models_endpoint():
    models = []
    for f in os.listdir(MODEL_CACHE_DIR):
        if f.endswith('_config.joblib'):
            try:
                config = joblib.load(os.path.join(MODEL_CACHE_DIR, f))
                models.append({
                    'ticker': config['ticker'],
                    'horizon': config['horizon'],
                    'accuracy': round(config['accuracy'] * 100, 2),
                    'auc': round(config['auc'], 4),
                    'trained_at': config['trained_at']
                })
            except:
                pass
    return jsonify(models)


def pretrain_models(tickers):
    print("\n" + "="*60)
    print("PRE-TRAINING MODELS")
    print("="*60)
    
    results = {}
    for ticker in tickers:
        try:
            print(f"\n--- {ticker} ---")
            if is_model_cached(ticker):
                print(f"Model already cached for {ticker}")
                _, _, config = load_cached_model(ticker)
                results[ticker] = {'accuracy': config['accuracy'], 'auc': config['auc'], 'status': 'cached'}
            else:
                _, _, _, metrics = train_model(ticker)
                results[ticker] = {'accuracy': metrics['accuracy'], 'auc': metrics['auc'], 'status': 'trained'}
        except Exception as e:
            print(f"Error training {ticker}: {e}")
            results[ticker] = {'error': str(e), 'status': 'failed'}
    
    print("\n" + "="*60)
    print("PRE-TRAINING SUMMARY")
    print("="*60)
    for ticker, res in results.items():
        if 'error' in res:
            print(f"{ticker}: FAILED - {res['error']}")
        else:
            print(f"{ticker}: Accuracy={res['accuracy']*100:.2f}%, AUC={res['auc']:.4f} ({res['status']})")
    
    return results


@app.route('/api/config')
def get_config():
    return jsonify({'gemini_api_key': GEMINI_API_KEY})


@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')


@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_from_directory('js', filename)


@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)


if __name__ == '__main__':
    import sys
    
    if '--pretrain' in sys.argv:
        pretrain_models(['AAPL', 'MSFT', 'TSLA'])
        print("\nPre-training complete. Starting server...")
    
    print("\n" + "="*50)
    print("LSTM Prediction API for TraderBot")
    print("="*50)
    print(f"Prediction Horizon: {PREDICTION_HORIZON} days")
    print("\nOpen in browser: http://localhost:5001")
    print("\nAPI Endpoints:")
    print("  POST /api/predict - Get prediction (trains if needed)")
    print("  GET  /api/status  - Check API status")
    print("  GET  /api/cached  - List cached models")
    print("="*50)
    app.run(host='0.0.0.0', port=5001, debug=False)
