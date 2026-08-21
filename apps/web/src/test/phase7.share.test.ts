import { describe, expect, it } from 'vitest';
import { retryDelay } from '../infrastructure/sync/sync.engine';
describe('Phase 7 share contracts',()=>{it('has bounded retry schedule',()=>expect([1,2,5,10,30,60,300]).toEqual([retryDelay(1)/1000,retryDelay(2)/1000,retryDelay(3)/1000,retryDelay(4)/1000,retryDelay(5)/1000,retryDelay(6)/1000,retryDelay(7)/1000]));});
