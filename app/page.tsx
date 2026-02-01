'use client';

import { useState, useEffect, useCallback } from 'react';

// Types
interface Token {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  tier: string;
}

interface Position {
  id: number;
  symbol: string;
  entryPrice: number;
  quantity: number;
  valueEUR: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: string;
}

interface Trade extends Position {
  status: string;
  closePrice?: number;
  closePnL?: number;
}

// Config
const TOKENS = [
  { id: 'solana', symbol: 'SOL', name: 'Solana', tier: 'blue-chip' },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk', tier: 'meme' },
  { id: 'dogwifcoin', symbol: 'WIF', name: 'dogwifhat', tier: 'meme' },
  { id: 'jupiter-exchange-solana', symbol: 'JUP', name: 'Jupiter', tier: 'defi' },
  { id: 'pyth-network', symbol: 'PYTH', name: 'Pyth', tier: 'infra' },
  { id: 'raydium', symbol: 'RAY', name: 'Raydium', tier: 'defi' },
  { id: 'render-token', symbol: 'RENDER', name: 'Render', tier: 'ai' },
  { id: 'jito-governance-token', symbol: 'JTO', name: 'Jito', tier: 'infra' },
];

const INITIAL_BALANCE = 1000;
const STOP_LOSS = 0.025;
const TAKE_PROFIT = 0.06;
const EUR_RATE = 0.92;

