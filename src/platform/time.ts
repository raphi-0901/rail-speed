// @ts-ignore
import GLib from 'gi://GLib';
import {TimeSource} from "../core/types";

export class GnomeTimeSource implements TimeSource {
    nowUs(): number {
        return GLib.get_monotonic_time()
    }
}
