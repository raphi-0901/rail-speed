export type ProviderResult = {
    ok: true
    speed: number
    latencyMs: number
    provider: string
} | {
    ok: false
    error: string
    provider: string
    latencyMs: number
}

export interface SpeedProvider {
    readonly name: string
    fetch(): Promise<ProviderResult>
}

export interface TimeSource {
    nowUs(): number
}

export interface HttpClient {
    get(url: string, headers?: Record<string, string>): Promise<string>
}
