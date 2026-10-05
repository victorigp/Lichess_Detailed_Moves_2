// ==UserScript==
// @name            Lichess - Detailed Moves 2
// @license         GPL-3.0-only
// @namespace       https://github.com/victorigp/Lichess_Detailed_Moves_2
// @contributionURL https://github.com/victorigp/Lichess_Detailed_Moves_2
// @version         2.0
// @description     Muestra jugadas brillantes, excelentes, buenas y de libro en los apartados de análisis y de estudio de Lichess sin necesidad de recargar la página. Al hacer clic sobre los textos de las jugadas, nos muestra su posición en el tablero con sus iconos correspondientes, con sistema avanzado de clasificación basado en Win Probability con detección de sacrificios, anti-inflación y fases de partida. Modificación del script Lichess - Detailed Moves by Seall.DEV & Thomas Sihapnya.
// @author          victorigp
// @require         https://greasyfork.org/scripts/47911-font-awesome-all-js/code/Font-awesome%20AllJs.js?version=275337
// @include         /^https\:\/\/lichess\.org\/[a-zA-Z0-9]{8,}/
// @include         /^https\:\/\/lichess\.org\/study\/.*/
// @grant           GM.xmlHttpRequest
// @grant           unsafeWindow
// @grant           GM_addStyle
// @inject-into     content
// ==/UserScript==
// ==OpenUserJS==
// ==/OpenUserJS==

