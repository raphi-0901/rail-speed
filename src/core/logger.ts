export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export class Logger {
    private static instance: Logger | null = null

    private readonly tag = 'rail-speed'

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger()
        }

        return Logger.instance
    }

    private now(): string {
        return new Date().toISOString()
    }

    private log(level: LogLevel, msg: string) {
        const out = `[${this.tag}] ${this.now()} ${level} ${msg}`
        switch(level) {
            case 'INFO': log(out); break
            case 'WARN': log(out); break
            case 'DEBUG': log(out); break
            case 'ERROR': logError(out); break
            default: log(level satisfies never)
        }
    }

    info(msg: string) {
        this.log('INFO', msg)
    }

    warn(msg: string) {
        this.log('WARN', msg)
    }

    debug(msg: string) {
        this.log('DEBUG', msg)
    }

    error(err: any, context = '') {
        const msg = context ? `${context}: ${err}` : `${err}`
        this.log('ERROR', msg)
    }
}
