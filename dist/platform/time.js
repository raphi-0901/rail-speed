// @ts-ignore
import GLib from 'gi://GLib';
export class GnomeTimeSource {
    nowUs() {
        return GLib.get_monotonic_time();
    }
}
