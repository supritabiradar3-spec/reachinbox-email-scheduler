import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Database, 
  Layers, 
  Search, 
  CheckCircle2, 
  RefreshCw, 
  Activity, 
  ShieldCheck, 
  Terminal, 
  Zap,
  Mail
} from 'lucide-react';

interface HealthResponse {
  status: string;
  service: string;
  phase: number;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

export default function App(): React.JSX.Element {
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string>('');

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data: HealthResponse = await response.json();
      setHealthData(data);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to backend';
      setError(errorMessage);
      setHealthData(null);
    } finally {
      setLoading(false);
      setLastChecked(new Date().toLocaleTimeString());
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-white tracking-tight">ReachInbox</span>
                <span className="text-xs bg-indigo-500/10 text-indigo-400 font-medium px-2 py-0.5 rounded-full border border-indigo-500/20">
                  Phase 1 Ready
                </span>
              </div>
              <p className="text-xs text-slate-400">Email Scheduler &amp; Background Dispatcher</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <button
              onClick={fetchHealth}
              disabled={loading}
              className="inline-flex items-center space-x-2 px-3.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
              <span>Refresh Health</span>
            </button>
            <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Local Dev Active</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Hero Banner */}
        <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950 p-8 shadow-2xl">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="relative z-10 space-y-4 max-w-3xl">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-950/60 border border-indigo-700/40 text-indigo-300 text-xs font-medium">
              <Zap className="w-3.5 h-3.5 text-indigo-400" />
              <span>Phase 1: Project Setup &amp; Architecture Foundation</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              ReachInbox Email Scheduler
            </h1>
            <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
              Monorepo setup with Express.js, TypeScript, React Vite, Tailwind CSS, Prisma ORM (MySQL 8), Redis, and Elasticsearch running via Docker Compose.
            </p>
          </div>
        </section>

        {/* Live Service Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Backend Express API */}
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-indigo-950/70 border border-indigo-800/40 text-indigo-400">
                <Server className="w-5 h-5" />
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                healthData?.status === 'ok' 
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/40' 
                  : error 
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-700/40' 
                  : 'bg-amber-950/80 text-amber-300 border border-amber-700/40'
              }`}>
                {healthData?.status === 'ok' ? 'Connected (200)' : error ? 'Disconnected' : 'Checking...'}
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Express Backend</h3>
              <p className="text-xs text-slate-400 mt-0.5">Port 5000 • TypeScript</p>
            </div>
            <div className="pt-2 border-t border-slate-800/70 text-[11px] text-slate-400 flex justify-between">
              <span>Endpoint: <code className="text-slate-300">/api/health</code></span>
              <span>{lastChecked ? `Checked: ${lastChecked}` : ''}</span>
            </div>
          </div>

          {/* MySQL 8.0 & Prisma */}
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-blue-950/70 border border-blue-800/40 text-blue-400">
                <Database className="w-5 h-5" />
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-700/40">
                Configured
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">MySQL 8.0 &amp; Prisma</h3>
              <p className="text-xs text-slate-400 mt-0.5">Port 3307 • reachinbox_scheduler</p>
            </div>
            <div className="pt-2 border-t border-slate-800/70 text-[11px] text-slate-400 flex justify-between">
              <span>ORM: <code className="text-slate-300">Prisma Client</code></span>
              <span>Volume: <code className="text-slate-300">mysql_data</code></span>
            </div>
          </div>

          {/* Redis & BullMQ */}
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-red-950/70 border border-red-800/40 text-red-400">
                <Layers className="w-5 h-5" />
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-700/40">
                Ready
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Redis 7 &amp; BullMQ</h3>
              <p className="text-xs text-slate-400 mt-0.5">Port 6379 • Bull Queue</p>
            </div>
            <div className="pt-2 border-t border-slate-800/70 text-[11px] text-slate-400 flex justify-between">
              <span>Mode: <code className="text-slate-300">AOF Enabled</code></span>
              <span>Volume: <code className="text-slate-300">redis_data</code></span>
            </div>
          </div>

          {/* Elasticsearch */}
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-amber-950/70 border border-amber-800/40 text-amber-400">
                <Search className="w-5 h-5" />
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-700/40">
                Ready
              </span>
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Elasticsearch 8</h3>
              <p className="text-xs text-slate-400 mt-0.5">Port 9200 • Single-Node</p>
            </div>
            <div className="pt-2 border-t border-slate-800/70 text-[11px] text-slate-400 flex justify-between">
              <span>Cluster: <code className="text-slate-300">Single Node</code></span>
              <span>Volume: <code className="text-slate-300">es_data</code></span>
            </div>
          </div>

        </div>

        {/* Phase 1 Deliverables Checklist & Architecture Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Phase 1 Verification Checklist */}
          <div className="lg:col-span-2 p-6 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-semibold text-white">Phase 1 Requirements Checklist</h2>
              </div>
              <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-md border border-emerald-500/20 font-medium">
                10 / 10 Completed
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Monorepo Folder Structure</p>
                  <p className="text-slate-500 text-[11px]">Clean separation of backend &amp; frontend</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">TypeScript Configurations</p>
                  <p className="text-slate-500 text-[11px]">Strict tsconfig for backend &amp; frontend</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">React + Vite + Tailwind CSS</p>
                  <p className="text-slate-500 text-[11px]">Fast build tooling &amp; utility styling</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Express Health-Check API</p>
                  <p className="text-slate-500 text-[11px]">GET /api/health with status &amp; uptime</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Prisma ORM for MySQL</p>
                  <p className="text-slate-500 text-[11px]">schema.prisma configured for MySQL 8</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Docker Compose Setup</p>
                  <p className="text-slate-500 text-[11px]">MySQL 8.0, Redis 7, Elasticsearch 8</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Volumes &amp; Health Checks</p>
                  <p className="text-slate-500 text-[11px]">Persistent data &amp; docker health probes</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Safe .env &amp; .gitignore</p>
                  <p className="text-slate-500 text-[11px]">No credentials committed; templates provided</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Workspaces &amp; NPM Scripts</p>
                  <p className="text-slate-500 text-[11px]">dev, dev:backend, dev:frontend, worker</p>
                </div>
              </div>

              <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-200">Phase 1 README Documentation</p>
                  <p className="text-slate-500 text-[11px]">Setup instructions &amp; verification steps</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Commands Reference */}
          <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <div className="flex items-center space-x-2 pb-3 border-b border-slate-800">
              <Terminal className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-semibold text-white">NPM Scripts</h2>
            </div>
            
            <div className="space-y-2 text-xs font-mono">
              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500"># Start Docker Services</span>
                <p className="text-indigo-300">npm run docker:up</p>
              </div>

              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500"># Start Dev (Fullstack)</span>
                <p className="text-indigo-300">npm run dev</p>
              </div>

              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500"># Run Type Checks</span>
                <p className="text-indigo-300">npm run typecheck</p>
              </div>

              <div className="p-2 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500"># Start Worker</span>
                <p className="text-indigo-300">npm run dev:worker</p>
              </div>
            </div>
          </div>

        </div>

        {/* Live Backend Response Inspector */}
        {healthData && (
          <section className="p-5 rounded-xl border border-slate-800/80 bg-slate-900/40 space-y-3">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Live Health API Response (GET /api/health)</span>
            </div>
            <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800/90 text-xs font-mono text-emerald-400 overflow-x-auto">
              {JSON.stringify(healthData, null, 2)}
            </pre>
          </section>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/70 bg-slate-950 py-4 mt-auto text-center text-xs text-slate-500">
        ReachInbox Software Development Intern Assignment • Phase 1
      </footer>
    </div>
  );
}
