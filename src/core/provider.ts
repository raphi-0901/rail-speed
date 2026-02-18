import {type ProviderResult } from "./types.js";
import {SpeedProvider} from "./types.js";
import {Logger} from "./logger.js";
import GLib from "gi://GLib";

export abstract class BaseProvider implements SpeedProvider {

    protected readonly _LOGGER = Logger.getInstance()

    abstract readonly name: string

    abstract destroy(): void

    abstract fetch(): Promise<ProviderResult>

    protected async wrapFetch(providerName: string, fetchFn: () => Promise<number>): Promise<ProviderResult> {
        const start = GLib.get_monotonic_time()

        try {
            const speed = await fetchFn()
            if (!Number.isFinite(speed)) {
                this._LOGGER.debug(`invalid speed from ${providerName}: ${speed}`)
                throw new Error('invalid speed')
            }

            return {
                ok: true,
                speed,
                latencyMs: Math.floor((GLib.get_monotonic_time() - start) / 1000),
                provider: providerName
            }
        } catch (e: any) {
            this._LOGGER.error(e, `fetch from ${providerName} failed`)

            return {
                ok: false,
                error: e?.message ?? 'unknown',
                latencyMs: Math.floor((GLib.get_monotonic_time() - start) / 1000),
                provider: providerName
            }
        }
    }
}
