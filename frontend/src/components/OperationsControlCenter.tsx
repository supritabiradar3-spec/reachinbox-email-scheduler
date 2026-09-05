import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Server,
  Search,
  Layers,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Send,
  Bell,
  Cpu,
  Clock,
  Mail
} from 'lucide-react';
import { ServiceHealthCard } from './ServiceHealthCard';

export interface DependenciesHealthData {
  status: 'healthy' | 'degraded';
  services: {
    mysql: { status: 'connected' | 'unavailable'; responseTimeMs: number };
    redis: { status: 'connected' | 'unavailable'; responseTimeMs: number };
    elasticsearch: { status: 'connected' | 'unavailable'; responseTimeMs: number };
    bullmq: { status: 'ready' | 'unavailable'; responseTimeMs: number };
  };
  checkedAt: string;
}

interface OperationsControlCenterProps {
  onNavigateToScheduler: () => void;
}

export function OperationsControlCenter({
  onNavigateToScheduler
}: OperationsControlCenterProps): React.JSX.Element {
  const [healthData, setHealthData] = useState<DependenciesHealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedTime, setLastCheckedTime] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health/dependencies', {
        credentials: 'include'
      });

      if (response.ok) {
        const data: DependenciesHealthData = await response.json();
        setHealthData(data);
        const now = new Date();
        setLastCheckedTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } else if (response.status === 401) {
        setError('Session expired. Please sign in again.');
      } else {
        setError('Unable to retrieve system health. Dependency metrics are currently unavailable.');
      }
    } catch {
      setError('Unable to retrieve system health. Network connection failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch only on mount
  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const isHealthy = healthData?.status === 'healthy';

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">

      {/* 1. OPERATIONS CONTROL CENTER HERO */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800/80 p-6 sm:p-7 shadow-xl">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />

        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 mb-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                Live Telemetry
              </span>
              <span className="text-[11px] text-slate-400 font-medium">ReachInbox Infrastructure</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Operations Control Center
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-xl">
              Monitor the core services powering distributed email scheduling, rate-limit controllers, and search indexing.
            </p>
          </div>

          {/* Top-Right Action Controls */}
          <div className="flex items-center space-x-2.5 shrink-0 self-start sm:self-center">
            {/* 1. Compact icon-only Refresh Status button */}
            <button
              id="refresh-health-btn"
              onClick={fetchHealth}
              disabled={loading}
              className="inline-flex items-center justify-center p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/80 text-xs font-medium transition disabled:opacity-50 active:scale-[0.98]"
              title="Refresh service status"
              aria-label="Refresh service status"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            {/* 2. Primary purple "Email Scheduler" button with Mail icon */}
            <button
              id="open-scheduler-btn"
              onClick={onNavigateToScheduler}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs sm:text-sm shadow-md shadow-indigo-600/25 transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
              title="Open Email Scheduler"
              aria-label="Open Email Scheduler"
            >
              <Mail className="w-4 h-4" />
              <span>Email Scheduler</span>
            </button>
          </div>
        </div>

        {/* Operational Status Row */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center space-x-2.5 text-xs">
          {loading && !healthData ? (
            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-slate-300 text-xs font-medium">
              <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
              <span>Checking Infrastructure...</span>
            </div>
          ) : error ? (
            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-rose-950/80 border border-rose-800/80 text-rose-300 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>Service Degradation Detected</span>
            </div>
          ) : isHealthy ? (
            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-700/70 text-emerald-300 text-xs font-semibold shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>All Systems Operational</span>
            </div>
          ) : (
            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-amber-950/80 border border-amber-700/70 text-amber-300 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Service Degradation Detected</span>
            </div>
          )}

          {lastCheckedTime && (
            <span className="text-[11px] text-slate-400 hidden sm:inline select-none">
              Last checked: {lastCheckedTime}
            </span>
          )}
        </div>
      </div>

      {/* 2. ERROR STATE (IF ENDPOINT CALL FAILS) */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchHealth}
            className="self-start sm:self-auto inline-flex items-center space-x-1.5 px-3 py-1 bg-rose-900/80 hover:bg-rose-800 text-rose-200 rounded-lg text-xs font-semibold border border-rose-700/60 transition"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry Health Check</span>
          </button>
        </div>
      )}

      {/* 3. FOUR SERVICE HEALTH CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Card 1: MySQL */}
        <ServiceHealthCard
          name="MySQL"
          role="Persistent Data Store"
          status={loading && !healthData ? 'checking' : healthData?.services.mysql.status || 'unavailable'}
          responseTimeMs={healthData?.services.mysql.responseTimeMs ?? null}
          icon={<Database className="w-5 h-5 text-indigo-400" />}
          description="Stores users, campaigns and email delivery state."
        />

        {/* Card 2: Redis */}
        <ServiceHealthCard
          name="Redis"
          role="Queue & Rate-Limit State"
          status={loading && !healthData ? 'checking' : healthData?.services.redis.status || 'unavailable'}
          responseTimeMs={healthData?.services.redis.responseTimeMs ?? null}
          icon={<Server className="w-5 h-5 text-rose-400" />}
          description="Powers sessions, rate limits and queue coordination."
        />

        {/* Card 3: Elasticsearch */}
        <ServiceHealthCard
          name="Elasticsearch"
          role="Email Search Index"
          status={loading && !healthData ? 'checking' : healthData?.services.elasticsearch.status || 'unavailable'}
          responseTimeMs={healthData?.services.elasticsearch.responseTimeMs ?? null}
          icon={<Search className="w-5 h-5 text-cyan-400" />}
          description="Indexes scheduled and sent emails for fast search."
        />

        {/* Card 4: BullMQ */}
        <ServiceHealthCard
          name="BullMQ"
          role="Dispatch Queue"
          status={loading && !healthData ? 'checking' : healthData?.services.bullmq.status || 'unavailable'}
          responseTimeMs={healthData?.services.bullmq.responseTimeMs ?? null}
          icon={<Layers className="w-5 h-5 text-amber-400" />}
          description="Runs persistent delayed email-dispatch jobs."
        />

      </div>

      {/* 4. DELIVERY INFRASTRUCTURE FLOW */}
      <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 shadow-lg space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span>Delivery Infrastructure</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Architectural flow of scheduled campaigns from ingestion to multi-sender dispatch and indexing.
            </p>
          </div>
          <div className="flex items-center space-x-1.5 text-[11px] text-slate-500 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>Asynchronous Engine</span>
          </div>
        </div>

        {/* Flow Stages */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative">

          {/* Stage 1 */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-400 mb-1">
                <span>Stage 1</span>
                <Database className="w-3.5 h-3.5" />
              </div>
              <p className="text-xs font-bold text-white">MySQL & Prisma</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Campaign ingestion, recipient list deduplication, and atomic transaction commit.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800/60 flex items-center text-[10px] text-slate-500 font-medium">
              <span>Source of Truth</span>
            </div>
          </div>

          {/* Stage 2 */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-rose-400 mb-1">
                <span>Stage 2</span>
                <Server className="w-3.5 h-3.5" />
              </div>
              <p className="text-xs font-bold text-white">BullMQ & Redis</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Delayed job scheduling, sliding-window rate checks, and inter-email delay throttling.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800/60 flex items-center text-[10px] text-slate-500 font-medium">
              <span>Rolling Rate Limits</span>
            </div>
          </div>

          {/* Stage 3 */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-amber-400 mb-1">
                <span>Stage 3</span>
                <Send className="w-3.5 h-3.5" />
              </div>
              <p className="text-xs font-bold text-white">Worker Process & SMTP</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Multi-sender account dispatch via Ethereal SMTP with exponential backoff retries.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800/60 flex items-center text-[10px] text-slate-500 font-medium">
              <span>Configurable Concurrency</span>
            </div>
          </div>

          {/* Stage 4 */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-cyan-400 mb-1">
                <span>Stage 4</span>
                <Search className="w-3.5 h-3.5" />
              </div>
              <p className="text-xs font-bold text-white">Elasticsearch & Slack</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Live document indexing, highlighted search, and Block Kit campaign delivery notifications.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800/60 flex items-center text-[10px] text-slate-500 font-medium">
              <span>Search & Alerts</span>
            </div>
          </div>

        </div>

        {/* Safe Operational Capability Badges */}
        <div className="pt-3 border-t border-slate-800/60 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] text-slate-500 font-medium mr-1">System Capabilities:</span>
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 font-medium">
            <ShieldCheck className="w-3 h-3 text-indigo-400" />
            <span>Persistent Scheduling</span>
          </span>
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 font-medium">
            <Clock className="w-3 h-3 text-rose-400" />
            <span>Distributed Rate Limits</span>
          </span>
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 font-medium">
            <Search className="w-3 h-3 text-cyan-400" />
            <span>Search Indexing</span>
          </span>
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 font-medium">
            <Bell className="w-3 h-3 text-amber-400" />
            <span>Slack Alerts</span>
          </span>
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 font-medium">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>Idempotent Delivery</span>
          </span>
        </div>
      </div>

    </div>
  );
}
