import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import {panel as Panel} from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'
import {Button} from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import {SpeedOrchestrator} from './core/orchestrator.js'
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
    private _speedHistory: {timestamp: number, speed: number | null}[] = []

    private _timer: number | null = null
    private _currentInterval: number = 0
    private _LOGGER = Logger.getInstance()

    private _orchestrator: SpeedOrchestrator | null = null

    private _netmon: Gio.NetworkMonitor | null = null
    private _netmonChangedId: number = 0
    private _netmonDebounce: number | null = null

    private _activeProvider: string | null = null

    get avgSpeed(): number {
        const speeds = this._speedHistory.map(p => p.speed).filter((s) => s !== null);
        if (speeds.length === 0) {
            return 0;
        }
        return speeds.reduce((acc, s) => acc + s, 0) / speeds.length;
    }

    get lastActualHistoryItem() {
        const item = this._speedHistory.filter(p => p.speed !== null).at(-1)

        if(!item) {
            return null;
        }

        return item as {
            timestamp: number
            speed: number
        }
    }

    get maxSpeed(): number {
        const speeds = this._speedHistory.map(p => p.speed).filter((s)=> s !== null);
        return Math.max(...speeds, 0);
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
        // Increased height to 160 to accommodate axis labels outside the plot area
        const graphArea = new St.DrawingArea({
            width: 400,
            height: 160,
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
        const [totalWidth, totalHeight] = area.get_surface_size()

        // ── Margins: labels live outside the plot area ──────────────────────
        const leftMargin   = 36  // space for Y-axis labels (km/h values)
        const rightMargin  = 8   // small breathing room on the right
        const topMargin    = 8   // small breathing room on top
        const bottomMargin = 18  // space for X-axis time labels

        // Inner plot dimensions
        const plotX = leftMargin
        const plotY = topMargin
        const plotW = totalWidth  - leftMargin - rightMargin
        const plotH = totalHeight - topMargin  - bottomMargin

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
        const visibleSpeeds = speedHistoryOfLast10Minutes.map(p => p.speed).filter(s => s !== null)
        const max = Math.max(...visibleSpeeds, this.avgSpeed, 50)
        const min = 0
        const yRange = Math.max(max - min, 1)

        // Helper: map a speed value → Y pixel within plot area
        const toPlotY = (speed: number) => plotY + plotH - ((speed - min) / yRange) * plotH
        // Helper: map a timestamp → X pixel within plot area
        const toPlotX = (ts: number) => plotX + ((ts - oldest) / timeRange) * plotW

        // Background (full canvas, transparent)
        cr.setSourceRGBA(0, 0, 0, 0.0)
        cr.paint()

        // ── Clip to plot area for all graph drawing ──────────────────────────
        cr.save()
        cr.rectangle(plotX, plotY, plotW, plotH)
        cr.clip()

        // Grid lines (subtle)
        cr.setSourceRGBA(1, 1, 1, 0.1)
        cr.setLineWidth(1)
        for (let i = 1; i < 4; i++) {
            const y = plotY + (plotH / 4) * i
            cr.moveTo(plotX, y)
            cr.lineTo(plotX + plotW, y)
            cr.stroke()
        }

        // Average line
        if (this.avgSpeed > 0) {
            const avgY = toPlotY(this.avgSpeed)

            cr.setSourceRGBA(1.0, 0.6, 0.2, 0.9)  // orange
            cr.setLineWidth(1.5)
            cr.setDash([4.0, 4.0], 0)  // dashed

            cr.moveTo(plotX, avgY)
            cr.lineTo(plotX + plotW, avgY)
            cr.stroke()

            cr.setDash([], 0) // reset dash

            // Avg label inside plot (small, near the line)
            cr.setSourceRGBA(1.0, 0.6, 0.2, 0.85)
            cr.setFontSize(9)
            cr.moveTo(plotX + 4, avgY - 3)
            cr.showText(`avg ${Math.round(this.avgSpeed)}`)
        }

        // --- Draw speed line (time-based X positioning) ---
        cr.setSourceRGBA(0.2, 0.8, 1.0, 0.9)  // cyan-ish
        cr.setLineWidth(2)

        let penDown = false

        speedHistoryOfLast10Minutes.forEach((point) => {
            const x = toPlotX(point.timestamp)

            if (point.speed === null) {
                penDown = false
                return
            }

            const y = toPlotY(point.speed)

            if (!penDown) {
                cr.moveTo(x, y)
                penDown = true
            } else {
                cr.lineTo(x, y)
            }
        })

        cr.stroke()

        // --- Fill under the line — segment-aware (handles null gaps) ---
        cr.setSourceRGBA(0.2, 0.8, 1.0, 0.15)

        let segmentStart: { x: number; y: number } | null = null
        let segmentLastX = 0
        const plotBottom = plotY + plotH

        for (const point of speedHistoryOfLast10Minutes) {
            const x = toPlotX(point.timestamp)

            if (point.speed === null) {
                if (segmentStart !== null) {
                    cr.lineTo(segmentLastX, plotBottom)
                    cr.lineTo(segmentStart.x, plotBottom)
                    cr.closePath()
                    cr.fill()
                    segmentStart = null
                }
                continue
            }

            const y = toPlotY(point.speed)

            if (segmentStart === null) {
                cr.newPath()
                cr.moveTo(x, y)
                segmentStart = { x, y }
            } else {
                cr.lineTo(x, y)
            }

            segmentLastX = x
        }

        // Close any trailing open segment
        if (segmentStart !== null) {
            cr.lineTo(segmentLastX, plotBottom)
            cr.lineTo(segmentStart.x, plotBottom)
            cr.closePath()
            cr.fill()
        }

        // --- Datapoint dots ---
        speedHistoryOfLast10Minutes.forEach(point => {
            const x = toPlotX(point.timestamp)

            if (point.speed === null) {
                // Subtle vertical gap marker
                cr.setSourceRGBA(1.0, 0.3, 0.3, 0.3)
                cr.setLineWidth(1)
                cr.moveTo(x, plotY)
                cr.lineTo(x, plotBottom)
                cr.stroke()
            } else {
                const y = toPlotY(point.speed)
                cr.setSourceRGBA(0.2, 0.8, 1.0, 1.0)
                cr.arc(x, y, 2.5, 0, 2 * Math.PI)
                cr.fill()
            }
        })

        // Current speed label (top-right inside plot)
        // Current speed label (right side, vertically aligned with last datapoint)
        const latest = speedHistoryOfLast10Minutes.at(-1)!.speed
        cr.setSourceRGBA(1, 1, 1, 0.8)
        cr.setFontSize(10)
        const latestText = latest === null ? 'Offline' : `${latest}`
        const latestTextExtents = cr.textExtents(latestText)
        const latestLabelY = latest === null
            ? plotY + 12
            : Math.min(
                Math.max(toPlotY(latest) + latestTextExtents.height / 2, plotY + latestTextExtents.height),
                plotBottom - 2
            )
        cr.moveTo(plotX + plotW - latestTextExtents.width - 4, latestLabelY)
        cr.showText(latestText)

        // ── End clip ─────────────────────────────────────────────────────────
        cr.restore()

        // ── Y-axis labels (outside plot, in left margin) ─────────────────────
        cr.setSourceRGBA(1, 1, 1, 0.6)
        cr.setFontSize(9)

        // Max label (top)
        const maxText = `${Math.round(max)}`
        const maxExtents = cr.textExtents(maxText)
        cr.moveTo(plotX - maxExtents.width - 4, plotY + maxExtents.height)
        cr.showText(maxText)

        // Zero label (bottom)
        const zeroExtents = cr.textExtents('0')
        cr.moveTo(plotX - zeroExtents.width - 4, plotBottom)
        cr.showText('0')

        // Optional mid-point Y label
        const midVal = Math.round(max / 2)
        const midText = `${midVal}`
        const midExtents = cr.textExtents(midText)
        const midY = toPlotY(midVal)
        cr.moveTo(plotX - midExtents.width - 4, midY + midExtents.height / 2)
        cr.showText(midText)

        // ── X-axis time labels (outside plot, in bottom margin) ──────────────
        cr.setSourceRGBA(1, 1, 1, 0.5)
        cr.setFontSize(9)

        const labelCount = 5
        for (let i = 0; i <= labelCount; i++) {
            const fraction = i / labelCount
            const x = plotX + fraction * plotW
            const timestampAtX = oldest + fraction * timeRange
            const secondsAgo = Math.round((now - timestampAtX) / 1000)

            const label = secondsAgo === 0 ? 'now' : `-${secondsAgo}s`
            const textExtents = cr.textExtents(label)

            // clamp so first and last labels don't overflow
            const clampedX = Math.min(
                Math.max(x - textExtents.width / 2, plotX),
                plotX + plotW - textExtents.width
            )

            // Label goes below the plot area
            cr.moveTo(clampedX, plotBottom + 13)
            cr.showText(label)

            // Tick mark at the bottom edge of the plot
            cr.setSourceRGBA(1, 1, 1, 0.2)
            cr.setLineWidth(1)
            cr.moveTo(x, plotBottom)
            cr.lineTo(x, plotBottom + 4)
            cr.stroke()
            cr.setSourceRGBA(1, 1, 1, 0.5)
        }

        cr.$dispose()
    }

    enable() {
        this.setupUI()

        this._LOGGER.info(`Enable ${this.metadata.uuid} (GLib v${GLib.MAJOR_VERSION}.${GLib.MINOR_VERSION}.${GLib.MICRO_VERSION})`);

        this._timer = null

        const providers = [
            new OebbProvider(),
            new IcePortalProvider(),
            new TestProvider(),
        ]

        this._orchestrator = new SpeedOrchestrator(providers)

        this._netmon = Gio.NetworkMonitor.get_default()

        this._netmonChangedId = this._netmon.connect(
            'network-changed',
            (_mon, available) => {
                this._LOGGER.info(`Network changed. Available: ${available}`)

                if (this._netmonDebounce !== null) {
                    GLib.source_remove(this._netmonDebounce)
                    this._netmonDebounce = null
                }

                this._netmonDebounce = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    1,
                    () => {
                        this._netmonDebounce = null

                        if (this._orchestrator) {
                            this._orchestrator.resetAll()
                        }

                        this._update()

                        return GLib.SOURCE_REMOVE
                    }
                )
            }
        )

        this._currentInterval = FAST_REFRESH
        this._restartTimer(FAST_REFRESH)
    }

    disable() {
        if (this._timer) {
            GLib.source_remove(this._timer)
            this._timer = null
        }

        if (this._netmonChangedId && this._netmon) {
            this._netmon.disconnect(this._netmonChangedId)
            this._netmonChangedId = 0
        }

        this._netmon = null

        if (this._indicator) {
            this._indicator.destroy()
            this._indicator = null
        }

        this._label = null
        this._maxSpeedItem = null
        this._avgSpeedItem = null
        this._graphArea = null

        this._speedHistory = []

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

        if (this._netmon && !this._netmon.get_network_available()) {
            this._LOGGER.warn(`offline detected -> skip polling`)
            const lastSpeed = this._speedHistory.at(-1)
            if(lastSpeed) {
                this._label.set_style("color: orange;");
            }

            this._speedHistory.push({speed: null, timestamp: GLib.get_monotonic_time() / 1000 })
            this._graphArea?.queue_repaint()
            this._updateProviderLabel()
            this._restartTimer(FAST_REFRESH)

            return
        }

        this._label.set_style("color: inherit;");
        this._updating = true
        try {
            const result = await this._orchestrator.tryOnce()
            if (result.ok) {
                this._label.set_text(`🚆 ${result.speed} km/h`)
                this._providerLabel.set_text(`${result.provider} · Live`)

                if(result.provider !== this._activeProvider) {
                    this._activeProvider = result.provider
                    this._speedHistory = [];
                }

                this._speedHistory.push({
                    speed: result.speed,
                    timestamp: result.timestamp,
                })
                this._graphArea?.queue_repaint()
                this._avgSpeedItem.label.set_text(`Avg: ${Math.round(this.avgSpeed)} km/h`)
                this._maxSpeedItem.label.set_text(`Max: ${Math.round(this.maxSpeed)} km/h`)

                const latest = this._speedHistory.at(-1)?.speed;
                if(!latest) {
                    this._bigSpeedLabel?.set_text('Offline');
                } else if (latest < 3) {
                    this._bigSpeedLabel?.set_text('Stopped');
                } else {
                    this._bigSpeedLabel?.set_text(`${latest} km/h`);
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

        const lastUpdate = this.lastActualHistoryItem
        const provider = this._activeProvider ?? "No provider"

        if(lastUpdate) {
            this._providerLabel.set_text(`${provider} · ${timeAgo(lastUpdate.timestamp)}`)
        }
        else {
            this._providerLabel.set_text(`${provider} · Not synchronized yet`)
        }
    }
}
