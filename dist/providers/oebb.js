import { HttpClient } from "../core/httpClient.js";
import GLib from "gi://GLib";
import { Logger } from "../core/logger.js";
export class OebbProvider {
    name = 'OEBB';
    _http = new HttpClient();
    _LOGGER = Logger.getInstance();
    /**
     * New method: abortable fetch for orchestrator
     */
    fetch() {
        const { promise, cancel } = this._http.fetchText('https://railnet.oebb.at/api/speed', {
            headers: { 'Accept': 'text/plain,*/*;q=0.9' },
        });
        const wrappedPromise = (async () => {
            try {
                const startMicroSeconds = GLib.get_monotonic_time();
                const text = await promise;
                const speed = Number(text);
                if (!Number.isFinite(speed)) {
                    throw new Error('OEBB: invalid numeric response');
                }
                this._LOGGER.debug(`OEBB speed: ${speed}`);
                return {
                    ok: true,
                    speed,
                    latencyMs: Math.floor((GLib.get_monotonic_time() - startMicroSeconds) / 1000),
                    provider: this.name
                };
            }
            catch (e) {
                throw e; // allow orchestrator to catch & apply backoff
            }
        })();
        return { promise: wrappedPromise, cancel };
    }
    destroy() {
        this._LOGGER.info(`${this.name}: destroy`);
        this._http.destroy();
    }
}
