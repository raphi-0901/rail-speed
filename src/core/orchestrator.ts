import { SpeedProvider } from './types.js'
import { ExponentialBackoff } from './backoff.js'
import GLib from "gi://GLib";
import {Logger} from "./logger.js";

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

    private readonly _LOGGER = Logger.getInstance()

    constructor(
        providers: SpeedProvider[]
    ) {
        this.entries = providers.map(p => ({
            provider: p,
            backoff: new ExponentialBackoff(2, 60, 2),
        }))

        this._LOGGER.info(`orchestrator created; providers=${this.entries.length}: ${this.entries.map(e => e.provider.name).join(',')}`)
    }

    resetAll(): void {
        this._LOGGER.info(`reset backoff for all providers.`)

        for (const e of this.entries) {
            e.backoff.markSuccess()
        }
    }

    destroy(): void {
        this._LOGGER.info(`orchestrator destroy`)

        for (const e of this.entries) {
            e.provider.destroy()
        }
    }

    async tryOnce(): Promise<OrchestratorResult> {
        const startMicroSeconds = GLib.get_monotonic_time()
        let soonest: number | null = null

        for (const entry of this.entries) {
            const { provider, backoff } = entry

            if (!backoff.isAllowed(startMicroSeconds)) {
                const wait = backoff.secondsUntilAllowed(startMicroSeconds)
                this._LOGGER.info(
                    `provider skip -> ${provider.name} (backoff ${wait}s)`
                )

                soonest = soonest === null ? wait : Math.min(soonest, wait)
                continue
            }

            this._LOGGER.info(`provider try  -> ${provider.name}`)
            const result = await provider.fetch()
            const endMicroSeconds = GLib.get_monotonic_time()
            const deltaMs = Math.round((endMicroSeconds - startMicroSeconds) / 1000)

            if (result.ok && result.speed !== null) {
                backoff.markSuccess()

                this._LOGGER.info(
                    `provider ok   <- ${provider.name} (${deltaMs}ms) speed=${result.speed}`
                )

                return {
                    ok: true,
                    speed: result.speed,
                    provider: result.provider,
                    latency: result.latencyMs,
                }
            }

            backoff.markFailure(startMicroSeconds)
        }

        return {
            ok: false,
            nextWake: soonest ?? 60
        }
    }
}
