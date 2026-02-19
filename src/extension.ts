import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import {panel as Panel} from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'
import {Button} from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import {OrchestratorResult, SpeedOrchestrator} from './core/orchestrator.js'
import {IcePortalProvider} from './providers/ice.js'
import {OebbProvider} from './providers/oebb.js'
import {Logger} from "./core/logger.js";
import {TestProvider} from "./providers/test.js";
import {PopupMenuItem} from "@girs/gnome-shell/ui/popupMenu";
import {timeAgo} from "./core/utils/timeAgo.js";

const FAST_REFRESH = 1

export default class RailSpeedExtension extends Extension {
    private _updating = false

    private _label: St.Label | null = null
    private _indicator: Button | null = null
    private _maxSpeedItem: PopupMenuItem | null = null
    private _avgSpeedItem: PopupMenuItem | null = null
    private _bigSpeedLabel: St.Label | null = null
    private _providerLabel: St.Label | null = null

    private _graphArea: St.DrawingArea | null = null
    private _speedHistory: {timestamp: number, speed: number}[] = []

    private _timer: number | null = null
    private _currentInterval: number = 0
    private _LOGGER = Logger.getInstance()

    private _orchestrator: SpeedOrchestrator | null = null

    private _netmon: Gio.NetworkMonitor | null = null
    private _netmonChangedId: number = 0
    private _netmonDebounce: number | null = null

    private _activeProvider: string | null = null

    get avgSpeed(): number {
        return this._speedHistory.reduce((acc, {speed}) => acc + speed, 0) / this._speedHistory.length
    }

    get maxSpeed(): number {
        return Math.max(...this._speedHistory.map(p => p.speed), 0)
    }

