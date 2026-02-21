import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from "gi://Gio";
import {Logger} from "./logger.js";
import Bytes = GLib.Bytes;

export interface FetchOptions {
    headers?: Record<string, string>;
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1_000;

export class HttpClient {
    private _session: Soup.Session | null;
    private readonly _LOGGER = Logger.getInstance();

    public constructor() {
        this._session = new Soup.Session();
    }

    public destroy(): void {
        this._LOGGER.debug(`destroyed session: ${this._session}`);
        this._session = null;
    }

    public fetchText(
        url: string,
        options: FetchOptions = {}
    ): { promise: Promise<string>; cancel: () => void } {
        if (!this._session) {
            throw new Error('HttpClient destroyed');
        }

        const message = Soup.Message.new('GET', url);
        this._applyHeaders(message, options.headers);

        const cancellable = new Gio.Cancellable();
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        const cancel = () => cancellable.cancel();

        const promise = new Promise<string>(async (resolve, reject) => {
            if (!this._session) {
                return reject(new Error('HttpClient destroyed'));
            }

            // --- Timeout race ---
            let timeoutSourceId: number | null = null;

            const timeoutPromise = new Promise<never>((_, rejectTimeout) => {
                timeoutSourceId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    timeoutMs,
                    () => {
                        cancellable.cancel();            // abort the request
                        rejectTimeout(new Error(`Request timed out after ${timeoutMs}ms`));
                        return GLib.SOURCE_REMOVE;
                    }
                );
            });

            const clearTimeout = () => {
                if (timeoutSourceId !== null) {
                    GLib.source_remove(timeoutSourceId);
                    timeoutSourceId = null;
                }
            };

            try {
                const bytes = await Promise.race([
                    this._session.send_and_read_async(
                        message,
                        GLib.PRIORITY_DEFAULT,
                        // @ts-ignore
                        cancellable
                    ),
                    timeoutPromise,
                ]) as unknown as Bytes | undefined;

                clearTimeout();

                if (!bytes) {
                    return reject(new Error('No response from server'));
                }

                const status = message.get_status();
                const body = new TextDecoder()
                    .decode(bytes.get_data() as unknown as ArrayBuffer)
                    .trim();

                if (status !== Soup.Status.OK) {
                    const reason = message.get_reason_phrase?.() ?? '';
                    reject(new Error(`HTTP ${status}${reason ? ` ${reason}` : ''}`));
                } else {
                    resolve(body);
                }
            } catch (e) {
                clearTimeout();
                reject(e);
            }
        });

        return { promise, cancel };
    }

    private _applyHeaders(
        message: Soup.Message,
        headers?: Record<string, string>
    ): void {
        if (!headers) return;

        const h = message.get_request_headers();
        for (const [key, value] of Object.entries(headers)) {
            if (value !== undefined && value !== null) {
                h.replace(key, value);
            }
        }
    }
}
