import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronRight
} from 'lucide-react';
import { ComposeModal } from './components/ComposeModal';

interface AuthUser {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

interface ScheduledEmailItem {
  id: string;
  recipientEmail: string;
  subject: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RATE_LIMITED';
}

interface SentEmailItem {
  id: string;
  recipientEmail: string;
  subject: string;
  sentAt: string | null;
  status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RATE_LIMITED';
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
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
          Scheduled
        </span>
      );
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-950/80 text-amber-300 border border-amber-700/50 animate-pulse">
          Processing
        </span>
      );
    case 'SENT':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-700/50">
          Sent
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-950/80 text-rose-300 border border-rose-700/50">
          Failed
        </span>
      );
    case 'RATE_LIMITED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-950/80 text-violet-300 border border-violet-700/50">
          Rate Limited
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
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
  const [sentPagination, setSentPagination] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0
  });
  const [sentLoading, setSentLoading] = useState<boolean>(false);
  const [sentError, setSentError] = useState<string | null>(null);

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

  // Fetch Scheduled Emails
  const fetchScheduledEmails = useCallback(async (page: number = 1) => {
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
      } else if (response.status === 401) {
        setUser(null);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setScheduledError(errorData.message || 'Failed to load scheduled emails');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error loading scheduled emails';
      setScheduledError(msg);
    } finally {
      setScheduledLoading(false);
    }
  }, []);

  // Fetch Sent Emails
  const fetchSentEmails = useCallback(async (page: number = 1) => {
    setSentLoading(true);
    setSentError(null);
    try {
      const response = await fetch(`/api/emails/sent?page=${page}&limit=10`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setSentEmails(data.emails || []);
        setSentPagination(data.pagination || { total: 0, page: 1, limit: 10, totalPages: 0 });
      } else if (response.status === 401) {
        setUser(null);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setSentError(errorData.message || 'Failed to load sent emails');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error loading sent emails';
      setSentError(msg);
    } finally {
      setSentLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('auth_error');
    if (errorParam) {
      if (errorParam === 'google_auth_failed') {
        setAuthError('Google authentication was cancelled or failed. Please try again.');
      } else {
        setAuthError(`Authentication error: ${errorParam}`);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuth();
  }, []);

  // Fetch data when authenticated user is detected or active tab changes
  useEffect(() => {
    if (user) {
      if (activeTab === 'scheduled') {
        fetchScheduledEmails(1);
      } else {
        fetchSentEmails(1);
      }
    }
  }, [user, activeTab, fetchScheduledEmails, fetchSentEmails]);

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Navigation Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg text-white tracking-tight">ReachInbox</span>
              <p className="text-xs text-slate-400">Email Scheduler</p>
            </div>
          </div>

          {/* User Profile & Logout */}
          {user && (
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <UserAvatar 
                  name={user.name} 
                  email={user.email} 
                  avatarUrl={user.avatarUrl} 
                  size="sm" 
                />
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-semibold text-slate-200">{user.name || user.email}</p>
                  <p className="text-[11px] text-slate-400">{user.email}</p>
                </div>
              </div>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                id="logout-btn"
                className="inline-flex items-center space-x-2 px-3.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700 transition disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{loggingOut ? 'Signing out...' : 'Sign Out'}</span>
              </button>
            </div>
          )}

        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col">
        
        {/* Unauthenticated View: Clean Login Page */}
        {!user ? (
          <div className="max-w-md w-full mx-auto my-auto space-y-6">
            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-md p-8 shadow-2xl space-y-6">
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
          /* Authenticated Dashboard */
          <div className="space-y-6">
            
            {/* Dashboard Action Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-6 rounded-2xl">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Email Scheduler Dashboard
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                  Compose, schedule batches, and monitor dispatch queues
                </p>
              </div>

              {/* Primary "Compose New Email" Button */}
              <button
                id="compose-email-btn"
                onClick={() => setIsComposeOpen(true)}
                className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/20 transition active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                <span>Compose New Email</span>
              </button>
            </div>

            {/* Dashboard Tabs & Content Area */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
              
              {/* Tab Navigation and Controls */}
              <div className="border-b border-slate-800 px-6 pt-4 flex items-center justify-between">
                <div className="flex space-x-8">
                  <button
                    id="tab-scheduled-emails"
                    onClick={() => setActiveTab('scheduled')}
                    className={`pb-3 text-xs sm:text-sm font-semibold flex items-center space-x-2 border-b-2 transition ${
                      activeTab === 'scheduled'
                        ? 'border-indigo-500 text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CalendarClock className="w-4 h-4" />
                    <span>Scheduled Emails</span>
                    {scheduledPagination.total > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800">
                        {scheduledPagination.total}
                      </span>
                    )}
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
                    {sentPagination.total > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                        {sentPagination.total}
                      </span>
                    )}
                  </button>
                </div>

                {/* Tab Refresh Button */}
                <button
                  onClick={() => {
                    if (activeTab === 'scheduled') {
                      fetchScheduledEmails(scheduledPagination.page);
                    } else {
                      fetchSentEmails(sentPagination.page);
                    }
                  }}
                  disabled={scheduledLoading || sentLoading}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition disabled:opacity-50"
                  title="Refresh list"
                  aria-label="Refresh list"
                >
                  <RefreshCw className={`w-4 h-4 ${scheduledLoading || sentLoading ? 'animate-spin text-indigo-400' : ''}`} />
                </button>
              </div>

              {/* Tab Panels */}
              <div className="p-4 sm:p-6">
                
                {/* SCHEDULED EMAILS TAB */}
                {activeTab === 'scheduled' && (
                  <div>
                    {scheduledError && (
                      <div className="mb-4 p-3 rounded-xl bg-rose-950/70 border border-rose-800/70 text-rose-300 text-xs flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{scheduledError}</span>
                      </div>
                    )}

                    {scheduledLoading && scheduledEmails.length === 0 ? (
                      <div className="py-12 flex flex-col items-center justify-center space-y-3">
                        <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
                        <p className="text-xs text-slate-400">Loading scheduled emails...</p>
                      </div>
                    ) : scheduledEmails.length === 0 ? (
                      /* Empty State */
                      <div className="text-center space-y-4 max-w-md mx-auto py-8">
                        <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center text-indigo-400">
                          <Clock className="w-6 h-6" />
                        </div>
                        <div className="space-y-1.5">
                          <h3 className="text-base font-semibold text-white">No Scheduled Emails</h3>
                          <p className="text-xs text-slate-400">
                            You have no emails waiting in the schedule queue. Click "Compose New Email" to set up your next email campaign.
                          </p>
                        </div>
                        <div className="pt-2">
                          <button
                            onClick={() => setIsComposeOpen(true)}
                            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-medium border border-slate-700 transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Schedule Your First Email</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Scheduled Emails Table */
                      <div className="space-y-4">
                        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                              <tr>
                                <th scope="col" className="py-3 px-4 font-semibold">Recipient</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Subject</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Scheduled Time</th>
                                <th scope="col" className="py-3 px-4 font-semibold text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {scheduledEmails.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-900/40 transition">
                                  <td className="py-3 px-4 font-medium text-white">{item.recipientEmail}</td>
                                  <td className="py-3 px-4 text-slate-300 max-w-xs truncate">{item.subject}</td>
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

                        {/* Pagination Footer */}
                        {scheduledPagination.totalPages > 1 && (
                          <div className="flex items-center justify-between text-xs text-slate-400 px-2 pt-2">
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
                  <div>
                    {sentError && (
                      <div className="mb-4 p-3 rounded-xl bg-rose-950/70 border border-rose-800/70 text-rose-300 text-xs flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{sentError}</span>
                      </div>
                    )}

                    {sentLoading && sentEmails.length === 0 ? (
                      <div className="py-12 flex flex-col items-center justify-center space-y-3">
                        <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
                        <p className="text-xs text-slate-400">Loading sent emails...</p>
                      </div>
                    ) : sentEmails.length === 0 ? (
                      /* Empty State */
                      <div className="text-center space-y-4 max-w-md mx-auto py-8">
                        <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center text-emerald-400">
                          <Inbox className="w-6 h-6" />
                        </div>
                        <div className="space-y-1.5">
                          <h3 className="text-base font-semibold text-white">No Sent Emails Yet</h3>
                          <p className="text-xs text-slate-400">
                            Dispatched emails and delivery logs will be listed here once the background worker processes scheduled jobs.
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* Sent Emails Table */
                      <div className="space-y-4">
                        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                              <tr>
                                <th scope="col" className="py-3 px-4 font-semibold">Recipient</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Subject</th>
                                <th scope="col" className="py-3 px-4 font-semibold">Dispatched Time</th>
                                <th scope="col" className="py-3 px-4 font-semibold text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {sentEmails.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-900/40 transition">
                                  <td className="py-3 px-4 font-medium text-white">{item.recipientEmail}</td>
                                  <td className="py-3 px-4 text-slate-300 max-w-xs truncate">{item.subject}</td>
                                  <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                                    {formatDateTime(item.sentAt)}
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <StatusBadge status={item.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination Footer */}
                        {sentPagination.totalPages > 1 && (
                          <div className="flex items-center justify-between text-xs text-slate-400 px-2 pt-2">
                            <span>
                              Showing {((sentPagination.page - 1) * sentPagination.limit) + 1} - {Math.min(sentPagination.page * sentPagination.limit, sentPagination.total)} of {sentPagination.total}
                            </span>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => fetchSentEmails(sentPagination.page - 1)}
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
                                onClick={() => fetchSentEmails(sentPagination.page + 1)}
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
        ReachInbox Email Scheduler • Phase 4 Persistent Email Scheduling
      </footer>
    </div>
  );
}
