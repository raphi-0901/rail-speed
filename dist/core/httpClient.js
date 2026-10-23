import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from "gi://Gio";
import { Logger } from "./logger.js";
const DEFAULT_TIMEOUT_MS = 1_000;
// @ts-ignore GJS doesn't auto-promisify Soup.Session.send_async; register it explicitly.
Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
export class HttpClient {
    _session;
    _LOGGER = Logger.getInstance();
    constructor() {
        this._session = new Soup.Session();
    }
    destroy() {
        this._LOGGER.debug(`destroyed session: ${this._session}`);
        this._session = null;
    }
    fetchText(url, options = {}) {
        if (!this._session) {
            throw new Error('HttpClient destroyed');
        }
        const message = Soup.Message.new('GET', url);
        this._applyHeaders(message, options.headers);
        const cancellable = new Gio.Cancellable();
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const cancel = () => cancellable.cancel();
        const promise = new Promise(async (resolve, reject) => {
            if (!this._session) {
                return reject(new Error('HttpClient destroyed'));
            }
            // --- Timeout race ---
            let timeoutSourceId = null;
            const timeoutPromise = new Promise((_, rejectTimeout) => {
                timeoutSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                    cancellable.cancel(); // abort the request
                    rejectTimeout(new Error(`Request timed out after ${timeoutMs}ms`));
                    return GLib.SOURCE_REMOVE;
                });
            });
            const clearTimeout = () => {
                if (timeoutSourceId !== null) {
                    GLib.source_remove(timeoutSourceId);
                    timeoutSourceId = null;
                }
            };
            try {
                const bytes = await Promise.race([
                    this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, 
                    // @ts-ignore
                    cancellable),
                    timeoutPromise,
                ]);
                clearTimeout();
                if (!bytes) {
                    return reject(new Error('No response from server'));
                }
                const status = message.get_status();
                const body = new TextDecoder()
                    .decode(bytes.get_data())
                    .trim();
                if (status !== Soup.Status.OK) {
                    const reason = message.get_reason_phrase?.() ?? '';
                    reject(new Error(`HTTP ${status}${reason ? ` ${reason}` : ''}`));
                }
                else {
                    resolve(body);
                }
            }
            catch (e) {
                clearTimeout();
                reject(e);
            }
        });
        return { promise, cancel };
    }
    openEventStream(url, options, onEvent, onClose) {
        if (!this._session) {
            throw new Error('HttpClient destroyed');
        }
        const message = Soup.Message.new('GET', url);
        this._applyHeaders(message, options.headers);
        const cancellable = new Gio.Cancellable();
        const cancel = () => cancellable.cancel();
        (async () => {
            if (!this._session) {
                onClose(new Error('HttpClient destroyed'));
                return;
            }
            try {
                const stream = await this._session.send_async(message, GLib.PRIORITY_DEFAULT, 
                // @ts-ignore
                cancellable);
                const status = message.get_status();
                if (status !== Soup.Status.OK) {
                    const reason = message.get_reason_phrase?.() ?? '';
                    onClose(new Error(`HTTP ${status}${reason ? ` ${reason}` : ''}`));
                    return;
                }
                const decoder = new TextDecoder();
                let buffer = '';
                for await (const bytes of stream.createAsyncIterator(4096)) {
                    buffer += decoder.decode(bytes.toArray());
                    let boundary;
                    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                        const frame = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        this._parseSseFrame(frame, onEvent);
                    }
                }
                onClose();
            }
            catch (e) {
                onClose(e);
            }
        })();
        return { cancel };
    }
    _parseSseFrame(frame, onEvent) {
        let event;
        let id;
        const dataLines = [];
        for (const rawLine of frame.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            if (line === '' || line.startsWith(':'))
                continue;
            const colonIndex = line.indexOf(':');
            const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
            const value = colonIndex === -1 ? '' : line.slice(colonIndex + 1).replace(/^ /, '');
            if (field === 'event')
                event = value;
            else if (field === 'id')
                id = value;
            else if (field === 'data')
                dataLines.push(value);
        }
        if (dataLines.length > 0) {
            onEvent({ event: event ?? 'message', id, data: dataLines.join('\n') });
        }
    }
    _applyHeaders(message, headers) {
        if (!headers)
            return;
        const h = message.get_request_headers();
        for (const [key, value] of Object.entries(headers)) {
            if (value !== undefined && value !== null) {
                h.replace(key, value);
            }
        }
    }
}
