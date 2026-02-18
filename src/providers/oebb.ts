import {ProviderResult, SpeedProvider} from "../core/types.js";
import {HttpClient} from "../core/httpClient.js";
import GLib from "gi://GLib";
import {Logger} from "../core/logger.js";

export class OebbProvider implements SpeedProvider {
    readonly name = 'OEBB';

    private _http = new HttpClient();

    private readonly _LOGGER = Logger.getInstance();

    /**
     * New method: abortable fetch for orchestrator
     */
    fetch(): { promise: Promise<ProviderResult>; cancel: () => void } {
        const {promise, cancel} = this._http.fetchText('https://railnet.oebb.at/api/speed', {
            headers: {'Accept': 'text/plain,*/*;q=0.9'},
        });

        const wrappedPromise = (async (): Promise<ProviderResult> => {
            try {
                const startMicroSeconds = GLib.get_monotonic_time()
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
