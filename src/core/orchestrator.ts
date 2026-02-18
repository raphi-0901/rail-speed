import { SpeedProvider } from './types.js'
import { ExponentialBackoff } from './backoff.js'
import GLib from "gi://GLib";

export type OrchestratorResult = {
    ok: true
    speed: number
    provider: string
    latency: number
} | {
    ok: false
    nextWake: number
}

export class SpeedOrchestrator {
    private readonly entries: {
        provider: SpeedProvider
        backoff: ExponentialBackoff
    }[]

    constructor(
        providers: SpeedProvider[]
    ) {
        this.entries = providers.map(p => ({
            provider: p,
            backoff: new ExponentialBackoff(2, 60, 2),
        }))
    }

    resetAll(): void {
        for (const e of this.entries) {
            e.backoff.markSuccess()
        }
    }

    destroy(): void {
        for (const e of this.entries) {
            e.provider.destroy()
        }
    }

    async tryOnce(): Promise<OrchestratorResult> {
        const nowUs = GLib.get_monotonic_time()
        let soonest: number | null = null

        for (const entry of this.entries) {
            const { provider, backoff } = entry

            if (!backoff.isAllowed(nowUs)) {
                const wait = backoff.secondsUntilAllowed(nowUs)
                soonest = soonest === null ? wait : Math.min(soonest, wait)
                continue
            }

            const result = await provider.fetch()

            if (result.ok && result.speed !== null) {
                backoff.markSuccess()
                return {
                    ok: true,
                    speed: result.speed,
                    provider: result.provider,
                    latency: result.latencyMs,
                }
            }

            backoff.markFailure(nowUs)
        }

        return {
            ok: false,
            nextWake: soonest ?? 60
        }
    }
}
