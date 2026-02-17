import St from 'gi://St';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import Clutter from 'gi://Clutter';

// Refresh
const FAST_REFRESH = 1;    // seconds

// Backoff settings (only when *all* providers fail)
const SLOW_INITIAL = 2;    // seconds after 1st failure
const SLOW_MAX = 60;       // max seconds
const BACKOFF_FACTOR = 2;  // exponential growth

const EXT_TAG = '[rail-speed]';

function nowTs() {
    return new Date().toISOString();
}

function logI(msg) {
    log(`${EXT_TAG} ${nowTs()} INFO  ${msg}`);
}

function logW(msg) {
    log(`${EXT_TAG} ${nowTs()} WARN  ${msg}`);
}

function logE(err, context = '') {
    if (context) {
        logError(err, `${EXT_TAG} ${nowTs()} ERROR ${context}`);
    } else {
        logError(err, `${EXT_TAG} ${nowTs()} ERROR`);
    }
}

function clip(s, n = 240) {
    if (typeof s !== 'string') {
        s = String(s);
    }
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default class TextFetchExtension extends Extension {
    _resetAllBackoffs(reason = '') {
        if (!this._providers) {
            return;
        }

        for (const [url, provider] of this._providers.entries()) {
            if (provider?.state) {
                provider.state.failCount = 0;
                provider.state.nextAllowedUs = 0;
            }
        }

        logI(`backoffs reset${reason ? ` (${reason})` : ''}`);

        // Wake quickly after network changes
        if (this._currentInterval !== FAST_REFRESH)
            this._restartTimer(FAST_REFRESH);
    }

    enable() {
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });

        Main.panel._centerBox.insert_child_at_index(this._label, 0);

        this._session = new Soup.Session();

        this._timer = null;
        this._currentInterval = FAST_REFRESH;
        this._failCount = 0;

        this._netmon = Gio.NetworkMonitor.get_default();
        this._netmonChangedId = this._netmon.connect('network-changed', (_mon, available) => {
            logI(`network-changed: available=${available}`);
            this._resetAllBackoffs('network-changed');

            // Optionally trigger an immediate update (don’t await in signal handler)
            this._update().catch(e => logE(e, '_update() unhandled (network-changed)'));
        });

        /**
         * Provider registry: url -> { fetch, parse }
         * - fetch(text): fetches raw response text (can set headers, etc.)
         * - parse(text): returns speed (number km/h) or throws
         */
        this._providers = new Map([
            [
                'https://railnet.oebb.at/api/speed',
                {
                    fetch: () => this._fetchText('https://railnet.oebb.at/api/speed', {
                        headers: {
                            'Accept': 'text/plain,*/*;q=0.9',
                        },
                    }),
                    parse: this._handleOebbSpeed.bind(this),
                },
            ],
            [
                'https://iceportal.de/api1/rs/status',
                {
                    fetch: () => this._fetchText('https://iceportal.de/api1/rs/status', {
                        headers: {
                            'Accept': 'application/json, text/plain, */*',
                            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                            // otherwise, the api returns 403
                            'User-Agent':
                                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
                                '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache',
                        },
                    }),
                    parse: this._handleIcePortalStatus.bind(this),
                },
            ],
        ]);

        this._providerUrls = Array.from(this._providers.keys());

        logI(`enabled; providers=${this._providerUrls.length}; fast_refresh=${FAST_REFRESH}s`);
        this._restartTimer(FAST_REFRESH);

        // Never call async without catch() from enable/timers
        this._update().catch(e => logE(e, '_update() unhandled (enable)'));
    }

    disable() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }

        if (this._label) {
            this._label.destroy();
            this._label = null;
        }

        if (this._netmonChangedId && this._netmon) {
            this._netmon.disconnect(this._netmonChangedId);
            this._netmonChangedId = 0;
        }
        this._netmon = null;

        this._session = null;
        this._providers = null;
        this._providerUrls = null;

        logI('disabled');
    }

    _restartTimer(seconds) {
        if (this._timer) {
            GLib.source_remove(this._timer);
        }

        this._timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            seconds,
            () => {
                this._update().catch(e => logE(e, '_update() unhandled (timer)'));
                return GLib.SOURCE_CONTINUE;
            }
        );

        if (this._currentInterval !== seconds) {
            logI(`timer interval -> ${seconds}s`);
        }

        this._currentInterval = seconds;
    }

    _nextBackoffSeconds() {
        const exponent = Math.min(this._failCount - 1, 30);
        const secs = SLOW_INITIAL * Math.pow(BACKOFF_FACTOR, Math.max(0, exponent));
        return Math.min(SLOW_MAX, Math.round(secs));
    }

    _applyHeaders(message, headers) {
        if (!headers) {
            return;
        }

        const h = message.get_request_headers();
        for (const [k, v] of Object.entries(headers)) {
            if (v === undefined || v === null) {
                continue;
            }
            h.replace(k, String(v));
        }
    }

    async _fetchText(url, opts = {}) {
        const message = Soup.Message.new('GET', url);

        this._applyHeaders(message, opts.headers);

        const bytes = await this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null
        );

        const status = message.get_status();
        const body = new TextDecoder().decode(bytes.get_data()).trim();

        if (status !== Soup.Status.OK) {
            const reason = message.get_reason_phrase?.() ?? '';
            // This is the key: often the server tells you WHY in the body
            logW(`HTTP ${status} ${reason} from ${url}; body="${clip(body)}"`);
            throw new Error(`HTTP ${status} ${reason}`.trim());
        }

        return body;
    }

    // Provider parsers
    _handleOebbSpeed(text) {
        const v = Number(text);
        if (!Number.isFinite(v)) {
            throw new Error('ÖBB: invalid numeric response');
        }
        return v;
    }

    _handleIcePortalStatus(text) {
        // Your sample response: top-level "speed": 0.0
        let obj;
        try {
            obj = JSON.parse(text);
        } catch {
            throw new Error('ICE: invalid JSON');
        }

        const v = Number(obj?.speed);
        if (!Number.isFinite(v)) {
            throw new Error('ICE: missing/invalid "speed"');
        }

        return v;
    }

    async _tryProvidersOnce() {
        const started = Date.now();

        for (const url of this._providerUrls) {
            const provider = this._providers.get(url);
            if (!provider) {
                continue;
            }

            const t0 = Date.now();
            logI(`provider try -> ${url}`);

            try {
                const text = await provider.fetch();
                const speed = provider.parse(text);

                if (!Number.isFinite(speed)) {
                    throw new Error('Parsed speed is not finite');
                }

                const dt = Date.now() - t0;
                logI(`provider ok  <- ${url} (${dt}ms) speed=${speed}`);

                return {
                    ok: true,
                    speed,
                    url,
                    ms: Date.now() - started
                };
            } catch (e) {
                const dt = Date.now() - t0;
                logW(`provider fail<- ${url} (${dt}ms) (trying next)`);
                logE(e, `provider error: ${url}`);
                // swallow and continue
            }
        }

        return {
            ok: false,
            ms: Date.now() - started
        };
    }

    async _update() {
        const result = await this._tryProvidersOnce();

        if (result.ok) {
            this._label.set_text(`🚆 ${result.speed} km/h`);

            if (this._failCount !== 0) {
                logI(`recovered after ${this._failCount} full-failure cycle(s)`);
            }

            this._failCount = 0;

            if (this._currentInterval !== FAST_REFRESH)
                this._restartTimer(FAST_REFRESH);

            return;
        }

        // only if ALL failed
        this._label.set_text('');

        this._failCount += 1;
        const next = this._nextBackoffSeconds();

        logW(`all providers failed (cycle=${this._failCount}, elapsed=${result.ms}ms) -> backoff ${next}s`);

        if (this._currentInterval !== next)
            this._restartTimer(next);
    }
}

