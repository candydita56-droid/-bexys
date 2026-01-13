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
const db = firebase.database();

const map = L.map('map', { 
    zoomControl: false, 
    attributionControl: false 
}).setView([42.3314, -83.0458], 18);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, crossOrigin: true
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

window.toggleMode = function() {
    isTargeting = !isTargeting;
    const btn = document.getElementById('mode-btn');
    const instr = document.getElementById('instruction-text');
    
    if (isTargeting) {
        btn.innerText = "DISENGAGE TARGETING";
        btn.classList.add("active");
        instr.style.display = "block";
        map.dragging.disable(); // FREEZE MAP
        mapContainer.style.cursor = "crosshair";
    } else {
        btn.innerText = "ACTIVATE TARGETING";
        btn.classList.remove("active");
        instr.style.display = "none";
        map.dragging.enable(); // UNFREEZE MAP
        mapContainer.style.cursor = "grab";
        box.style.display = 'none';
    }
};

// Events for Mouse & Touch
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
    
    // Minimum size check (prevent accidental clicks)
    if (rect.width > 20 && rect.height > 20) {
        processScan(rect);
    }
    
    // Visual reset
    setTimeout(() => { box.style.display = 'none'; }, 200);
}

// --- SCANNING ENGINE ---
async function processScan(rect) {
    if (!model) return;
    
    const readout = document.getElementById("scan-readout");
    readout.innerText = "ENHANCING & ANALYZING...";
    
    // 1. Full Res Capture
    html2canvas(document.getElementById("map"), {
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio || 2 // Force Retina/High-Res
    }).then(async fullCanvas => {
        
        // 2. Crop to Selection
        const cropCanvas = document.createElement('canvas');
        const scale = window.devicePixelRatio || 2;
        
        cropCanvas.width = rect.width * scale;
        cropCanvas.height = rect.height * scale;
        const ctx = cropCanvas.getContext('2d');
        
        ctx.drawImage(
            fullCanvas, 
            rect.left * scale, rect.top * scale, rect.width * scale, rect.height * scale,
            0, 0, rect.width * scale, rect.height * scale
        );

        // 3. AI Prediction
        const prediction = await model.predict(cropCanvas);
        
        let abandonP = 0;
        for (let i = 0; i < prediction.length; i++) {
            if (prediction[i].className === "Abandoned") abandonP = prediction[i].probability;
        }

        const percent = (abandonP * 100).toFixed(1);
        document.getElementById("confidence-meter").style.width = percent + "%";
        
        if (abandonP > 0.50) {
            readout.innerText = `TARGET IDENTIFIED (${percent}%)`;
            // Save Image & Data to DB
            saveTarget(abandonP, cropCanvas.toDataURL());
        } else {
            readout.innerText = "SECTOR CLEAR";
        }
        
    }).catch(err => {
        console.error(err);
        readout.innerText = "SENSOR ERROR";
    });
}

// --- DATABASE FUNCTIONS ---
function saveTarget(confidence, imgData) {
    const locId = Date.now();
    const center = map.getCenter();
    
    firebase.database().ref('intel/' + locId).set({
        lat: center.lat,
        lng: center.lng,
        confidence: confidence,
        image: imgData, // Storing the base64 image directly
        status: "UNVERIFIED",
        timestamp: Date.now()
    });
}

window.toggleDatabase = function() {
    const el = document.getElementById('database-overlay');
    const grid = document.getElementById('db-grid');
    
    if (el.style.display === 'none') {
        el.style.display = 'flex';
        // Load data
        grid.innerHTML = '<div style="color:#0f0;">DECRYPTING ARCHIVES...</div>';
        
        firebase.database().ref('intel/').once('value', (snapshot) => {
            grid.innerHTML = '';
            const data = snapshot.val();
            if (data) {
                // Show newest first
                Object.keys(data).reverse().forEach(key => {
                    const item = data[key];
                    const div = document.createElement('div');
                    div.className = 'db-item';
                    
                    const statusColor = item.status === "CONFIRMED" ? "#0f0" : (item.status === "FALSE_ALARM" ? "#f00" : "#aaa");
                    
                    div.innerHTML = `
                        <img src="${item.image}" />
                        <div class="db-info">
                            CONF: ${(item.confidence*100).toFixed(0)}%<br>
                            STATUS: <span style="color:${statusColor}">${item.status}</span>
                        </div>
                        <button class="verify-btn btn-yes" onclick="verify('${key}', 'CONFIRMED')">CONFIRM ABANDONED</button>
                        <button class="verify-btn btn-no" onclick="verify('${key}', 'FALSE_ALARM')">FALSE POSITIVE</button>
                    `;
                    grid.appendChild(div);
                });
            } else {
                grid.innerHTML = '<div style="color:#555;">NO INTEL COLLECTED YET</div>';
            }
        });
        
    } else {
        el.style.display = 'none';
    }
};

window.verify = function(key, newStatus) {
    firebase.database().ref('intel/' + key).update({
        status: newStatus
    });
    // Refresh the view
    toggleDatabase(); 
    toggleDatabase(); 
};
