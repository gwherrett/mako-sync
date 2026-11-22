/*
 * Mako Clean preview dialog. Opened by actions_add.js with params.payloadJson: the
 * PreviewPayload built in src/core/runner.ts. Nothing is written here; Apply sets
 * modalResult = 1 and actions_add.js saves the changes after the dialog closes.
 *
 * Plain JavaScript on purpose: MediaMonkey calls this file's global init(params) and
 * reads the global modalResult, the same way its own dialogs work (e.g.
 * dialogs\dlgDeletedTracks.js).
 */

function init(params) {
    title = params.title || 'Mako Clean';
    resizeable = true;
    window.noAutoSize = true; // fixed default size, set in the .html

    var payload = JSON.parse(params.payloadJson);

    renderHeader(qid('header'), payload);
    renderContent(qid('content'), payload);

    window.localListen(qid('btnApply'), 'click', function () {
        modalResult = 1;
    });
}

function addLine(parent, text, className) {
    var label = document.createElement('label');
    label.innerText = text;
    if (className)
        label.classList.add(className);
    parent.appendChild(label);
    return label;
}

function formatDate(iso) {
    if (!iso)
        return 'unknown date';
    var date = new Date(iso);
    return isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function count(n, noun) {
    return n + ' ' + noun + (n === 1 ? '' : 's');
}

function renderHeader(header, payload) {
    addLine(header, 'Genre map exported: ' + formatDate(payload.mapExportedAt));
    addLine(header, count(payload.trackCount, 'track') + ' selected. ' +
        count(payload.rows.length, 'change') + ' on ' + count(payload.changedTrackCount, 'track') + '.');
    addLine(header, 'Nothing is written until you click Apply.', 'unimportantText');
}

function addCell(row, text, tag) {
    var cell = document.createElement(tag || 'td');
    cell.innerText = text;
    cell.style.padding = '0.2em 0.8em 0.2em 0';
    cell.style.textAlign = 'left';
    cell.style.verticalAlign = 'top';
    row.appendChild(cell);
    return cell;
}

function addTable(parent, headings, rows) {
    var table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    var headRow = document.createElement('tr');
    headings.forEach(function (h) { addCell(headRow, h, 'th'); });
    table.appendChild(headRow);
    rows.forEach(function (cells) {
        var tr = document.createElement('tr');
        cells.forEach(function (c) { addCell(tr, c); });
        table.appendChild(tr);
    });
    parent.appendChild(table);
}

function renderContent(content, payload) {
    if (payload.rows.length === 0) {
        addLine(content, 'No changes.');
    } else {
        addTable(content, ['Track', 'File', 'Field', 'Current', 'New', ''],
            payload.rows.map(function (r) {
                return [r.track, r.file, r.field, r.from || '(blank)', r.to, r.overwrite ? 'Overwrite' : ''];
            }));
    }

    if (payload.notes.length > 0) {
        var heading = addLine(content, 'Not changed by a rule (' + payload.notes.length + ')');
        heading.style.display = 'block';
        heading.style.marginTop = '1em';
        heading.style.fontWeight = 'bold';
        addTable(content, ['Track', 'File', 'Reason'],
            payload.notes.map(function (n) { return [n.track, n.file, n.reason]; }));
    }
}
