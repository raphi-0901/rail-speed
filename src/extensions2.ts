import '@girs/gdk-4.0'

import Gtk from 'gi://Gtk?version=4.0';


import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import Soup from 'gi://Soup'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

import { SpeedOrchestrator } from './core/orchestrator.js'
import { IcePortalProvider } from './providers/ice.js'
import { OebbProvider } from './providers/oebb.js'
import { GnomeHttpClient } from './platform/gnome-fetch.js'
import { GnomeTimeSource } from './platform/time.js'

const FAST_REFRESH = 1

export default class TrainSpeedExtension extends Extension {
    private button = new Gtk.Button();


    private _label: typeof St.Label | null = null
    private _timer: number | null = null
    private _currentInterval: number = 0

    private _session: any = null
    private _http: GnomeHttpClient | null = null
    private _time: GnomeTimeSource | null = null

    private _orchestrator: SpeedOrchestrator | null = null

    private _netmon: Gio.NetworkMonitor | null = null
    private _netmonChangedId: number = 0

    enable() {
        // -----------------------
        // UI
        // -----------------------
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        })

        Main.panel._centerBox.insert_child_at_index(this._label, 0)

        // -----------------------
        // Platform objects
        // -----------------------
        this._session = new Soup.Session()
        this._http = new GnomeHttpClient(this._session)
        this._time = new GnomeTimeSource()

        // -----------------------
        // Providers
        // -----------------------
        const providers = [
            new IcePortalProvider(this._http),
            new OebbProvider(this._http),
        ]

        // -----------------------
        // Core orchestrator
        // -----------------------
        this._orchestrator = new SpeedOrchestrator(
            providers,
            this._time
        )

        // -----------------------
        // Network monitor
        // -----------------------
        this._netmon = Gio.NetworkMonitor.get_default()

        this._netmonChangedId = this._netmon.connect(
            'network-changed',
            (_mon, available) => {
                // Reset all backoffs when network changes
                if (this._orchestrator)
                    this._orchestrator.resetAll()

                // Optional immediate retry
                this._update().catch(e => logError(e))
            }
        )

        // -----------------------
        // Timer
        // -----------------------
        this._currentInterval = FAST_REFRESH
        this._restartTimer(FAST_REFRESH)

        // Immediate first run
        this._update().catch(e => logError(e))
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
        if (this._label) {
            this._label.destroy()
            this._label = null
        }

        // -----------------------
        // Drop platform objects
        // -----------------------
        this._session = null
        this._http = null
        this._time = null

        // -----------------------
        // Drop core
        // -----------------------
        this._orchestrator = null
    }

    _restartTimer(seconds) {
        const secs = Math.max(1, Math.round(seconds))

        if (this._timer)
            GLib.source_remove(this._timer)

        this._timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            secs,
            () => {
                this._update().catch(e => logError(e))
                return GLib.SOURCE_CONTINUE
            }
        )

        this._currentInterval = secs
    }

    async _update() {
        if (!this._orchestrator || !this._label)
            return

        // Avoid pointless polling if offline
        if (this._netmon && !this._netmon.get_network_available()) {
            this._label.set_text('')
            this._restartTimer(5)
            return
        }

        const result = await this._orchestrator.tryOnce()

        if (result.ok) {
            this._label.set_text(`🚆 ${result.speed} km/h`)

            if (this._currentInterval !== FAST_REFRESH)
                this._restartTimer(FAST_REFRESH)

        } else {
            this._label.set_text('')
            this._restartTimer(result.nextWake)
        }
    }
}
