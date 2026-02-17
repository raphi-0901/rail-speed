export class ExponentialBackoff {
    initial;
    max;
    factor;
    failCount = 0;
    nextAllowedMicroSeconds = 0;
    constructor(initial, max, factor) {
        this.initial = initial;
        this.max = max;
        this.factor = factor;
    }
    isAllowed(nowMicroSeconds) {
        return nowMicroSeconds >= this.nextAllowedMicroSeconds;
    }
    secondsUntilAllowed(nowUs) {
        if (this.isAllowed(nowUs)) {
            return 0;
        }
        return Math.ceil((this.nextAllowedMicroSeconds - nowUs) / 1_000_000);
    }
    markSuccess() {
        this.failCount = 0;
        this.nextAllowedMicroSeconds = 0;
    }
    markFailure(nowUs) {
        this.failCount++;
        const exponent = Math.min(this.failCount - 1, 30);
        const secs = this.initial * Math.pow(this.factor, exponent);
        const delay = Math.min(this.max, Math.round(secs));
        this.nextAllowedMicroSeconds = nowUs + delay * 1_000_000;
        return delay;
    }
}
