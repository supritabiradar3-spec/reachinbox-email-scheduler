import React from 'react';
import { RefreshCw } from 'lucide-react';

export interface ServiceHealthCardProps {
  name: string;
  role: string;
  status: 'connected' | 'ready' | 'unavailable' | 'checking';
  responseTimeMs: number | null;
  icon: React.ReactNode;
  description: string;
}

export function ServiceHealthCard({
  name,
  role,
  status,
  responseTimeMs,
  icon,
  description
}: ServiceHealthCardProps): React.JSX.Element {
  const isHealthy = status === 'connected' || status === 'ready';
  const isChecking = status === 'checking';

  const statusText = isChecking
    ? 'Checking...'
    : status === 'ready'
    ? 'Ready'
    : status === 'connected'
    ? 'Connected'
    : 'Unavailable';

  return (
    <div
      className={`p-5 rounded-2xl border transition-all duration-200 backdrop-blur-md h-full flex flex-col justify-between ${
        isChecking
          ? 'bg-slate-900/60 border-slate-800 shadow-sm'
          : isHealthy
          ? 'bg-slate-900/70 border-emerald-500/20 hover:border-emerald-500/40 shadow-sm shadow-emerald-500/5'
          : 'bg-rose-950/20 border-rose-500/30 hover:border-rose-500/50 shadow-sm shadow-rose-500/5'
      }`}
      aria-label={`${name} service health: ${statusText}`}
    >
      {/* Top Row: Icon & Status Badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center border shrink-0 ${
              isChecking
                ? 'bg-slate-800/80 border-slate-700 text-slate-400'
                : isHealthy
                ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-400'
                : 'bg-rose-950/60 border-rose-700/50 text-rose-400'
            }`}
          >
            {icon}
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">{name}</h3>
            <p className="text-[11px] font-medium text-slate-400">{role}</p>
          </div>
        </div>

        {/* Status Pill */}
        <div
          className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border shrink-0 select-none ${
            isChecking
              ? 'bg-slate-800/90 text-slate-300 border-slate-700'
              : isHealthy
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700/60'
              : 'bg-rose-950/90 text-rose-300 border-rose-700/60'
          }`}
        >
          {isChecking ? (
            <RefreshCw className="w-3 h-3 text-slate-400 animate-spin" />
          ) : isHealthy ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-rose-400" aria-hidden="true" />
          )}
          <span>{statusText}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 mt-3.5 leading-relaxed flex-grow">{description}</p>

      {/* Bottom Row: Response Latency & Operational Health Metric */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
        <span className="text-[11px] text-slate-500 font-medium">Response Time</span>
        <div className="flex items-center space-x-1.5 font-mono text-[11px]">
          {isChecking ? (
            <div className="h-4 w-10 bg-slate-800 animate-pulse rounded" />
          ) : responseTimeMs !== null && isHealthy ? (
            <span className="text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800/40">
              {responseTimeMs}ms
            </span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </div>
      </div>
    </div>
  );
}
