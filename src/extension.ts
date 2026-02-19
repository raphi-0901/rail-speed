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

const FAST_REFRESH = 1

export default class RailSpeedExtension extends Extension {
    private _updating = false

    private _label: St.Label | null = null
    private _indicator: Button | null = null
    private _speedItem: PopupMenuItem | null = null
    private _routeItem: PopupMenuItem | null = null

    private _timer: number | null = null
    private _currentInterval: number = 0
    private _LOGGER = Logger.getInstance()

    private _orchestrator: SpeedOrchestrator | null = null

    private _netmon: Gio.NetworkMonitor | null = null
    private _netmonChangedId: number = 0
    private _netmonDebounce: number | null = null

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

        // Add items to the dropdown menu
        const speedItem = new PopupMenu.PopupMenuItem('Speed: —')
        const routeItem = new PopupMenu.PopupMenuItem('Route: unknown')
        const separator = new PopupMenu.PopupSeparatorMenuItem()
        const infoLabel = new PopupMenu.PopupMenuItem('Train info will appear here')

        // Disable the items so they act as labels (not clickable)
        speedItem.sensitive = false
        routeItem.sensitive = false
        infoLabel.sensitive = false

        if (indicator.menu instanceof PopupMenu.PopupMenu) {
            indicator.menu.addMenuItem(speedItem)
            indicator.menu.addMenuItem(routeItem)
            indicator.menu.addMenuItem(separator)
            indicator.menu.addMenuItem(infoLabel)
        }

        this._label = label
        this._indicator = indicator
        this._speedItem = speedItem
        this._routeItem = routeItem

        Panel.addToStatusArea('railSpeed', indicator, 0, 'center')
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

        if (!this._orchestrator || !this._label) {
            return
        }

        // Avoid pointless polling if offline
        if (this._netmon && !this._netmon.get_network_available()) {
            this._LOGGER.warn(`offline detected -> skip polling`)
            this._label.set_text('')
            this._restartTimer(5)

            return
        }

        this._updating = true
        try {
            const result = await this._orchestrator.tryOnce()
            if (result.ok) {
                this._label.set_text(`🚆 ${result.speed} km/h`)
                this._restartTimer(FAST_REFRESH)
            } else {
                this._label.set_text('')
                this._restartTimer(result.nextWake)
            }
        } finally {
            this._updating = false
        }
    }
}
