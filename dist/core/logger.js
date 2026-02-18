export class Logger {
    static instance = null;
    tag = 'rail-speed';
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    now() {
        return new Date().toISOString();
    }
    log(level, msg) {
        const out = `[${this.tag}] ${this.now()} ${level} ${msg}`;
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
    info(msg) {
        this.log('INFO', msg);
    }
    warn(msg) {
        this.log('WARN', msg);
    }
    error(err, context = '') {
        const msg = context ? `${context}: ${err}` : `${err}`;
        this.log('ERROR', msg);
    }
}
//# sourceMappingURL=logger.js.map