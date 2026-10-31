import * as vscode from 'vscode';
import { KnowledgeGraph } from './types';

export function showKnowledgeGraph(
    extensionUri: vscode.Uri,
    graph: KnowledgeGraph
): void {
    const panel = vscode.window.createWebviewPanel(
        'freeCoderKnowledgeGraph',
        'Free Coder: Knowledge Graph',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = getGraphHtml(
        panel.webview,
        extensionUri,
        graph
    );
}

function getGraphHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    graph: KnowledgeGraph
): string {
    const nonce = getNonce();

    const graphJson = JSON.stringify(graph)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">

    <meta
        http-equiv="Content-Security-Policy"
        content="
            default-src 'none';
            style-src 'unsafe-inline';
            script-src 'nonce-${nonce}';
        "
    >

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Knowledge Graph</title>

    <style>
        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            font-family: var(
                --vscode-font-family,
                Arial,
                sans-serif
            );
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }

        #toolbar {
            height: 48px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;

            background:
                var(--vscode-sideBar-background);

            border-bottom:
                1px solid var(--vscode-panel-border);

            z-index: 10;
        }

        #toolbar button {
            border: none;
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;

            background:
                var(--vscode-button-background);

            color:
                var(--vscode-button-foreground);
        }

        #toolbar button:hover {
            background:
                var(--vscode-button-hoverBackground);
        }

        #search {
            width: 240px;
            padding: 6px 8px;

            border-radius: 4px;
            border: 1px solid
                var(--vscode-input-border);

            background:
                var(--vscode-input-background);

            color:
                var(--vscode-input-foreground);

            outline: none;
        }

        #graph-container {
            position: relative;
            width: 100%;
            height: calc(100% - 48px);
            overflow: hidden;

            cursor: grab;
        }

        #graph-container.dragging {
            cursor: grabbing;
        }

        #graph {
            position: absolute;
            left: 0;
            top: 0;
            transform-origin: 0 0;
        }

        svg {
            position: absolute;
            left: 0;
            top: 0;
            overflow: visible;
        }

        .node {
            position: absolute;

            min-width: 140px;
            max-width: 220px;

            padding: 10px 12px;

            border-radius: 8px;

            background:
                var(--vscode-editorWidget-background);

            border:
                1px solid
                var(--vscode-widget-border);

            box-shadow:
                0 4px 12px rgba(0, 0, 0, 0.25);

            cursor: pointer;

            user-select: none;
        }

        .node:hover {
            border-color:
                var(--vscode-focusBorder);
        }

        .node.selected {
            border:
                2px solid
                var(--vscode-focusBorder);
        }

        .node-title {
            font-weight: 600;
            font-size: 13px;

            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .node-path {
            margin-top: 4px;

            font-size: 10px;

            color:
                var(--vscode-descriptionForeground);

            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #details {
            position: absolute;

            right: 16px;
            top: 16px;

            width: 280px;

            padding: 12px;

            border-radius: 8px;

            background:
                var(--vscode-editorWidget-background);

            border:
                1px solid
                var(--vscode-widget-border);

            box-shadow:
                0 8px 24px rgba(0, 0, 0, 0.3);

            display: none;

            z-index: 20;
        }

        #details.visible {
            display: block;
        }

        #details-title {
            font-weight: 600;
            margin-bottom: 8px;
        }

        #details-path {
            font-size: 11px;

            color:
                var(--vscode-descriptionForeground);

            word-break: break-all;
        }

        #stats {
            margin-left: auto;

            font-size: 11px;

            color:
                var(--vscode-descriptionForeground);
        }

        .edge-label {
            font-size: 10px;
            fill:
                var(--vscode-descriptionForeground);
        }
    </style>
</head>

<body>

<div id="toolbar">

    <button id="zoom-in">
        +
    </button>

    <button id="zoom-out">
        −
    </button>

    <button id="reset">
        Reset
    </button>

    <input
        id="search"
        type="text"
        placeholder="Search files..."
    />

    <span id="stats"></span>

</div>

<div id="graph-container">

    <div id="graph">
        <svg id="edges"></svg>
        <div id="nodes"></div>
    </div>

    <div id="details">
        <div id="details-title"></div>
        <div id="details-path"></div>
    </div>

</div>

<script nonce="${nonce}">

const vscode = acquireVsCodeApi();

const graphData = ${graphJson};

const container =
    document.getElementById('graph-container');

const graph =
    document.getElementById('graph');

const nodesContainer =
    document.getElementById('nodes');

const edgesSvg =
    document.getElementById('edges');

const details =
    document.getElementById('details');

const detailsTitle =
    document.getElementById('details-title');

const detailsPath =
    document.getElementById('details-path');

const stats =
    document.getElementById('stats');

const search =
    document.getElementById('search');

let scale = 1;
let offsetX = 100;
let offsetY = 100;

let isPanning = false;
let panStartX = 0;
let panStartY = 0;

let positions = {};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 70;

stats.textContent =
    graphData.nodes.length +
    ' files · ' +
    graphData.edges.length +
    ' relationships';

function createLayout() {

    const columns =
        Math.max(
            1,
            Math.ceil(
                Math.sqrt(graphData.nodes.length)
            )
        );

    graphData.nodes.forEach(
        (node, index) => {

            const column =
                index % columns;

            const row =
                Math.floor(index / columns);

            positions[node.id] = {
                x: column * 240,
                y: row * 130
            };
        }
    );
}

