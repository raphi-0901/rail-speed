import { HttpClient } from "../core/httpClient.js";
import GLib from "gi://GLib";
import { Logger } from "../core/logger.js";
const RECONNECT_DELAY_MS = 5_000;
export class WestbahnProvider {
    name = 'Westbahn';
    _http = new HttpClient();
    _LOGGER = Logger.getInstance();
    _trainId;
    _lastSpeed = null;
    _connected = false;
    _connecting = false;
    _cancelStream = null;
    _reconnectTimeoutId = null;
    _destroyed = false;
    constructor(trainId) {
        this._trainId = trainId;
        this._connect();
    }
    setTrainId(trainId) {
        if (trainId === this._trainId)
            return;
        this._LOGGER.info(`${this.name}: train id changed to "${trainId}"`);
        this._trainId = trainId;
        this._teardownStream();
        this._lastSpeed = null;
        this._clearReconnectTimer();
        this._connect();
    }
    fetch() {
        const promise = (async () => {
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
        return { promise, cancel: () => { } };
    }
    destroy() {
        this._LOGGER.info(`${this.name}: destroy`);
        this._destroyed = true;
        this._teardownStream();
        this._clearReconnectTimer();
        this._http.destroy();
    }
    async _connect() {
        if (this._destroyed || this._connecting || this._connected || !this._trainId)
            return;
        this._connecting = true;
        try {
            const { cancel } = this._http.openEventStream(`https://rts.westbahn.at/train?trid=${encodeURIComponent(this._trainId)}`, { headers: { 'Accept': 'text/event-stream' } }, (evt) => this._handleEvent(evt), (err) => this._handleClose(err));
            this._cancelStream = cancel;
            this._connected = true;
            this._LOGGER.info(`${this.name}: connected (trid=${this._trainId})`);
        }
        catch (e) {
            this._LOGGER.debug(`${this.name}: connect failed: ${e}, retrying in ${RECONNECT_DELAY_MS}ms`);
            this._scheduleReconnect();
        }
        finally {
            this._connecting = false;
        }
    }
    _handleEvent(evt) {
        if (evt.event !== 'speed')
            return;
        try {
            const speed = JSON.parse(evt.data)?.payload?.speed;
            if (Number.isFinite(speed)) {
                this._lastSpeed = speed;
                this._LOGGER.debug(`${this.name} speed: ${speed}`);
            }
        }
        catch (e) {
            this._LOGGER.warn(`${this.name}: bad frame: ${e}`);
        }
    }
    _handleClose(err) {
        this._connected = false;
        this._cancelStream = null;
        this._lastSpeed = null; // trip likely ended; drop stale speed
        if (this._destroyed)
            return;
        this._LOGGER.info(`${this.name}: stream closed${err ? `: ${err.message}` : ''}, reconnecting in ${RECONNECT_DELAY_MS}ms`);
        this._scheduleReconnect();
    }
    _scheduleReconnect() {
        if (this._destroyed || this._reconnectTimeoutId !== null || !this._trainId)
            return;
        this._reconnectTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RECONNECT_DELAY_MS, () => {
            this._reconnectTimeoutId = null;
            this._connect();
            return GLib.SOURCE_REMOVE;
        });
    }
    _clearReconnectTimer() {
        if (this._reconnectTimeoutId !== null) {
            GLib.source_remove(this._reconnectTimeoutId);
            this._reconnectTimeoutId = null;
        }
    }
    _teardownStream() {
        this._cancelStream?.();
        this._cancelStream = null;
        this._connected = false;
    }
}
