import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from "gi://Gio";
import {Logger} from "./logger.js";
import Bytes = GLib.Bytes;

/**
 * Options for fetchText()
 */
export interface FetchOptions {
    headers?: Record<string, string>;
}

/**
 * Minimal HTTP client wrapper around Soup.Session
 */
export class HttpClient {
    private _session: Soup.Session | null;
    private readonly _LOGGER = Logger.getInstance();

    public constructor() {
        this._session = new Soup.Session();
    }

    /**
     * Cleanup resources
     */
    public destroy(): void {
        this._LOGGER.debug(`destroyed session: ${this._session}`);
        // In GJS we can't really "close" the session,
        // but we can drop the reference.
        // Marking as any avoids strict-null complaints.
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

        const promise = new Promise<string>(async (resolve, reject) => {
            if(!this._session) {
                return reject(new Error('HttpClient destroyed'));
            }

            try {
                const bytes = await this._session.send_and_read_async(
                    message,
                    GLib.PRIORITY_DEFAULT,
                    // @ts-ignore
                    cancellable
                ) as unknown as Bytes | undefined;

                if(!bytes) {
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
                reject(e);
            }
        });

        return {
            promise,
            cancel: () => {
                cancellable.cancel();
            },
        };
    }

    /**
     * Apply request headers safely
     */
    private _applyHeaders(
        message: Soup.Message,
        headers?: Record<string, string>
    ): void {
        if (!headers) {
            return;
        }

        const h = message.get_request_headers();

        for (const [key, value] of Object.entries(headers)) {
            if (value !== undefined && value !== null) {
                h.replace(key, value);
            }
        }
    }
}
