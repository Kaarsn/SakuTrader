'use client';

import dynamic from 'next/dynamic';
import { Candle } from '../lib/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

type Props = {
  candles: Candle[];
  ticker: string;
  dark: boolean;
};

export default function StockCharts({ candles, ticker, dark }: Props) {
  const times = candles.map((c) => c.time);

  const palette = {
    font: dark ? '#fff2a8' : '#25343a',
    grid: dark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(64, 72, 84, 0.18)',
    axis: dark ? 'rgba(186, 201, 223, 0.6)' : 'rgba(48, 56, 64, 0.5)',
    ma20: '#f97316',
    ma50: '#16a34a',
    rsi: '#2563eb',
    macd: '#0369a1',
    signal: '#ea580c'
  };

  const candlestick = {
    x: times,
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    type: 'candlestick',
    name: `${ticker} OHLC`,
    increasing: { line: { color: '#059669', width: 1.3 }, fillcolor: '#34d399' },
    decreasing: { line: { color: '#dc2626', width: 1.3 }, fillcolor: '#f87171' }
  };

  const ma20 = {
    x: times,
    y: candles.map((c) => c.ma20),
    type: 'scatter',
    mode: 'lines',
    name: 'MA20',
    line: { color: palette.ma20, width: 3, dash: 'dot' },
    opacity: 0.95
  };

  const ma50 = {
    x: times,
    y: candles.map((c) => c.ma50),
    type: 'scatter',
    mode: 'lines',
    name: 'MA50',
    line: { color: palette.ma50, width: 2 },
    opacity: 0.85
  };

  const bbUpper = {
    x: times,
    y: candles.map((c) => c.bbUpper),
    type: 'scatter',
    mode: 'lines',
    name: 'BB Upper',
    line: { color: '#c084fc', width: 1, dash: 'dash' },
    opacity: 0.7
  };

  const bbMiddle = {
    x: times,
    y: candles.map((c) => c.bbMiddle),
    type: 'scatter',
    mode: 'lines',
    name: 'BB Middle',
    line: { color: '#a78bfa', width: 1 },
    opacity: 0.6
  };

  const bbLower = {
    x: times,
    y: candles.map((c) => c.bbLower),
    type: 'scatter',
    mode: 'lines',
    name: 'BB Lower',
    line: { color: '#c084fc', width: 1, dash: 'dash' },
    opacity: 0.7
  };

  const rsi = {
    x: times,
    y: candles.map((c) => c.rsi),
    type: 'scatter',
    mode: 'lines',
    name: 'RSI(14)',
    line: { color: palette.rsi, width: 2 }
  };

  const macd = {
    x: times,
    y: candles.map((c) => c.macd),
    type: 'scatter',
    mode: 'lines',
    name: 'MACD',
    line: { color: palette.macd, width: 2 }
  };

  const macdSignal = {
    x: times,
    y: candles.map((c) => c.macdSignal),
    type: 'scatter',
    mode: 'lines',
    name: 'Signal',
    line: { color: palette.signal, width: 2 }
  };

  const layoutBase = {
    template: 'none',
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { color: palette.font, size: 12 },
    legend: { font: { color: palette.font, size: 12 } },
    margin: { l: 40, r: 16, t: 20, b: 30 },
    xaxis: {
      rangeslider: { visible: false },
      showgrid: true,
      gridcolor: palette.grid,
      linecolor: palette.axis,
      tickfont: { color: palette.font }
    },
    yaxis: {
      showgrid: true,
      gridcolor: palette.grid,
      zerolinecolor: palette.axis,
      tickfont: { color: palette.font }
    },
    autosize: true
  } as const;

  return (
    <div className="grid" style={{ gap: 12 }}>
      <Plot
        data={[candlestick, bbUpper, bbMiddle, bbLower, ma50, ma20]}
        layout={{ ...layoutBase, title: `${ticker} Candlestick + MA + Bollinger Bands` }}
        useResizeHandler
        style={{ width: '100%', height: 260 }}
      />
      <Plot
        data={[rsi]}
        layout={{ ...layoutBase, title: 'RSI (14)' }}
        useResizeHandler
        style={{ width: '100%', height: 150 }}
      />
      <Plot
        data={[macd, macdSignal]}
        layout={{ ...layoutBase, title: 'MACD (12, 26, 9)' }}
        useResizeHandler
        style={{ width: '100%', height: 150 }}
      />
    </div>
  );
}
