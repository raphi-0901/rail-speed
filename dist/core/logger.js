export class Logger {
    static instance = null;
    sink;
    tag;
    constructor(tag, sink) {
        this.tag = tag;
        this.sink = sink;
    }
    static getInstance(tag = 'train-speed', sink) {
        if (!Logger.instance) {
            Logger.instance = new Logger(tag, sink);
        }
        return Logger.instance;
    }
    now() {
        return new Date().toISOString();
    }
    info(msg) {
        this.sink?.log?.('INFO', this.tag, msg);
    }
    warn(msg) {
        this.sink?.log?.('WARN', this.tag, msg);
    }
    error(err, context = '') {
        const msg = context ? `${context}: ${err}` : `${err}`;
        this.sink?.log?.('ERROR', this.tag, msg);
    }
}