(function () {
    'use strict';

    // =====================================================================
    // --- Inject Styles ---
    // =====================================================================
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

    // =====================================================================
    // --- Config ---
    // =====================================================================

    // --- Umbrales de Win% Delta (Mejora #4: Curva no lineal) ---
    // Estos reemplazan los umbrales de centipawns crudos
    // Calibrados con datos reales: partidas de élite tienen deltas máx ~2-5%
    const WIN_PCT_DELTA_GOOD = 1.5;        // ≥1.5% de mejora en Win% → Buena (~0.14 pawns desde pos equilibrada)
    const WIN_PCT_DELTA_EXCELLENT = 5.0;    // ≥5% → Excelente (~0.47 pawns)
    const WIN_PCT_DELTA_BRILLIANT = 10.0;   // ≥10% → Brillante (~1.0 pawns)

    // --- Mejora #1: Win Probability Caps ---
    const WIN_PCT_CAP_LOW = 8.0;   // Si Win% previo < 8%, posición perdida → no clasificar positivamente
    const WIN_PCT_CAP_HIGH = 92.0; // Si Win% previo > 92%, posición ganada (~+6.0) → no clasificar

    // --- Mejora #8: Swing bidireccional ---
    const EQUILIBRIUM_ZONE_LOW = 35.0;   // Zona de equilibrio: 35%-65% Win%
    const EQUILIBRIUM_ZONE_HIGH = 65.0;
    const SWING_BONUS_MULTIPLIER = 1.3;  // Bonus 30% si la jugada cruza el punto de equilibrio

    // --- Mejora #9: Anti-inflación ---
    const MAX_BRILLIANTS_PER_SIDE = 3;   // Máximo de brillantes por bando
    const MAX_EXCELLENT_PER_SIDE = 5;    // Máximo de excelentes por bando

    // --- Mejora #6: Fases de partida ---
    const OPENING_LAST_MOVE = 12;        // Jugadas 1-12 = apertura (por ply: 0-23)
    const MIDDLEGAME_LAST_MOVE = 30;     // Jugadas 13-30 = medio juego (por ply: 24-59)
    // Jugadas 31+ = final

    // Multiplicadores de umbral por fase (más alto = más difícil de lograr)
    const PHASE_MULTIPLIERS = {
        opening: 1.05,    // Apertura: 5% más difícil (la teoría cubre estas jugadas)
        middlegame: 1.0,  // Medio juego: umbrales estándar
        endgame: 1.0      // Final: umbrales estándar
    };

    // --- Mejora #7: Penalización recapturas ---
    const RECAPTURE_PENALTY = 0.7;  // Reducir delta efectivo al 70% para recapturas
    const CHECK_RESPONSE_PENALTY = 0.6; // Reducir delta al 60% para respuestas a jaque

    // --- Mejora #2: Detección de sacrificio ---
    const SACRIFICE_BONUS_MULTIPLIER = 1.0; // Sin bonus extra si hay sacrificio
    const NON_SACRIFICE_PENALTY = 1.0;      // Sin penalización (datos reales muestran que bloquea clasificaciones legítimas)

    // --- Mejora #10: Smoothing ---
    const SMOOTHING_SPIKE_THRESHOLD = 30.0; // Si Win% cambia >30% y vuelve, es un pico espurio
    const SMOOTHING_LOOKBACK = 2;           // Mirar ±2 jugadas para detectar picos

    // --- Configuración general ---
    const CHECKMATE_IN_X_MOVES_VALUE = 100;
    const PROCESSING_DEBOUNCE = 800;
    const STABILITY_RECHECK_DELAY = 3000; // Esperar 3s y re-verificar si hay más evals
    let lastEvalCount = 0; // Para detectar cambios en el número de evals
    const WAIT_FOR_SUMMARY_TIMEOUT = 5000;
    const WAIT_FOR_SUMMARY_INTERVAL = 250;
    const ANALYSIS_INACTIVITY_TIMEOUT = 7000;
    const SHOW_SAN_NOT_FOUND_WARNINGS = false;
    const LOADER_ID = 'acpl-chart-container-loader';

    // =====================================================================
    // --- Globals ---
    // =====================================================================
    let currentEcoCodes = null;
    let observer = null;
    let analysisCompletionTimer = null;
    let processingDebounceTimer = null;
    let isProcessing = false;
    let observerTargetNode = null;
    let observerConfig = { childList: true, subtree: true, characterData: true };
    let currentMovesData = {
        white: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 },
        black: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 }
    };
    let processedNodesForBook = new Set();

    // =====================================================================
    // --- Win Probability System ---
    // =====================================================================

    /**
     * Convierte una evaluación en centipawns a probabilidad de victoria (0-100%).
     * Usa la fórmula del modelo de Lichess (sigmoid logística).
     * Mejora: Curva no lineal para la evaluación.
     * Mejora: Manejo mejorado de evaluaciones de mate.
     *
     * @param {number} cp - Evaluación en centipawns (positivo = ventaja blancas)
     * @param {boolean} isMate - Si la evaluación es un mate-in-X
     * @param {number} mateIn - Número de jugadas hasta el mate (positivo = blancas dan mate)
     * @returns {number} Win% desde la perspectiva de las blancas (0-100)
     */
    function cpToWinPct(cp, isMate = false, mateIn = 0) {
        if (isMate) {
            // Mejora: Manejo mejorado de mate
            if (mateIn > 0) {
                // Blancas dan mate: cuanto más cercano, más cerca de 100%
                // Mate-in-1 = 100%, mate-in-20 ≈ 99.5%
                return 100 - (0.5 * Math.min(mateIn, 50) / 50);
            } else if (mateIn < 0) {
                // Negras dan mate
                return 0 + (0.5 * Math.min(Math.abs(mateIn), 50) / 50);
            }
            // mateIn === 0 no debería ocurrir, pero por seguridad
            return 50;
        }

        // Fórmula estándar de Lichess para conversión cp → Win%
        // Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
        const exponent = -0.00368208 * cp;
        const winPct = 50 + 50 * (2 / (1 + Math.exp(exponent)) - 1);

        // Clamp entre 0.1 y 99.9 para evitar valores absolutos
        return Math.max(0.1, Math.min(99.9, winPct));
    }

    /**
     * Parsea una evaluación del DOM y devuelve un objeto estructurado.
     * @param {string} evalText - Texto de evaluación (e.g., "+1.5", "#3", "#-2")
     * @returns {object} { cp, isMate, mateIn, winPct }
     */
    function parseEval(evalText) {
        if (!evalText) return { cp: 0, isMate: false, mateIn: 0, winPct: 50 };

        const trimmed = evalText.trim();

        if (trimmed.startsWith('#')) {
            const mateVal = parseInt(trimmed.substring(1));
            if (isNaN(mateVal)) return { cp: 0, isMate: false, mateIn: 0, winPct: 50 };
            return {
                cp: mateVal > 0 ? CHECKMATE_IN_X_MOVES_VALUE * 100 : -CHECKMATE_IN_X_MOVES_VALUE * 100,
                isMate: true,
                mateIn: mateVal,
                winPct: cpToWinPct(0, true, mateVal)
            };
        }

        const cp = parseFloat(trimmed);
        if (isNaN(cp)) return { cp: 0, isMate: false, mateIn: 0, winPct: 50 };

        // Lichess muestra la eval en pawns (e.g., 1.5), la convertimos a centipawns (*100)
        const cpCentipawns = cp * 100;
        return {
            cp: cpCentipawns,
            isMate: false,
            mateIn: 0,
            winPct: cpToWinPct(cpCentipawns)
        };
    }

    /**
     * Busca la evaluación de una jugada usando un sistema de respaldo de 3 niveles.
     * Resuelve el problema de Lichess ocultando/moviendo tags <eval> en estudios con anotaciones.
     *
     * Prioridad 1: Tag <eval>/<e> DENTRO del elemento move (comportamiento estándar)
     * Prioridad 2: Tag <eval>/<e> como HERMANO siguiente del move (layout alternativo)
     * Prioridad 3: Patrón [%eval X.XX] en texto de comentarios asociados al move
     *
     * @param {Element} domMove - El elemento DOM de la jugada (move o u8)
     * @returns {string|null} Texto de evaluación (e.g., "+1.65", "#3") o null si no se encuentra
     */
    function getEvalText(domMove) {
        // --- Prioridad 1: eval como hijo directo del move ---
        const evalChild = domMove.querySelector('eval, e');
        if (evalChild) {
            return evalChild.textContent;
        }

        // --- Prioridad 2: eval como hermano siguiente del move ---
        // En algunos layouts de Lichess (especialmente estudios con comentarios pesados),
        // el tag <eval> se renderiza FUERA del <move>/<u8>, como hermano siguiente.
        let sibling = domMove.nextElementSibling;
        while (sibling) {
            const tag = sibling.tagName ? sibling.tagName.toLowerCase() : '';

            // Si encontramos otro move o un index, paramos (ya pasamos a la siguiente jugada)
            if (tag === 'move' || tag === 'u8' || tag === 'index' || tag === 'kwtext') {
                break;
            }

            // Tag eval como hermano
            if (tag === 'eval' || tag === 'e') {
                console.log(`[Fallback] Found eval as sibling for move: ${sibling.textContent}`);
                return sibling.textContent;
            }

            sibling = sibling.nextElementSibling;
        }

        // --- Prioridad 3: buscar [%eval X.XX] en comentarios asociados ---
        // En PGN importados, Lichess puede dejar [%eval] dentro del texto del comentario
        sibling = domMove.nextElementSibling;
        while (sibling) {
            const tag = sibling.tagName ? sibling.tagName.toLowerCase() : '';

            // Parar si llegamos a otro move
            if (tag === 'move' || tag === 'u8' || tag === 'index') {
                break;
            }

            // Buscar en nodos de comentario
            if (tag === 'comment' || (sibling.classList && sibling.classList.contains('comment'))) {
                const commentText = sibling.textContent || '';
                // Patrón: [%eval 1.65] o [%eval #3] o [%eval -0.5]
                const evalMatch = commentText.match(/\[%eval\s+([^\]]+)\]/);
                if (evalMatch) {
                    console.log(`[Fallback] Found [%eval] in comment text: ${evalMatch[1]}`);
                    return evalMatch[1].trim();
                }
            }

            sibling = sibling.nextElementSibling;
        }

        return null;
    }

    // =====================================================================
    // --- Detección de fase de partida ---
    // =====================================================================

    /**
     * Determina la fase de la partida basándose en el número de ply (medio-movimiento).
     * @param {number} plyIndex - Índice del ply (0-based)
     * @returns {string} 'opening' | 'middlegame' | 'endgame'
     */
    function getGamePhase(plyIndex) {
        const moveNumber = Math.floor(plyIndex / 2) + 1;
        if (moveNumber <= OPENING_LAST_MOVE) return 'opening';
        if (moveNumber <= MIDDLEGAME_LAST_MOVE) return 'middlegame';
        return 'endgame';
    }

    // =====================================================================
    // --- Detección de sacrificio ---
    // =====================================================================

    /**
     * Analiza si una jugada SAN involucra una captura.
     * @param {string} san - Notación SAN de la jugada
     * @returns {boolean}
     */
    function isCapture(san) {
        if (!san) return false;
        return san.includes('x');
    }

    /**
     * Extrae la casilla de destino de una jugada SAN.
     * @param {string} san - Notación SAN
     * @returns {string|null} Casilla de destino (e.g., "e4", "f3")
     */
    function getDestSquare(san) {
        if (!san) return null;
        const clean = san.replace(/[+#!?]/g, '').trim();
        if (clean === 'O-O' || clean === 'O-O-O') return null; // Enroques no tienen casilla de destino comparable
        const match = clean.match(/([a-h][1-8])(?:=[QRBN])?$/);
        return match ? match[1] : null;
    }

    // =====================================================================
    // --- Detección de jugadas forzadas y recapturas ---
    // =====================================================================

    /**
     * Determina si una jugada es una recaptura (captura en la misma casilla que la jugada anterior).
     * @param {string} currentSan - SAN de la jugada actual
     * @param {string} previousSan - SAN de la jugada anterior
     * @returns {boolean}
     */
    function isRecapture(currentSan, previousSan) {
        if (!currentSan || !previousSan) return false;
        if (!isCapture(currentSan)) return false;

        const currentDest = getDestSquare(currentSan);
        const previousDest = getDestSquare(previousSan);

        return currentDest !== null && currentDest === previousDest;
    }

    /**
     * Determina si la jugada anterior fue un jaque (lo que hace la respuesta semi-forzada).
     * @param {string} previousSan - SAN de la jugada anterior
     * @returns {boolean}
     */
    function isResponseToCheck(previousSan) {
        if (!previousSan) return false;
        return previousSan.includes('+') || previousSan.includes('#');
    }

    // =====================================================================
    // --- Smoothing de evaluaciones ---
    // =====================================================================

    /**
     * Detecta si una evaluación es un pico espurio comparando con evaluaciones adyacentes.
     * Un pico espurio es cuando Win% salta drásticamente y luego vuelve.
     *
     * @param {Array} evalHistory - Array de Win% valores para todas las jugadas procesadas hasta ahora
     * @param {number} currentIndex - Índice de la jugada actual
     * @param {number} currentWinPct - Win% de la jugada actual
     * @returns {number} Win% suavizado (puede ser el original si no hay pico)
     */
    function smoothEval(evalHistory, currentIndex, currentWinPct) {
        if (evalHistory.length < 3) return currentWinPct;

        const prevIndex = currentIndex - 1;
        if (prevIndex < 1) return currentWinPct;

        const prevPrev = evalHistory[prevIndex - 1];
        const prev = evalHistory[prevIndex];

        // Detectar pico en la jugada anterior: si prev se desvía mucho de prevPrev Y de current
        const devFromPrevPrev = Math.abs(prev - prevPrev);
        const devFromCurrent = Math.abs(prev - currentWinPct);
        const baselineChange = Math.abs(currentWinPct - prevPrev);

        // Si la jugada previa saltó mucho respecto a sus vecinos y los vecinos son similares
        if (devFromPrevPrev > SMOOTHING_SPIKE_THRESHOLD &&
            devFromCurrent > SMOOTHING_SPIKE_THRESHOLD &&
            baselineChange < SMOOTHING_SPIKE_THRESHOLD * 0.5) {
            // Es un pico espurio en la jugada anterior; no afecta la actual
            // pero marcamos que no debemos usar la eval previa como referencia
            return currentWinPct; // No modificar la actual, pero la lógica de delta usará esto
        }

        return currentWinPct;
    }

    /**
     * Calcula el delta efectivo de Win% considerando smoothing.
     * Si la eval previa parece un pico espurio, usa la eval de 2 jugadas atrás.
     *
     * @param {Array} evalHistory - Array de objetos {winPct} para todas las jugadas
     * @param {number} currentIndex - Índice actual
     * @returns {number} El Win% de referencia (previo) más fiable
     */
    function getSmoothedPreviousWinPct(evalHistory, currentIndex) {
        if (currentIndex < 1) return 50;
        if (currentIndex < 2) return evalHistory[currentIndex - 1];

        const prev = evalHistory[currentIndex - 1];
        const prevPrev = evalHistory[currentIndex - 2];
        const current = evalHistory[currentIndex];

        // Detectar si prev es un pico espurio
        const devFromPrevPrev = Math.abs(prev - prevPrev);
        const devFromCurrent = Math.abs(prev - current);
        const baselineChange = Math.abs(current - prevPrev);

        if (devFromPrevPrev > SMOOTHING_SPIKE_THRESHOLD &&
            devFromCurrent > SMOOTHING_SPIKE_THRESHOLD &&
            baselineChange < SMOOTHING_SPIKE_THRESHOLD * 0.5) {
            // La eval previa es un pico espurio → usar la de 2 jugadas atrás
            console.log(`[Smoothing] Spike detected at ply ${currentIndex - 1}: ${prevPrev.toFixed(1)}% → ${prev.toFixed(1)}% → ${current.toFixed(1)}%. Using ${prevPrev.toFixed(1)}% as reference.`);
            return prevPrev;
        }

        return prev;
    }

    // =====================================================================
    // --- SISTEMA DE CLASIFICACIÓN AVANZADO ---
    // =====================================================================

    /**
     * Clasificador principal v2.0: determina el tipo de jugada (brilliant/excellent/good/null)
     * aplicando todas las mejoras.
     *
     * @param {object} params
     * @param {number} params.prevWinPct - Win% antes de la jugada (perspectiva blancas)
     * @param {number} params.currWinPct - Win% después de la jugada (perspectiva blancas)
     * @param {string} params.moveColor - 'white' o 'black'
     * @param {string} params.currentSan - SAN de la jugada actual
     * @param {string} params.previousSan - SAN de la jugada anterior
     * @param {number} params.plyIndex - Índice del ply (0-based)
     * @param {object} params.moveCounts - Conteo actual de {brillant, excellent} por bando
     * @param {Array}  params.evalHistory - Historial de Win% para smoothing
     * @param {boolean} params.prevIsMate - Si la eval previa era un mate-in-X
     * @param {boolean} params.currIsMate - Si la eval actual es un mate-in-X
     * @returns {string|null} 'brilliant' | 'excellent' | 'good' | null
     */
    function classifyMove(params) {
        const {
            prevWinPct, currWinPct, moveColor, currentSan, previousSan,
            plyIndex, moveCounts, evalHistory, prevIsMate, currIsMate
        } = params;

        // Win% desde la perspectiva del bando que juega
        const prevWinPctForSide = moveColor === 'white' ? prevWinPct : (100 - prevWinPct);
        const currWinPctForSide = moveColor === 'white' ? currWinPct : (100 - currWinPct);

        // Delta desde la perspectiva del bando que juega (positivo = mejora)
        let rawDelta = currWinPctForSide - prevWinPctForSide;

        // --- Win Probability Caps ---
        // Si la posición previa ya estaba completamente ganada o perdida, no clasificar
        if (prevWinPctForSide > WIN_PCT_CAP_HIGH) {
            // Ya estaba ganando de paliza → no hay mérito extra
            return null;
        }
        if (prevWinPctForSide < WIN_PCT_CAP_LOW) {
            // Ya estaba perdiendo de paliza → mejorar aquí es trivial o imposible
            // EXCEPCIÓN: si la jugada "salva" la partida (cruza equilibrio), sí puede ser buena
            if (currWinPctForSide < EQUILIBRIUM_ZONE_LOW) return null;
            // Si llega al equilibrio o más allá, dejar que el swing bidireccional lo evalúe
        }

        // --- Manejo mejorado de mate ---
        // Si ya teníamos mate y lo mantenemos, no es brillante
        if (prevIsMate && currIsMate) {
            return null; // Mantener un mate no requiere genialidad
        }
        // Si encontramos un mate nuevo donde antes no había, es potencialmente brillante
        // El delta de Win% ya refleja esto (99%+ vs previo)

        // --- Smoothing ---
        // Usar la referencia suavizada si hay picos espurios
        if (evalHistory && evalHistory.length >= 3 && plyIndex >= 2) {
            const smoothedPrev = getSmoothedPreviousWinPct(evalHistory, plyIndex);
            const smoothedPrevForSide = moveColor === 'white' ? smoothedPrev : (100 - smoothedPrev);
            // Recalcular delta con la referencia suavizada
            rawDelta = currWinPctForSide - smoothedPrevForSide;
        }

        // Si el delta es negativo o cero, la jugada no mejoró la posición
        if (rawDelta <= 0) return null;

        // --- Game Phase Awareness ---
        const phase = getGamePhase(plyIndex);
        const phaseMultiplier = PHASE_MULTIPLIERS[phase];

        // --- Penalización por jugadas forzadas/recapturas ---
        let forcedPenalty = 1.0;
        if (isRecapture(currentSan, previousSan)) {
            forcedPenalty = RECAPTURE_PENALTY;
            console.log(`[Recapture] ${currentSan} recaptures on ${getDestSquare(currentSan)} → penalty ${RECAPTURE_PENALTY}`);
        } else if (isResponseToCheck(previousSan)) {
            forcedPenalty = CHECK_RESPONSE_PENALTY;
            console.log(`[CheckResponse] ${currentSan} responds to check → penalty ${CHECK_RESPONSE_PENALTY}`);
        }

        // --- Detección de sacrificio ---
        let sacrificeMultiplier = 1.0;
        if (!isCapture(currentSan)) {
            // No es captura → podría ser sacrificio posicional, pero menos probable
            sacrificeMultiplier = NON_SACRIFICE_PENALTY;
        }
        // Si ES captura: sin penalización (sacrificeMultiplier = 1.0)
        // Nota: Un verdadero "sacrificio" sería detectar que la pieza capturada vale menos
        // que la que capturas, pero eso requiere info que no tenemos en el DOM

        // --- Swing bidireccional ---
        let swingBonus = 1.0;
        if (prevWinPctForSide < EQUILIBRIUM_ZONE_HIGH && currWinPctForSide > EQUILIBRIUM_ZONE_HIGH) {
            // La jugada cambió las tornas: de posición equilibrada/peor a claramente mejor
            swingBonus = SWING_BONUS_MULTIPLIER;
            console.log(`[Swing] ${currentSan} crosses equilibrium: ${prevWinPctForSide.toFixed(1)}% → ${currWinPctForSide.toFixed(1)}% → bonus ${SWING_BONUS_MULTIPLIER}`);
        }
        // Bonus extra si cruzas desde territorio negativo al positivo
        if (prevWinPctForSide < 50 && currWinPctForSide > 50) {
            swingBonus = Math.max(swingBonus, SWING_BONUS_MULTIPLIER);
            console.log(`[Swing] ${currentSan} flips evaluation: ${prevWinPctForSide.toFixed(1)}% → ${currWinPctForSide.toFixed(1)}%`);
        }

        // --- Calcular delta efectivo ---
        const effectiveDelta = rawDelta * forcedPenalty * sacrificeMultiplier * swingBonus;

        // Umbrales ajustados por fase
        const thresholdGood = WIN_PCT_DELTA_GOOD * phaseMultiplier;
        const thresholdExcellent = WIN_PCT_DELTA_EXCELLENT * phaseMultiplier;
        const thresholdBrilliant = WIN_PCT_DELTA_BRILLIANT * phaseMultiplier;

        // --- Anti-inflación ---
        const sideCounts = moveCounts[moveColor];

        // Clasificar
        if (effectiveDelta >= thresholdBrilliant) {
            if (sideCounts.brillant >= MAX_BRILLIANTS_PER_SIDE) {
                console.log(`[Anti-Inflation] Max brilliants (${MAX_BRILLIANTS_PER_SIDE}) reached for ${moveColor}. Downgrading.`);
                // Intentar clasificar como excelente
                if (sideCounts.excellent < MAX_EXCELLENT_PER_SIDE) {
                    return 'excellent';
                }
                return 'good'; // Downgrade doble
            }
            return 'brilliant';
        }

        if (effectiveDelta >= thresholdExcellent) {
            if (sideCounts.excellent >= MAX_EXCELLENT_PER_SIDE) {
                console.log(`[Anti-Inflation] Max excellents (${MAX_EXCELLENT_PER_SIDE}) reached for ${moveColor}. Downgrading.`);
                return 'good';
            }
            return 'excellent';
        }

        if (effectiveDelta >= thresholdGood) {
            return 'good';
        }

        return null;
    }

    // =====================================================================
    // --- Util ---
    // =====================================================================
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

    function triggerProcessing(reason = "Unknown") {
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

    // =====================================================================
    // --- Process Moves (v2.0 con todas las mejoras) ---
    // =====================================================================
    function processMovesAndSummary() {
        if (isProcessing) { console.log("Already processing, skipping trigger."); return; }
        isProcessing = true;
        console.log('Processing moves and summary (v2.0 - Win Probability System)...');

        if (currentEcoCodes === null || !Array.isArray(currentEcoCodes)) {
            console.error("ECO codes not ready! Aborting."); finishProcessing(false); return;
        }

        currentMovesData = {
            white: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 },
            black: { 'book': 0, 'good': 0, 'excellent': 0, 'brillant': 0 }
        };
        processedNodesForBook.clear();

        const potentialContainers = document.querySelectorAll('.analyse__moves .tview2-column, .gamebook .tview2-column, div.tview2.tview2-column, rmoves, l4x, .analyse__moves, .gamebook');
        let moveContainer = null;
        for (let container of potentialContainers) { if (container.querySelector('move, u8')) { moveContainer = container; break; } }
        if (!moveContainer) { console.warn('No move container found during processing.'); finishProcessing(false); return; }

        // --- FILTRO CRÍTICO: solo jugadas de la línea principal ---
        // Las variaciones en Lichess están dentro de <interrupt>, <lines>, <line>
        // Si las incluimos, contaminan previousEvalParsed y causan resultados inconsistentes
        function isVariationMove(domMove) {
            let parent = domMove.parentElement;
            while (parent && parent !== moveContainer) {
                const tag = parent.tagName ? parent.tagName.toLowerCase() : '';
                if (tag === 'interrupt' || tag === 'lines' || tag === 'line') {
                    return true;
                }
                if (parent.classList && parent.classList.contains('variation')) {
                    return true;
                }
                parent = parent.parentElement;
            }
            return false;
        }

        const allDomMoves = moveContainer.querySelectorAll('move, u8');
        const domMoves = Array.from(allDomMoves).filter(m => !isVariationMove(m));
        const variationCount = allDomMoves.length - domMoves.length;
        console.log(`[FILTER] Total DOM moves: ${allDomMoves.length}, Main line: ${domMoves.length}, Variations filtered: ${variationCount}`);

        if (domMoves.length === 0) { console.warn('No main-line moves found.'); finishProcessing(false); return; }

        // --- Estabilidad: contar evals disponibles (solo línea principal, con fallback) ---
        const currentEvalCount = domMoves.filter(m => getEvalText(m) !== null).length;
        console.log(`[STABILITY] Eval nodes in main line: ${currentEvalCount}/${domMoves.length} (previous: ${lastEvalCount})`);

        // Clear previous annotations (en TODOS los nodos, incluyendo variaciones)
        allDomMoves.forEach(domMove => {
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

        // --- PRIMERA PASADA: recopilar todas las evaluaciones para smoothing ---
        let allEvals = []; // Array de {winPct, isMate} para cada ply
        let allSans = []; // Array de SAN texts para cada ply
        let moves = [];

        let debugStats = { total: 0, empty: 0, noSan: 0, noEval: 0, book: 0, nativeGlyph: 0, negativeClass: 0, firstMove: 0, subThreshold: 0, capped: 0, classified: 0 };

        domMoves.forEach((domMove, domIndex) => {
            if (domMove.classList.contains('empty')) {
                allEvals.push(null);
                allSans.push(null);
                return;
            }
            const sanNode = domMove.querySelector('san, kw');

            const sanText = sanNode ? sanNode.textContent.trim() : null;
            allSans.push(sanText);

            // Usar sistema de respaldo de 3 niveles para encontrar eval
            const evalText = getEvalText(domMove);
            if (evalText) {
                const parsed = parseEval(evalText);
                allEvals.push(parsed);
            } else {
                allEvals.push(null);
            }
        });

        // Debug: mostrar primeras 5 evals para verificar parsing
        console.log('[DEBUG] First 10 evals parsed:', allEvals.slice(0, 10).map((e, i) => e ? `ply${i}: cp=${e.cp} win=${e.winPct.toFixed(1)}%` : `ply${i}: null`));

        // Construir historial de Win% para smoothing (Mejora #10)
        let winPctHistory = [];
        allEvals.forEach((ev, i) => {
            if (ev) {
                winPctHistory.push(ev.winPct);
            } else if (winPctHistory.length > 0) {
                winPctHistory.push(winPctHistory[winPctHistory.length - 1]); // Repetir última
            } else {
                winPctHistory.push(50); // Posición inicial = 50%
            }
        });

        // --- SEGUNDA PASADA: clasificar jugadas ---
        let previousEvalParsed = { cp: 0, isMate: false, mateIn: 0, winPct: 50 };
        let previousSanText = null;
        let topDeltas = []; // TOP 10 deltas para diagnóstico
        moves = [];

        domMoves.forEach((domMove, domIndex) => {
            if (domMove.classList.contains('empty')) return;
            const sanNode = domMove.querySelector('san, kw');
            if (sanNode) {
                const originalMoveHTML = sanNode.innerHTML.trim();
                const cleanSanText = originalMoveHTML.replace(/<[^>]*>/g, '');
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

                // --- Evaluación avanzada v2.0 ---
                const evalText = getEvalText(domMove);
                let currentEvalParsed = previousEvalParsed; // Default: mantener anterior
                debugStats.total++;

                if (!isBookMove && !isCheckmatingMove) {
                    if (evalText) {
                        currentEvalParsed = parseEval(evalText);

                        // Only add custom annotations if Lichess hasn't already classified this move as bad
                        const hasNativeGlyph = domMove.querySelector('glyph:not(.custom-move-glyph)');
                        const hasNegativeClass = domMove.classList.contains('inaccuracy') || domMove.classList.contains('mistake') || domMove.classList.contains('blunder');

                        if (currentMoveIndex === 0) {
                            debugStats.firstMove++;
                        } else if (hasNativeGlyph) {
                            debugStats.nativeGlyph++;
                        } else if (hasNegativeClass) {
                            debugStats.negativeClass++;
                        } else {
                            // --- CLASIFICACIÓN v2.0 ---
                            const prevWinForSide = currentColor === 'white' ? previousEvalParsed.winPct : (100 - previousEvalParsed.winPct);
                            const currWinForSide = currentColor === 'white' ? currentEvalParsed.winPct : (100 - currentEvalParsed.winPct);
                            const rawDeltaDebug = currWinForSide - prevWinForSide;

                            // Registrar top 5 deltas para diagnóstico
                            if (rawDeltaDebug > 0) {
                                topDeltas.push({ san: cleanSanText, color: currentColor, delta: rawDeltaDebug, prevWin: prevWinForSide, currWin: currWinForSide, prevCp: previousEvalParsed.cp, currCp: currentEvalParsed.cp });
                                topDeltas.sort((a, b) => b.delta - a.delta);
                                if (topDeltas.length > 10) topDeltas.length = 10;
                            }

                            const classification = classifyMove({
                                prevWinPct: previousEvalParsed.winPct,
                                currWinPct: currentEvalParsed.winPct,
                                moveColor: currentColor,
                                currentSan: cleanSanText,
                                previousSan: previousSanText,
                                plyIndex: domIndex,
                                moveCounts: currentMovesData,
                                evalHistory: winPctHistory,
                                prevIsMate: previousEvalParsed.isMate,
                                currIsMate: currentEvalParsed.isMate
                            });

                            if (classification) {
                                debugStats.classified++;
                                const glyphConfig = {
                                    'brilliant': { color: '#1baca6', symbol: '!!', title: 'Brillante' },
                                    'excellent': { color: '#96bc4b', symbol: '!', title: 'Excelente' },
                                    'good': { color: '#b2f196', symbol: '!?', title: 'Buena' }
                                };
                                const cfg = glyphConfig[classification];
                                setCustomGlyph(domMove, sanNode, classification, cfg.color, cfg.symbol, cfg.title);

                                if (classification === 'brilliant') currentMovesData[currentColor].brillant++;
                                else if (classification === 'excellent') currentMovesData[currentColor].excellent++;
                                else if (classification === 'good') currentMovesData[currentColor].good++;

                                console.log(`[v2.0] ✅ ${currentColor} ${cleanSanText}: ${classification.toUpperCase()} | Win%: ${prevWinForSide.toFixed(1)}% → ${currWinForSide.toFixed(1)}% (Δ${rawDeltaDebug.toFixed(1)}%) | Phase: ${getGamePhase(domIndex)}`);
                            } else {
                                debugStats.subThreshold++;
                            }
                        }
                    } else {
                        debugStats.noEvalMain = (debugStats.noEvalMain || 0) + 1;
                    }
                } else {
                    // Jugada de libro o jaque mate: solo actualizar eval si hay
                    if (isBookMove) debugStats.book++;
                    if (!evalText) debugStats.noEval++;
                    if (evalText) {
                        currentEvalParsed = parseEval(evalText);
                    }
                }

                // Actualizar estado previo
                previousEvalParsed = currentEvalParsed;
                previousSanText = cleanSanText;

            } else if (SHOW_SAN_NOT_FOUND_WARNINGS) { console.warn(`No <san> tag found.`); }
        }); // End domMoves loop

        console.log('Move processing finished (v2.0).');
        console.log('[DEBUG] Stats:', JSON.stringify(debugStats));
        console.log(`[DEBUG] TOP 10 positive deltas:`, topDeltas.map(d => `${d.color} ${d.san}: Δ${d.delta.toFixed(2)}% (cp: ${d.prevCp}→${d.currCp}, win: ${d.prevWin.toFixed(1)}%→${d.currWin.toFixed(1)}%)`));
        console.log(`[DEBUG] Thresholds → Good: ${WIN_PCT_DELTA_GOOD}%, Excellent: ${WIN_PCT_DELTA_EXCELLENT}%, Brilliant: ${WIN_PCT_DELTA_BRILLIANT}%`);
        console.log(`Results: White - Brilliant:${currentMovesData.white.brillant} Excellent:${currentMovesData.white.excellent} Good:${currentMovesData.white.good} Book:${currentMovesData.white.book}`);
        console.log(`Results: Black - Brilliant:${currentMovesData.black.brillant} Excellent:${currentMovesData.black.excellent} Good:${currentMovesData.black.good} Book:${currentMovesData.black.book}`);

        // Actualizar contador de evals para detección de estabilidad
        lastEvalCount = currentEvalCount;

        waitForElement('.advice-summary', (summaryContainer) => showDataInTable(summaryContainer));

    } // End processMovesAndSummary

    // =====================================================================
    // --- UI Helpers ---
    // =====================================================================
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

    // =====================================================================
    // --- Summary Table & Click Navigation ---
    // =====================================================================
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
        finishProcessing(true);
    }

    // =====================================================================
    // --- Board Glyph Sync ---
    // =====================================================================
    const GLYPH_COLORS = {
        'book': '#a88865',
        'brilliant': '#1baca6',
        'excellent': '#96bc4b',
        'good': '#b2f196'
    };

    function getDestSquareFromSan(san, moveColor) {
        if (!san) return null;
        const clean = san.replace(/[+#!?]/g, '').trim();
        if (clean === 'O-O') return moveColor === 'white' ? 'g1' : 'g8';
        if (clean === 'O-O-O') return moveColor === 'white' ? 'c1' : 'c8';
        const match = clean.match(/([a-h][1-8])(?:=[QRBN])?$/);
        return match ? match[1] : null;
    }

    function squareToTransform(sq, isFlipped) {
        const fileIndex = sq.charCodeAt(0) - 97;
        const rankIndex = parseInt(sq[1]) - 1;
        let x, y;
        if (!isFlipped) {
            x = fileIndex * 100;
            y = (7 - rankIndex) * 100;
        } else {
            x = (7 - fileIndex) * 100;
            y = rankIndex * 100;
        }
        return `translate(${x}%, ${y}%)`;
    }

    function syncBoardGlyph() {
        const activeMove = document.querySelector('move.active, u8.active');
        const board = document.querySelector('cg-board');
        if (!board) return;

        board.querySelectorAll('.custom-board-glyph').forEach(el => el.remove());
        board.querySelectorAll('glyph').forEach(el => { el.style.display = ''; });

        if (!activeMove) return;

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

        board.querySelectorAll('glyph').forEach(el => { el.style.display = 'none'; });

        const sanNode = activeMove.querySelector('san, kw');
        if (!sanNode) return;
        const sanText = sanNode.textContent.trim();

        let moveColor = 'white';
        const prevSibling = activeMove.previousElementSibling;
        if (prevSibling && prevSibling.tagName === 'MOVE' && !prevSibling.classList.contains('empty')) {
            moveColor = 'black';
        }
        if (prevSibling && prevSibling.classList && prevSibling.classList.contains('empty')) {
            moveColor = 'black';
        }

        const destSq = getDestSquareFromSan(sanText, moveColor);
        if (!destSq) return;

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

    // =====================================================================
    // --- Observer Setup ---
    // =====================================================================
    function setupObserver() {
        observerTargetNode = document.querySelector('main.analyse, main.study');
        if (!observerTargetNode) { console.warn("Could not find main container for Observer."); return; }

        const observerCallback = (mutationsList, obs) => {
            if (isProcessing) return;

            let loaderRemoved = false;
            let evalChanged = false;

            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
                    if (Array.from(mutation.removedNodes).some(node => node.nodeType === Node.ELEMENT_NODE && node.id === LOADER_ID)) {
                        loaderRemoved = true;
                        break;
                    }
                }
                if (!loaderRemoved && mutation.type === 'characterData' && mutation.target.parentElement?.tagName === 'EVAL') {
                    evalChanged = true;
                }
            }

            if (loaderRemoved) {
                console.log(`Analysis loader #${LOADER_ID} removed. Debouncing processing trigger...`);
                clearTimeout(analysisCompletionTimer);
                triggerProcessing("Loader Removed");
            } else if (evalChanged) {
                clearTimeout(analysisCompletionTimer);
                clearTimeout(processingDebounceTimer);
                analysisCompletionTimer = setTimeout(() => {
                    console.log(`Analysis inactivity detected (${ANALYSIS_INACTIVITY_TIMEOUT}ms). Triggering processing (fallback).`);
                    triggerProcessing("Inactivity Fallback");
                }, ANALYSIS_INACTIVITY_TIMEOUT);
            }
        };
        observer = new MutationObserver(observerCallback);
        console.log("MutationObserver created.");
        startObserverObservation();
    }

    // =====================================================================
    // --- Entry Point ---
    // =====================================================================
    window.addEventListener('load', () => {
        console.log("Lichess Detailed Moves v2.0 - Win Probability System running...");
        console.log("Mejoras activas: Win% Caps, Sacrificios, Jugada Forzada, Curva No Lineal, Mate, Fases, Recapturas, Swing, Anti-Inflación, Smoothing");
        loadEcoCodesApi(() => {
            console.log("ECO codes pre-loaded. Setting up observer.");
            setupObserver();
            setupBoardSync();
            console.log("Waiting for analysis completion (loader removal or inactivity) to trigger processing...");
            // Esperar más tiempo para que el DOM se estabilice completamente
            setTimeout(() => {
                if (!document.getElementById(LOADER_ID) && document.querySelector('move:not(.empty) eval, u8:not(.empty) e')) {
                    console.log("Loader not present and evals found on load. Triggering initial processing check.");
                    triggerProcessing("Initial Load Check");

                    // Re-verificar después de un tiempo por si se cargaron más evals
                    setTimeout(() => {
                        const newEvalCount = document.querySelectorAll('move:not(.empty) eval, u8:not(.empty) e').length;
                        if (newEvalCount > lastEvalCount) {
                            console.log(`[STABILITY] More evals found after recheck (${newEvalCount} vs ${lastEvalCount}). Re-processing...`);
                            triggerProcessing("Stability Recheck");
                        } else {
                            console.log(`[STABILITY] Eval count stable at ${newEvalCount}. No reprocess needed.`);
                        }
                    }, STABILITY_RECHECK_DELAY);
                } else {
                    console.log("Initial check: Loader present or no evals found. Waiting for observer.");
                }
            }, 2000);
        });
    }, false);

})();
