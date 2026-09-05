import { ioRedisClient } from '../config/redis.js';

export type RateLimitReason = 'OK' | 'HOURLY_LIMIT' | 'MIN_DELAY' | 'DELAY';

export interface DispatchSlotReservationParams {
  userId?: string;
  senderKey?: string;
  campaignId?: string;
  hourlyLimit: number;
  delaySeconds: number;
  emailId: string;
  now?: number; // Optional timestamp override for deterministic testing
  ttlSeconds?: number;
}

export interface DispatchSlotReservationResult {
  allowed: boolean;
  waitMs: number;
  nextAvailableAt: Date;
  reason: RateLimitReason;
}

export const RATE_LIMIT_WINDOW_MS = 3600000; // Rolling 60 minutes
export const DEFAULT_RATE_LIMIT_TTL_SECONDS = 7200; // 2 hours

/**
 * Lua script for atomic Redis dispatch reservation.
 * Ensures that multiple concurrent workers never exceed the rolling 60-minute
 * hourly limit or the minimum delay interval between dispatch starts for a sender.
 */
const RESERVE_SLOT_LUA = `
local windowKey = KEYS[1]
local lastDispatchKey = KEYS[2]

local now = tonumber(ARGV[1])
local hourlyLimit = tonumber(ARGV[2])
local delaySeconds = tonumber(ARGV[3])
local emailId = ARGV[4]
local ttl = tonumber(ARGV[5])

local windowSizeMs = 3600000
local delayMs = delaySeconds * 1000

-- 1. Clean up entries older than the rolling 60-minute window
redis.call('ZREMRANGEBYSCORE', windowKey, '-inf', now - windowSizeMs)

-- 2. Check rolling hourly limit
local currentCount = redis.call('ZCARD', windowKey)
local hourlyAllowed = true
local hourlyWaitMs = 0

if hourlyLimit > 0 and currentCount >= hourlyLimit then
  hourlyAllowed = false
  local oldestElements = redis.call('ZRANGE', windowKey, 0, 0, 'WITHSCORES')
  if #oldestElements > 0 then
    local oldestScore = tonumber(oldestElements[2])
    hourlyWaitMs = (oldestScore + windowSizeMs) - now
    if hourlyWaitMs <= 0 then
      hourlyWaitMs = 1000
    end
  else
    hourlyWaitMs = windowSizeMs
  end
end

-- 3. Check delay interval since last dispatch start
local lastDispatch = redis.call('GET', lastDispatchKey)
local delayAllowed = true
local delayWaitMs = 0

if lastDispatch and delayMs > 0 then
  local lastTs = tonumber(lastDispatch)
  local elapsed = now - lastTs
  if elapsed < delayMs then
    delayAllowed = false
    delayWaitMs = delayMs - elapsed
    if delayWaitMs <= 0 then
      delayWaitMs = 1000
    end
  end
end

-- 4. If either limit is violated, return wait time and refresh TTL
if (not hourlyAllowed) or (not delayAllowed) then
  local reason = 'HOURLY_LIMIT'
  local maxWaitMs = hourlyWaitMs
  if (not hourlyAllowed) and (not delayAllowed) then
    if hourlyWaitMs >= delayWaitMs then
      maxWaitMs = hourlyWaitMs
      reason = 'HOURLY_LIMIT'
    else
      maxWaitMs = delayWaitMs
      reason = 'MIN_DELAY'
    end
  elseif not hourlyAllowed then
    maxWaitMs = hourlyWaitMs
    reason = 'HOURLY_LIMIT'
  else
    maxWaitMs = delayWaitMs
    reason = 'MIN_DELAY'
  end

  redis.call('EXPIRE', windowKey, ttl)
  redis.call('EXPIRE', lastDispatchKey, ttl)
  return { 0, maxWaitMs, reason }
end

-- 5. If allowed, record reservation atomically and set TTLs
local member = tostring(now) .. ':' .. emailId
redis.call('ZADD', windowKey, now, member)
redis.call('SET', lastDispatchKey, tostring(now))
redis.call('EXPIRE', windowKey, ttl)
redis.call('EXPIRE', lastDispatchKey, ttl)

return { 1, 0, 'OK' }
`;

/**
 * Resolves the Redis rate-limit scope key based on tenant/user ID, senderKey, or campaignId.
 */
export const getRateLimitScope = (params: string | { userId?: string; senderKey?: string; campaignId?: string }): string => {
  if (typeof params === 'string') {
    return `campaign:${params}`;
  }
  if (params.userId && params.senderKey) {
    return `tenant:${params.userId}:sender:${params.senderKey}`;
  }
  if (params.senderKey) {
    return `sender:${params.senderKey}`;
  }
  if (params.campaignId) {
    return `campaign:${params.campaignId}`;
  }
  return 'global';
};

