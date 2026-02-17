export class IcePortalProvider {
    http;
    name = 'iceportal';
    constructor(http) {
        this.http = http;
    }
    async fetch() {
        const started = Date.now();
        try {
            const text = await this.http.get('https://iceportal.de/api1/rs/status', {
                'Accept': 'application/json',
            });
            const obj = JSON.parse(text);
            const speed = Number(obj?.speed);
            if (!Number.isFinite(speed)) {
                throw new Error('invalid speed');
            }
            return {
                ok: true,
                speed,
                latencyMs: Date.now() - started,
                provider: this.name,
            };
        }
        catch (e) {
            return {
                ok: false,
                error: e?.message ?? 'unknown error',
                latencyMs: Date.now() - started,
                provider: this.name,
            };
        }
    }
}
