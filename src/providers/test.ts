import {ProviderResult, SpeedProvider} from "../core/types.js";
import {HttpClient} from "../core/httpClient.js";
import GLib from "gi://GLib";
import {Logger} from "../core/logger.js";

export class TestProvider implements SpeedProvider {
    readonly name = 'TEST';

    private _http = new HttpClient();

    private readonly _LOGGER = Logger.getInstance();

    /**
     * New method: abortable fetch for orchestrator
     */
    fetch(): { promise: Promise<ProviderResult>; cancel: () => void } {
        const {promise, cancel} = this._http.fetchText('https://dummyjson.com/c/8e53-5ce8-4a29-ba8e');

        const wrappedPromise = (async (): Promise<ProviderResult> => {
            try {
                const startMicroSeconds = GLib.get_monotonic_time()
                const text = await promise;
                const speed = Number(text);

                if (!Number.isFinite(speed)) {
                    throw new Error('Test: invalid numeric response');
                }

                this._LOGGER.debug(`Test speed: ${speed}`);
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
