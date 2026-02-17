export class BaseProvider {
    async wrapFetch(providerName, fetchFn) {
        const start = Date.now();
        try {
            const speed = await fetchFn();
            if (!Number.isFinite(speed)) {
                throw new Error('invalid speed');
            }
            return {
                ok: true,
                speed,
                latencyMs: Date.now() - start,
                provider: providerName
            };
        }
        catch (e) {
            return {
                ok: false,
                error: e?.message ?? 'unknown',
                latencyMs: Date.now() - start,
                provider: providerName
            };
        }
    }
}
//# sourceMappingURL=provider.js.map