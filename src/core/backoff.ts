export class ExponentialBackoff {
    private failCount = 0
    private nextAllowedMicroSeconds = 0

    constructor(
        private readonly initial: number,
        private readonly max: number,
        private readonly factor: number
    ) {}

    isAllowed(nowMicroSeconds: number): boolean {
        return nowMicroSeconds >= this.nextAllowedMicroSeconds
    }

    secondsUntilAllowed(nowMicroSeconds: number): number {
        if (this.isAllowed(nowMicroSeconds)) {
            return 0
        }
        return Math.ceil((this.nextAllowedMicroSeconds - nowMicroSeconds) / 1_000_000)
    }

    markSuccess(): void {
        this.failCount = 0
        this.nextAllowedMicroSeconds = 0
    }

    markFailure(nowUs: number): number {
        this.failCount++

        const exponent = Math.min(this.failCount - 1, 30)
        const secs = this.initial * Math.pow(this.factor, exponent)
        const delay = Math.min(this.max, Math.round(secs))

        this.nextAllowedMicroSeconds = nowUs + delay * 1_000_000
        return delay
    }
}
