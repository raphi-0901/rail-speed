export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LoggerSink {
    log(level: LogLevel, tag: string, msg: string, error?: any): void
}

export class Logger {
    private static instance: Logger | null = null

    private sink?: LoggerSink
    private tag: string

    private constructor(tag: string, sink?: LoggerSink) {
        this.tag = tag
        this.sink = sink
    }

    static getInstance(tag = 'rail-speed', sink?: LoggerSink): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(tag, sink)
        }
        return Logger.instance
    }

    private now(): string {
        return new Date().toISOString()
    }

    info(msg: string) {
        this.sink?.log?.('INFO', this.tag, msg)
    }

    warn(msg: string) {
        this.sink?.log?.('WARN', this.tag, msg)
    }

    error(err: any, context = '') {
        const msg = context ? `${context}: ${err}` : `${err}`
        this.sink?.log?.('ERROR', this.tag, msg)
    }
}
