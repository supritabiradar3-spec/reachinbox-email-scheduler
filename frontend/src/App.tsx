import React, { useState, useEffect } from 'react';
import { 
  Mail, 
  LogOut, 
  AlertCircle, 
  RefreshCw, 
  Calendar,
  Clock,
  Send
} from 'lucide-react';

interface AuthUser {
  name: string | null;
  email: string;
  avatarUrl: string | null;
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
    lg: 'w-16 h-16 text-xl'
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

export default function App(): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [redirectingToGoogle, setRedirectingToGoogle] = useState<boolean>(false);

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

  useEffect(() => {
    // Check URL parameters for OAuth errors
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
      }
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setLoggingOut(false);
    }
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
      {/* Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
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

          {/* User Profile & Single Logout Button */}
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col justify-center">
        
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

              {/* Error Message Alert */}
              {authError && (
                <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-start space-x-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Sign In Failed</p>
                    <p className="mt-0.5 text-rose-300/90">{authError}</p>
                  </div>
                </div>
              )}

              {/* Google OAuth Button */}
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
          /* Authenticated View: Clean Dashboard Placeholder */
          <div className="space-y-6">
            
            {/* Welcome Banner */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 flex items-center space-x-5">
              <UserAvatar 
                name={user.name} 
                email={user.email} 
                avatarUrl={user.avatarUrl} 
                size="lg" 
              />
              <div className="space-y-1">
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Welcome back{user.name ? `, ${user.name}` : ''}
                </h1>
                <p className="text-sm text-slate-400">{user.email}</p>
              </div>
            </div>

            {/* Dashboard Placeholder */}
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center text-indigo-400">
                <Clock className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto space-y-2">
                <h2 className="text-base font-semibold text-white">Email Scheduler Dashboard</h2>
                <p className="text-sm text-slate-400">
                  Your scheduled emails, delivery queues, and dispatch logs will appear here.
                </p>
              </div>
              <div className="pt-4 flex items-center justify-center space-x-6 text-xs text-slate-500">
                <span className="flex items-center space-x-1.5">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span>Scheduled Queues</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <Send className="w-4 h-4 text-slate-400" />
                  <span>Email Dispatcher</span>
                </span>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/70 bg-slate-950 py-4 mt-auto text-center text-xs text-slate-500">
        ReachInbox Email Scheduler
      </footer>
    </div>
  );
}
