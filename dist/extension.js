import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { panel as Panel } from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { SpeedOrchestrator } from './core/orchestrator.js';
import { IcePortalProvider } from './providers/ice.js';
import { OebbProvider } from './providers/oebb.js';
import { Logger } from "./core/logger.js";
import { TestProvider } from "./providers/test.js";
const FAST_REFRESH = 1;
export default class RailSpeedExtension extends Extension {
    _label = null;
    _timer = null;
    _currentInterval = 0;
    _LOGGER = Logger.getInstance();
    _orchestrator = null;
    _netmon = null;
    _netmonChangedId = 0;
    enable() {
        const labelContainer = new Button(0.0, 'railSpeed');
        const label = new St.Label({
            text: '--',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        labelContainer.add_child(label);
        this._label = label;
        Panel.addToStatusArea('railSpeed', labelContainer, 0);
        this._LOGGER.info(`Enable ${this.metadata.uuid} (GLib v${GLib.MAJOR_VERSION}.${GLib.MINOR_VERSION}.${GLib.MICRO_VERSION})`);
        this._timer = null;
        const providers = [
            new TestProvider(),
            new IcePortalProvider(),
            new OebbProvider(),
        ];
        this._orchestrator = new SpeedOrchestrator(providers);
        this._netmon = Gio.NetworkMonitor.get_default();
        this._netmonChangedId = this._netmon.connect('network-changed', (_mon, available) => {
            this._LOGGER.info(`Network changed. Available: ${available}`);
            if (this._orchestrator) {
                this._orchestrator.resetAll();
            }
            this._update().catch(e => logError(e));
        });
        this._currentInterval = FAST_REFRESH;
        this._restartTimer(FAST_REFRESH);
        this._update().catch(e => logError(e));
    }
    disable() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        if (this._netmonChangedId && this._netmon) {
            this._netmon.disconnect(this._netmonChangedId);
            this._netmonChangedId = 0;
        }
        this._netmon = null;
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        this._orchestrator = null;
    }
    _restartTimer(seconds) {
        const secs = Math.max(1, Math.round(seconds));
        if (this._timer) {
            GLib.source_remove(this._timer);
        }
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._update().catch(e => logError(e));
            return GLib.SOURCE_CONTINUE;
        });
        this._currentInterval = secs;
    }
    async _update() {
        this._LOGGER.info(`Update`);
        if (!this._orchestrator || !this._label)
            return;
        if (this._netmon && !this._netmon.get_network_available()) {
            this._label.set_text('');
            this._restartTimer(5);
            return;
        }
        const result = await this._orchestrator.tryOnce();
        if (result.ok) {
            this._label.set_text(`🚆 ${result.speed} km/h`);
            if (this._currentInterval !== FAST_REFRESH)
                this._restartTimer(FAST_REFRESH);
        }
        else {
            this._label.set_text('');
            this._restartTimer(result.nextWake);
        }
    }
}
//# sourceMappingURL=extension.js.map