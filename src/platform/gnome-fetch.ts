import {HttpClient} from "../core/types";
// @ts-ignore
import GLib from 'gi://GLib';
// @ts-ignore
import Soup from 'gi://Soup';

export class GnomeHttpClient implements HttpClient {
    constructor(private readonly session: any) {}

    async get(url: string, headers?: Record<string, string>): Promise<string> {
        const message = Soup.Message.new('GET', url)

        if (headers) {
            const h = message.get_request_headers()
            for (const [k, v] of Object.entries(headers))
                h.replace(k, v)
        }

        const bytes = await this.session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null
        )

        const status = message.get_status()
        const body = new TextDecoder().decode(bytes.get_data()).trim()

        if (status !== Soup.Status.OK)
            throw new Error(`HTTP ${status}`)

        return body
    }
}