/**
 * Scoped Redis key generators for rolling window rate control.
 */
export const getRateLimitWindowKey = (params: string | { userId?: string; senderKey?: string; campaignId?: string }): string => {
  const scope = getRateLimitScope(params);
  return `ratelimit:${scope}:window`;
};

export const getRateLimitLastDispatchKey = (params: string | { userId?: string; senderKey?: string; campaignId?: string }): string => {
  const scope = getRateLimitScope(params);
  return `ratelimit:${scope}:last_dispatch`;
};

// Aliases for campaign-scoped helper calls
export const getCampaignWindowKey = (campaignId: string): string => getRateLimitWindowKey(campaignId);
export const getCampaignLastDispatchKey = (campaignId: string): string => getRateLimitLastDispatchKey(campaignId);

/**
 * Scoped key for atomic Slack rate-limit hit alert deduplication across workers.
 */
export const getRateLimitAlertDedupKey = (userId: string, senderKey: string): string => {
  return `ratelimit:alert:tenant:${userId}:sender:${senderKey}`;
};

/**
 * Attempts to reserve an atomic dispatch slot for an email in a campaign or sender queue.
 * Shared across all distributed worker processes via Redis.
 */
export const reserveDispatchSlot = async (
  params: DispatchSlotReservationParams
): Promise<DispatchSlotReservationResult> => {
  const {
    userId,
    senderKey,
    campaignId,
    hourlyLimit,
    delaySeconds,
    emailId,
    now = Date.now(),
    ttlSeconds = DEFAULT_RATE_LIMIT_TTL_SECONDS
  } = params;

  const windowKey = getRateLimitWindowKey({ userId, senderKey, campaignId });
  const lastDispatchKey = getRateLimitLastDispatchKey({ userId, senderKey, campaignId });

  try {
    const rawResult = await ioRedisClient.eval(
      RESERVE_SLOT_LUA,
      2,
      windowKey,
      lastDispatchKey,
      now.toString(),
      hourlyLimit.toString(),
      delaySeconds.toString(),
      emailId,
      ttlSeconds.toString()
    );

    const [allowedInt, waitMsRaw, reasonRaw] = rawResult as [number, number, string];
    const waitMs = Math.max(0, waitMsRaw || 0);
    const reason = (reasonRaw as RateLimitReason) || 'OK';

    return {
      allowed: allowedInt === 1,
      waitMs,
      nextAvailableAt: new Date(now + waitMs),
      reason
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown Redis rate limiter error';
    const scope = getRateLimitScope({ userId, senderKey, campaignId });
    console.error(`[RateLimiter] Error evaluating reservation for ${scope}:`, errMsg);
    throw new Error(`Rate limiter evaluation failed: ${errMsg}`);
  }
};

/**
 * Clears rate limiter keys for a specific scope (primarily used for deterministic test cleanup).
 */
export const clearRateLimitKeys = async (
  params: string | { userId?: string; senderKey?: string; campaignId?: string }
): Promise<void> => {
  const windowKey = getRateLimitWindowKey(params);
  const lastDispatchKey = getRateLimitLastDispatchKey(params);
  await ioRedisClient.del(windowKey, lastDispatchKey);
};

export const clearCampaignRateLimit = async (campaignId: string): Promise<void> => {
  return clearRateLimitKeys(campaignId);
};

/**
 * Inspects the current rate limit status for a scope without making a reservation.
 */
export const inspectRateLimit = async (
  params: string | { userId?: string; senderKey?: string; campaignId?: string },
  now = Date.now()
): Promise<{ currentHourCount: number; lastDispatchAt: Date | null; ttlSeconds: number }> => {
  const windowKey = getRateLimitWindowKey(params);
  const lastDispatchKey = getRateLimitLastDispatchKey(params);

  await ioRedisClient.zremrangebyscore(windowKey, '-inf', (now - RATE_LIMIT_WINDOW_MS).toString());
  const count = await ioRedisClient.zcard(windowKey);
  const lastDispatchRaw = await ioRedisClient.get(lastDispatchKey);
  const ttl = await ioRedisClient.ttl(windowKey);

  return {
    currentHourCount: count,
    lastDispatchAt: lastDispatchRaw ? new Date(parseInt(lastDispatchRaw, 10)) : null,
    ttlSeconds: ttl
  };
};

export const inspectCampaignRateLimit = async (
  campaignId: string,
  now = Date.now()
): Promise<{ currentHourCount: number; lastDispatchAt: Date | null; ttlSeconds: number }> => {
  return inspectRateLimit(campaignId, now);
};
