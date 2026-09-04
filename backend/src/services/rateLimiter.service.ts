import { ioRedisClient } from '../config/redis.js';

export interface DispatchSlotReservationParams {
  campaignId: string;
  hourlyLimit: number;
  delaySeconds: number;
  emailId: string;
  now?: number; // Optional timestamp override for deterministic testing
  ttlSeconds?: number;
}

export interface DispatchSlotReservationResult {
  allowed: boolean;
  waitMs: number;
  reason: 'OK' | 'HOURLY_LIMIT' | 'DELAY';
}

export const RATE_LIMIT_WINDOW_MS = 3600000; // Rolling 60 minutes
export const DEFAULT_RATE_LIMIT_TTL_SECONDS = 7200; // 2 hours

/**
 * Lua script for atomic Redis dispatch reservation.
 * Ensures that multiple concurrent workers never exceed the campaign's rolling 60-minute
 * hourly limit or the minimum delay interval between dispatch starts.
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
  if delayWaitMs > maxWaitMs then
    maxWaitMs = delayWaitMs
    reason = 'DELAY'
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
 * Scoped Redis key generators for campaign rate control.
 */
export const getCampaignWindowKey = (campaignId: string): string => {
  return `ratelimit:campaign:${campaignId}:window`;
};

export const getCampaignLastDispatchKey = (campaignId: string): string => {
  return `ratelimit:campaign:${campaignId}:last_dispatch`;
};

/**
 * Attempts to reserve an atomic dispatch slot for an email in a campaign.
 * Shared across all distributed worker processes via Redis.
 */
export const reserveDispatchSlot = async (
  params: DispatchSlotReservationParams
): Promise<DispatchSlotReservationResult> => {
  const {
    campaignId,
    hourlyLimit,
    delaySeconds,
    emailId,
    now = Date.now(),
    ttlSeconds = DEFAULT_RATE_LIMIT_TTL_SECONDS
  } = params;

  const windowKey = getCampaignWindowKey(campaignId);
  const lastDispatchKey = getCampaignLastDispatchKey(campaignId);

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

    const [allowedInt, waitMs, reason] = rawResult as [number, number, string];

    return {
      allowed: allowedInt === 1,
      waitMs: Math.max(0, waitMs || 0),
      reason: (reason as 'OK' | 'HOURLY_LIMIT' | 'DELAY') || 'OK'
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown Redis rate limiter error';
    console.error(`[RateLimiter] Error evaluating reservation for campaign ${campaignId}:`, errMsg);
    // In case of an unexpected Redis error, fail safely by granting or short-deferring
    throw new Error(`Rate limiter evaluation failed: ${errMsg}`);
  }
};

/**
 * Clears rate limiter keys for a specific campaign (primarily used for deterministic test cleanup).
 */
export const clearCampaignRateLimit = async (campaignId: string): Promise<void> => {
  const windowKey = getCampaignWindowKey(campaignId);
  const lastDispatchKey = getCampaignLastDispatchKey(campaignId);
  await ioRedisClient.del(windowKey, lastDispatchKey);
};

/**
 * Inspects the current rate limit status for a campaign without making a reservation.
 */
export const inspectCampaignRateLimit = async (
  campaignId: string,
  now = Date.now()
): Promise<{ currentHourCount: number; lastDispatchAt: Date | null; ttlSeconds: number }> => {
  const windowKey = getCampaignWindowKey(campaignId);
  const lastDispatchKey = getCampaignLastDispatchKey(campaignId);

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
