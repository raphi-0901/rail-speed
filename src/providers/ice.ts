import { ProviderResult } from "../core/types.js";
import {BaseProvider} from "../core/provider.js";
import {HttpClient} from "../core/httpClient.js";

export class IcePortalProvider extends BaseProvider {
    readonly name = 'ICEPortal';

    constructor(private readonly http: HttpClient) {
        super();
    }

    async fetch(): Promise<ProviderResult> {
        return this.wrapFetch(this.name, async () => {
            const text = await this.http.fetchText('https://iceportal.de/api1/rs/status', {
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    // Without this the API returns 403
                    'User-Agent':
                        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
                        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                }
            });

            let obj: any;
            try {
                obj = JSON.parse(text);
            } catch {
                throw new Error('ICE: invalid JSON');
            }

            const speed = Number(obj?.speed);
            if (!Number.isFinite(speed)) {
                throw new Error('ICE: missing/invalid "speed"');
            }

            return speed;
        });
    }
}
