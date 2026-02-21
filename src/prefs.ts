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

        const group = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Configure the appearance of the extension',
        });
        page.add(group);

        // Create a new preferences row
        const row = new Adw.SwitchRow({
            title: 'Show Indicator',
            subtitle: 'Whether to show the panel indicator',
        });
        group.add(row);

        // Create a settings object and bind the row to the `show-indicator` key
        this.getSettings().bind('show-indicator', row, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.addAlignment(page)
        this.addGraphWindowSize(page)
    }

    private addAlignment(page: Adw.PreferencesPage) {
        const settings = this.getSettings();

        const alignGroup = new Adw.PreferencesGroup({
            title: 'Alignment',
            description: 'Configure the position of the indicator',
        });
        page.add(alignGroup);

        const row = new Adw.ActionRow({
            title: 'Position',
            subtitle: 'Horizontal position of the indicator',
        });
        alignGroup.add(row);

        // Create linked toggle buttons
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            valign: Gtk.Align.CENTER,
            css_classes: ['linked'],
            spacing: 0,
        });

        const leftBtn = new Gtk.ToggleButton({
            label: 'Left',
            css_classes: ['flat'],
        });
        const centerBtn = new Gtk.ToggleButton({
            label: 'Center',
            css_classes: ['flat'],
            group: leftBtn,
        });
        const rightBtn = new Gtk.ToggleButton({
            label: 'Right',
            css_classes: ['flat'],
            group: leftBtn,
        });

        box.append(leftBtn);
        box.append(centerBtn);
        box.append(rightBtn);
        row.add_suffix(box);
        row.set_activatable_widget(box);

        // Map setting value → button
        const valueToButton: Record<string, Gtk.ToggleButton> = {
            left: leftBtn,
            center: centerBtn,
            right: rightBtn,
        };

        // Load initial state
        const current = settings.get_string('position');
        (valueToButton[current] ?? leftBtn).set_active(true);

        // Save on toggle
        const onToggle = (btn: Gtk.ToggleButton, value: string) => {
            btn.connect('toggled', () => {
                if (btn.get_active()) {
                    settings.set_string('position', value);
                }
            });
        };
        onToggle(leftBtn, 'left');
        onToggle(centerBtn, 'center');
        onToggle(rightBtn, 'right');
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
