import { LoggerSink, LogLevel } from '../core/logger.js'

export class GnomeLoggerSink implements LoggerSink {
    log(level: LogLevel, tag: string, msg: string) {
        const out = `[${tag}] ${new Date().toISOString()} ${level} ${msg}`
        switch(level) {
            case 'INFO': log(out); break
            case 'WARN': log(out); break
            case 'ERROR': logError(out); break
        }
    }
}