function render() {

    nodesContainer.innerHTML = '';
    edgesSvg.innerHTML = '';

    const visibleNodes =
        getVisibleNodes();

    visibleNodes.forEach(node => {

        const element =
            document.createElement('div');

        element.className = 'node';

        element.dataset.id = node.id;

        const position =
            positions[node.id];

        element.style.left =
            position.x + 'px';

        element.style.top =
            position.y + 'px';

        element.innerHTML =
            '<div class="node-title">' +
            escapeHtml(node.label) +
            '</div>' +
            '<div class="node-path">' +
            escapeHtml(node.path) +
            '</div>';

        element.addEventListener(
            'click',
            event => {

                event.stopPropagation();

                showDetails(node);
            }
        );

        nodesContainer.appendChild(element);
    });

    drawEdges(visibleNodes);

    updateTransform();
}

function drawEdges(visibleNodes) {

    const visibleIds =
        new Set(
            visibleNodes.map(node => node.id)
        );

    const width = 5000;
    const height = 5000;

    edgesSvg.setAttribute(
        'width',
        width
    );

    edgesSvg.setAttribute(
        'height',
        height
    );

    graphData.edges.forEach(edge => {

        if (
            !visibleIds.has(edge.source) ||
            !visibleIds.has(edge.target)
        ) {
            return;
        }

        const source =
            positions[edge.source];

        const target =
            positions[edge.target];

        if (!source || !target) {
            return;
        }

        const line =
            document.createElementNS(
                'http://www.w3.org/2000/svg',
                'line'
            );

        line.setAttribute(
            'x1',
            source.x + NODE_WIDTH / 2
        );

        line.setAttribute(
            'y1',
            source.y + NODE_HEIGHT / 2
        );

        line.setAttribute(
            'x2',
            target.x + NODE_WIDTH / 2
        );

        line.setAttribute(
            'y2',
            target.y + NODE_HEIGHT / 2
        );

        line.setAttribute(
            'stroke',
            'var(--vscode-descriptionForeground)'
        );

        line.setAttribute(
            'stroke-width',
            '1.5'
        );

        line.setAttribute(
            'marker-end',
            'url(#arrow)'
        );

        edgesSvg.appendChild(line);
    });

    addArrowMarker();
}

function addArrowMarker() {

    const defs =
        document.createElementNS(
            'http://www.w3.org/2000/svg',
            'defs'
        );

    const marker =
        document.createElementNS(
            'http://www.w3.org/2000/svg',
            'marker'
        );

    marker.setAttribute(
        'id',
        'arrow'
    );

    marker.setAttribute(
        'markerWidth',
        '8'
    );

    marker.setAttribute(
        'markerHeight',
        '8'
    );

    marker.setAttribute(
        'refX',
        '7'
    );

    marker.setAttribute(
        'refY',
        '3'
    );

    marker.setAttribute(
        'orient',
        'auto'
    );

    const path =
        document.createElementNS(
            'http://www.w3.org/2000/svg',
            'path'
        );

    path.setAttribute(
        'd',
        'M0,0 L0,6 L7,3 z'
    );

    path.setAttribute(
        'fill',
        'var(--vscode-descriptionForeground)'
    );

    marker.appendChild(path);
    defs.appendChild(marker);
    edgesSvg.appendChild(defs);
}

function getVisibleNodes() {

    const query =
        search.value
            .trim()
            .toLowerCase();

    if (!query) {
        return graphData.nodes;
    }

    return graphData.nodes.filter(
        node =>
            node.label
                .toLowerCase()
                .includes(query) ||
            node.path
                .toLowerCase()
                .includes(query)
    );
}

function showDetails(node) {

    detailsTitle.textContent =
        node.label;

    detailsPath.textContent =
        node.path;

    details.classList.add(
        'visible'
    );

    document
        .querySelectorAll('.node')
        .forEach(element => {

            element.classList.toggle(
                'selected',
                element.dataset.id === node.id
            );
        });
}

function updateTransform() {

    graph.style.transform =
        'translate(' +
        offsetX +
        'px, ' +
        offsetY +
        'px) scale(' +
        scale +
        ')';
}

function zoom(amount) {

    scale *= amount;

    scale =
        Math.max(
            0.25,
            Math.min(3, scale)
        );

    updateTransform();
}

document
    .getElementById('zoom-in')
    .addEventListener(
        'click',
        () => zoom(1.2)
    );

document
    .getElementById('zoom-out')
    .addEventListener(
        'click',
        () => zoom(0.8)
    );

document
    .getElementById('reset')
    .addEventListener(
        'click',
        () => {

            scale = 1;
            offsetX = 100;
            offsetY = 100;

            updateTransform();
        }
    );

search.addEventListener(
    'input',
    render
);

container.addEventListener(
    'mousedown',
    event => {

        if (
            event.target.closest('.node')
        ) {
            return;
        }

        isPanning = true;

        panStartX =
            event.clientX - offsetX;

        panStartY =
            event.clientY - offsetY;

        container.classList.add(
            'dragging'
        );
    }
);

window.addEventListener(
    'mousemove',
    event => {

        if (!isPanning) {
            return;
        }

        offsetX =
            event.clientX - panStartX;

        offsetY =
            event.clientY - panStartY;

        updateTransform();
    }
);

window.addEventListener(
    'mouseup',
    () => {

        isPanning = false;

        container.classList.remove(
            'dragging'
        );
    }
);

function escapeHtml(value) {

    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

createLayout();
render();

</script>

</body>
</html>
`;
}

function getNonce(): string {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    let result = '';

    for (let i = 0; i < 32; i++) {
        result += chars.charAt(
            Math.floor(
                Math.random() * chars.length
            )
        );
    }

    return result;
}