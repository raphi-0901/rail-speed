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
import {timeAgo} from "./core/utils/timeAgo.js";

const FAST_REFRESH = 1
const MAX_GRAPH_WINDOW_SIZE = 60

export default class RailSpeedExtension extends Extension {
    private _updating = false

    private _label: St.Label | null = null
    private _indicator: Button | null = null
    private _maxSpeedLabel: St.Label | null = null
    private _avgSpeedLabel: St.Label | null = null
    private _bigSpeedLabel: St.Label | null = null
    private _providerLabel: St.Label | null = null

    private _settings: Gio.Settings | null = null

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

    private _globalCount = 0
    private _globalSum = 0
    private _globalMax = 0

    get avgSpeed(): number {
        if (this._globalCount === 0) {
            return 0
        }
        return this._globalSum / this._globalCount
    }

    get maxSpeed(): number {
        return this._globalMax
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

    get GRAPH_WINDOW_SIZE(): number {
        return this.getSettings().get_int('graph-window-size') ?? 10
    }

    private _positionChangedId: number = 0

    private _applyPosition() {
        if (!this._indicator) {
            return
        }

        const position = this._settings?.get_string('position') ?? 'center'

        // Remove from current box
        // @ts-ignore
        Panel.statusArea['railSpeed'] = null
        this._indicator.container.get_parent()?.remove_child(this._indicator.container)

        // Re-add to the correct box
        Panel.addToStatusArea('railSpeed', this._indicator, 0, position)
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
        // ---- Max / Avg side-by-side row ----
        const statsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false })

