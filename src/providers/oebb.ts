import { ProviderResult } from "../core/types.js";
import {BaseProvider} from "../core/provider.js";
import {HttpClient} from "../core/httpClient.js";

export class OebbProvider extends BaseProvider {
    readonly name = 'OEBB';

    private _http = new HttpClient();

    constructor() {
        super();
    }

    async fetch(): Promise<ProviderResult> {
        return this.wrapFetch(this.name, async () => {
            const text = await this._http.fetchText('https://railnet.oebb.at/api/speed', {
                headers: {
                    'Accept': 'text/plain,*/*;q=0.9',
                }
            });

            const speed = Number(text);
            if (!Number.isFinite(speed)) {
                throw new Error('ÖBB: invalid numeric response');
            }

            return speed;
        });
    }

    destroy(): void {
        this._http.destroy();
    }
}
