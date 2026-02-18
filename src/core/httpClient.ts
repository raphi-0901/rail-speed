import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import {Logger} from "./logger.js";

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

    /**
     * Performs a GET request and returns the response body as text.
     *
     * @throws Error if HTTP status is not 200
     */
    public async fetchText(
        url: string,
        options: FetchOptions = {}
    ): Promise<string> {
        if (!this._session) {
            this._LOGGER.error(`HttpClient destroyed`);
            throw new Error('HttpClient destroyed');
        }

        const message = Soup.Message.new('GET', url);

        this._applyHeaders(message, options.headers);

        const bytes = await this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null
        );

        const status: number = message.get_status();
        const body: string = new TextDecoder()
            .decode(bytes.get_data() as unknown as ArrayBuffer)
            .trim();

        if (status !== Soup.Status.OK) {
            const reason: string =
                message.get_reason_phrase?.() ?? '';

            throw new Error(
                `HTTP ${status}${reason ? ` ${reason}` : ''}`
            );
        }

        return body;
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