export default function Home() {
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Fetch prices from CoinGecko
  const fetchPrices = useCallback(async () => {
    try {
      const ids = TOKENS.map(t => t.id).join(',');
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
      );
      const data = await res.json();
      
      const updatedTokens = TOKENS.map(t => ({
        ...t,
        price: data[t.id]?.usd || 0,
        change24h: data[t.id]?.usd_24h_change || 0,
      }));
      
      setTokens(updatedTokens);
      setLastUpdate(new Date());
      setLoading(false);
      
      // Check positions for SL/TP
      checkPositions(updatedTokens);
    } catch (error) {
      console.error('Price fetch error:', error);
    }
  }, []);

  // Check positions for stop loss / take profit
  const checkPositions = (currentTokens: Token[]) => {
    setPositions(prev => {
      const stillOpen: Position[] = [];
      const toClose: Trade[] = [];
      
      prev.forEach(pos => {
        const token = currentTokens.find(t => t.symbol === pos.symbol);
        if (!token) {
          stillOpen.push(pos);
          return;
        }
        
        const currentPrice = token.price;
        const pnlUSD = (currentPrice - pos.entryPrice) * pos.quantity;
        const pnlEUR = pnlUSD * EUR_RATE;
        
        if (currentPrice <= pos.stopLoss) {
          toClose.push({
            ...pos,
            status: 'SL HIT ❌',
            closePrice: currentPrice,
            closePnL: pnlEUR,
          });
          setBalance(b => b + pos.valueEUR + pnlEUR);
        } else if (currentPrice >= pos.takeProfit) {
          toClose.push({
            ...pos,
            status: 'TP HIT ✅',
            closePrice: currentPrice,
            closePnL: pnlEUR,
          });
          setBalance(b => b + pos.valueEUR + pnlEUR);
        } else {
          stillOpen.push(pos);
        }
      });
      
      if (toClose.length > 0) {
        setTrades(t => [...toClose, ...t]);
      }
      
      return stillOpen;
    });
  };

  // Execute a trade
  const executeTrade = (symbol: string) => {
    const token = tokens.find(t => t.symbol === symbol);
    if (!token || token.price === 0) return;
    
    const tradeSize = Math.min(100, balance * 0.1); // Max 10% or €100
    if (tradeSize < 10) {
      alert('Insufficient balance');
      return;
    }
    
    const tradeSizeUSD = tradeSize / EUR_RATE;
    const quantity = tradeSizeUSD / token.price;
    
    const position: Position = {
      id: Date.now(),
      symbol,
      entryPrice: token.price,
      quantity,
      valueEUR: tradeSize,
      stopLoss: token.price * (1 - STOP_LOSS),
      takeProfit: token.price * (1 + TAKE_PROFIT),
      timestamp: new Date().toISOString(),
    };
    
    setBalance(b => b - tradeSize);
    setPositions(p => [...p, position]);
    setTrades(t => [{ ...position, status: 'OPEN' }, ...t]);
  };

  // Close a position manually
  const closePosition = (posId: number) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === posId);
      if (!pos) return prev;
      
      const token = tokens.find(t => t.symbol === pos.symbol);
      const currentPrice = token?.price || pos.entryPrice;
      const pnlUSD = (currentPrice - pos.entryPrice) * pos.quantity;
      const pnlEUR = pnlUSD * EUR_RATE;
      
      setBalance(b => b + pos.valueEUR + pnlEUR);
      setTrades(t => [{
        ...pos,
        status: 'CLOSED',
        closePrice: currentPrice,
        closePnL: pnlEUR,
      }, ...t]);
      
      return prev.filter(p => p.id !== posId);
    });
  };

  // Reset everything
  const resetAll = () => {
    if (confirm('Reset all trades and balance?')) {
      setBalance(INITIAL_BALANCE);
      setPositions([]);
      setTrades([]);
    }
  };

  // Calculate totals
  const positionsValue = positions.reduce((sum, pos) => {
    const token = tokens.find(t => t.symbol === pos.symbol);
    const currentPrice = token?.price || pos.entryPrice;
    return sum + (currentPrice * pos.quantity * EUR_RATE);
  }, 0);
  
  const totalValue = balance + positionsValue;
  const totalPnL = totalValue - INITIAL_BALANCE;
  const returnPct = (totalPnL / INITIAL_BALANCE) * 100;

  // Fetch on mount and interval
  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 15000); // Every 15s
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const formatPrice = (p: number) => p < 0.001 ? p.toFixed(8) : p < 1 ? p.toFixed(6) : p.toFixed(2);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-gray-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
          <div>
            <h1 className="text-2xl font-bold text-[#14F195]">◎ SOL TRADER</h1>
            <p className="text-gray-500 text-sm">Paper Trading Simulator</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500">
              {lastUpdate ? `Updated: ${lastUpdate.toLocaleTimeString()}` : 'Loading...'}
            </span>
            <span className="bg-[#14F195] text-black px-3 py-1 rounded-full text-xs font-bold">
              PAPER MODE
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-gray-500 text-xs uppercase">Portfolio Value</p>
            <p className="text-2xl font-bold">€{totalValue.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-gray-500 text-xs uppercase">Cash Balance</p>
            <p className="text-2xl font-bold">€{balance.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-gray-500 text-xs uppercase">Total P&L</p>
            <p className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-[#14F195]' : 'text-red-500'}`}>
              {totalPnL >= 0 ? '+' : ''}€{totalPnL.toFixed(2)}
            </p>
            <p className={`text-sm ${totalPnL >= 0 ? 'text-[#14F195]' : 'text-red-500'}`}>
              {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
            </p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-gray-500 text-xs uppercase">Open Positions</p>
            <p className="text-2xl font-bold">{positions.length}</p>
            <button 
              onClick={resetAll}
              className="text-xs text-gray-500 hover:text-red-500 mt-1"
            >
              Reset All
            </button>
          </div>
        </div>

        {/* Tokens */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 mb-8">
          <h2 className="text-gray-400 text-sm uppercase mb-4">Market • Click to Trade</h2>
          {loading ? (
            <p className="text-gray-500">Loading prices...</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {tokens.map(token => {
                const hasPosition = positions.some(p => p.symbol === token.symbol);
                return (
                  <button
                    key={token.symbol}
                    onClick={() => !hasPosition && executeTrade(token.symbol)}
                    disabled={hasPosition}
                    className={`bg-gray-800 rounded-lg p-3 text-center hover:bg-gray-700 transition ${
                      hasPosition ? 'opacity-50 cursor-not-allowed ring-2 ring-[#14F195]' : ''
                    }`}
                  >
                    <p className="font-bold">{token.symbol}</p>
                    <p className="text-sm text-gray-400">${formatPrice(token.price)}</p>
                    <p className={`text-xs ${token.change24h >= 0 ? 'text-[#14F195]' : 'text-red-500'}`}>
                      {token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(2)}%
                    </p>
                    {hasPosition && <p className="text-[10px] text-[#14F195] mt-1">OPEN</p>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Positions & Trades */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Open Positions */}
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <h2 className="text-gray-400 text-sm uppercase mb-4">Open Positions</h2>
            {positions.length === 0 ? (
              <p className="text-gray-600 text-center py-8">No open positions</p>
            ) : (
              <div className="space-y-3">
                {positions.map(pos => {
                  const token = tokens.find(t => t.symbol === pos.symbol);
                  const currentPrice = token?.price || pos.entryPrice;
                  const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
                  const pnlEUR = (currentPrice - pos.entryPrice) * pos.quantity * EUR_RATE;
                  
                  return (
                    <div key={pos.id} className="bg-gray-800 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold">{pos.symbol}</p>
                          <p className="text-xs text-gray-500">
                            Entry: ${formatPrice(pos.entryPrice)} → ${formatPrice(currentPrice)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${pnlPct >= 0 ? 'text-[#14F195]' : 'text-red-500'}`}>
                            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                          </p>
                          <p className={`text-sm ${pnlEUR >= 0 ? 'text-[#14F195]' : 'text-red-500'}`}>
                            €{pnlEUR.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>SL: ${formatPrice(pos.stopLoss)} | TP: ${formatPrice(pos.takeProfit)}</span>
                        <button 
                          onClick={() => closePosition(pos.id)}
                          className="text-red-500 hover:text-red-400"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Trade History */}
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <h2 className="text-gray-400 text-sm uppercase mb-4">Trade History</h2>
            {trades.length === 0 ? (
              <p className="text-gray-600 text-center py-8">No trades yet</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {trades.slice(0, 20).map((trade, i) => (
                  <div key={`${trade.id}-${i}`} className="bg-gray-800 rounded-lg p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-bold">{trade.symbol}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        trade.status.includes('TP') ? 'bg-[#14F195] text-black' :
                        trade.status.includes('SL') ? 'bg-red-500 text-white' :
                        trade.status === 'OPEN' ? 'bg-blue-500 text-white' :
                        'bg-gray-600'
                      }`}>
                        {trade.status}
                      </span>
                    </div>
                    {trade.closePnL !== undefined && (
                      <p className={`text-xs ${trade.closePnL >= 0 ? 'text-[#14F195]' : 'text-red-500'}`}>
                        P&L: {trade.closePnL >= 0 ? '+' : ''}€{trade.closePnL.toFixed(2)}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      {new Date(trade.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-600 text-xs mt-8 pt-4 border-t border-gray-800">
          <p>SOL Trader • Paper Trading Simulator • Built by Nodefy AI 🚀</p>
          <p className="mt-1">SL: {STOP_LOSS * 100}% | TP: {TAKE_PROFIT * 100}% | Trade size: 10% or €100 max</p>
        </div>
      </div>
    </main>
  );
}
