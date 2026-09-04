import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Calendar, 
  Gauge, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  SendHorizontal,
  Loader2,
  Send
} from 'lucide-react';
import { parseRecipientFile, ParseResult } from '../utils/recipientParser';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface SenderOption {
  key: string;
  displayName: string;
  fromEmail: string;
}

export function ComposeModal({ isOpen, onClose, onSuccess }: ComposeModalProps): React.JSX.Element | null {
  // Senders State
  const [senders, setSenders] = useState<SenderOption[]>([]);
  const [selectedSenderKey, setSelectedSenderKey] = useState<string>('');
  const [loadingSenders, setLoadingSenders] = useState<boolean>(false);

  // Form States
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [showRecipientDetails, setShowRecipientDetails] = useState<boolean>(false);
  
  // Timing & Rate Limits
  const [startTime, setStartTime] = useState<string>('');
  const [delaySeconds, setDelaySeconds] = useState<number>(5);
  const [hourlyLimit, setHourlyLimit] = useState<number>(100);

  // Slack Integration States
  const [slackConnected, setSlackConnected] = useState<boolean>(false);
  const [slackInstallationId, setSlackInstallationId] = useState<string | null>(null);
  const [slackTeamName, setSlackTeamName] = useState<string | null>(null);
  const [slackChannels, setSlackChannels] = useState<Array<{ id: string; name: string; isPrivate: boolean }>>([]);
  const [loadingSlackChannels, setLoadingSlackChannels] = useState<boolean>(false);
  const [notifySlack, setNotifySlack] = useState<boolean>(false);
  const [selectedSlackChannelId, setSelectedSlackChannelId] = useState<string>('');
  const [selectedSlackChannelName, setSelectedSlackChannelName] = useState<string>('');
  const [slackChannelError, setSlackChannelError] = useState<string | null>(null);

  // Submission Status
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch senders and Slack status when modal opens
  useEffect(() => {
    if (isOpen) {
      setLoadingSenders(true);
      fetch('/api/senders', { credentials: 'include' })
        .then((res) => res.json())
        .then((data) => {
          if (data.senders && Array.isArray(data.senders) && data.senders.length > 0) {
            setSenders(data.senders);
            setSelectedSenderKey((prev) => prev || data.senders[0].key);
          }
        })
        .catch((err) => console.warn('Failed to fetch senders:', err))
        .finally(() => setLoadingSenders(false));

      // Fetch Slack connection status
      fetch('/api/slack/status', { credentials: 'include' })
        .then((res) => res.json())
        .then((data) => {
          const instId = data.installation?.id || data.installationId || null;
          const tName = data.installation?.teamName || data.teamName || 'Slack Workspace';
          if (data.status === 'success' && data.connected && instId) {
            setSlackConnected(true);
            setSlackInstallationId(instId);
            setSlackTeamName(tName);
          } else {
            setSlackConnected(false);
            setSlackInstallationId(null);
            setSlackTeamName(null);
          }
        })
        .catch((err) => console.warn('Failed to fetch Slack status:', err));

      const now = new Date();
      now.setMinutes(now.getMinutes() + 5);
      const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setStartTime(localISO);
      setSubmitError(null);
      setIdempotencyKey(`idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    }
  }, [isOpen]);

  // Fetch channels when notifySlack is enabled
  const fetchChannels = async () => {
    setLoadingSlackChannels(true);
    setSlackChannelError(null);
    try {
      const res = await fetch('/api/slack/channels', { credentials: 'include' });
      let data: { status?: string; channels?: Array<{ id: string; name: string; isPrivate: boolean }>; message?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error('Received an invalid response from the server.');
      }

      if (res.ok && data.status === 'success' && data.channels && Array.isArray(data.channels)) {
        setSlackChannels(data.channels);
        if (data.channels.length > 0 && !selectedSlackChannelId) {
          setSelectedSlackChannelId(data.channels[0].id);
          setSelectedSlackChannelName(data.channels[0].name);
        }
      } else {
        const rawMsg = data?.message || 'Failed to load Slack channels';
        const userMsg = rawMsg.toLowerCase().includes('fetch failed')
          ? 'Unable to connect to Slack API. Please check your network connection and try again.'
          : rawMsg;
        setSlackChannelError(userMsg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching Slack channels';
      const userMsg = msg.toLowerCase().includes('fetch failed')
        ? 'Unable to connect to Slack API. Please check your network connection and try again.'
        : msg;
      setSlackChannelError(userMsg);
    } finally {
      setLoadingSlackChannels(false);
    }
  };

  const handleNotifySlackToggle = (checked: boolean) => {
    setNotifySlack(checked);
    if (checked && slackChannels.length === 0) {
      fetchChannels();
    }
  };

  const handleChannelSelect = (channelId: string) => {
    setSelectedSlackChannelId(channelId);
    const found = slackChannels.find((c) => c.id === channelId);
    setSelectedSlackChannelName(found ? found.name : '');
  };

  if (!isOpen) return null;

  // File Upload Handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setFileError(null);
    setIsParsing(true);
    setParseResult(null);

    try {
      const result = await parseRecipientFile(file);
      setParseResult(result);
      if (result.valid.length === 0) {
        setFileError('No valid email addresses found in the uploaded file.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to parse file';
      setFileError(message);
      setSelectedFile(null);
      setParseResult(null);
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setParseResult(null);
    setFileError(null);
    setShowRecipientDetails(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    setSubject('');
    setBody('');
    setSelectedFile(null);
    setParseResult(null);
    setFileError(null);
    setSubmitError(null);
    setShowRecipientDetails(false);
    setIsSubmitting(false);
    setNotifySlack(false);
    setSelectedSlackChannelId('');
    setSelectedSlackChannelName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Validation Logic
  const isStartTimeValid = Boolean(startTime && !isNaN(new Date(startTime).getTime()) && new Date(startTime).getTime() > Date.now() - 60000);
  const isDelayValid = delaySeconds > 0 && !isNaN(delaySeconds);
  const isHourlyLimitValid = hourlyLimit >= 1 && Number.isInteger(Number(hourlyLimit));
  const hasSender = Boolean(selectedSenderKey && selectedSenderKey.trim().length > 0);
  const hasSubject = subject.trim().length > 0;
  const hasBody = body.trim().length > 0;
  const hasValidRecipients = (parseResult?.valid.length ?? 0) > 0;
  const isSlackValid = !notifySlack || (Boolean(slackInstallationId) && Boolean(selectedSlackChannelId));

  const isFormValid = hasSender &&
    hasSubject && 
    hasBody && 
    hasValidRecipients && 
    isStartTimeValid && 
    isDelayValid && 
    isHourlyLimitValid &&
    isSlackValid &&
    !isParsing;

  // Handle Schedule Submit
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || !parseResult) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payload: Record<string, unknown> = {
        senderKey: selectedSenderKey,
        subject: subject.trim(),
        body: body.trim(),
        recipients: parseResult.valid,
        startTime: new Date(startTime).toISOString(),
        delaySeconds: Number(delaySeconds),
        hourlyLimit: Number(hourlyLimit)
      };

      if (notifySlack && slackInstallationId && selectedSlackChannelId) {
        payload.notifySlack = true;
        payload.slackInstallationId = slackInstallationId;
        payload.slackChannelId = selectedSlackChannelId;
        payload.slackChannelName = selectedSlackChannelName || undefined;
      }

      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `Failed to schedule campaign (HTTP ${response.status})`);
      }

      // Success
      resetForm();
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div 
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-800/90 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-modal-title"
      >
        {/* Sticky Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/95 backdrop-blur-md shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20 text-white">
              <SendHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h2 id="compose-modal-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                Compose New Email
              </h2>
              <p className="text-[11px] text-slate-400">Configure sender account, timing, and recipient list</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form with Internal Scrollable Body */}
        <form onSubmit={handleScheduleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            
            {/* Submit Error Alert */}
            {submitError && (
              <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-800/70 text-rose-300 text-xs flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Scheduling Error</p>
                  <p className="mt-0.5 text-rose-300/90">{submitError}</p>
                </div>
              </div>
            )}

            {/* Section 1: Message & Sender */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                  1. Sender &amp; Campaign Content
                </span>
              </div>

              {/* Sender Account Selection */}
              <div className="space-y-1.5">
                <label htmlFor="sender-account-select" className="block text-xs font-medium text-slate-300 flex items-center space-x-1">
                  <Send className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Sender Account <span className="text-rose-400">*</span></span>
                </label>
                <select
                  id="sender-account-select"
                  required
                  value={selectedSenderKey}
                  onChange={(e) => setSelectedSenderKey(e.target.value)}
                  disabled={loadingSenders || isSubmitting}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition disabled:opacity-60"
                >
                  {senders.length === 0 ? (
                    <option value="">{loadingSenders ? 'Loading configured senders...' : 'No sender accounts available'}</option>
                  ) : (
                    senders.map((sender) => (
                      <option key={sender.key} value={sender.key}>
                        {sender.displayName}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Subject Field */}
              <div className="space-y-1.5">
                <label htmlFor="email-subject" className="block text-xs font-medium text-slate-300">
                  Subject <span className="text-rose-400">*</span>
                </label>
                <input
                  id="email-subject"
                  type="text"
                  required
                  placeholder="e.g. Product Update & Welcome Announcement"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
                {!hasSubject && subject.length > 0 && (
                  <p className="text-[11px] text-rose-400">Subject is required.</p>
                )}
              </div>

              {/* Body Field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="email-body" className="block text-xs font-medium text-slate-300">
                    Email Body Content <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[11px] text-slate-500">{body.length} characters</span>
                </div>
                <textarea
                  id="email-body"
                  required
                  rows={4}
                  placeholder="Write your email body message here..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition resize-y"
                />
              </div>
            </div>

            {/* Section 2: Recipient Upload */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                  2. Recipient List
                </span>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                id="recipient-file-input"
              />

              {!selectedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 bg-slate-950/60 hover:bg-slate-950 rounded-xl p-5 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-2 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-950/70 border border-indigo-800/40 group-hover:border-indigo-600/60 flex items-center justify-center text-indigo-400 transition">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-300 group-hover:text-white transition">
                      Click to upload recipient list (.csv or .txt)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Supports comma-separated or newline-delimited addresses (max 5 MB)
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-800/50 flex items-center justify-center text-indigo-400 shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-200 truncate max-w-xs">{selectedFile.name}</p>
                        <p className="text-[10px] text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      disabled={isSubmitting}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition"
                      title="Remove file"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Parsing Status Badges */}
                  {parseResult && (
                    <div className="pt-2 border-t border-slate-800/70 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-emerald-950/80 border border-emerald-700/40 text-emerald-300 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{parseResult.valid.length} Valid</span>
                        </span>

                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-rose-950/80 border border-rose-700/40 text-rose-300 font-medium">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                          <span>{parseResult.invalid.length} Invalid</span>
                        </span>

                        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-700/40 text-amber-300 font-medium">
                          <span>{parseResult.duplicates.length} Duplicates Filtered</span>
                        </span>
                      </div>

                      {/* Toggle Recipient Details */}
                      <button
                        type="button"
                        onClick={() => setShowRecipientDetails(!showRecipientDetails)}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 transition pt-1"
                      >
                        <span>{showRecipientDetails ? 'Hide' : 'Inspect'} parsed recipient details</span>
                        {showRecipientDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {showRecipientDetails && (
                        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] space-y-2 max-h-40 overflow-y-auto font-mono">
                          {parseResult.valid.length > 0 && (
                            <div>
                              <span className="text-emerald-400 font-semibold">Valid Recipients:</span>
                              <p className="text-slate-300 break-words mt-0.5">
                                {parseResult.valid.join(', ')}
                              </p>
                            </div>
                          )}
                          {parseResult.invalid.length > 0 && (
                            <div>
                              <span className="text-rose-400 font-semibold">Invalid Items:</span>
                              <p className="text-slate-400 break-words mt-0.5">
                                {parseResult.invalid.join(', ')}
                              </p>
                            </div>
                          )}
                          {parseResult.duplicates.length > 0 && (
                            <div>
                              <span className="text-amber-400 font-semibold">Duplicates (Filtered):</span>
                              <p className="text-slate-400 break-words mt-0.5">
                                {parseResult.duplicates.join(', ')}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {fileError && (
                <p className="text-[11px] text-rose-400 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{fileError}</span>
                </p>
              )}
            </div>

            {/* Section 3: Scheduling & Rate Limits */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                  3. Dispatch Timing &amp; Rate Limits
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {/* Start Time */}
                <div className="space-y-1.5">
                  <label htmlFor="start-time" className="block text-xs font-medium text-slate-300 flex items-center space-x-1">
                    <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Start Time <span className="text-rose-400">*</span></span>
                  </label>
                  <input
                    id="start-time"
                    type="datetime-local"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 transition"
                  />
                  {!isStartTimeValid && startTime.length > 0 && (
                    <p className="text-[10px] text-rose-400">Start time cannot be in past.</p>
                  )}
                </div>

                {/* Delay in Seconds */}
                <div className="space-y-1.5">
                  <label htmlFor="delay-seconds" className="block text-xs font-medium text-slate-300 flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5 text-violet-400" />
                    <span>Delay (sec) <span className="text-rose-400">*</span></span>
                  </label>
                  <input
                    id="delay-seconds"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 transition"
                  />
                  {!isDelayValid && (
                    <p className="text-[10px] text-rose-400">Must be &ge; 1.</p>
                  )}
                </div>

                {/* Hourly Email Limit */}
                <div className="space-y-1.5">
                  <label htmlFor="hourly-limit" className="block text-xs font-medium text-slate-300 flex items-center space-x-1">
                    <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Hourly Limit <span className="text-rose-400">*</span></span>
                  </label>
                  <input
                    id="hourly-limit"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 transition"
                  />
                  {!isHourlyLimitValid && (
                    <p className="text-[10px] text-rose-400">Must be &ge; 1.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Section 4: Slack Completion Notification (Optional) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                  4. Slack Notification (Optional)
                </span>
              </div>

              {slackConnected ? (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center space-x-2.5 cursor-pointer text-xs font-medium text-slate-200 select-none">
                      <input
                        type="checkbox"
                        checked={notifySlack}
                        onChange={(e) => handleNotifySlackToggle(e.target.checked)}
                        disabled={isSubmitting}
                        className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-950 bg-slate-900 cursor-pointer"
                      />
                      <span>Notify Slack when campaign completes</span>
                    </label>
                    {slackTeamName && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-indigo-950/80 border border-indigo-700/50 text-indigo-300">
                        {slackTeamName}
                      </span>
                    )}
                  </div>

                  {notifySlack && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <label htmlFor="slack-channel-select" className="block text-xs font-medium text-slate-300">
                          Destination Channel <span className="text-rose-400">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={fetchChannels}
                          disabled={loadingSlackChannels}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 transition"
                        >
                          {loadingSlackChannels ? 'Loading...' : 'Refresh channels'}
                        </button>
                      </div>

                      {slackChannelError ? (
                        <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300 space-y-2">
                          <p className="text-[11px] flex items-center space-x-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                            <span>{slackChannelError}</span>
                          </p>
                          <button
                            type="button"
                            onClick={fetchChannels}
                            disabled={loadingSlackChannels}
                            className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 underline inline-block"
                          >
                            {loadingSlackChannels ? 'Retrying...' : 'Retry fetching channels'}
                          </button>
                        </div>
                      ) : (
                        <select
                          id="slack-channel-select"
                          value={selectedSlackChannelId}
                          onChange={(e) => handleChannelSelect(e.target.value)}
                          disabled={loadingSlackChannels || isSubmitting}
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 transition"
                        >
                          {loadingSlackChannels ? (
                            <option value="">Loading Slack channels...</option>
                          ) : slackChannels.length === 0 ? (
                            <option value="">No channels available</option>
                          ) : (
                            slackChannels.map((ch) => (
                              <option key={ch.id} value={ch.id}>
                                {ch.isPrivate ? '🔒' : '#'} {ch.name}
                              </option>
                            ))
                          )}
                        </select>
                      )}

                      <p className="text-[10px] text-slate-500">
                        ReachInbox will post a delivery summary to this channel once all emails finish.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-300">Connect Slack for completion alerts</p>
                    <p className="text-[11px] text-slate-500">Receive automated delivery reports when campaigns finish.</p>
                  </div>
                  <a
                    href="/api/slack/oauth/start"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-medium transition shrink-0"
                  >
                    <span>Connect Slack</span>
                  </a>
                </div>
              )}
            </div>

          </div>

          {/* Sticky Modal Footer */}
          <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-900/95 backdrop-blur-md flex items-center justify-end space-x-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              id="schedule-submit-btn"
              className="inline-flex items-center space-x-2 px-5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-xl shadow-lg shadow-indigo-600/25 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Scheduling Campaign...</span>
                </>
              ) : (
                <>
                  <SendHorizontal className="w-4 h-4" />
                  <span>Schedule Campaign</span>
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
