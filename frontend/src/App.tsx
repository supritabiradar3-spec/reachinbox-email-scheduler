import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Mail, 
  LogOut, 
  AlertCircle, 
  RefreshCw, 
  Plus, 
  Clock, 
  Send, 
  CalendarClock, 
  Inbox, 
  ChevronLeft, 
  ChevronRight, 
  ExternalLink, 
  Search, 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  Users,
  RotateCcw,
  Activity
} from 'lucide-react';
import { ComposeModal } from './components/ComposeModal';
import { HighlightSnippet } from './utils/highlightHelper';

interface AuthUser {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

interface SenderOption {
  key: string;
  displayName: string;
  fromEmail: string;
}

interface ScheduledEmailItem {
  id: string;
  senderKey?: string;
  recipientEmail: string;
  subject: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RATE_LIMITED' | string;
}

interface SentEmailItem {
  id: string;
  senderKey?: string;
  recipientEmail: string;
  subject: string;
  sentAt: string | null;
  status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RATE_LIMITED' | string;
  smtpMessageId?: string | null;
  etherealPreviewUrl?: string | null;
  snippet?: string | null;
}

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function UserAvatar({ 
  name, 
  email, 
  avatarUrl, 
  size = 'md' 
}: { 
  name: string | null; 
  email: string; 
  avatarUrl: string | null; 
  size?: 'sm' | 'md' | 'lg' 
}): React.JSX.Element {
  const [imgError, setImgError] = useState<boolean>(false);
  const initial = (name || email || 'U').trim().charAt(0).toUpperCase();

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg'
  }[size];

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name || email}
        onError={() => setImgError(true)}
        className={`${sizeClasses} rounded-full object-cover border border-slate-700 shadow-sm`}
      />
    );
  }

  return (
    <div className={`${sizeClasses} rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center font-bold text-white shadow-md select-none`}>
      {initial}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'SCHEDULED':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-950/90 text-indigo-300 border border-indigo-700/60 shadow-sm">
          Scheduled
        </span>
      );
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/90 text-amber-300 border border-amber-700/60 animate-pulse shadow-sm">
          Processing
        </span>
      );
    case 'SENT':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 shadow-sm">
          Sent
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-950/90 text-rose-300 border border-rose-700/60 shadow-sm">
          Failed
        </span>
      );
    case 'RATE_LIMITED':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-orange-950/90 text-orange-300 border border-orange-700/60 shadow-sm">
          Rate Limited
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
          {status}
        </span>
      );
  }
}

function formatDateTime(isoString: string | null): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    }).format(date);
  } catch {
    return isoString;
  }
}

