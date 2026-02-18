import { ProviderResult } from "../core/types.js";
import {BaseProvider} from "../core/provider.js";
import {HttpClient} from "../core/httpClient.js";

export class TestProvider extends BaseProvider {
    readonly name = 'Test';

    private _http = new HttpClient();

    constructor() {
        super();
    }

    async fetch(): Promise<ProviderResult> {
        return this.wrapFetch(this.name, async () => {
            const text = await this._http.fetchText('https://dummyjson.com/c/8e53-5ce8-4a29-ba8e');

            const speed = Number(text);
            if (!Number.isFinite(speed)) {
                throw new Error('Test: invalid numeric response');
            }

            return speed;
        });
    }

    destroy(): void {
        this._http.destroy();
    }
}