        const statsBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        })

        // Max label
        const maxSpeedLabel = new St.Label({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        })
        maxSpeedLabel.clutterText.set_use_markup(true)

        // Vertical separator
        const separator = new St.Widget({
            style_class: 'popup-separator-menu-item',
            width: 1,
            y_expand: true,
        })
        separator.set_style('background-color: rgba(255,255,255,0.2);')

        // Avg label
        const avgSpeedLabel = new St.Label({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        })
        avgSpeedLabel.clutterText.set_use_markup(true)

        statsBox.add_child(maxSpeedLabel)
        statsBox.add_child(separator)
        statsBox.add_child(avgSpeedLabel)

        statsItem.add_child(statsBox)

        // Wrap DrawingArea in a PopupBaseMenuItem so it fits the menu
        const graphItem = new PopupMenu.PopupBaseMenuItem({ reactive: false })
        // Increased height to 160 to accommodate axis labels outside the plot area
        const graphArea = new St.DrawingArea({
            width: 400,
            height: 160,
        })

        graphArea.connect('repaint', (area) => {
            this._drawGraph(area)
        })

        graphItem.add_child(graphArea)

        // ---------- Provider footer ----------
        const providerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false })
        const providerLabel = new St.Label({
            text: '',
            style: 'font-size: 10px; opacity: 0.6; padding-top: 6px;'
        })
        providerItem.add_child(providerLabel)

        // /usr/share/icons/Yaru/scalable/status/speedometer-symbolic.svg

        if (indicator.menu instanceof PopupMenu.PopupMenu) {
            indicator.menu.addMenuItem(headerItem)
            indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
            indicator.menu.addMenuItem(statsItem)
            indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
            indicator.menu.addMenuItem(graphItem)
            indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
            indicator.menu.addMenuItem(providerItem)
            indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            indicator.menu.addAction('Reset statistics', () => this._resetStats());
            // Add a menu item to open the preferences window
            indicator.menu.addAction('Preferences', () => this.openPreferences());

            // Create a new GSettings object, and bind the "show-indicator"
            // setting to the "visible" property.
            this._settings = this.getSettings();
            this._settings.bind('show-indicator', indicator, 'visible',
                Gio.SettingsBindFlags.DEFAULT);

            // Watch for changes to a specific setting
            this._settings.connect('changed', (settings, key) => {
                const value = settings.get_value(key).print(true);
                this._LOGGER.info(`Setting ${key} changed to ${value}.`);
            });

            this._positionChangedId = this._settings!.connect('changed::position', () => {
                this._applyPosition()
            })
        }

        this._label = label
        this._indicator = indicator
        this._maxSpeedLabel = maxSpeedLabel
        this._avgSpeedLabel = avgSpeedLabel
        this._providerLabel = providerLabel
        this._graphArea = graphArea

        this._applyPosition()
    }

    private _resetStats() {
        this._LOGGER.info('Resetting statistics');
        this._speedHistory = [];
        this._globalSum = 0;
        this._globalCount = 0;
        this._globalMax = 0;
        this._updateUI();
    }

    private _drawGraph(area: St.DrawingArea) {
        // limit speedHistory to max to avoid large memory usage
        const maxGraphWindowSizeCutoff = GLib.get_monotonic_time() / 1000 - 60 * MAX_GRAPH_WINDOW_SIZE * 1000

        while (
            this._speedHistory.length > 0 &&
            this._speedHistory[0].timestamp < maxGraphWindowSizeCutoff
            ) {
            this._speedHistory.shift()
        }

        const userSettingGraphWindowSizeCutoff = GLib.get_monotonic_time() / 1000 - 60 * this.GRAPH_WINDOW_SIZE * 1000
        // extract only window size
        const relevantHistoryItems = this._speedHistory.filter(p => p.timestamp >= userSettingGraphWindowSizeCutoff)

        const cr = area.get_context()
        const [totalWidth, totalHeight] = area.get_surface_size()

        // ── Margins: labels live outside the plot area ──────────────────────
        const leftMargin   = cr.textExtents('000').width + 4  // space for Y-axis labels (km/h values)
        const rightMargin  = cr.textExtents('000').width + 4   // small breathing room on the right
        const topMargin    = 8   // small breathing room on top
        const bottomMargin = 18  // space for X-axis time labels

        // Inner plot dimensions
        const plotX = leftMargin
        const plotY = topMargin
        const plotW = totalWidth  - leftMargin - rightMargin
        const plotH = totalHeight - topMargin  - bottomMargin

        // Draw background only within the plot area
        cr.setSourceRGBA(0, 0, 0, 0.3)
        cr.rectangle(plotX, plotY, plotW, plotH)
        cr.fill()

        const now = GLib.get_monotonic_time() / 1000

        if (!cr || relevantHistoryItems.length < 2) {
            // Draw the background so it doesn't look broken
            cr.setSourceRGBA(0, 0, 0, 0.3)
            cr.rectangle(plotX, plotY, plotW, plotH)
            cr.fill()

            // Centered "Waiting for data…" message
            cr.setSourceRGBA(1, 1, 1, 0.4)
            cr.setFontSize(12)
            const msg = 'Waiting for data\u2026'
            const ext = cr.textExtents(msg)
            cr.moveTo(plotX + (plotW - ext.width) / 2, plotY + (plotH + ext.height) / 2)
            cr.showText(msg)

            cr.$dispose()
            return
        }

        const filteredSpeedsOfRelevantHistoryItems = relevantHistoryItems
            .map(p => p.speed)
            .filter(s => s !== null)
        const averageOfFilteredSpeedsOfRelevantHistoryItems = filteredSpeedsOfRelevantHistoryItems
            .reduce((acc, current) => acc + current, 0) / filteredSpeedsOfRelevantHistoryItems.length


        // --- Time range (relative positioning) ---
        const oldest = relevantHistoryItems.at(0)!.timestamp
        const newest = relevantHistoryItems.at(-1)!.timestamp
        const timeRange = Math.max(newest - oldest, 1)

        // --- Y scaling based only on visible data ---
        const visibleSpeeds = relevantHistoryItems.map(p => p.speed).filter(s => s !== null)
        const max = Math.max(...visibleSpeeds, averageOfFilteredSpeedsOfRelevantHistoryItems, 50)
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
        if (averageOfFilteredSpeedsOfRelevantHistoryItems > 0) {
            const avgY = toPlotY(averageOfFilteredSpeedsOfRelevantHistoryItems)

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
            cr.showText(`avg ${Math.round(averageOfFilteredSpeedsOfRelevantHistoryItems)}`)
        }

        // --- Draw speed line (time-based X positioning) ---
        cr.setSourceRGBA(0.2, 0.8, 1.0, 0.9)  // cyan-ish
        cr.setLineWidth(2)

        let penDown = false

        relevantHistoryItems.forEach((point) => {
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

        for (const point of relevantHistoryItems) {
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
        relevantHistoryItems.forEach(point => {
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

        // Current speed label — centered above the last data point
        const lastPoint = relevantHistoryItems.at(-1)!
        const latest = lastPoint.speed
        cr.setSourceRGBA(1, 1, 1, 0.8)
        cr.setFontSize(10)
        if(latest === null) {
            cr.showText('')
        } else {
            const text = `${latest}`
            const textHeight = cr.textExtents(text).height
            cr.moveTo(toPlotX(lastPoint.timestamp) + 4, toPlotY(latest) + textHeight / 2)
            cr.showText(text)
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
            // new TestProvider(),
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
        this._maxSpeedLabel = null
        this._avgSpeedLabel = null
        this._graphArea = null

        this._speedHistory = []
        this._globalSum = 0;
        this._globalCount = 0;

        if (this._orchestrator) {
            this._orchestrator.destroy()
            this._orchestrator = null
        }

        if (this._positionChangedId && this._settings) {
            this._settings.disconnect(this._positionChangedId)
            this._positionChangedId = 0
        }

        if(this._settings) {
            this._settings = null;
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

        if (!this._orchestrator || !this._label || !this._indicator || !this._maxSpeedLabel || !this._avgSpeedLabel || !this._graphArea || !this._bigSpeedLabel || !this._providerLabel) {
            return
        }

        if (this._netmon && !this._netmon.get_network_available()) {
            this._LOGGER.warn(`offline detected -> skip polling`)
            const lastSpeed = this.lastActualHistoryItem
            if(lastSpeed) {
                this._label.set_style("color: orange;");
                this._bigSpeedLabel.set_text(`${lastSpeed.speed} km/h - (Offline)`);
            }

            this._speedHistory.push({speed: null, timestamp: GLib.get_monotonic_time() / 1000 })
            this._updateUI()
            this._restartTimer(FAST_REFRESH)

            return
        }

        this._label.set_style("color: inherit;");
        this._updating = true
        try {
            const result = await this._orchestrator.tryOnce()
            if (result.ok) {
                if(result.provider !== this._activeProvider) {
                    this._activeProvider = result.provider
                    this._speedHistory = [];
                }

                this._globalCount++
                this._globalSum += result.speed
                this._globalMax = Math.max(this.maxSpeed, result.speed)
                this._speedHistory.push({
                    speed: result.speed,
                    timestamp: result.timestamp,
                })

                this._updateUI()
                this._restartTimer(FAST_REFRESH)
            } else {
                this._updateUI()
                this._restartTimer(result.nextWake)
            }
        } finally {
            this._updating = false
        }
    }

    private _updateUI() {
        if(this._label) {
            const latest = this._speedHistory.at(-1)?.speed;
            if(latest === null || latest === undefined) {
                this._label.set_text('Offline');
            } else {
                this._label.set_text(`🚆 ${latest} km/h`);
            }
        }

        if(this._graphArea) {
            this._graphArea.queue_repaint()
        }

        if(this._avgSpeedLabel) {
            this._avgSpeedLabel.clutterText.set_use_markup(true)
            this._avgSpeedLabel.clutterText.set_markup(
                `<b>Avg</b>: ${Math.round(this.avgSpeed)} km/h`
            )
        }

        if(this._maxSpeedLabel) {
            this._maxSpeedLabel.clutterText.set_use_markup(true)
            this._maxSpeedLabel.clutterText.set_markup(
                `<b>Max</b>: ${Math.round(this.maxSpeed)} km/h`
            )
        }

        if(this._bigSpeedLabel) {
            const latest = this._speedHistory.at(-1)?.speed;
            if (latest === null || latest === undefined) {
                this._bigSpeedLabel.set_text('Offline');
            } else if (latest < 3) {
                this._bigSpeedLabel.set_text('Stopped');
            } else {
                this._bigSpeedLabel.set_text(`${latest} km/h`);
            }
        }

        if(this._providerLabel) {
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
}
