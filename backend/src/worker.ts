import { config } from './config/env.js';

console.log('==============================================');
console.log('ReachInbox Email Scheduler - Worker Process');
console.log('Phase 1: Worker entry point ready.');
console.log(`Redis target: ${config.redisUrl}`);
console.log('==============================================');
