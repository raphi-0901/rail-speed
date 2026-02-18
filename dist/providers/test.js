import { BaseProvider } from "../core/provider.js";
import { HttpClient } from "../core/httpClient.js";
export class TestProvider extends BaseProvider {
    name = 'Test';
    _http = new HttpClient();
    constructor() {
        super();
    }
    async fetch() {
        return this.wrapFetch(this.name, async () => {
            const text = await this._http.fetchText('https://dummyjson.com/c/8e53-5ce8-4a29-ba8e');
            const speed = Number(text);
            if (!Number.isFinite(speed)) {
                throw new Error('Test: invalid numeric response');
            }
            return speed;
        });
    }
    destroy() {
        this._http.destroy();
    }
}
//# sourceMappingURL=test.js.map