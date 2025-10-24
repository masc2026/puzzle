document.addEventListener('DOMContentLoaded', () => {
    
    // --- Globale Variablen ---
    let canvas, ctx, puzzlePlan;
    
    // Gitter-Maße (pro Zelle)
    let pieceWidth, pieceHeight; 
    
    // <<< NEU: Dimensionen und Offsets >>>
    let solutionWidth, solutionHeight; // Größe der Zielfläche (aus JSON)
    let totalWidth, totalHeight;       // Größe des gesamten Canvas (mit Rand)
    let offsetX, offsetY;              // (x,y) der linken oberen Ecke der Zielfläche

    let pieces = [];
    let activePiece = null;
    let mouseOffsetX = 0, mouseOffsetY = 0;
    
    const snapTolerance = 30;
    // <<< NEU: Faktor für den Rand >>>
    // 1.5 = 50% Rand, 2.0 = 100% Rand
    const STAGING_FACTOR = 1.5; 

    // --- Hilfsfunktion für Zufallszahlen ---
    function getRandom(min, max) {
        return Math.random() * (max - min) + min;
    }

    // --- Haupt-Initialisierungsfunktion ---
    async function init() {
        try {
            // 1. JSON-Dateinamen holen
            const urlParams = new URLSearchParams(window.location.search);
            const planFile = urlParams.get('plan');
            
            if (!planFile) {
                throw new Error("Keine 'plan'-Datei in der URL angegeben (z.B. ?plan=puzzle_plan.json)");
            }

            // 2. Puzzle-Plan (JSON) laden
            const response = await fetch('../' + planFile);
            if (!response.ok) {
                throw new Error(`Fehler beim Laden von ${planFile}: ${response.statusText}`);
            }
            puzzlePlan = await response.json();

            // 3. Canvas-Dimensionen berechnen
            canvas = document.getElementById('puzzleCanvas');
            ctx = canvas.getContext('2d');
            
            // Die Maße aus der JSON-Datei sind unsere ZIELFLÄCHE
            solutionWidth = puzzlePlan.canvas.width;
            solutionHeight = puzzlePlan.canvas.height;

            // <<< GEÄNDERT: Canvas-Größe mit Rand >>>
            totalWidth = solutionWidth * STAGING_FACTOR;
            totalHeight = solutionHeight * STAGING_FACTOR;
            
            canvas.width = totalWidth;
            canvas.height = totalHeight;

            // <<< NEU: Ziel-Offset berechnen >>>
            // Dies ist die (x, y) Koordinate der linken oberen Ecke der Zielfläche,
            // damit sie zentriert ist.
            offsetX = (totalWidth - solutionWidth) / 2;
            offsetY = (totalHeight - solutionHeight) / 2;
            
            // 4. Gitter-Abmessungen berechnen (basierend auf der Zielfläche)
            pieceWidth = solutionWidth / puzzlePlan.grid.cols;
            pieceHeight = solutionHeight / puzzlePlan.grid.rows;

            // 5. Bilder laden (nutzt jetzt die neuen Maße)
            await loadPieces();
            
            // 6. Initiales Zeichnen
            draw();

            // 7. Event-Listener hinzufügen
            canvas.addEventListener('mousedown', onMouseDown);
            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('mouseup', onMouseUp);
            canvas.addEventListener('mouseout', onMouseUp);

        } catch (error) {
            console.error("Puzzle konnte nicht initialisiert werden:", error);
            alert("Fehler beim Laden des Puzzles: " + error.message);
        }
    }

    // --- Bilder laden und positionieren ---
    async function loadPieces() {
        const loadPromises = puzzlePlan.pieces.map(pieceData => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.src = '../' + pieceData.file_rel_path;
                
                img.onload = () => {
                    
                    // <<< GEÄNDERT: Zielposition >>>
                    // Die Ziel-Position ist jetzt die JSON-Position PLUS dem Offset der Zielfläche
                    const targetX = pieceData.posx + offsetX;
                    const targetY = pieceData.posy + offsetY;

                    // <<< GEÄNDERT: Startpositionen >>>
                    // Verteile die Teile in den 4 Randbereichen (Top, Right, Bottom, Left)
                    const zone = pieceData.id % 4;
                    let startX, startY;

                    if (zone === 0) { // TOP-Rand
                        startX = getRandom(0, totalWidth - img.naturalWidth);
                        startY = getRandom(0, Math.max(0, offsetY - img.naturalHeight));
                    } else if (zone === 1) { // RIGHT-Rand
                        startX = getRandom(offsetX + solutionWidth, Math.max(offsetX + solutionWidth, totalWidth - img.naturalWidth));
                        startY = getRandom(0, totalHeight - img.naturalHeight);
                    } else if (zone === 2) { // BOTTOM-Rand
                        startX = getRandom(0, totalWidth - img.naturalWidth);
                        startY = getRandom(offsetY + solutionHeight, Math.max(offsetY + solutionHeight, totalHeight - img.naturalHeight));
                    } else { // LEFT-Rand
                        startX = getRandom(0, Math.max(0, offsetX - img.naturalWidth));
                        startY = getRandom(0, totalHeight - img.naturalHeight);
                    }

                    pieces.push({
                        id: pieceData.id,
                        img: img,
                        x: startX,          // Start-X (im Randbereich)
                        y: startY,          // Start-Y (im Randbereich)
                        targetX: targetX,   // Absolutes Ziel-X (in der Mitte)
                        targetY: targetY,   // Absolutes Ziel-Y (in der Mitte)
                        isDragging: false,
                        isSnapped: false
                    });
                    resolve();
                };
                img.onerror = (err) => {
                    console.error("Bild konnte nicht geladen werden:", pieceData.file_rel_path);
                    reject(err);
                };
            });
        });

        await Promise.all(loadPromises);
        // Wir müssen .reverse() hier nicht mehr machen, da die onMouseDown-Schleife
        // jetzt ohnehin rückwärts läuft und .push() in onMouseDown das Teil nach oben holt.
        // pieces.reverse(); // <- Nicht mehr notwendig
    }

    // --- Haupt-Zeichenfunktion ---
    function draw() {
        // 1. Gesamten Canvas als "Ablagefläche" (Rand) zeichnen
        ctx.fillStyle = '#f4f4f4'; // Heller Hintergrund für Ablage
        ctx.fillRect(0, 0, totalWidth, totalHeight);

        // 2. "Zielfläche" in der Mitte zeichnen
        ctx.fillStyle = '#ffffff'; // Weißer Hintergrund für Ziel
        ctx.fillRect(offsetX, offsetY, solutionWidth, solutionHeight);
        ctx.strokeStyle = '#999'; // Grauer Rahmen um Zielfläche
        ctx.lineWidth = 2;
        ctx.strokeRect(offsetX, offsetY, solutionWidth, solutionHeight);

        // 3. Helfer-Gitter im Lösungsbereich (mit Offset)
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        for (let r = 0; r < puzzlePlan.grid.rows; r++) {
            for (let c = 0; c < puzzlePlan.grid.cols; c++) {
                // <<< WICHTIG: Offset hier anwenden! >>>
                ctx.strokeRect(offsetX + c * pieceWidth, offsetY + r * pieceHeight, pieceWidth, pieceHeight);
            }
        }

        // 4. Puzzleteile zeichnen (von unten nach oben)
        for (const piece of pieces) {
            ctx.drawImage(piece.img, piece.x, piece.y);
        }
    }

    // --- Event-Handler ---

    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    }

    function onMouseDown(e) {
        const pos = getMousePos(e);
        
        // <<< FIX: Schleife rückwärts laufen lassen (von oben nach unten) >>>
        // Wir iterieren von der höchsten (zuletzt gezeichneten) zur niedrigsten Ebene.
        for (let i = pieces.length - 1; i >= 0; i--) {
            const piece = pieces[i];

            // Klick-Bereich-Berechnung
            const totalWidth = piece.img.naturalWidth;
            const totalHeight = piece.img.naturalHeight;

            const borderX = totalWidth / 4;
            const borderY = totalHeight / 4;

            const visibleX_start = piece.x + borderX;
            const visibleY_start = piece.y + borderY;
            const visibleX_end = piece.x + totalWidth - borderX;
            const visibleY_end = piece.y + totalHeight - borderY;

            // Klick-Erkennung nur im sichtbaren Bereich
            if (!piece.isSnapped && 
                pos.x > visibleX_start && pos.x < visibleX_end &&
                pos.y > visibleY_start && pos.y < visibleY_end) 
            {
                activePiece = piece;
                activePiece.isDragging = true;
                
                mouseOffsetX = pos.x - activePiece.x;
                mouseOffsetY = pos.y - activePiece.y;
                
                // <<< FIX: Teil nach oben holen (an das Ende des Arrays verschieben) >>>
                // 1. Entferne das Teil von seiner aktuellen Position (i)
                pieces.splice(i, 1);
                // 2. Füge es am Ende des Arrays hinzu (damit es zuletzt gezeichnet wird)
                pieces.push(activePiece);
                
                // Da wir das oberste Teil gefunden haben, können wir aufhören.
                break;
            }
        }
    }

    function onMouseMove(e) {
        if (!activePiece || !activePiece.isDragging) return;
        const pos = getMousePos(e);
        activePiece.x = pos.x - mouseOffsetX;
        activePiece.y = pos.y - mouseOffsetY;
        draw();
    }

    function onMouseUp(e) {
        if (!activePiece) return;
        activePiece.isDragging = false;

        // Snap-Logik
        const dx = Math.abs(activePiece.x - activePiece.targetX);
        const dy = Math.abs(activePiece.y - activePiece.targetY);

        if (dx < snapTolerance && dy < snapTolerance) {
            activePiece.x = activePiece.targetX;
            activePiece.y = activePiece.targetY;
            activePiece.isSnapped = true;
            checkWin();
        }
        
        activePiece = null;
        draw();
    }

    function checkWin() {
        const allSnapped = pieces.every(p => p.isSnapped);
        if (allSnapped) {
            setTimeout(() => {
                alert('Herzlichen Glückwunsch! Puzzle gelöst!');
            }, 100);
        }
    }

    // Start der Anwendung
    init();
});