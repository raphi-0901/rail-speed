import {ProviderResult, SpeedProvider} from "./types";

export abstract class BaseProvider implements SpeedProvider {
    abstract readonly name: string

    abstract fetch(): Promise<ProviderResult>

    protected async wrapFetch(providerName: string, fetchFn: () => Promise<number>): Promise<ProviderResult> {
        const start = Date.now()
        try {
            const speed = await fetchFn()
            if (!Number.isFinite(speed)) {
                throw new Error('invalid speed')
            }

            return {
                ok: true,
                speed,
                latencyMs: Date.now() - start,
                provider: providerName
            }
        } catch (e: any) {
            return {
                ok: false,
                error: e?.message ?? 'unknown',
                latencyMs: Date.now() - start,
                provider: providerName
            }
        }
    }
}
