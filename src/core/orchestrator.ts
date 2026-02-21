import { SpeedProvider } from './types.js'
import { ExponentialBackoff } from './backoff.js'
import GLib from "gi://GLib";
import {Logger} from "./logger.js";

export type OrchestratorResult = {
    ok: true
    speed: number
    provider: string
    latency: number
    timestamp: number
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
        const startMicroSeconds = GLib.get_monotonic_time();
        let soonest: number | null = null;

        // 1️⃣ Filter allowed providers and prepare tasks
        const tasks: {
            entry: { provider: SpeedProvider; backoff: ExponentialBackoff };
            cancel: () => void;
            promise: Promise<OrchestratorResult>;
        }[] = [];

        for (const entry of this.entries) {
            const { provider, backoff } = entry;

            if (!backoff.isAllowed(startMicroSeconds)) {
                const wait = backoff.secondsUntilAllowed(startMicroSeconds);
                this._LOGGER.info(
                    `provider skip -> ${provider.name} (backoff ${wait}s)`
                );
                soonest = soonest === null ? wait : Math.min(soonest, wait);
                continue;
            }

            this._LOGGER.info(`provider try  -> ${provider.name}`);

            // Each provider should return a cancelable task
            const { promise, cancel } = provider.fetch();

            // Wrap promise to handle backoff & orchestrator result
            const wrappedPromise = (async (): Promise<OrchestratorResult> => {
                try {
                    const result = await promise;

                    if (result.ok && result.speed !== null) {
                        backoff.markSuccess();

                        const deltaMs = Math.round(
                            (GLib.get_monotonic_time() - startMicroSeconds) / 1000
                        );

                        this._LOGGER.info(
                            `provider ok   <- ${provider.name} (${deltaMs}ms)`
                        );

                        return {
                            ok: true,
                            speed: result.speed,
                            provider: result.provider,
                            latency: result.latencyMs,
                            timestamp: GLib.get_monotonic_time() / 1000
                        };
                    }

                    // Failure counts as "did not succeed"
                    backoff.markFailure(startMicroSeconds);
                    throw new Error("provider failed");
                } catch {
                    backoff.markFailure(startMicroSeconds);
                    throw new Error("provider failed");
                }
            })();

            tasks.push({ entry, promise: wrappedPromise, cancel });
        }

        // 2️⃣ No allowed providers? Return nextWake
        if (tasks.length === 0) {
            return { ok: false, nextWake: 1 };
        }

        // 3️⃣ Race tasks with Promise.any
        try {
            const firstResult = await Promise.any(tasks.map(t => t.promise));

            // Cancel all remaining tasks to stop network requests
            for (const t of tasks) t.cancel();

            return firstResult;
        } catch {
            // All failed
            throw new Error("All providers failed.")
        }
    }
}
