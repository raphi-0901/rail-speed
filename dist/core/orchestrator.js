import { ExponentialBackoff } from './backoff';
export class SpeedOrchestrator {
    time;
    entries;
    constructor(providers, time) {
        this.time = time;
        this.entries = providers.map(p => ({
            provider: p,
            backoff: new ExponentialBackoff(2, 60, 2),
        }));
    }
    resetAll() {
        for (const e of this.entries) {
            e.backoff.markSuccess();
        }
    }
    async tryOnce() {
        const nowUs = this.time.nowUs();
        let soonest = null;
        for (const entry of this.entries) {
            const { provider, backoff } = entry;
            if (!backoff.isAllowed(nowUs)) {
                const wait = backoff.secondsUntilAllowed(nowUs);
                soonest = soonest === null ? wait : Math.min(soonest, wait);
                continue;
            }
            const result = await provider.fetch();
            if (result.ok && result.speed !== null) {
                backoff.markSuccess();
                return {
                    ok: true,
                    speed: result.speed,
                    provider: result.provider,
                    latency: result.latencyMs,
                };
            }
            backoff.markFailure(nowUs);
        }
        return {
            ok: false,
            nextWake: soonest ?? 60
        };
    }
}
