import { HttpClient, ProviderResult } from "../core/types.js";
import {BaseProvider} from "../core/provider.js";

export class OebbProvider extends BaseProvider {
    readonly name = 'OEBB';

    constructor(private readonly http: HttpClient) {
        super();
    }

    async fetch(): Promise<ProviderResult> {
        return this.wrapFetch(this.name, async () => {
            const text = await this.http.get('https://railnet.oebb.at/api/speed', {
                'Accept': 'text/plain,*/*;q=0.9',
            });

            const speed = Number(text);
            if (!Number.isFinite(speed)) {
                throw new Error('ÖBB: invalid numeric response');
            }

            return speed;
        });
    }
}
