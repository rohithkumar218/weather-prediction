import React from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts';

export default function TemperatureChart({ data, mode, unit, windUnit }) {
  const isWeek = mode === 'week';
  const isRain = mode === 'precipitation';
  const isWind = mode === 'wind';
  const unitLabel = isRain ? '%' : isWind ? windUnit : `°${unit}`;
  const formatValue = (value) => [`${value}${unitLabel}`, isWeek ? 'Temperature' : isRain ? 'Rain chance' : isWind ? 'Wind speed' : 'Temperature'];
  return (
    <div className="chart-area">
      <ResponsiveContainer width="100%" height="100%">
        {isWeek ? <LineChart data={data} margin={{ top: 16, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#e8ecee" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: '#8995a0', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: '#8995a0', fontSize: 10 }} tickLine={false} axisLine={false} unit="°" />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e6eaec', borderRadius: 10, color: '#26364a', fontSize: 12, boxShadow: '0 8px 22px #26364a18' }} formatter={(value, name) => [`${value}°${unit}`, name === 'high' ? 'High' : 'Low']} />
          <Line type="monotone" dataKey="high" name="high" stroke="#ff8128" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="low" name="low" stroke="#83bcc8" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </LineChart> : <AreaChart data={data} margin={{ top: 16, right: 12, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="temperatureFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isRain ? '#83bcc8' : isWind ? '#e5b459' : '#ff8128'} stopOpacity={0.24} />
              <stop offset="100%" stopColor={isRain ? '#83bcc8' : isWind ? '#e5b459' : '#ff8128'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e8ecee" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: '#8995a0', fontSize: 10 }} tickLine={false} axisLine={false} interval={2} />
          <YAxis tick={{ fill: '#8995a0', fontSize: 10 }} tickLine={false} axisLine={false} unit={unitLabel} domain={isRain ? [0, 100] : ['auto', 'auto']} />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e6eaec', borderRadius: 10, color: '#26364a', fontSize: 12, boxShadow: '0 8px 22px #26364a18' }} formatter={formatValue} />
          <Area type="monotone" dataKey={isRain ? 'precipitation' : isWind ? 'wind' : 'temperature'} stroke={isRain ? '#83bcc8' : isWind ? '#e5b459' : '#ff8128'} strokeWidth={2.2} fill="url(#temperatureFill)" dot={false} activeDot={{ r: 4, fill: '#ff8128', stroke: '#fff', strokeWidth: 2 }} />
        </AreaChart>}
      </ResponsiveContainer>
    </div>
  );
}
