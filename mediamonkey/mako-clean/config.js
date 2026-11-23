/*
 * Mako Clean settings page (Tools > Addons). Same shape as MediaMonkey's
 * output-now-playing-to-file add-on: window.configInfo with load and save.
 * The key must match SETTINGS_KEY in src/actions_add.ts.
 */

window.configInfo = {

    load: function (panel, addon) {
        var UI = getAllUIElements(panel);
        var settings = app.getValue('makoClean_settings', { mapPath: '' });

        UI.editMapPath.controlClass.value = settings.mapPath || '';

        app.listen(UI.btnBrowseMap, 'click', function () {
            app.utils.dialogOpenFile('', 'json', 'JSON file (*.json)|*.json|All files (*.*)|*.*', 'Select the Mako genre map').then(function (filename) {
                if (filename)
                    UI.editMapPath.controlClass.value = filename;
            });
        });
    },

    save: function (panel, addon) {
        var UI = getAllUIElements(panel);
        app.setValue('makoClean_settings', { mapPath: String(UI.editMapPath.controlClass.value || '').trim() });
    }
};
