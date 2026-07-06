"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Scatter,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatPriceUSD } from "@/lib/format";
export interface CandlestickPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SmartMoneyMarker {
  time: string;
  price: number;
  side: "buy" | "sell";
  entity: string;
}

type Timeframe = "1h" | "4h" | "1d" | "1w" | "1m";
type ChartType = "candlestick" | "line";

interface PriceChartProps {
  data: CandlestickPoint[];
  markers?: SmartMoneyMarker[];
  className?: string;
}

export function PriceChart({ data, markers = [], className }: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [chartType, setChartType] = useState<ChartType>("line");
  const timeframes: Timeframe[] = ["1h", "4h", "1d", "1w", "1m"];

  // Aggregate data based on timeframe
  const chartData = useMemo(() => {
    let step = 1;
    if (timeframe === "4h") step = 4;
    if (timeframe === "1w") step = 7;
    if (timeframe === "1m") step = 30;

    const sliced = step === 1 ? data : data.filter((_, i) => i % step === 0);

    return sliced.map((d) => {
      const marker = markers.find((m) => m.time === d.time);
      return {
        ...d,
        buyPrice: marker?.side === "buy" ? marker.price : null,
        sellPrice: marker?.side === "sell" ? marker.price : null,
        buyEntity: marker?.side === "buy" ? marker.entity : null,
        sellEntity: marker?.side === "sell" ? marker.entity : null,
        bodyLow: Math.min(d.open, d.close),
        bodyHigh: Math.max(d.open, d.close),
      };
    });
  }, [data, timeframe, markers]);

  const priceMin = useMemo(() => Math.min(...chartData.map((d) => d.low)) * 0.998, [chartData]);
  const priceMax = useMemo(() => Math.max(...chartData.map((d) => d.high)) * 1.002, [chartData]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                timeframe === tf
                  ? "bg-accent-cyan/10 text-accent-cyan"
                  : "text-text-muted hover:text-text-primary"
              )}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setChartType("line")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              chartType === "line"
                ? "bg-accent-cyan/10 text-accent-cyan"
                : "text-text-muted hover:text-text-primary"
            )}
          >
            Line
          </button>
          <button
            onClick={() => setChartType("candlestick")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              chartType === "candlestick"
                ? "bg-accent-cyan/10 text-accent-cyan"
                : "text-text-muted hover:text-text-primary"
            )}
          >
            Candle
          </button>
        </div>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "#6B7280" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              domain={[priceMin, priceMax]}
              tick={{ fontSize: 10, fill: "#6B7280" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatPriceUSD(v)}
              width={70}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#111318",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#E8EAED",
              }}
              formatter={(value: unknown, name: unknown) => {
                const v = Number(value);
                const n = String(name);
                if (n === "volume") return [`${(v / 1e6).toFixed(0)}M`, "Volume"];
                return [formatPriceUSD(v), n];
              }}
              labelFormatter={(label: unknown) => String(label)}
            />

            {chartType === "line" ? (
              <Line
                type="monotone"
                dataKey="close"
                stroke="#00D4FF"
                strokeWidth={2}
                dot={false}
                name="Price"
              />
            ) : (
              <>
                <Line
                  type="monotone"
                  dataKey="high"
                  stroke="#6B7280"
                  strokeWidth={1}
                  dot={false}
                  name="High"
                />
                <Line
                  type="monotone"
                  dataKey="low"
                  stroke="#6B7280"
                  strokeWidth={1}
                  dot={false}
                  name="Low"
                />
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke="#00D4FF"
                  strokeWidth={2}
                  dot={false}
                  name="Close"
                />
              </>
            )}

            {/* Buy markers */}
            <Scatter dataKey="buyPrice" fill="#00FF88" shape="triangle" name="SM Buy" />
            {/* Sell markers */}
            <Scatter dataKey="sellPrice" fill="#FF3D6B" shape="diamond" name="SM Sell" />

            <Bar dataKey="volume" fill="rgba(0,212,255,0.15)" yAxisId="volume" name="Volume" />
            <YAxis yAxisId="volume" orientation="right" hide domain={[0, (dataMax: number) => dataMax * 5]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 bg-accent-green" style={{ clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }} />
          Smart Money Buy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rotate-45 bg-danger" />
          Smart Money Sell
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-accent-cyan/20" />
          Volume
        </span>
      </div>
    </div>
  );
}
