export class GnomeLoggerSink {
    log(level, tag, msg) {
        const out = `[${tag}] ${new Date().toISOString()} ${level} ${msg}`;
        switch (level) {
            case 'INFO':
                log(out);
                break;
            case 'WARN':
                log(out);
                break;
            case 'ERROR':
                logError(out);
                break;
        }
    }
}
