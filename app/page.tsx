'use client';

import { useState, useEffect, useRef } from 'react';

// Types
interface Token {
  symbol: string;
  name: string;
  price: number;
  prevPrice: number;
  change24h: number;
  rsi: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
}

interface Position {
  id: number;
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  valueEUR: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: Date;
}

interface Trade {
  id: number;
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  result: 'WIN' | 'LOSS';
  reason: 'TP' | 'SL' | 'SIGNAL';
  openedAt: Date;
  closedAt: Date;
}

interface LogEntry {
  time: Date;
  type: 'INFO' | 'BUY' | 'SELL' | 'TP' | 'SL' | 'SIGNAL';
  message: string;
}

// Config
const TOKENS_CONFIG = [
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk' },
  { id: 'dogwifcoin', symbol: 'WIF', name: 'dogwifhat' },
  { id: 'jupiter-exchange-solana', symbol: 'JUP', name: 'Jupiter' },
  { id: 'popcat', symbol: 'POPCAT', name: 'Popcat' },
  { id: 'render-token', symbol: 'RENDER', name: 'Render' },
];

const CONFIG = {
  INITIAL_BALANCE: 1000,
  POSITION_SIZE: 0.15,      // 15% per trade
  MAX_POSITIONS: 4,
  STOP_LOSS: 0.03,          // 3%
  TAKE_PROFIT: 0.08,        // 8%
  RSI_BUY: 35,              // Buy when RSI < 35
  RSI_SELL: 70,             // Sell when RSI > 70
  MIN_CHANGE_BUY: -3,       // Buy on 3%+ dip
  POLL_INTERVAL: 15000,     // 15 seconds
};

