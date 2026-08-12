// ==UserScript==
// @name            Lichess - Detailed Moves 2
// @license         GPL-3.0-only
// @namespace       https://github.com/victorigp/Lichess_Detailed_Moves_2
// @contributionURL https://github.com/victorigp/Lichess_Detailed_Moves_2
// @version         1.32
// @description     Muestra jugadas brillantes, excelentes, buenas y de libro en los apartados de análisis y de estudio de Lichess sin necesidad de recargar la página. Al hacer clic sobre los textos de las jugadas, nos muestra su posición en el tablero con sus iconos correspondientes. Modificación del script Lichess - Detailed Moves by Seall.DEV & Thomas Sihapnya
// @author          Víctor Iglesias
// @require         https://greasyfork.org/scripts/47911-font-awesome-all-js/code/Font-awesome%20AllJs.js?version=275337
// @include         /^https\:\/\/lichess\.org\/[a-zA-Z0-9]{8,}/
// @include         /^https\:\/\/lichess\.org\/study\/.*/
// @grant           GM.xmlHttpRequest
// @grant           unsafeWindow
// @grant           GM_addStyle
// @inject-into     content
// ==/UserScript==
// ==OpenUserJS==
// @author          victorigp
// ==/OpenUserJS==

(function () {
    'use strict';

    // --- Inject Styles ---
    const customStyle = document.createElement('style');
    customStyle.textContent = `
        .custom-move-stat { cursor: pointer; user-select: none; transition: opacity 0.2s; }
        .custom-move-stat:hover { opacity: 0.8; }
        .advice-summary__acpl > div { cursor: pointer; }
        
        move[data-custom-type="brilliant"].active, u8[data-custom-type="brilliant"].active { background-color: rgba(27, 172, 166, 1) !important; color: white !important; }
        move[data-custom-type="excellent"].active, u8[data-custom-type="excellent"].active { background-color: rgba(150, 188, 75, 1) !important; color: white !important; }
        move[data-custom-type="good"].active, u8[data-custom-type="good"].active { background-color: rgba(178, 241, 150, 1) !important; color: white !important; }
        move[data-custom-type="book"].active, u8[data-custom-type="book"].active { background-color: rgba(168, 136, 101, 1) !important; color: white !important; }
        
        move[data-custom-type="brilliant"]:not(.active) san, u8[data-custom-type="brilliant"]:not(.active) san, move[data-custom-type="brilliant"]:not(.active) .custom-move-glyph { color: #1baca6 !important; fill: #1baca6 !important; }
        move[data-custom-type="excellent"]:not(.active) san, u8[data-custom-type="excellent"]:not(.active) san, move[data-custom-type="excellent"]:not(.active) .custom-move-glyph { color: #96bc4b !important; fill: #96bc4b !important; }
        move[data-custom-type="good"]:not(.active) san, u8[data-custom-type="good"]:not(.active) san, move[data-custom-type="good"]:not(.active) .custom-move-glyph { color: #b2f196 !important; fill: #b2f196 !important; }
        move[data-custom-type="book"]:not(.active) san, u8[data-custom-type="book"]:not(.active) san, move[data-custom-type="book"]:not(.active) .custom-move-glyph { color: #a88865 !important; fill: #a88865 !important; }
        
        move[data-custom-type].active san, u8[data-custom-type].active san, move[data-custom-type].active .custom-move-glyph { color: white !important; fill: white !important; }
        
        glyph.custom-move-glyph {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            margin-left: 4px !important;
            font-size: 0.9em !important;
            font-weight: bold !important;
            vertical-align: middle !important;
            background: none !important;
            box-shadow: none !important;
        }
    `;
    (document.head || document.documentElement).appendChild(customStyle);
    // --- Config ---
    const GOOD_MOVE_THRESOLD = 0.6;
    const EXCELLENT_MOVE_THRESOLD = 1.0;
    const BRILLANT_MOVE_THRESOLD = 2.0;
    const CHECKMATE_IN_X_MOVES_VALUE = 100;
    const PROCESSING_DEBOUNCE = 550;
    const WAIT_FOR_SUMMARY_TIMEOUT = 5000;
    const WAIT_FOR_SUMMARY_INTERVAL = 250;
    const ANALYSIS_INACTIVITY_TIMEOUT = 7000; // Fallback inactivity timeout
    const SHOW_SAN_NOT_FOUND_WARNINGS = false;
    const LOADER_ID = 'acpl-chart-container-loader'; // <-- Use ID now

    // --- Globals ---
    let currentEcoCodes = null;
    let observer = null;
    let analysisCompletionTimer = null;
    let processingDebounceTimer = null;
    let isProcessing = false;
    let observerTargetNode = null;
    let observerConfig = { childList: true, subtree: true, characterData: true };
    let currentMovesData = { white: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 }, black: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 } };
    let processedNodesForBook = new Set();

    // --- Util ---
    function waitForElement(selector, callback, timeout = WAIT_FOR_SUMMARY_TIMEOUT, interval = WAIT_FOR_SUMMARY_INTERVAL) {
        const startTime = Date.now();
        let elementFound = false;
        const timer = setInterval(() => {
            if (!isProcessing || elementFound) { clearInterval(timer); return; }
            const element = document.querySelector(selector);
            if (element) {
                elementFound = true; clearInterval(timer);
                if (isProcessing) callback(element);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(timer);
                console.warn(`Timed out waiting for element "${selector}".`);
                if (isProcessing) finishProcessing(false);
            }
        }, interval);
    }

    // --- Observer ---
    function startObserverObservation() {
        if (observer && observerTargetNode) {
            try { observer.observe(observerTargetNode, observerConfig); console.log("Observer watching for changes..."); }
            catch (e) { console.error("Error starting observer.", e); }
        } else if (!observerTargetNode) { console.warn("Cannot start observer, target node not set."); }
    }

    // --- Core ---
    function loadEcoCodesApi(callback) {
        if (currentEcoCodes !== null) { callback(); return; }
        console.log('Loading ECO codes...');
        const ecoCodesApiUrl = 'https://github.com/victorigp/Lichess_Detailed_Moves_2/raw/main/data/eco.json';
        GM.xmlHttpRequest({
            method: "GET", url: ecoCodesApiUrl,
            onload: function (response) {
                let codes = [];
                try { codes = JSON.parse(response.responseText); console.log(`ECO codes loaded (${codes?.length || 0}).`); }
                catch (e) { console.error('Error parsing ECO codes.', e); codes = []; }
                finally { currentEcoCodes = codes; callback(); }
            },
            onerror: function (err) { console.error('Error fetching ECO codes.', err); currentEcoCodes = []; callback(); }
        });
    }

    function checkColor(index) { return (index % 2 === 0) ? "white" : "black"; }

    function triggerProcessing(reason = "Unknown") { // Add reason for clarity
        clearTimeout(processingDebounceTimer);
        processingDebounceTimer = setTimeout(() => {
            console.log(`Processing triggered by: ${reason}. Running after debounce...`);
            loadEcoCodesApi(processMovesAndSummary);
        }, PROCESSING_DEBOUNCE);
    }

    function getMoveColor(m) {
        if (m.classList.contains('white')) return 'white';
        if (m.classList.contains('black')) return 'black';
        const prev = m.previousElementSibling;
        if (prev) {
            if (prev.tagName === 'INDEX') {
                return prev.textContent.includes('...') ? 'black' : 'white';
            }
            if (prev.tagName === 'MOVE' || prev.tagName === 'U8') {
                return getMoveColor(prev) === 'white' ? 'black' : 'white';
            }
        }
        const parent = m.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === 'MOVE' || c.tagName === 'U8');
            const pos = siblings.indexOf(m);
            const firstChild = parent.firstElementChild;
            let offset = 0;
            if (firstChild && firstChild.tagName === 'INDEX' && firstChild.textContent.includes('...')) {
                offset = 1;
            }
            return ((pos + offset) % 2 === 0) ? 'white' : 'black';
        }
        return 'white';
    }

    function processMovesAndSummary() {
        if (isProcessing) { console.log("Already processing, skipping trigger."); return; }
        isProcessing = true;
        console.log('Processing moves and summary...');

        if (currentEcoCodes === null || !Array.isArray(currentEcoCodes)) {
            console.error("ECO codes not ready! Aborting."); finishProcessing(false); return;
        }

        currentMovesData = { white: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 }, black: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 } };
        processedNodesForBook.clear();

        const potentialContainers = document.querySelectorAll('.analyse__moves .tview2-column, .gamebook .tview2-column, div.tview2.tview2-column, rmoves, l4x, .analyse__moves, .gamebook');
        let moveContainer = null;
        for (let container of potentialContainers) { if (container.querySelector('move, u8')) { moveContainer = container; break; } }
        if (!moveContainer) { console.warn('No move container found during processing.'); finishProcessing(false); return; }

        const domMoves = moveContainer.querySelectorAll('move, u8');
        if (!domMoves || domMoves.length === 0) { console.warn('No moves found during processing.'); finishProcessing(false); return; }

        // Clear previous annotations
        domMoves.forEach(domMove => {
            const sanNode = domMove.querySelector('san, kw');
            if (sanNode) {
                sanNode.style.color = '';
                const addedSpan = sanNode.querySelector('span[style^="color"], span.book-icon-wrapper');
                if (addedSpan) { sanNode.innerHTML = addedSpan.textContent.replace(/[!?]$|!!$/, '').trim(); }
                else { sanNode.innerHTML = sanNode.innerHTML.replace(/[!?]$|!!$/, '').trim(); }
            }
            domMove.removeAttribute('title');
            domMove.style.backgroundColor = '';
            domMove.querySelectorAll('.custom-move-glyph').forEach(g => g.remove());
            domMove.querySelectorAll('.lichess-native-hidden').forEach(g => {
                g.style.display = '';
                g.classList.remove('lichess-native-hidden');
            });
        });
        const summaryContainer = document.querySelector('.advice-summary, .advice-summary__sections');
        if (summaryContainer) { summaryContainer.querySelectorAll('.custom-move-stat').forEach(el => el.remove()); }

        let moves = [];
        let previousEval = { value: 0 };

        domMoves.forEach((domMove, domIndex) => {
            if (domMove.classList.contains('empty')) return;
            const sanNode = domMove.querySelector('san, kw');
            if (sanNode) {
                const originalMoveHTML = sanNode.innerHTML.trim();
                const isCheckmatingMove = originalMoveHTML.endsWith('#');
                moves.push(originalMoveHTML);
                let currentMoveIndex = moves.length - 1;
                let currentColor = getMoveColor(domMove);
                let isBookMove = !!domMove.querySelector('i.fa-book');

                // Handle opening moves
                if (!isBookMove && currentEcoCodes.length > 0) {
                    let currentPgn = createPgnMoves(moves);
                    let foundOpening = currentEcoCodes.find(eco => eco.moves.toLowerCase().trim() == currentPgn.toLowerCase().trim());
                    if (foundOpening) {
                        const hasNativeGlyph = domMove.querySelector('glyph:not(.custom-move-glyph)');
                        const hasNegativeClass = domMove.classList.contains('inaccuracy') || domMove.classList.contains('mistake') || domMove.classList.contains('blunder');
                        if (!hasNativeGlyph && !hasNegativeClass) {
                            handleOpeningMoveStrict(sanNode, originalMoveHTML, foundOpening, currentColor, domMove);
                            isBookMove = true;
                        }
                    }
                } else if (isBookMove && !processedNodesForBook.has(domMove)) {
                    currentMovesData[currentColor].book++;
                    processedNodesForBook.add(domMove);
                }

                // Strict v0.5 Evaluation Logic
                let currentEval = { value: previousEval.value };
                const evalNode = domMove.querySelector('eval, e');

                if (!isBookMove && !isCheckmatingMove) {
                    if (evalNode) {
                        let evalText = evalNode.innerHTML.trim();
                        if (evalText.startsWith('#')) { currentEval.value = (currentColor === 'white') ? -CHECKMATE_IN_X_MOVES_VALUE : CHECKMATE_IN_X_MOVES_VALUE; }
                        else { let parsedVal = parseFloat(evalText); currentEval.value = isNaN(parsedVal) ? 0 : parsedVal; }

                        // Only add custom annotations if Lichess hasn't already classified this move as bad
                        const hasNativeGlyph = domMove.querySelector('glyph:not(.custom-move-glyph)');
                        const hasNegativeClass = domMove.classList.contains('inaccuracy') || domMove.classList.contains('mistake') || domMove.classList.contains('blunder');

                        if (currentMoveIndex > 0 && !hasNativeGlyph && !hasNegativeClass) {
                            let delta = currentEval.value - previousEval.value;
                            let annotationAdded = false;
                            if (currentColor === 'white') {
                                if (delta >= BRILLANT_MOVE_THRESOLD) { setCustomGlyph(domMove, sanNode, 'brilliant', '#1baca6', '!!', 'Brillante'); currentMovesData.white.brillant++; annotationAdded = true; }
                                if (!annotationAdded && delta >= EXCELLENT_MOVE_THRESOLD) { setCustomGlyph(domMove, sanNode, 'excellent', '#96bc4b', '!', 'Excelente'); currentMovesData.white.excellent++; annotationAdded = true; }
                                if (!annotationAdded && delta >= GOOD_MOVE_THRESOLD) { setCustomGlyph(domMove, sanNode, 'good', '#b2f196', '!?', 'Buena'); currentMovesData.white.good++; annotationAdded = true; }
                            } else { // Black
                                if (delta <= -BRILLANT_MOVE_THRESOLD) { setCustomGlyph(domMove, sanNode, 'brilliant', '#1baca6', '!!', 'Brillante'); currentMovesData.black.brillant++; annotationAdded = true; }
                                if (!annotationAdded && delta <= -EXCELLENT_MOVE_THRESOLD) { setCustomGlyph(domMove, sanNode, 'excellent', '#96bc4b', '!', 'Excelente'); currentMovesData.black.excellent++; annotationAdded = true; }
                                if (!annotationAdded && delta <= -GOOD_MOVE_THRESOLD) { setCustomGlyph(domMove, sanNode, 'good', '#b2f196', '!?', 'Buena'); currentMovesData.black.good++; annotationAdded = true; }
                            }
                        }
                    }
                } else { // Skipped eval annotation
                    if (evalNode) {
                        let evalText = evalNode.innerHTML.trim();
                        if (evalText.startsWith('#')) { currentEval.value = (currentColor === 'white') ? -CHECKMATE_IN_X_MOVES_VALUE : CHECKMATE_IN_X_MOVES_VALUE; }
                        else { let parsedVal = parseFloat(evalText); currentEval.value = isNaN(parsedVal) ? 0 : parsedVal; }
                    }
                }
                // Update previous state
                previousEval = currentEval;

            } else if (SHOW_SAN_NOT_FOUND_WARNINGS) { console.warn(`No <san> tag found.`); }
        }); // End domMoves loop

        console.log('Move processing finished.');
        waitForElement('.advice-summary', (summaryContainer) => showDataInTable(summaryContainer));

    } // End processMovesAndSummary

    const BOOK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" style="width:0.8em;height:0.8em;vertical-align:middle;"><path d="M96 0C43 0 0 43 0 96V416c0 53 43 96 96 96H384h32c17.7 0 32-14.3 32-32s-14.3-32-32-32V384c17.7 0 32-14.3 32-32V32c0-17.7-14.3-32-32-32H384 96zm0 384H352v64H96c-17.7 0-32-14.3-32-32s14.3-32 32-32zm32-240c0-8.8 7.2-16 16-16H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16zm16 48H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16s7.2-16 16-16z"/></svg>`;

    function setCustomGlyph(domMove, sanNode, type, color, symbol, title) {
        domMove.querySelectorAll('glyph:not(.custom-move-glyph)').forEach(g => { g.style.display = 'none'; g.classList.add('lichess-native-hidden'); });
        domMove.querySelectorAll('.custom-move-glyph').forEach(g => g.remove());

        const customGlyph = document.createElement('glyph');
        customGlyph.className = 'custom-move-glyph';
        customGlyph.setAttribute('data-glyph-type', type);
        customGlyph.setAttribute('data-color', color);
        customGlyph.title = title;
        customGlyph.style.background = 'none';

        if (type === 'book') {
            customGlyph.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" style="width:0.85em;height:0.85em;vertical-align:middle;"><path d="M96 0C43 0 0 43 0 96V416c0 53 43 96 96 96H384h32c17.7 0 32-14.3 32-32s-14.3-32-32-32V384c17.7 0 32-14.3 32-32V32c0-17.7-14.3-32-32-32H384 96zm0 384H352v64H96c-17.7 0-32-14.3-32-32s14.3-32 32-32zm32-240c0-8.8 7.2-16 16-16H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16zm16 48H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16s7.2-16 16-16z"/></svg>`;
        } else {
            customGlyph.textContent = symbol;
        }

        if (sanNode) {
            if (sanNode.nextSibling) {
                domMove.insertBefore(customGlyph, sanNode.nextSibling);
            } else {
                domMove.appendChild(customGlyph);
            }
        }

        domMove.setAttribute('data-custom-type', type);
    }

    function handleOpeningMoveStrict(sanNode, originalMoveText, opening, currentColor, domMove) {
        if (domMove.querySelector('.custom-move-glyph')) return;
        const titleText = opening.name;

        setCustomGlyph(domMove, sanNode, 'book', '#a88865', 'Book', titleText);

        if (domMove) {
            domMove.title = titleText;
            if (!processedNodesForBook.has(domMove)) { currentMovesData[currentColor].book++; processedNodesForBook.add(domMove); }
        }
    }

    function createPgnMoves(movesArray) {
        let pgn = '';
        movesArray.forEach((move, index) => {
            const cleanMove = move.replace(/<[^>]*>/g, '');
            if (checkColor(index) === "white") { pgn += `${Math.floor(index / 2) + 1}. ${cleanMove}`; }
            else { pgn += ` ${cleanMove} `; }
        });
        return pgn.trim();
    }

    const statCycleMap = {};

    function makeStatClickable(element, sideColor, category) {
        if (element.hasAttribute('data-clickable-attached')) return;
        element.setAttribute('data-clickable-attached', 'true');
        element.style.cursor = 'pointer';
        element.title = 'Haz clic para ir a esta jugada';
        element.addEventListener('click', (e) => {
            const allMoves = Array.from(document.querySelectorAll('move, u8')).filter(m => !m.classList.contains('empty'));
            const matchingMoves = allMoves.filter((m) => {
                const moveColor = getMoveColor(m);
                if (moveColor !== sideColor) return false;

                if (category === 'book') return m.querySelector('.custom-move-glyph[data-glyph-type="book"]');
                if (category === 'brilliant') return m.querySelector('.custom-move-glyph[data-glyph-type="brilliant"]');
                if (category === 'excellent') return m.querySelector('.custom-move-glyph[data-glyph-type="excellent"]');
                if (category === 'good') return m.querySelector('.custom-move-glyph[data-glyph-type="good"]');
                if (category === 'inaccuracy') return m.classList.contains('inaccuracy') || (m.querySelector('glyph') && m.querySelector('glyph').textContent.includes('?!'));
                if (category === 'mistake') return m.classList.contains('mistake') || (m.querySelector('glyph') && m.querySelector('glyph').textContent === '?');
                if (category === 'blunder') return m.classList.contains('blunder') || (m.querySelector('glyph') && m.querySelector('glyph').textContent.includes('??'));
                return false;
            });

            if (matchingMoves.length > 0) {
                const key = `${sideColor}-${category}`;
                const nextIdx = (statCycleMap[key] || 0) % matchingMoves.length;
                const targetMove = matchingMoves[nextIdx];

                targetMove.scrollIntoView({ behavior: 'smooth', block: 'center' });

                const clickTarget = targetMove;

                try {
                    clickTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                    clickTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                } catch (err) { }

                clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                clickTarget.click();

                statCycleMap[key] = nextIdx + 1;
            }
        });
    }

    function showDataInTable(summaryContainer) {
        console.log('Updating summary table...');
        if (!summaryContainer || !isProcessing) { console.warn(`Invalid summary or processing flag false.`); finishProcessing(false); return; }
        const summarySides = summaryContainer.querySelectorAll('.advice-summary__side');
        if (summarySides.length < 2) { console.warn(`Less than 2 summary sides.`); finishProcessing(false); return; }
        const whiteSide = Array.from(summarySides).find(side => side.querySelector('.color-icon.white'));
        const blackSide = Array.from(summarySides).find(side => side.querySelector('.color-icon.black'));
        if (!whiteSide || !blackSide) { console.warn('Could not ID white/black summary sides.'); finishProcessing(false); return; }

        function dataPoint(colour, symbol, data, text, side, coloured, className, category) {
            let container = side.querySelector('.advice-summary__acpl') || side;
            let beforeNode = null;
            const childNodes = Array.from(container.childNodes);
            const insertBeforeTerms = ['imprecisiones', 'Imprecisiones', 'imprecisión', 'Imprecisión', 'inaccuracies', 'Inaccuracies', 'inaccuracy', 'Inaccuracy', 'Error', 'Errores', 'Mistake', 'Errores graves', 'Blunder', 'Pérdida promedio', 'average centipawn loss', 'Precisión', 'Accuracy'];

            for (const term of insertBeforeTerms) {
                const potentialNode = childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && (node.textContent || '').includes(term));
                if (potentialNode?.offsetParent) { beforeNode = potentialNode; break; }
            }

            const div = document.createElement('div');
            if (data !== 0 && coloured) { div.style.color = coloured; }
            div.classList.add('custom-move-stat', className, 'symbol', 'advice-summary__error');
            div.setAttribute('data-color', colour);
            div.setAttribute('data-symbol', symbol);

            const strong = document.createElement('strong');
            strong.textContent = data;

            div.appendChild(strong);
            div.appendChild(document.createTextNode(' ' + text));

            makeStatClickable(div, colour, category);

            if (beforeNode) { container.insertBefore(div, beforeNode); } else { container.appendChild(div); }
        }

        dataPoint('white', '!!', currentMovesData.white.brillant, ' Brillantes', whiteSide, '#1baca6', 'stat-brilliant-w', 'brilliant');
        dataPoint('white', '!', currentMovesData.white.excellent, ' Excelentes', whiteSide, '#96bc4b', 'stat-excellent-w', 'excellent');
        dataPoint('white', '!?', currentMovesData.white.good, ' Buenas', whiteSide, '#b2f196', 'stat-good-w', 'good');
        dataPoint('white', 'Book', currentMovesData.white.book, ' De libro', whiteSide, '#a88865', 'stat-book-w', 'book');
        dataPoint('black', '!!', currentMovesData.black.brillant, ' Brillantes', blackSide, '#1baca6', 'stat-brilliant-b', 'brilliant');
        dataPoint('black', '!', currentMovesData.black.excellent, ' Excelentes', blackSide, '#96bc4b', 'stat-excellent-b', 'excellent');
        dataPoint('black', '!?', currentMovesData.black.good, ' Buenas', blackSide, '#b2f196', 'stat-good-b', 'good');
        dataPoint('black', 'Book', currentMovesData.black.book, ' De libro', blackSide, '#a88865', 'stat-book-b', 'book');

        function enableClickOnNativeStats(side, sideColor) {
            const container = side.querySelector('.advice-summary__acpl') || side;
            Array.from(container.childNodes).forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                const txt = (node.textContent || '').toLowerCase();
                if (txt.includes('imprecisi') || txt.includes('inaccuracy')) makeStatClickable(node, sideColor, 'inaccuracy');
                else if (txt.includes('errores graves') || txt.includes('blunder')) makeStatClickable(node, sideColor, 'blunder');
                else if (txt.includes('error') || txt.includes('mistake')) makeStatClickable(node, sideColor, 'mistake');
            });
        }

        enableClickOnNativeStats(whiteSide, 'white');
        enableClickOnNativeStats(blackSide, 'black');

        console.log('Summary table updated successfully.');
        finishProcessing(true); // Finish successfully
    }

    const GLYPH_COLORS = {
        'book': '#a88865',
        'brilliant': '#1baca6',
        'excellent': '#96bc4b',
        'good': '#b2f196'
    };


    // Parse destination square from SAN text (e.g. "e4"->"e4", "Nf3"->"f3", "Bxc6+"->"c6", "O-O"->castling)
    function getDestSquareFromSan(san, moveColor) {
        if (!san) return null;
        const clean = san.replace(/[+#!?]/g, '').trim();
        if (clean === 'O-O') return moveColor === 'white' ? 'g1' : 'g8';
        if (clean === 'O-O-O') return moveColor === 'white' ? 'c1' : 'c8';
        const match = clean.match(/([a-h][1-8])(?:=[QRBN])?$/);
        return match ? match[1] : null;
    }

    // Compute transform for a square given board orientation
    function squareToTransform(sq, isFlipped) {
        const fileIndex = sq.charCodeAt(0) - 97; // a=0, h=7
        const rankIndex = parseInt(sq[1]) - 1;     // 1=0, 8=7
        let x, y;
        if (!isFlipped) { // White at bottom
            x = fileIndex * 100;
            y = (7 - rankIndex) * 100;
        } else { // Black at bottom
            x = (7 - fileIndex) * 100;
            y = rankIndex * 100;
        }
        return `translate(${x}%, ${y}%)`;
    }

    function syncBoardGlyph() {
        const activeMove = document.querySelector('move.active, u8.active');
        const board = document.querySelector('cg-board');
        if (!board) return;

        // Clean up existing custom glyphs
        board.querySelectorAll('.custom-board-glyph').forEach(el => el.remove());

        // Restore any hidden native glyphs
        board.querySelectorAll('glyph').forEach(el => { el.style.display = ''; });

        if (!activeMove) return;

        // Determine what custom icon the active move has
        let glyphColor = null;
        let glyphSymbol = null;
        let glyphIcon = null;

        const customGlyphNode = activeMove.querySelector('.custom-move-glyph');
        if (customGlyphNode) {
            const glyphType = customGlyphNode.getAttribute('data-glyph-type');
            glyphColor = customGlyphNode.getAttribute('data-color') || GLYPH_COLORS[glyphType] || '#a88865';
            if (glyphType === 'book') {
                glyphIcon = 'book';
            } else {
                glyphSymbol = customGlyphNode.textContent;
            }
        }

        if (!glyphColor) return;

        // Hide the native Lichess glyph since we are overriding it
        board.querySelectorAll('glyph').forEach(el => { el.style.display = 'none'; });

        // Determine destination square by parsing the SAN text from the active move
        const sanNode = activeMove.querySelector('san, kw');
        if (!sanNode) return;
        const sanText = sanNode.textContent.trim();

        // Determine move color: check if this move is white's or black's
        // In Lichess studies, white moves are typically first in a pair
        const moveIndex = activeMove.querySelector('index');
        let moveColor = 'white';
        // If the move appears after "..." or is the second move in a pair, it's black
        if (activeMove.previousElementSibling && activeMove.previousElementSibling.tagName === 'MOVE' && !activeMove.previousElementSibling.classList.contains('empty')) {
            moveColor = 'black';
        }
        // Also check if there's a native color indicator
        const prevSibling = activeMove.previousElementSibling;
        if (prevSibling && prevSibling.classList && prevSibling.classList.contains('empty')) {
            moveColor = 'black'; // "..." empty move means this is black's turn
        }

        const destSq = getDestSquareFromSan(sanText, moveColor);
        if (!destSq) return;

        // Determine board orientation
        const cgWrap = document.querySelector('.cg-wrap');
        const isFlipped = cgWrap ? cgWrap.classList.contains('orientation-black') : false;

        const transform = squareToTransform(destSq, isFlipped);

        const customGlyph = document.createElement('div');
        customGlyph.className = 'custom-board-glyph';
        customGlyph.style.position = 'absolute';
        customGlyph.style.transform = transform;
        customGlyph.style.width = '12.5%';
        customGlyph.style.height = '12.5%';
        customGlyph.style.zIndex = '10';
        customGlyph.style.pointerEvents = 'none';

        const bubble = document.createElement('div');
        bubble.style.position = 'absolute';
        bubble.style.top = '-12%';
        bubble.style.right = '-12%';
        bubble.style.width = '45%';
        bubble.style.height = '45%';
        bubble.style.backgroundColor = glyphColor;
        bubble.style.borderRadius = '50%';
        bubble.style.color = 'white';
        bubble.style.display = 'flex';
        bubble.style.justifyContent = 'center';
        bubble.style.alignItems = 'center';
        bubble.style.fontWeight = 'bold';
        bubble.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        bubble.style.fontFamily = 'sans-serif';
        bubble.style.zIndex = '11';
        bubble.style.containerType = 'size';

        if (glyphIcon) {
            bubble.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="white" style="width:55%;height:55%;"><path d="M96 0C43 0 0 43 0 96V416c0 53 43 96 96 96H384h32c17.7 0 32-14.3 32-32s-14.3-32-32-32V384c17.7 0 32-14.3 32-32V32c0-17.7-14.3-32-32-32H384 96zm0 384H352v64H96c-17.7 0-32-14.3-32-32s14.3-32 32-32zm32-240c0-8.8 7.2-16 16-16H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16zm16 48H336c8.8 0 16 7.2 16 16s-7.2 16-16 16H144c-8.8 0-16-7.2-16-16s7.2-16 16-16z"/></svg>`;
        } else {
            const span = document.createElement('span');
            span.textContent = glyphSymbol;
            span.style.fontSize = '60cqmin';
            bubble.appendChild(span);
        }

        customGlyph.appendChild(bubble);
        board.appendChild(customGlyph);
    }

    function triggerSync() {
        // Use longer delays to ensure chessground animation (200ms) has completed
        setTimeout(syncBoardGlyph, 50);
        setTimeout(syncBoardGlyph, 300);
    }

    let moveListObserver = null;
    function setupBoardSync() {
        if (moveListObserver) return;
        const moveContainer = document.querySelector('.analyse__moves, .study__moves, .gamebook, rmoves, l4x, .tview2');
        if (!moveContainer) {
            setTimeout(setupBoardSync, 1000);
            return;
        }
        moveListObserver = new MutationObserver((mutations) => {
            let activeChanged = false;
            for (let m of mutations) {
                if (m.attributeName === 'class' && (m.target.tagName === 'U8' || m.target.tagName === 'MOVE')) {
                    activeChanged = true;
                    break;
                }
            }
            if (activeChanged) triggerSync();
        });
        moveListObserver.observe(moveContainer, { attributes: true, subtree: true, attributeFilter: ['class'] });

        // Also observe board for native glyph injections
        const board = document.querySelector('cg-board');
        if (board) {
            new MutationObserver((mutations) => {
                for (let m of mutations) {
                    if (m.addedNodes.length) {
                        for (let n of m.addedNodes) {
                            if (n.tagName === 'GLYPH') triggerSync();
                        }
                    }
                }
            }).observe(board, { childList: true });
        }
    }

    function finishProcessing(success) {
        if (isProcessing) { isProcessing = false; }
        triggerSync();
    }

    // --- Observer Setup ---
    function setupObserver() {
        observerTargetNode = document.querySelector('main.analyse, main.study');
        if (!observerTargetNode) { console.warn("Could not find main container for Observer."); return; }

        const observerCallback = (mutationsList, obs) => {
            if (isProcessing) return; // Ignore mutations during processing

            let loaderRemoved = false;
            let evalChanged = false;

            for (const mutation of mutationsList) {
                // Check for loader removal FIRST
                if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
                    if (Array.from(mutation.removedNodes).some(node => node.nodeType === Node.ELEMENT_NODE && node.id === LOADER_ID)) {
                        loaderRemoved = true;
                        break; // Prioritize this signal
                    }
                }
                // Check for eval text changes if loader wasn't removed in this batch
                if (!loaderRemoved && mutation.type === 'characterData' && mutation.target.parentElement?.tagName === 'EVAL') {
                    evalChanged = true;
                }
            }

            // --- Triggering Logic ---
            if (loaderRemoved) {
                // Analysis likely finished based on loader removal
                console.log(`Analysis loader #${LOADER_ID} removed. Debouncing processing trigger...`);
                clearTimeout(analysisCompletionTimer); // Clear inactivity timer
                triggerProcessing("Loader Removed"); // Trigger processing via debounce
            } else if (evalChanged) {
                // Analysis is actively running, reset inactivity timer (fallback)
                // console.log("Eval change detected. Resetting inactivity timer.");
                clearTimeout(analysisCompletionTimer);
                clearTimeout(processingDebounceTimer); // Cancel pending processing if activity resumes
                analysisCompletionTimer = setTimeout(() => {
                    console.log(`Analysis inactivity detected (${ANALYSIS_INACTIVITY_TIMEOUT}ms). Triggering processing (fallback).`);
                    triggerProcessing("Inactivity Fallback"); // Trigger processing via debounce
                }, ANALYSIS_INACTIVITY_TIMEOUT);
            }
        };
        observer = new MutationObserver(observerCallback);
        console.log("MutationObserver created.");
        startObserverObservation(); // Start observing immediately
    }

    // --- Entry Point ---
    window.addEventListener('load', () => {
        console.log("Lichess Detailed Moves script running (v1.29 - Loader ID Detection)...");
        loadEcoCodesApi(() => {
            console.log("ECO codes pre-loaded. Setting up observer.");
            setupObserver();
            setupBoardSync();
            console.log("Waiting for analysis completion (loader removal or inactivity) to trigger processing...");
            // Optional: Initial check if loader is *already* missing and evals exist
            setTimeout(() => {
                if (!document.getElementById(LOADER_ID) && document.querySelector('move:not(.empty) eval, u8:not(.empty) e')) {
                    console.log("Loader not present and evals found on load. Triggering initial processing check.");
                    triggerProcessing("Initial Load Check");
                } else {
                    console.log("Initial check: Loader present or no evals found. Waiting for observer.");
                }
            }, 1000); // Wait 1s after setup before this check
        });
    }, false);

})();
