import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ExamplePreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window: Adw.PreferencesWindow) {
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        this.addAlignment()
        this.addGraphWindowSize(page)
    }

    private addAlignment() {

    }

    private addGraphWindowSize(page: Adw.PreferencesPage) {
        const settings = this.getSettings()
        // ── Graph ────────────────────────────────────────────────────────────
        const graphGroup = new Adw.PreferencesGroup({
            title: 'Graph',
            description: 'Configure the speed history graph',
        });
        page.add(graphGroup);

        const adjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 60,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int('graph-window-size'),
        });

        const graphWindowRow = new Adw.SpinRow({
            title: 'Graph Window Size',
            subtitle: 'Number of minutes of speed history to display',
            adjustment,
        });
        graphGroup.add(graphWindowRow);

        settings.bind(
            'graph-window-size',
            adjustment,       // ← bind to the adjustment, not the row
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
    }
}
