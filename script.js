// --- CONFIGURATION ---
const URL_MODEL = "https://teachablemachine.withgoogle.com/models/2KNvF2Sda/";

const firebaseConfig = {
  apiKey: "AIzaSyDgFj6bpL_rrzdnv5LcoeXd-VTYWyhahDk",
  authDomain: "recon-database-2f0c1.firebaseapp.com",
  projectId: "recon-database-2f0c1",
  storageBucket: "recon-database-2f0c1.firebasestorage.app",
  messagingSenderId: "331060784794",
  appId: "1:331060784794:web:a39ae38a64806eadea3923",
  measurementId: "G-MLVBC1WPLY"
};

// --- INIT ---
try {
    firebase.initializeApp(firebaseConfig);
    console.log("Uplink Established.");
} catch (e) { console.warn("Offline Mode"); }

const map = L.map('map', { 
    zoomControl: false, 
    attributionControl: false 
}).setView([42.3314, -83.0458], 15);

// USE MAX NATIVE ZOOM 19 for High Res
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, 
    maxNativeZoom: 19,
    crossOrigin: true
}).addTo(map);

map.on('move', () => {
    const c = map.getCenter();
    document.getElementById('lat-disp').innerText = c.lat.toFixed(5);
    document.getElementById('lng-disp').innerText = c.lng.toFixed(5);
});

// --- AI LOADER ---
let model;
async function loadAI() {
    try {
        model = await tmImage.load(URL_MODEL + "model.json", URL_MODEL + "metadata.json");
        document.getElementById("scan-readout").innerText = "SYSTEM READY";
    } catch (e) { console.error(e); }
}
loadAI();

// --- DRAG SELECTION LOGIC ---
let isTargeting = false;
let startX, startY;
const box = document.getElementById('selection-box');
const mapContainer = document.getElementById('map');
let isScanning = false; // Flag to stop scan

window.toggleMode = function() {
    isTargeting = !isTargeting;
    const btn = document.getElementById('mode-btn');
    const instr = document.getElementById('instruction-text');
    
    if (isTargeting) {
        btn.innerText = "DISENGAGE TARGETING";
        btn.classList.add("active");
        instr.style.display = "block";
        map.dragging.disable(); 
        mapContainer.style.cursor = "crosshair";
    } else {
        btn.innerText = "ACTIVATE DRAG SCAN";
        btn.classList.remove("active");
        instr.style.display = "none";
        map.dragging.enable(); 
        mapContainer.style.cursor = "grab";
        box.style.display = 'none';
    }
};

mapContainer.addEventListener('mousedown', startDraw);
mapContainer.addEventListener('touchstart', (e) => startDraw(e.touches[0]), {passive: false});
mapContainer.addEventListener('mousemove', moveDraw);
mapContainer.addEventListener('touchmove', (e) => moveDraw(e.touches[0]), {passive: false});
mapContainer.addEventListener('mouseup', endDraw);
mapContainer.addEventListener('touchend', endDraw);

function startDraw(e) {
    if (!isTargeting) return;
    const rect = mapContainer.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    box.style.left = startX + 'px';
    box.style.top = startY + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.display = 'block';
}

function moveDraw(e) {
    if (!isTargeting || box.style.display === 'none') return;
    const rect = mapContainer.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    const width = currentX - startX;
    const height = currentY - startY;
    
    box.style.width = Math.abs(width) + 'px';
    box.style.height = Math.abs(height) + 'px';
    box.style.left = (width < 0 ? currentX : startX) + 'px';
    box.style.top = (height < 0 ? currentY : startY) + 'px';
}

function endDraw() {
    if (!isTargeting) return;
    const rect = box.getBoundingClientRect();
    
    if (rect.width > 20 && rect.height > 20) {
        // Convert screen box to Lat/Lng Bounds for Grid Scan
        const bounds = map.containerPointToLatLng([rect.left, rect.top]);
        const bounds2 = map.containerPointToLatLng([rect.right, rect.bottom]);
        
        // Ensure we know NorthWest and SouthEast
        const north = Math.max(bounds.lat, bounds2.lat);
        const south = Math.min(bounds.lat, bounds2.lat);
        const west = Math.min(bounds.lng, bounds2.lng);
        const east = Math.max(bounds.lng, bounds2.lng);

        startGridScan(north, south, west, east);
    }
    box.style.display = 'none';
}

