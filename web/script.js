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
        pieces.reverse(); // Für korrektes Anklicken
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

        // 4. Puzzleteile zeichnen
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
        
        for (const piece of pieces) {
            // Klick-Erkennung (unverändert)
            if (!piece.isSnapped && 
                pos.x > piece.x && pos.x < piece.x + piece.img.naturalWidth &&
                pos.y > piece.y && pos.y < piece.y + piece.img.naturalHeight) 
            {
                activePiece = piece;
                activePiece.isDragging = true;
                mouseOffsetX = pos.x - activePiece.x;
                mouseOffsetY = pos.y - activePiece.y;
                
                // Angeklicktes Teil nach oben holen
                pieces = pieces.filter(p => p.id !== activePiece.id);
                pieces.push(activePiece);
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

        // <<< Snap-Logik (unverändert) >>>
        // Funktioniert, da targetX und targetY bereits den Offset der Zielfläche enthalten.
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