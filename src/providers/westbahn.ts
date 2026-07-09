import {ProviderResult, SpeedProvider} from "../core/types.js";
import {HttpClient, SseEvent} from "../core/httpClient.js";
import GLib from "gi://GLib";
import {Logger} from "../core/logger.js";

const RECONNECT_DELAY_MS = 5_000;

export class WestbahnProvider implements SpeedProvider {
    readonly name = 'Westbahn';

    private _http = new HttpClient();
    private readonly _LOGGER = Logger.getInstance();

    private _trainId: string;
    private _lastSpeed: number | null = null;
    private _connected = false;
    private _connecting = false;
    private _cancelStream: (() => void) | null = null;
    private _reconnectTimeoutId: number | null = null;
    private _destroyed = false;

    constructor(trainId: string) {
        this._trainId = trainId;
        this._connect();
    }

    setTrainId(trainId: string): void {
        if (trainId === this._trainId) return;

        this._LOGGER.info(`${this.name}: train id changed to "${trainId}"`);
        this._trainId = trainId;
        this._teardownStream();
        this._lastSpeed = null;
        this._clearReconnectTimer();
        this._connect();
    }

    fetch(): { promise: Promise<ProviderResult>; cancel: () => void } {
        const promise = (async (): Promise<ProviderResult> => {
            if (!this._trainId) {
                throw new Error(`${this.name}: no train id configured`);
            }

            this._connect();

            if (!this._connected) {
                throw new Error(`${this.name}: disconnected`);
            }
            if (this._lastSpeed === null) {
                throw new Error(`${this.name}: no speed data yet`);
            }

            return {
                ok: true,
                speed: this._lastSpeed,
                latencyMs: 0,
                provider: this.name,
            };
        })();

        // no-op: the orchestrator cancels race losers every tick, but the SSE
        // connection must stay alive independently of any single fetch() call
        return {promise, cancel: () => {}};
    }

    destroy(): void {
        this._LOGGER.info(`${this.name}: destroy`);
        this._destroyed = true;
        this._teardownStream();
        this._clearReconnectTimer();
        this._http.destroy();
    }

    private async _connect(): Promise<void> {
        if (this._destroyed || this._connecting || this._connected || !this._trainId) return;
        this._connecting = true;

        try {
            const {cancel} = this._http.openEventStream(
                `https://rts.westbahn.at/train?trid=${encodeURIComponent(this._trainId)}`,
                {headers: {'Accept': 'text/event-stream'}},
                (evt) => this._handleEvent(evt),
                (err) => this._handleClose(err)
            );

            this._cancelStream = cancel;
            this._connected = true;
            this._LOGGER.info(`${this.name}: connected (trid=${this._trainId})`);
        } catch (e) {
            this._LOGGER.debug(`${this.name}: connect failed: ${e}, retrying in ${RECONNECT_DELAY_MS}ms`);
            this._scheduleReconnect();
        } finally {
            this._connecting = false;
        }
    }

    private _handleEvent(evt: SseEvent): void {
        if (evt.event !== 'speed') return;

        try {
            const speed = JSON.parse(evt.data)?.payload?.speed;
            if (Number.isFinite(speed)) {
                this._lastSpeed = speed;
                this._LOGGER.debug(`${this.name} speed: ${speed}`);
            }
        } catch (e) {
            this._LOGGER.warn(`${this.name}: bad frame: ${e}`);
        }
    }

    private _handleClose(err?: Error): void {
        this._connected = false;
        this._cancelStream = null;
        this._lastSpeed = null; // trip likely ended; drop stale speed

        if (this._destroyed) return;

        this._LOGGER.info(`${this.name}: stream closed${err ? `: ${err.message}` : ''}, reconnecting in ${RECONNECT_DELAY_MS}ms`);
        this._scheduleReconnect();
    }

    private _scheduleReconnect(): void {
        if (this._destroyed || this._reconnectTimeoutId !== null || !this._trainId) return;

        this._reconnectTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RECONNECT_DELAY_MS, () => {
            this._reconnectTimeoutId = null;
            this._connect();
            return GLib.SOURCE_REMOVE;
        });
    }

    private _clearReconnectTimer(): void {
        if (this._reconnectTimeoutId !== null) {
            GLib.source_remove(this._reconnectTimeoutId);
            this._reconnectTimeoutId = null;
        }
    }

    private _teardownStream(): void {
        this._cancelStream?.();
        this._cancelStream = null;
        this._connected = false;
    }
}
