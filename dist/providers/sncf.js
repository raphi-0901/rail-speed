import { HttpClient } from "../core/httpClient.js";
import GLib from "gi://GLib";
import { Logger } from "../core/logger.js";
export class SncfProvider {
    name = 'SNCF';
    _http = new HttpClient();
    _LOGGER = Logger.getInstance();
    /**
     * New method: abortable fetch for orchestrator
     */
    fetch() {
        const { promise, cancel } = this._http.fetchText('https://wifi.sncf/router/api/train/gps', {
            headers: { 'Accept': 'application/json, text/plain, */*' },
        });
        const wrappedPromise = (async () => {
            try {
                const startMicroSeconds = GLib.get_monotonic_time();
                const text = await promise;
                let obj;
                try {
                    obj = JSON.parse(text);
                }
                catch {
                    this._LOGGER.debug(`invalid JSON from ${this.name}: ${text}`);
                    throw new Error(`${this.name}: invalid JSON`);
                }
                // API reports m/s
                const metersPerSecond = obj?.speed;
                if (typeof metersPerSecond !== 'number' || !Number.isFinite(metersPerSecond)) {
                    throw new Error(`${this.name}: missing/invalid "speed"`);
                }
                const speed = Math.round(metersPerSecond * 3.6);
                this._LOGGER.debug(`${this.name} speed: ${speed}`);
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
    reset() {
        this._http.reset();
    }
    destroy() {
        this._LOGGER.info(`${this.name}: destroy`);
        this._http.destroy();
    }
}