export default function App(): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [redirectingToGoogle, setRedirectingToGoogle] = useState<boolean>(false);

  // Tabs & Compose Modal
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);

  // Senders State
  const [senders, setSenders] = useState<SenderOption[]>([]);
  const [sendersLoading, setSendersLoading] = useState<boolean>(false);

  // Scheduled Emails State
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmailItem[]>([]);
  const [scheduledPagination, setScheduledPagination] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0
  });
  const [scheduledLoading, setScheduledLoading] = useState<boolean>(false);
  const [scheduledError, setScheduledError] = useState<string | null>(null);

  // Sent Emails State
  const [sentEmails, setSentEmails] = useState<SentEmailItem[]>([]);
  const [globalSentTotal, setGlobalSentTotal] = useState<number>(0);
  const [sentPagination, setSentPagination] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0
  });
  const [sentLoading, setSentLoading] = useState<boolean>(false);
  const [sentError, setSentError] = useState<string | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeSearch, setActiveSearch] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Slack Integration State
  const [slackConnected, setSlackConnected] = useState<boolean>(false);
  const [slackTeamName, setSlackTeamName] = useState<string | null>(null);
  const [slackLoading, setSlackLoading] = useState<boolean>(false);
  const [slackDisconnecting, setSlackDisconnecting] = useState<boolean>(false);
  const [slackAlert, setSlackAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Build safe Bull Board Queue Monitor URL from API configuration
  const queueMonitorUrl = useMemo(() => {
    const apiUrl = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || 'http://localhost:5000';
    const baseOrigin = apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');
    return `${baseOrigin}/admin/queues`;
  }, []);

  // Time-based greeting and user first name
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const userFirstName = useMemo(() => {
    if (!user) return '';
    if (user.name) {
      const first = user.name.trim().split(/\s+/)[0];
      if (first) return first;
    }
    if (user.email) {
      const prefix = user.email.split('@')[0];
      return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }
    return '';
  }, [user]);

  // Fetch Slack Connection Status
  const fetchSlackStatus = useCallback(async () => {
    setSlackLoading(true);
    try {
      const response = await fetch('/api/slack/status', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const teamName = data.installation?.teamName || data.teamName || data.workspaceName || null;
        if (data.status === 'success' && data.connected) {
          setSlackConnected(true);
          setSlackTeamName(teamName || 'Slack Workspace');
        } else {
          setSlackConnected(false);
          setSlackTeamName(null);
        }
      }
    } catch {
      setSlackConnected(false);
    } finally {
      setSlackLoading(false);
    }
  }, []);

  // Disconnect Slack Workspace
  const handleSlackDisconnect = async () => {
    if (!window.confirm('Disconnect your Slack workspace? Completion notifications will be disabled.')) {
      return;
    }
    setSlackDisconnecting(true);
    try {
      const response = await fetch('/api/slack/disconnect', {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        setSlackConnected(false);
        setSlackTeamName(null);
        setSlackAlert({ type: 'success', message: 'Slack workspace disconnected.' });
      } else {
        const errData = await response.json().catch(() => ({}));
        setSlackAlert({ type: 'error', message: errData.message || 'Failed to disconnect Slack workspace.' });
      }
    } catch {
      setSlackAlert({ type: 'error', message: 'Network error disconnecting Slack workspace.' });
    } finally {
      setSlackDisconnecting(false);
    }
  };

  // Check Current Authentication State
  const checkAuth = async () => {
    setAuthChecking(true);
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthChecking(false);
    }
  };

  // Fetch Configured Senders for Friendly Display Names
  const fetchSenders = useCallback(async () => {
    setSendersLoading(true);
    try {
      const response = await fetch('/api/senders', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.senders && Array.isArray(data.senders)) {
          setSenders(data.senders);
        }
      }
    } catch (err) {
      console.warn('Failed to load sender definitions:', err);
    } finally {
      setSendersLoading(false);
    }
  }, []);

  // Senders Map: senderKey -> displayName
  const senderMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const sender of senders) {
      map[sender.key] = sender.displayName;
    }
    return map;
  }, [senders]);

  const getFriendlySenderName = (key?: string): string => {
    if (!key) return 'ReachInbox Sender';
    return senderMap[key] || key;
  };

  // Fetch Scheduled Emails
  const fetchScheduledEmails = useCallback(async (page: number = 1): Promise<boolean> => {
    setScheduledLoading(true);
    setScheduledError(null);
    try {
      const response = await fetch(`/api/emails/scheduled?page=${page}&limit=10`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setScheduledEmails(data.emails || []);
        setScheduledPagination(data.pagination || { total: 0, page: 1, limit: 10, totalPages: 0 });
        return true;
      } else if (response.status === 401) {
        setUser(null);
        return false;
      } else {
        const errorData = await response.json().catch(() => ({}));
        setScheduledError(errorData.message || 'Failed to load scheduled emails');
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error loading scheduled emails';
      setScheduledError(msg);
      return false;
    } finally {
      setScheduledLoading(false);
    }
  }, []);

  // Fetch Sent Emails
  const fetchSentEmails = useCallback(async (page: number = 1): Promise<boolean> => {
    setSentLoading(true);
    setSentError(null);
    try {
      const response = await fetch(`/api/emails/sent?page=${page}&limit=10`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setSentEmails(data.emails || []);
        const pagination = data.pagination || { total: 0, page: 1, limit: 10, totalPages: 0 };
        setSentPagination(pagination);
        setGlobalSentTotal(pagination.total);
        return true;
      } else if (response.status === 401) {
        setUser(null);
        return false;
      } else {
        const errorData = await response.json().catch(() => ({}));
        setSentError(errorData.message || 'Failed to load sent emails');
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error loading sent emails';
      setSentError(msg);
      return false;
    } finally {
      setSentLoading(false);
    }
  }, []);

  // Execute Search via Elasticsearch
  const executeSearch = useCallback(async (query: string, page: number = 1): Promise<boolean> => {
    const trimmed = query.trim();
    if (!trimmed) {
      setActiveSearch('');
      return fetchSentEmails(1);
    }

    setSentLoading(true);
    setSentError(null);
    setActiveSearch(trimmed);

    try {
      const response = await fetch(`/api/emails/search?q=${encodeURIComponent(trimmed)}&page=${page}&limit=10`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setSentEmails(data.emails || []);
        setSentPagination(data.pagination || { total: 0, page: 1, limit: 10, totalPages: 0 });
        return true;
      } else if (response.status === 401) {
        setUser(null);
        return false;
      } else {
        const errorData = await response.json().catch(() => ({}));
        setSentError(errorData.message || 'Search request failed');
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error executing search';
      setSentError(msg);
      return false;
    } finally {
      setSentLoading(false);
    }
  }, [fetchSentEmails]);

  const handleClearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
    fetchSentEmails(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(searchQuery, 1);
  };

  const handleRefreshAll = async () => {
    fetchSenders();
    fetchSlackStatus();
    const schedOk = await fetchScheduledEmails(scheduledPagination.page || 1);
    const sentOk = activeSearch
      ? await executeSearch(activeSearch, sentPagination.page || 1)
      : await fetchSentEmails(sentPagination.page || 1);

    if (schedOk && sentOk) {
      const now = new Date();
      setLastUpdated(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('auth_error');
    if (errorParam) {
      if (errorParam === 'google_auth_failed') {
        setAuthError('Google authentication was cancelled or failed. Please try again.');
      } else {
        setAuthError(`Authentication error: ${errorParam}`);
      }
    }

    const slackConnectedParam = params.get('slack_connected') === 'true' || params.get('slack_auth') === 'success';
    const slackErrorParam = params.get('slack_error') || params.get('slack_auth_error');
    if (slackConnectedParam) {
      setSlackAlert({ type: 'success', message: 'Slack workspace connected successfully! You can now select Slack channels in campaign compose.' });
      fetchSlackStatus();
    } else if (slackErrorParam) {
      setSlackAlert({ type: 'error', message: `Slack authentication failed: ${slackErrorParam}` });
    }

    if (errorParam || params.has('slack_connected') || params.has('slack_auth') || slackErrorParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuth();
  }, []);

  // Fetch all summary data (senders, slack status, scheduled emails, sent emails) when authenticated user is present
  useEffect(() => {
    if (user) {
      fetchSenders();
      fetchSlackStatus();
      Promise.all([
        fetchScheduledEmails(1),
        fetchSentEmails(1)
      ]).then(([schedOk, sentOk]) => {
        if (schedOk && sentOk) {
          const now = new Date();
          setLastUpdated(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }
      }).catch(() => {});
    }
  }, [user, fetchSenders, fetchSlackStatus, fetchScheduledEmails, fetchSentEmails]);

  // Ensure active tab view is refreshed on tab switch
  useEffect(() => {
    if (user) {
      if (activeTab === 'scheduled') {
        fetchScheduledEmails(scheduledPagination.page || 1);
      } else {
        if (activeSearch) {
          executeSearch(activeSearch, sentPagination.page || 1);
        } else {
          fetchSentEmails(sentPagination.page || 1);
        }
      }
    }
  }, [activeTab]);

  const handleGoogleLogin = () => {
    setRedirectingToGoogle(true);
    setAuthError(null);
    window.location.href = '/api/auth/google';
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        setUser(null);
        setScheduledEmails([]);
        setSentEmails([]);
        setGlobalSentTotal(0);
        setLastUpdated(null);
      }
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setLoggingOut(false);
    }
  };

  const handleCampaignCreated = () => {
    setActiveTab('scheduled');
    fetchScheduledEmails(1);
    fetchSentEmails(1);
    fetchSenders();
  };

  // Initial loading screen
  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 font-sans">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
          </div>
          <p className="text-sm font-medium text-slate-400">Loading application...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* 1. PROFESSIONAL HEADER */}
      <header className="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-base sm:text-lg text-white tracking-tight">ReachInbox</span>
              <p className="text-[11px] text-slate-400 -mt-0.5">Email Scheduler</p>
            </div>
          </div>

          {/* User Profile & Actions */}
          {user && (
            <div className="flex items-center space-x-3 sm:space-x-4">
              
              {/* Slack Connection Status Badge */}
              {slackConnected ? (
                <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-950/70 border border-indigo-700/60 text-xs shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-indigo-300 font-medium">#{slackTeamName || 'Slack'}</span>
                  <button
                    onClick={handleSlackDisconnect}
                    disabled={slackDisconnecting}
                    className="text-[10px] text-slate-400 hover:text-rose-400 transition pl-1 font-medium"
                    title="Disconnect Slack Workspace"
                  >
                    {slackDisconnecting ? '...' : 'Disconnect'}
                  </button>
                </div>
              ) : (
                <a
                  href="/api/slack/oauth/start"
                  id="slack-connect-link"
                  className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700/80 transition active:scale-[0.98]"
                  title="Connect Slack for campaign completion notifications"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                  <span>Connect Slack</span>
                </a>
              )}

              <a
                href={queueMonitorUrl}
                target="_blank"
                rel="noreferrer noopener"
                id="queue-monitor-link"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700/80 transition active:scale-[0.98]"
                title="Open Bull Board Queue Monitor"
                aria-label="Open Bull Board Queue Monitor"
              >
                <Activity className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Queue Monitor</span>
              </a>

              <div className="flex items-center space-x-2.5">
                <UserAvatar 
                  name={user.name} 
                  email={user.email} 
                  avatarUrl={user.avatarUrl} 
                  size="sm" 
                />
                <div className="text-left">
                  <p className="text-xs font-semibold text-slate-200 truncate max-w-[100px] sm:max-w-[160px]">{user.name || user.email}</p>
                  <p className="text-[11px] text-slate-400 truncate max-w-[160px] hidden sm:block">{user.email}</p>
                </div>
              </div>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                id="logout-btn"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700/80 transition disabled:opacity-50 active:scale-[0.98]"
                title="Sign out of your account"
                aria-label="Sign out of your account"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{loggingOut ? 'Signing out...' : 'Sign Out'}</span>
              </button>
            </div>
          )}

        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col">
        
        {/* Slack Alert Toast/Banner */}
        {slackAlert && (
          <div className={`mb-6 p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            slackAlert.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-800/70 text-emerald-300'
              : 'bg-rose-950/70 border-rose-800/70 text-rose-300'
          }`}>
            <div className="flex items-center space-x-2">
              {slackAlert.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{slackAlert.message}</span>
            </div>
            <button
              onClick={() => setSlackAlert(null)}
              className="p-1 text-slate-400 hover:text-slate-200 rounded transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        
        {/* Unauthenticated View: Clean Login Card */}
        {!user ? (
          <div className="max-w-md w-full mx-auto my-auto space-y-6">
            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-8 shadow-2xl space-y-6">
              <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>

              <div className="text-center space-y-2">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-xl shadow-indigo-500/20 mb-4">
                  <Mail className="w-7 h-7 text-white" />
                </div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">
                  ReachInbox Email Scheduler
                </h1>
                <p className="text-sm text-slate-400">
                  Sign in with your Google account to manage scheduled emails
                </p>
              </div>

              {authError && (
                <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-start space-x-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Sign In Failed</p>
                    <p className="mt-0.5 text-rose-300/90">{authError}</p>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  id="google-login-btn"
                  onClick={handleGoogleLogin}
                  disabled={redirectingToGoogle}
                  className="w-full flex items-center justify-center space-x-3 px-5 py-3.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm transition-all duration-200 shadow-lg shadow-white/5 hover:shadow-white/10 active:scale-[0.99] disabled:opacity-60"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>{redirectingToGoogle ? 'Redirecting to Google...' : 'Continue with Google'}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Authenticated SaaS Dashboard */
          <div className="space-y-6">
            
            {/* 2. COMPACT DASHBOARD HERO */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 border border-slate-800/80 p-6 sm:p-7 shadow-lg">
              <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true"></div>
              <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" aria-hidden="true"></span>
                    <span>{greeting}{userFirstName ? `, ${userFirstName}` : ''}</span>
                  </p>
                  <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Email Scheduler Dashboard
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    Compose, schedule, and monitor your email campaigns
                  </p>
                </div>

                {/* Primary Action Button */}
                <button
                  id="compose-email-btn"
                  onClick={() => setIsComposeOpen(true)}
                  className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-indigo-600/25 transition active:scale-[0.98] shrink-0 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                >
                  <Plus className="w-4 h-4" />
                  <span>Compose New Email</span>
                </button>
              </div>

              {/* Operational Summary Row */}
              <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-400">
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-950/60 border border-slate-800 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" aria-hidden="true"></span>
                  <span>{senders.length} {senders.length === 1 ? 'Sender' : 'Senders'} Configured</span>
                </div>
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-950/60 border border-slate-800 text-[11px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${slackConnected ? 'bg-indigo-400' : 'bg-slate-500'}`} aria-hidden="true"></span>
                  <span>{slackConnected ? `Slack Connected (${slackTeamName || 'Workspace'})` : 'Slack Not Connected'}</span>
                </div>
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-950/60 border border-slate-800 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" aria-hidden="true"></span>
                  <span>{scheduledPagination.total} Scheduled</span>
                </div>
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-950/60 border border-slate-800 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true"></span>
                  <span>{globalSentTotal} Sent</span>
                </div>
              </div>
            </div>

            {/* 3. REAL SUMMARY CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
              
              {/* Card 1: Scheduled Emails */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab('scheduled')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('scheduled');
                  }
                }}
                aria-label={`View scheduled emails. Currently ${scheduledPagination.total} scheduled.`}
                className="p-4 rounded-xl bg-slate-900/60 border border-indigo-500/20 shadow-sm flex items-start space-x-3.5 transition hover:border-indigo-500/40 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none select-none"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-400 truncate">Scheduled Emails</p>
                  {scheduledLoading && scheduledPagination.total === 0 ? (
                    <div className="h-6 w-12 bg-slate-800 animate-pulse rounded mt-1"></div>
                  ) : (
                    <p className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                      {scheduledPagination.total ?? '—'}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">Awaiting queue dispatch</p>
                </div>
              </div>

              {/* Card 2: Sent Emails */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab('sent')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('sent');
                  }
                }}
                aria-label={`View sent emails. Currently ${globalSentTotal} delivered.`}
                className="p-4 rounded-xl bg-slate-900/60 border border-emerald-500/20 shadow-sm flex items-start space-x-3.5 transition hover:border-emerald-500/40 cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none select-none"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-400 truncate">Sent Emails</p>
                  {sentLoading && globalSentTotal === 0 ? (
                    <div className="h-6 w-12 bg-slate-800 animate-pulse rounded mt-1"></div>
                  ) : (
                    <p className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                      {globalSentTotal ?? '—'}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">Successfully delivered</p>
                </div>
              </div>

              {/* Card 3: Failed Emails */}
              <div
                className="p-4 rounded-xl bg-slate-900/60 border border-rose-500/20 shadow-sm flex items-start space-x-3.5 transition hover:border-rose-500/40"
                title="No failed deliveries currently reported by the dashboard"
              >
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-400 truncate">Failed Emails</p>
                  <p
                    className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5"
                    title="No failed deliveries currently reported by the dashboard"
                  >
                    0
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">Delivery errors</p>
                </div>
              </div>

              {/* Card 4: Active Senders */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-cyan-500/20 shadow-sm flex items-start space-x-3.5 transition hover:border-cyan-500/40">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-400 truncate">Active Senders</p>
                  {sendersLoading && senders.length === 0 ? (
                    <div className="h-6 w-12 bg-slate-800 animate-pulse rounded mt-1"></div>
                  ) : (
                    <p className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                      {senders.length > 0 ? senders.length : '—'}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">Configured accounts</p>
                </div>
              </div>

            </div>

            {/* 4. EMAIL MANAGEMENT PANEL */}
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl mt-6 md:mt-8">
              
              {/* Tab Navigation and Controls */}
              <div className="border-b border-slate-800 px-4 sm:px-6 pt-3 flex items-center justify-between bg-slate-900/80">
                <div className="flex space-x-6 sm:space-x-8">
                  <button
                    id="tab-scheduled-emails"
                    onClick={() => setActiveTab('scheduled')}
                    className={`pb-3 text-xs sm:text-sm font-semibold flex items-center space-x-2 border-b-2 transition ${
                      activeTab === 'scheduled'
                        ? 'border-indigo-500 text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span>Scheduled Emails</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      activeTab === 'scheduled'
                        ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                      {scheduledPagination.total}
                    </span>
                  </button>

                  <button
                    id="tab-sent-emails"
                    onClick={() => setActiveTab('sent')}
                    className={`pb-3 text-xs sm:text-sm font-semibold flex items-center space-x-2 border-b-2 transition ${
                      activeTab === 'sent'
                        ? 'border-indigo-500 text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    <span>Sent Emails</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      activeTab === 'sent'
                        ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                      {globalSentTotal}
                    </span>
                  </button>
                </div>

                {/* Accessible Compact Refresh Button & Last Updated Timestamp */}
                <div className="flex items-center space-x-2.5 mb-2">
                  {lastUpdated && (
                    <span className="text-[11px] text-slate-400 hidden sm:inline select-none">
                      Last updated: {lastUpdated}
                    </span>
                  )}
                  <button
                    id="dashboard-refresh-btn"
                    onClick={handleRefreshAll}
                    disabled={scheduledLoading || sentLoading || slackLoading}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-medium transition disabled:opacity-50"
                    title="Refresh dashboard data"
                    aria-label="Refresh dashboard data"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${scheduledLoading || sentLoading || slackLoading ? 'animate-spin text-indigo-400' : ''}`} />
                    <span className="hidden sm:inline">Refresh</span>
                  </button>
                </div>
              </div>

              {/* Tab Panels */}
              <div className="p-4 sm:p-6">
                
                {/* SCHEDULED EMAILS TAB */}
                {activeTab === 'scheduled' && (
                  <div className="space-y-4">
                    {/* Error Banner with Working Retry */}
                    {scheduledError && (
                      <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>{scheduledError}</span>
                        </div>
                        <button
                          onClick={() => fetchScheduledEmails(scheduledPagination.page)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 rounded-lg text-xs font-medium border border-rose-700/50 transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      </div>
                    )}

                    {/* Loading State Skeleton */}
                    {scheduledLoading && scheduledEmails.length === 0 ? (
                      <div className="py-4 space-y-2.5">
                        <div className="h-10 bg-slate-900/80 rounded-xl border border-slate-800 animate-pulse"></div>
                        <div className="h-12 bg-slate-900/50 rounded-xl border border-slate-800/60 animate-pulse"></div>
                        <div className="h-12 bg-slate-900/50 rounded-xl border border-slate-800/60 animate-pulse"></div>
                      </div>
                    ) : scheduledEmails.length === 0 ? (
                      /* 8. Scheduled Empty State */
                      <div className="py-5 sm:py-6 space-y-6">
                        <div className="text-center space-y-2.5 max-w-sm mx-auto">
                          <div className="w-10 h-10 mx-auto rounded-xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center text-indigo-400 shadow-sm">
                            <Clock className="w-5 h-5" />
                          </div>
                          <div className="space-y-1">
                            <h3 className="text-sm sm:text-base font-semibold text-white">Your schedule is clear</h3>
                            <p className="text-xs text-slate-400">
                              Create a campaign to schedule your next batch of emails.
                            </p>
                          </div>
                          <div className="pt-1.5">
                            <button
                              onClick={() => setIsComposeOpen(true)}
                              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Compose New Email</span>
                            </button>
                          </div>
                        </div>

                        {/* Recent Delivery Activity (if sent records exist) */}
                        {sentEmails.length > 0 && (
                          <div className="pt-6 border-t border-slate-800/80 text-left max-w-2xl mx-auto space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                                <Send className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Recent Delivery Activity</span>
                              </h4>
                              <button
                                onClick={() => setActiveTab('sent')}
                                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition focus-visible:ring-2 focus-visible:ring-indigo-500 rounded px-1 focus-visible:outline-none"
                              >
                                View all sent emails &rarr;
                              </button>
                            </div>

                            <div className="space-y-2">
                              {sentEmails.slice(0, 3).map((item) => (
                                <div
                                  key={`recent-${item.id}`}
                                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-slate-200 font-medium truncate" title={item.subject}>
                                      {item.subject}
                                    </p>
                                    <div className="flex items-center space-x-2 mt-0.5 text-[11px] text-slate-400">
                                      <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 font-medium text-[10px]">
                                        {getFriendlySenderName(item.senderKey)}
                                      </span>
                                      <span className="text-slate-500" aria-hidden="true">•</span>
                                      <span className="font-mono text-[10px]">
                                        {formatDateTime(item.sentAt)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="self-start sm:self-center shrink-0">
                                    <StatusBadge status={item.status} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Scheduled Emails View */
                      <div className="space-y-4">
                        
                        {/* 6. Desktop Table Layout */}
                        <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                              <tr>
                                <th scope="col" className="py-3 px-4 font-semibold">Recipient</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Sender</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Subject</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Scheduled Time</th>
                                <th scope="col" className="py-3 px-4 font-semibold text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {scheduledEmails.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-900/50 transition">
                                  <td className="py-3 px-4 font-medium text-white max-w-[200px] truncate" title={item.recipientEmail}>
                                    {item.recipientEmail}
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className="px-2 py-0.5 rounded-md bg-slate-800/90 text-[11px] text-slate-200 border border-slate-700/60 font-medium">
                                      {getFriendlySenderName(item.senderKey)}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-slate-300 max-w-xs truncate" title={item.subject}>
                                    {item.subject}
                                  </td>
                                  <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                                    {formatDateTime(item.scheduledAt)}
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <StatusBadge status={item.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* 7. Mobile Stacked Cards Layout */}
                        <div className="md:hidden space-y-3">
                          {scheduledEmails.map((item) => (
                            <div key={item.id} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-white text-xs truncate" title={item.recipientEmail}>
                                  {item.recipientEmail}
                                </span>
                                <StatusBadge status={item.status} />
                              </div>
                              <p className="text-xs text-slate-300 font-medium line-clamp-2" title={item.subject}>
                                {item.subject}
                              </p>
                              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                                  {getFriendlySenderName(item.senderKey)}
                                </span>
                                <span className="font-mono text-[10px]">
                                  {formatDateTime(item.scheduledAt)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Pagination Footer */}
                        {scheduledPagination.totalPages > 1 && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400 px-1 pt-2">
                            <span>
                              Showing {((scheduledPagination.page - 1) * scheduledPagination.limit) + 1} - {Math.min(scheduledPagination.page * scheduledPagination.limit, scheduledPagination.total)} of {scheduledPagination.total}
                            </span>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => fetchScheduledEmails(scheduledPagination.page - 1)}
                                disabled={scheduledPagination.page <= 1 || scheduledLoading}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 transition"
                                aria-label="Previous page"
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                              <span className="px-2">
                                Page {scheduledPagination.page} of {scheduledPagination.totalPages}
                              </span>
                              <button
                                onClick={() => fetchScheduledEmails(scheduledPagination.page + 1)}
                                disabled={scheduledPagination.page >= scheduledPagination.totalPages || scheduledLoading}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 transition"
                                aria-label="Next page"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* SENT EMAILS TAB */}
                {activeTab === 'sent' && (
                  <div className="space-y-4">
                    {/* Full-Text Elasticsearch Search Bar */}
                    <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                          <Search className="w-4 h-4" />
                        </div>
                        <input
                          id="sent-email-search-input"
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search sent emails by subject, body, or recipient..."
                          className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            onClick={handleClearSearch}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300"
                            aria-label="Clear search input"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="submit"
                          id="search-sent-btn"
                          disabled={sentLoading || !searchQuery.trim()}
                          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1.5"
                        >
                          <Search className="w-3.5 h-3.5" />
                          <span>Search</span>
                        </button>
                        {activeSearch && (
                          <button
                            type="button"
                            onClick={handleClearSearch}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </form>

                    {/* Active Search Filter Banner */}
                    {activeSearch && (
                      <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-indigo-950/40 border border-indigo-800/40 text-xs text-indigo-300">
                        <div className="flex items-center space-x-2">
                          <Search className="w-3.5 h-3.5 text-indigo-400" />
                          <span>
                            Showing search results for: <strong className="text-white font-semibold">"{activeSearch}"</strong> ({sentPagination.total} {sentPagination.total === 1 ? 'match' : 'matches'})
                          </span>
                        </div>
                        <button
                          onClick={handleClearSearch}
                          className="text-xs text-indigo-400 hover:text-indigo-200 underline"
                        >
                          Reset to all sent emails
                        </button>
                      </div>
                    )}

                    {/* Error Banner with Working Retry */}
                    {sentError && (
                      <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>{sentError}</span>
                        </div>
                        <button
                          onClick={() => {
                            if (activeSearch) {
                              executeSearch(activeSearch, sentPagination.page);
                            } else {
                              fetchSentEmails(sentPagination.page);
                            }
                          }}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 rounded-lg text-xs font-medium border border-rose-700/50 transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      </div>
                    )}

                    {/* Loading State Skeleton */}
                    {sentLoading && sentEmails.length === 0 ? (
                      <div className="py-4 space-y-2.5">
                        <div className="h-10 bg-slate-900/80 rounded-xl border border-slate-800 animate-pulse"></div>
                        <div className="h-12 bg-slate-900/50 rounded-xl border border-slate-800/60 animate-pulse"></div>
                        <div className="h-12 bg-slate-900/50 rounded-xl border border-slate-800/60 animate-pulse"></div>
                      </div>
                    ) : sentEmails.length === 0 ? (
                      /* 8. Sent Empty State */
                      <div className="text-center space-y-2.5 max-w-sm mx-auto py-5 sm:py-6">
                        <div className="w-10 h-10 mx-auto rounded-xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center text-emerald-400 shadow-sm">
                          <Inbox className="w-5 h-5" />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-sm sm:text-base font-semibold text-white">
                            {activeSearch ? 'No matching sent emails' : 'No sent emails yet'}
                          </h3>
                          <p className="text-xs text-slate-400">
                            {activeSearch 
                              ? `No sent emails matched "${activeSearch}". Try refining your query or keywords.`
                              : 'Successfully dispatched emails will appear here.'}
                          </p>
                        </div>
                        {activeSearch && (
                          <div className="pt-1.5">
                            <button
                              onClick={handleClearSearch}
                              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-medium border border-slate-700 transition"
                            >
                              Clear Search Filter
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Sent Emails View */
                      <div className="space-y-4">
                        
                        {/* 6. Desktop Table Layout */}
                        <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                              <tr>
                                <th scope="col" className="py-3 px-4 font-semibold">Recipient</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Sender</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Subject</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Dispatched Time</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Status</th>
                                <th scope="col" className="py-3 px-4 font-semibold text-right">Preview</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {sentEmails.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-900/50 transition">
                                  <td className="py-3 px-4 font-medium text-white max-w-[180px] truncate" title={item.recipientEmail}>
                                    {item.recipientEmail}
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className="px-2 py-0.5 rounded-md bg-slate-800/90 text-[11px] text-slate-200 border border-slate-700/60 font-medium">
                                      {getFriendlySenderName(item.senderKey)}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-slate-300 max-w-sm">
                                    <p className="font-medium text-slate-200 truncate" title={item.subject}>{item.subject}</p>
                                    {item.snippet && (
                                      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1 italic font-sans text-slate-400/90">
                                        <HighlightSnippet snippet={item.snippet} />
                                      </p>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                                    {formatDateTime(item.sentAt)}
                                  </td>
                                  <td className="py-3 px-4">
                                    <StatusBadge status={item.status} />
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    {item.etherealPreviewUrl ? (
                                      <a
                                        href={item.etherealPreviewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-indigo-950/80 text-indigo-300 hover:text-indigo-100 hover:bg-indigo-900 border border-indigo-700/50 text-[11px] transition shadow-sm"
                                        title="Open Ethereal Email Preview"
                                      >
                                        <span>View</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    ) : (
                                      <span className="text-slate-600 text-[11px]">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* 7. Mobile Stacked Cards Layout */}
                        <div className="md:hidden space-y-3">
                          {sentEmails.map((item) => (
                            <div key={item.id} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-white text-xs truncate" title={item.recipientEmail}>
                                  {item.recipientEmail}
                                </span>
                                <StatusBadge status={item.status} />
                              </div>
                              <div>
                                <p className="text-xs text-slate-200 font-medium line-clamp-2" title={item.subject}>
                                  {item.subject}
                                </p>
                                {item.snippet && (
                                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 italic">
                                    <HighlightSnippet snippet={item.snippet} />
                                  </p>
                                )}
                              </div>
                              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                                  {getFriendlySenderName(item.senderKey)}
                                </span>
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono text-[10px]">
                                    {formatDateTime(item.sentAt)}
                                  </span>
                                  {item.etherealPreviewUrl && (
                                    <a
                                      href={item.etherealPreviewUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/50 text-[10px]"
                                    >
                                      <span>View</span>
                                      <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Pagination Footer */}
                        {sentPagination.totalPages > 1 && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400 px-1 pt-2">
                            <span>
                              Showing {((sentPagination.page - 1) * sentPagination.limit) + 1} - {Math.min(sentPagination.page * sentPagination.limit, sentPagination.total)} of {sentPagination.total}
                            </span>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => {
                                  const prevPage = sentPagination.page - 1;
                                  if (activeSearch) {
                                    executeSearch(activeSearch, prevPage);
                                  } else {
                                    fetchSentEmails(prevPage);
                                  }
                                }}
                                disabled={sentPagination.page <= 1 || sentLoading}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 transition"
                                aria-label="Previous page"
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                              <span className="px-2">
                                Page {sentPagination.page} of {sentPagination.totalPages}
                              </span>
                              <button
                                onClick={() => {
                                  const nextPage = sentPagination.page + 1;
                                  if (activeSearch) {
                                    executeSearch(activeSearch, nextPage);
                                  } else {
                                    fetchSentEmails(nextPage);
                                  }
                                }}
                                disabled={sentPagination.page >= sentPagination.totalPages || sentLoading}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 transition"
                                aria-label="Next page"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

              </div>

            </div>

          </div>
        )}

      </main>

      {/* Compose Email Modal */}
      <ComposeModal 
        isOpen={isComposeOpen} 
        onClose={() => setIsComposeOpen(false)} 
        onSuccess={handleCampaignCreated}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/70 bg-slate-950 py-4 mt-auto text-center text-xs text-slate-500">
        ReachInbox Email Scheduler • Enterprise Edition
      </footer>
    </div>
  );
}