export default function TradingBot() {
  const [balance, setBalance] = useState(CONFIG.INITIAL_BALANCE);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const priceHistory = useRef<{ [symbol: string]: number[] }>({});
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [{ time: new Date(), type, message }, ...prev].slice(0, 100));
  };

  // Calculate RSI
  const calculateRSI = (prices: number[], period = 14): number => {
    if (prices.length < period + 1) return 50;
    
    let gains = 0, losses = 0;
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
  };

  // Determine signal
  const getSignal = (rsi: number, change24h: number): 'BUY' | 'SELL' | 'HOLD' => {
    if (rsi < CONFIG.RSI_BUY && change24h < CONFIG.MIN_CHANGE_BUY) return 'BUY';
    if (rsi > CONFIG.RSI_SELL) return 'SELL';
    return 'HOLD';
  };

  // Fetch prices
  const fetchPrices = async () => {
    try {
      const ids = TOKENS_CONFIG.map(t => t.id).join(',');
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { cache: 'no-store' }
      );
      const data = await res.json();

      const updatedTokens: Token[] = TOKENS_CONFIG.map(t => {
        const price = data[t.id]?.usd || 0;
        const change24h = data[t.id]?.usd_24h_change || 0;
        
        // Update price history
        if (!priceHistory.current[t.symbol]) {
          priceHistory.current[t.symbol] = [];
        }
        priceHistory.current[t.symbol].push(price);
        if (priceHistory.current[t.symbol].length > 50) {
          priceHistory.current[t.symbol].shift();
        }
        
        const rsi = calculateRSI(priceHistory.current[t.symbol]);
        const signal = getSignal(rsi, change24h);
        const prevPrice = tokens.find(tok => tok.symbol === t.symbol)?.price || price;

        return {
          symbol: t.symbol,
          name: t.name,
          price,
          prevPrice,
          change24h,
          rsi,
          signal,
        };
      });

      setTokens(updatedTokens);
      setLastUpdate(new Date());

      if (isRunning) {
        processSignals(updatedTokens);
        checkPositions(updatedTokens);
      }
    } catch (error) {
      addLog('INFO', `Price fetch error: ${error}`);
    }
  };

  // Process trading signals
  const processSignals = (currentTokens: Token[]) => {
    currentTokens.forEach(token => {
      if (token.signal === 'BUY' && token.price > 0) {
        const hasPosition = positions.some(p => p.symbol === token.symbol);
        if (!hasPosition && positions.length < CONFIG.MAX_POSITIONS && balance > 50) {
          openPosition(token);
        }
      }
    });
  };

  // Open a position
  const openPosition = (token: Token) => {
    const tradeValue = Math.min(balance * CONFIG.POSITION_SIZE, balance - 10);
    if (tradeValue < 20) return;

    const quantity = tradeValue / token.price;
    const position: Position = {
      id: Date.now(),
      symbol: token.symbol,
      side: 'LONG',
      entryPrice: token.price,
      currentPrice: token.price,
      quantity,
      valueEUR: tradeValue,
      pnl: 0,
      pnlPercent: 0,
      stopLoss: token.price * (1 - CONFIG.STOP_LOSS),
      takeProfit: token.price * (1 + CONFIG.TAKE_PROFIT),
      openedAt: new Date(),
    };

    setPositions(prev => [...prev, position]);
    setBalance(prev => prev - tradeValue);
    addLog('BUY', `🟢 OPENED ${token.symbol} @ $${token.price.toFixed(4)} | Size: €${tradeValue.toFixed(2)} | SL: $${position.stopLoss.toFixed(4)} | TP: $${position.takeProfit.toFixed(4)}`);
  };

  // Check positions for SL/TP
  const checkPositions = (currentTokens: Token[]) => {
    setPositions(prev => {
      const stillOpen: Position[] = [];
      
      prev.forEach(pos => {
        const token = currentTokens.find(t => t.symbol === pos.symbol);
        if (!token) {
          stillOpen.push(pos);
          return;
        }

        const currentPrice = token.price;
        const pnl = (currentPrice - pos.entryPrice) * pos.quantity;
        const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

        // Check Stop Loss
        if (currentPrice <= pos.stopLoss) {
          closeTrade(pos, currentPrice, 'SL');
          return;
        }

        // Check Take Profit
        if (currentPrice >= pos.takeProfit) {
          closeTrade(pos, currentPrice, 'TP');
          return;
        }

        // Check sell signal
        if (token.signal === 'SELL' && pnl > 0) {
          closeTrade(pos, currentPrice, 'SIGNAL');
          return;
        }

        // Update position
        stillOpen.push({
          ...pos,
          currentPrice,
          pnl,
          pnlPercent,
        });
      });

      return stillOpen;
    });
  };

  // Close a trade
  const closeTrade = (pos: Position, exitPrice: number, reason: 'TP' | 'SL' | 'SIGNAL') => {
    const pnl = (exitPrice - pos.entryPrice) * pos.quantity;
    const pnlPercent = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const returnValue = pos.valueEUR + pnl;

    const trade: Trade = {
      id: pos.id,
      symbol: pos.symbol,
      side: 'LONG',
      entryPrice: pos.entryPrice,
      exitPrice,
      quantity: pos.quantity,
      pnl,
      pnlPercent,
      result: pnl >= 0 ? 'WIN' : 'LOSS',
      reason,
      openedAt: pos.openedAt,
      closedAt: new Date(),
    };

    setTrades(prev => [trade, ...prev]);
    setBalance(prev => prev + returnValue);
    
    const emoji = pnl >= 0 ? '✅' : '❌';
    const reasonText = reason === 'TP' ? 'TAKE PROFIT' : reason === 'SL' ? 'STOP LOSS' : 'SIGNAL';
    addLog(reason, `${emoji} CLOSED ${pos.symbol} @ $${exitPrice.toFixed(4)} | ${reasonText} | PnL: €${pnl.toFixed(2)} (${pnlPercent.toFixed(1)}%)`);
  };

  // Toggle bot
  const toggleBot = () => {
    if (isRunning) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      addLog('INFO', '⏹️ Bot stopped');
    } else {
      addLog('INFO', '▶️ Bot started - scanning for opportunities...');
      fetchPrices();
      intervalRef.current = setInterval(fetchPrices, CONFIG.POLL_INTERVAL);
    }
    setIsRunning(!isRunning);
  };

  // Reset bot
  const resetBot = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsRunning(false);
    setBalance(CONFIG.INITIAL_BALANCE);
    setPositions([]);
    setTrades([]);
    setLogs([]);
    priceHistory.current = {};
    addLog('INFO', '🔄 Bot reset to initial state');
  };

  // Initial fetch
  useEffect(() => {
    fetchPrices();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Stats
  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = trades.length > 0 
    ? (trades.filter(t => t.result === 'WIN').length / trades.length * 100).toFixed(0) 
    : '0';
  const openPnL = positions.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">🤖 SOL Paper Trader</h1>
            <p className="text-zinc-500 text-sm">Real prices, fake money, real learnings</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={toggleBot}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                isRunning 
                  ? 'bg-red-600 hover:bg-red-500' 
                  : 'bg-green-600 hover:bg-green-500'
              }`}
            >
              {isRunning ? '⏹️ Stop' : '▶️ Start'}
            </button>
            <button
              onClick={resetBot}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg font-medium transition-colors"
            >
              🔄 Reset
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className="text-zinc-500 text-sm">Balance</div>
            <div className="text-xl font-bold">€{balance.toFixed(2)}</div>
          </div>
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className="text-zinc-500 text-sm">Open PnL</div>
            <div className={`text-xl font-bold ${openPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              €{openPnL.toFixed(2)}
            </div>
          </div>
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className="text-zinc-500 text-sm">Closed PnL</div>
            <div className={`text-xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              €{totalPnL.toFixed(2)}
            </div>
          </div>
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className="text-zinc-500 text-sm">Win Rate</div>
            <div className="text-xl font-bold">{winRate}%</div>
          </div>
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
            <div className="text-zinc-500 text-sm">Trades</div>
            <div className="text-xl font-bold">{trades.length}</div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Token Prices */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h2 className="font-semibold mb-3 flex items-center justify-between">
              📊 Live Prices
              {lastUpdate && (
                <span className="text-xs text-zinc-500">
                  {lastUpdate.toLocaleTimeString()}
                </span>
              )}
            </h2>
            <div className="space-y-2">
              {tokens.map(token => (
                <div key={token.symbol} className="flex items-center justify-between p-2 bg-zinc-800/50 rounded-lg">
                  <div>
                    <span className="font-medium">{token.symbol}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                      token.signal === 'BUY' ? 'bg-green-600' : 
                      token.signal === 'SELL' ? 'bg-red-600' : 'bg-zinc-600'
                    }`}>
                      {token.signal}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-mono">${token.price.toFixed(token.price < 0.01 ? 6 : 2)}</div>
                    <div className={`text-xs ${token.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(1)}% · RSI {token.rsi.toFixed(0)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Open Positions */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h2 className="font-semibold mb-3">📈 Open Positions ({positions.length}/{CONFIG.MAX_POSITIONS})</h2>
            {positions.length === 0 ? (
              <div className="text-zinc-500 text-center py-8">
                {isRunning ? 'Waiting for signals...' : 'Start bot to trade'}
              </div>
            ) : (
              <div className="space-y-2">
                {positions.map(pos => (
                  <div key={pos.id} className="p-3 bg-zinc-800/50 rounded-lg">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium">{pos.symbol}</span>
                      <span className={`font-mono ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        €{pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 space-y-0.5">
                      <div>Entry: ${pos.entryPrice.toFixed(4)} → ${pos.currentPrice.toFixed(4)}</div>
                      <div>SL: ${pos.stopLoss.toFixed(4)} | TP: ${pos.takeProfit.toFixed(4)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Trade History */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h2 className="font-semibold mb-3">📜 Trade History</h2>
            {trades.length === 0 ? (
              <div className="text-zinc-500 text-center py-8">No trades yet</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {trades.slice(0, 20).map(trade => (
                  <div key={trade.id} className="p-2 bg-zinc-800/50 rounded-lg text-sm">
                    <div className="flex justify-between">
                      <span>{trade.result === 'WIN' ? '✅' : '❌'} {trade.symbol}</span>
                      <span className={trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                        €{trade.pnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {trade.reason} · {trade.pnlPercent.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Log */}
        <div className="mt-6 bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h2 className="font-semibold mb-3">📝 Live Log</h2>
          <div className="bg-black rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-zinc-500">Waiting for activity...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`py-0.5 ${
                  log.type === 'BUY' ? 'text-green-400' :
                  log.type === 'SELL' || log.type === 'SL' ? 'text-red-400' :
                  log.type === 'TP' ? 'text-green-400' :
                  'text-zinc-400'
                }`}>
                  [{log.time.toLocaleTimeString()}] {log.message}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Config Info */}
        <div className="mt-4 text-xs text-zinc-600 text-center">
          Position Size: {CONFIG.POSITION_SIZE * 100}% · Stop Loss: {CONFIG.STOP_LOSS * 100}% · Take Profit: {CONFIG.TAKE_PROFIT * 100}% · 
          Buy RSI: &lt;{CONFIG.RSI_BUY} · Sell RSI: &gt;{CONFIG.RSI_SELL} · Poll: {CONFIG.POLL_INTERVAL / 1000}s
        </div>
      </div>
    </div>
  );
}
