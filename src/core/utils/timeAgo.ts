import GLib from "gi://GLib";

export function timeAgo(date: number) {
    const now = GLib.get_monotonic_time() / 1000
    const seconds = Math.floor((now - date) / 1000);

    const intervals = [
        { label: 'year', seconds: 24 * 60 * 60 * 365 },
        { label: 'month', seconds: 24 * 60 * 60 * 30 },
        { label: 'day', seconds: 24 * 60 * 60 },
        { label: 'hour', seconds: 60 * 60 },
        { label: 'minute', seconds: 60 },
        { label: 'second', seconds: 1 }
    ];

    for (let i = 0; i < intervals.length; i++) {
        const interval = intervals[i];
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) {
            return count === 1
                ? `1 ${interval.label} ago`
                : `${count} ${interval.label}s ago`;
        }
    }

    return 'just now';
}
