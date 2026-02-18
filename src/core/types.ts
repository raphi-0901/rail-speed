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