    private setupUI() {
        // Create the panel button (it has a .menu built in)
        const indicator = new Button(0.0, 'railSpeed')

        // The label shown in the panel bar
        const label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        })
        indicator.add_child(label)

        // ---------- Big speed header ----------
        const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false })
        const bigLabel = new St.Label({
            text: '-- km/h',
            style: 'font-size: 22px; font-weight: bold; padding: 6px 0;'
        })
        headerItem.add_child(bigLabel)

        this._bigSpeedLabel = bigLabel

        // Add items to the dropdown menu
        const maxSpeedItem = new PopupMenu.PopupMenuItem('Max: -- km/h')
        const avgSpeedItem = new PopupMenu.PopupMenuItem('Avg: -- km/h')

        // Wrap DrawingArea in a PopupBaseMenuItem so it fits the menu
        const graphItem = new PopupMenu.PopupBaseMenuItem({ reactive: false })
        const graphArea = new St.DrawingArea({
            width: 400,
            height: 140,
            style: 'background-color: rgba(0,0,0,0.3); border-radius: 4px;'
        })

        graphArea.connect('repaint', (area) => {
            this._drawGraph(area)
        })

        graphItem.add_child(graphArea)

        // Disable the items so they act as labels (not clickable)
        maxSpeedItem.sensitive = false
        avgSpeedItem.sensitive = false

        // ---------- Provider footer ----------
        const providerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false })
        const providerLabel = new St.Label({
            text: '',
            style: 'font-size: 10px; opacity: 0.6; padding-top: 6px;'
        })
        providerItem.add_child(providerLabel)

        if (indicator.menu instanceof PopupMenu.PopupMenu) {
            indicator.menu.addMenuItem(headerItem)
            indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
            indicator.menu.addMenuItem(maxSpeedItem)
            indicator.menu.addMenuItem(avgSpeedItem)
            indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
            indicator.menu.addMenuItem(graphItem)
            indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
            indicator.menu.addMenuItem(providerItem)
        }

        this._label = label
        this._indicator = indicator
        this._maxSpeedItem = maxSpeedItem
        this._avgSpeedItem = avgSpeedItem
        this._providerLabel = providerLabel
        this._graphArea = graphArea

        Panel.addToStatusArea('railSpeed', indicator, 0, 'center')
    }

    private _drawGraph(area: St.DrawingArea) {
        const cr = area.get_context()
        const [width, height] = area.get_surface_size()
        const now = GLib.get_monotonic_time() / 1000
        const tenMinutesAgo = now - 10 * 60 * 1000
        const speedHistoryOfLast10Minutes = this._speedHistory.filter(item => item.timestamp > tenMinutesAgo)

        if (!cr || speedHistoryOfLast10Minutes.length < 2) {
            cr?.$dispose()
            return
        }

        // --- Time range (relative positioning) ---
        const oldest = speedHistoryOfLast10Minutes.at(0)!.timestamp
        const newest = speedHistoryOfLast10Minutes.at(-1)!.timestamp
        const timeRange = Math.max(newest - oldest, 1)

        // --- Y scaling based only on visible data ---
        const visibleSpeeds = speedHistoryOfLast10Minutes.map(p => p.speed)
        const max = Math.max(...visibleSpeeds, this.avgSpeed, 50)
        const min = 0
        const yRange = Math.max(max - min, 1)

        // Background
        cr.setSourceRGBA(0, 0, 0, 0.0)
        cr.paint()

        // Grid lines (subtle)
        cr.setSourceRGBA(1, 1, 1, 0.1)
        cr.setLineWidth(1)
        for (let i = 1; i < 4; i++) {
            const y = (height / 4) * i
            cr.moveTo(0, y)
            cr.lineTo(width, y)
            cr.stroke()
        }

        // Average line
        if (this.avgSpeed > 0) {
            const avgY = height - ((this.avgSpeed - min) / (max - min)) * height

            cr.setSourceRGBA(1.0, 0.6, 0.2, 0.9)  // orange
            cr.setLineWidth(1.5)
            cr.setDash([4.0, 4.0], 0)  // dashed

            cr.moveTo(0, avgY)
            cr.lineTo(width, avgY)
            cr.stroke()

            cr.setDash([], 0) // reset dash

            // Avg label
            cr.setFontSize(10)
            cr.moveTo(4, avgY - 4)
            cr.showText(`avg ${Math.round(this.avgSpeed)}`)
        }

        // --- Draw speed line (time-based X positioning) ---
        cr.setSourceRGBA(0.2, 0.8, 1.0, 0.9)  // cyan-ish
        cr.setLineWidth(2)

        speedHistoryOfLast10Minutes.forEach((point, i) => {
            const x =
                ((point.timestamp - oldest) / timeRange) * width

            const y =
                height -
                ((point.speed - min) / yRange) * height

            if (i === 0) {
                cr.moveTo(x, y)
            } else {
                cr.lineTo(x, y)
            }
        })

        cr.stroke()

        // Fill under the line
        cr.setSourceRGBA(0.2, 0.8, 1.0, 0.15)

        speedHistoryOfLast10Minutes.forEach((point, i) => {
            const x =
                ((point.timestamp - oldest) / timeRange) * width

            const y =
                height -
                ((point.speed - min) / yRange) * height

            if (i === 0) {
                cr.moveTo(x, y)
            } else {
                cr.lineTo(x, y)
            }
        })

        // Close to bottom
        const lastPoint = speedHistoryOfLast10Minutes.at(-1)!
        const lastX =
            ((lastPoint.timestamp - oldest) / timeRange) * width

        cr.lineTo(lastX, height)
        cr.lineTo(0, height)
        cr.closePath()
        cr.fill()

        // --- Datapoint dots ---
        cr.setSourceRGBA(0.2, 0.8, 1.0, 1.0)

        speedHistoryOfLast10Minutes.forEach(point => {
            const x =
                ((point.timestamp - oldest) / timeRange) * width

            const y =
                height -
                ((point.speed - min) / yRange) * height

            cr.arc(x, y, 2.5, 0, 2 * Math.PI)
            cr.fill()
        })

        // Current speed label
        const latest = speedHistoryOfLast10Minutes.at(-1)!.speed
        cr.setSourceRGBA(1, 1, 1, 0.8)
        cr.setFontSize(10)
        cr.moveTo(width - cr.textExtents(`${latest}`).width - 4, 14)
        cr.showText(`${latest}`)

        // Max label
        cr.moveTo(4, height - 4)
        cr.showText(`0`)
        cr.moveTo(4, 14)
        cr.showText(`${Math.round(max)}`)

        cr.$dispose()
    }

    enable() {
        this.setupUI()

        this._LOGGER.info(`Enable ${this.metadata.uuid} (GLib v${GLib.MAJOR_VERSION}.${GLib.MINOR_VERSION}.${GLib.MICRO_VERSION})`);

        // -----------------------
        // Platform objects
        // -----------------------
        this._timer = null

        // -----------------------
        // Providers
        // -----------------------
        const providers = [
            new OebbProvider(),
            new IcePortalProvider(),
            new TestProvider(),
        ]

        // -----------------------
        // Core orchestrator
        // -----------------------
        this._orchestrator = new SpeedOrchestrator(providers)

        // -----------------------
        // Network monitor
        // -----------------------
        this._netmon = Gio.NetworkMonitor.get_default()

        this._netmonChangedId = this._netmon.connect(
            'network-changed',
            (_mon, available) => {
                this._LOGGER.info(`Network changed. Available: ${available}`)

                // cancel current debounce
                if (this._netmonDebounce !== null) {
                    GLib.source_remove(this._netmonDebounce)
                    this._netmonDebounce = null
                }

                // wait 1s for network to stabilize before resetting backoff
                this._netmonDebounce = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    1,
                    () => {
                        this._netmonDebounce = null

                        if (this._orchestrator) {
                            this._orchestrator.resetAll()
                        }

                        this._restartTimer(FAST_REFRESH)

                        return GLib.SOURCE_REMOVE
                    }
                )
            }
        )

        // -----------------------
        // Timer
        // -----------------------
        this._currentInterval = FAST_REFRESH
        this._restartTimer(FAST_REFRESH)
    }

    disable() {
        // -----------------------
        // Stop timer
        // -----------------------
        if (this._timer) {
            GLib.source_remove(this._timer)
            this._timer = null
        }

        // -----------------------
        // Disconnect network monitor
        // -----------------------
        if (this._netmonChangedId && this._netmon) {
            this._netmon.disconnect(this._netmonChangedId)
            this._netmonChangedId = 0
        }

        this._netmon = null

        // -----------------------
        // Destroy UI
        // -----------------------
        if (this._indicator) {
            this._indicator.destroy()
            this._indicator = null
        }

        this._label = null
        this._maxSpeedItem = null
        this._avgSpeedItem = null
        this._graphArea = null

        this._speedHistory = []

        // -----------------------
        // Drop core
        // -----------------------
        if (this._orchestrator) {
            this._orchestrator.destroy()
            this._orchestrator = null
        }

        this._LOGGER.info('disabled')
    }

    _restartTimer(seconds: number) {
        const secs = Math.max(1, Math.round(seconds))

        if (this._timer) {
            GLib.source_remove(this._timer)
            this._timer = null
        }

        this._timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            secs,
            () => {
                this._timer = null

                this._update().catch(e => {
                    this._LOGGER.error(e, '_update() unhandled (timer)')
                })

                return GLib.SOURCE_REMOVE
            }
        )

        if (this._currentInterval !== secs) {
            this._LOGGER.info(`timer interval -> ${secs}s`)
        }

        this._currentInterval = secs
    }

    async _update() {
        if (this._updating) {
            return
        }

        if (!this._orchestrator || !this._label || !this._indicator || !this._maxSpeedItem || !this._avgSpeedItem || !this._graphArea || !this._bigSpeedLabel || !this._providerLabel) {
            return
        }

        // Avoid pointless polling if offline
        if (this._netmon && !this._netmon.get_network_available()) {
            this._LOGGER.warn(`offline detected -> skip polling`)
            this._label.set_text('')
            this._updateProviderLabel()
            this._restartTimer(5)

            return
        }

        this._updating = true
        try {
            const result = await this._orchestrator.tryOnce()
            if (result.ok) {
                this._label.set_text(`🚆 ${result.speed} km/h`)
                this._providerLabel.set_text(`${result.provider} · Live`)

                // reset stats if provider changed
                if(result.provider !== this._activeProvider) {
                    this._activeProvider = result.provider
                    this._speedHistory = [];
                }

                // Push to history
                this._speedHistory.push({
                    speed: result.speed,
                    timestamp: result.timestamp,
                })
                this._graphArea?.queue_repaint()
                this._avgSpeedItem.label.set_text(`Avg: ${Math.round(this.avgSpeed)} km/h`)
                this._maxSpeedItem.label.set_text(`Max: ${Math.round(this.maxSpeed)} km/h`)

                if (result.speed < 3) {
                    this._bigSpeedLabel.set_text('Stopped')
                } else {
                    this._bigSpeedLabel.set_text(`${result.speed} km/h`)
                }
                this._restartTimer(FAST_REFRESH)
            } else {
                this._updateProviderLabel()
                this._restartTimer(result.nextWake)
            }
        } finally {
            this._updating = false
        }
    }

    private _updateProviderLabel() {
        if(!this._providerLabel) {
            return
        }

        const lastUpdate = this._speedHistory.at(-1)?.timestamp
        const provider = this._activeProvider ?? "No provider"

        if(lastUpdate) {
            this._providerLabel.set_text(`${provider} · ${timeAgo(lastUpdate)}`)
        }
        else {
            this._providerLabel.set_text(`${provider} · Not synchronized yet`)
        }
    }
}
