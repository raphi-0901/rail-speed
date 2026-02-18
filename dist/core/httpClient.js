import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
export class HttpClient {
    _session;
    constructor() {
        this._session = new Soup.Session();
    }
    destroy() {
        this._session = null;
    }
    async fetchText(url, options = {}) {
        if (!this._session) {
            throw new Error('HttpClient destroyed');
        }
        const message = Soup.Message.new('GET', url);
        this._applyHeaders(message, options.headers);
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        const status = message.get_status();
        const body = new TextDecoder()
            .decode(bytes.get_data())
            .trim();
        if (status !== Soup.Status.OK) {
            const reason = message.get_reason_phrase?.() ?? '';
            throw new Error(`HTTP ${status}${reason ? ` ${reason}` : ''}`);
        }
        return body;
    }
    _applyHeaders(message, headers) {
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
//# sourceMappingURL=httpClient.js.map