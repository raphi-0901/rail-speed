import {ProviderResult, SpeedProvider} from "../core/types.js";
import {HttpClient} from "../core/httpClient.js";
import GLib from "gi://GLib";
import {Logger} from "../core/logger.js";

export class IcePortalProvider implements SpeedProvider {
    readonly name = 'ICE';

    private _http = new HttpClient();

    private readonly _LOGGER = Logger.getInstance();

    /**
     * New method: abortable fetch for orchestrator
     */
    fetch(): { promise: Promise<ProviderResult>; cancel: () => void } {
        const {promise, cancel} = this._http.fetchText('https://iceportal.de/api1/rs/status', {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                // Without this the API returns 403
                'User-Agent':
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            }
        });

        const wrappedPromise = (async (): Promise<ProviderResult> => {
            try {
                const startMicroSeconds = GLib.get_monotonic_time()
                const text = await promise;
                let obj: any;
                try {
                    obj = JSON.parse(text);
                } catch {
                    this._LOGGER.debug(`invalid JSON from ICEPortal: ${text}`);

                    throw new Error('ICE: invalid JSON');
                }

                const speed = Number(obj?.speed);
                if (!Number.isFinite(speed)) {
                    throw new Error('ICE: missing/invalid "speed"');
                }

                this._LOGGER.debug(`ICE speed: ${speed}`);

                return {
                    ok: true,
                    speed,
                    latencyMs: Math.floor((GLib.get_monotonic_time() - startMicroSeconds) / 1000),
                    provider: this.name
                }
            } catch (e) {
                throw e; // allow orchestrator to catch & apply backoff
            }
        })();

        return {promise: wrappedPromise, cancel};
    }

    destroy(): void {
        this._LOGGER.info(`${this.name}: destroy`);
        this._http.destroy();
    }
}