// --- THE GRID SCANNER (Chunk by Chunk) ---
window.cancelScan = function() {
    isScanning = false;
    document.getElementById('progress-overlay').style.display = 'none';
};

async function startGridScan(north, south, west, east) {
    if (!model) return;
    isScanning = true;
    
    const overlay = document.getElementById('progress-overlay');
    const bar = document.getElementById('progress-fill');
    const txt = document.getElementById('progress-text');
    overlay.style.display = 'flex';

    // 1. Define Chunk Size (roughly screen size at Zoom 19)
    // 0.002 degrees is approx 200 meters, good for a detailed snapshot
    const stepLat = 0.002; 
    const stepLng = 0.003; 

    // 2. Generate Grid Points
    let points = [];
    for (let lat = north; lat > south; lat -= stepLat) {
        for (let lng = west; lng < east; lng += stepLng) {
            points.push([lat, lng]);
        }
    }
    
    // Safety limit to prevent crashing
    if (points.length > 50) {
        alert(`WARNING: Selection too large (${points.length} sectors). Scanning first 50 only.`);
        points = points.slice(0, 50);
    }

    const total = points.length;
    let foundCount = 0;

    // 3. Iterate through chunks
    for (let i = 0; i < points.length; i++) {
        if (!isScanning) break; // Allow abort
        
        const center = points[i];
        
        // A. Move Map & Zoom In
        map.setView(center, 19, { animate: false });
        
        // B. Wait for tiles to load (Critical for High Res)
        await new Promise(r => setTimeout(r, 1500)); 
        
        // C. Capture
        await captureAndAnalyze(center);
        
        // D. Update UI
        const pct = Math.round(((i + 1) / total) * 100);
        bar.style.width = pct + "%";
        txt.innerText = `${pct}% COMPLETE`;
    }

    overlay.style.display = 'none';
    alert(`SCAN COMPLETE. Discovered ${foundCount} targets.`);
}

async function captureAndAnalyze(latlng) {
    return html2canvas(document.getElementById("map"), {
        useCORS: true, allowTaint: true, scale: 2
    }).then(async canvas => {
        const prediction = await model.predict(canvas);
        const abandon = prediction.find(p => p.className === "Abandoned");
        
        if (abandon && abandon.probability > 0.70) {
            saveTarget(abandon.probability, canvas.toDataURL(), latlng);
        }
    });
}

// --- DATABASE ---
function saveTarget(confidence, imgData, latlng) {
    const locId = Date.now() + Math.random().toString(36).substr(2, 5);
    // LatLng might be array or object depending on source
    const lat = latlng[0] || latlng.lat;
    const lng = latlng[1] || latlng.lng;

    firebase.database().ref('discovery/' + locId).set({
        lat: lat,
        lng: lng,
        confidence: confidence,
        image: imgData,
        timestamp: Date.now()
    });
}

window.toggleDatabase = function() {
    const el = document.getElementById('database-overlay');
    const grid = document.getElementById('db-grid');
    if (el.style.display === 'none') {
        el.style.display = 'flex';
        grid.innerHTML = '<div style="color:#0f0;">LOADING ARCHIVES...</div>';
        firebase.database().ref('discovery/').once('value', (snapshot) => {
            grid.innerHTML = '';
            const data = snapshot.val();
            if (data) {
                Object.keys(data).reverse().forEach(key => {
                    const item = data[key];
                    const div = document.createElement('div');
                    div.className = 'db-item';
                    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
                    div.innerHTML = `
                        <img src="${item.image}" />
                        <div class="db-info">
                            CONF: ${(item.confidence*100).toFixed(0)}%
                        </div>
                        <a href="${gmapsUrl}" target="_blank" class="coord-link">OPEN MAPS</a>
                    `;
                    grid.appendChild(div);
                });
            } else { grid.innerHTML = 'NO TARGETS FOUND'; }
        });
    } else { el.style.display = 'none'; }
};
