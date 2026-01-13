// --- CONFIGURATION ---
// Your specific AI Model
const URL_MODEL = "https://teachablemachine.withgoogle.com/models/2KNvF2Sda/";

// Your specific Firebase Keys
const firebaseConfig = {
  apiKey: "AIzaSyDgFj6bpL_rrzdnv5LcoeXd-VTYWyhahDk",
  authDomain: "recon-database-2f0c1.firebaseapp.com",
  projectId: "recon-database-2f0c1",
  storageBucket: "recon-database-2f0c1.firebasestorage.app",
  messagingSenderId: "331060784794",
  appId: "1:331060784794:web:a39ae38a64806eadea3923",
  measurementId: "G-MLVBC1WPLY"
};

// --- INITIALIZATION ---
// Initialize Firebase
// We use a try-catch block so if the database fails, the map still works.
try {
    firebase.initializeApp(firebaseConfig);
    console.log("Database Connection: ONLINE");
} catch (e) {
    console.warn("Database Connection: FAILED (Offline Mode Active)");
    console.error(e);
}
const db = firebase.database();

// Initialize Map
// Default view set to Detroit (Rust Belt) for high abandon density
const map = L.map('map', {
    zoomControl: false, // Hides the +/- buttons for a cleaner look
    attributionControl: false 
}).setView([42.3314, -83.0458], 18);

// Add Satellite Layer (Esri World Imagery)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    crossOrigin: true // CRITICAL: Allows the AI to "see" the map images
}).addTo(map);

// Update coordinates on the green display as you move
map.on('move', () => {
    const center = map.getCenter();
    document.getElementById('lat-disp').innerText = center.lat.toFixed(5);
    document.getElementById('lng-disp').innerText = center.lng.toFixed(5);
});

// Load the AI Model
let model;
async function loadAI() {
    const readout = document.getElementById("scan-readout");
    readout.innerText = "INITIALIZING AI...";
    try {
        const modelURL = URL_MODEL + "model.json";
        const metadataURL = URL_MODEL + "metadata.json";
        model = await tmImage.load(modelURL, metadataURL);
        readout.innerText = "SYSTEM ONLINE. READY.";
    } catch (e) {
        readout.innerText = "AI LOAD FAILED";
        console.error(e);
    }
}
loadAI();

// --- THE SCANNER LOGIC ---
window.initiateScan = async function() {
    const readout = document.getElementById("scan-readout");
    const bar = document.getElementById("confidence-meter");
    const btn = document.getElementById("scan-btn");

    // Safety check
    if (!model) {
        readout.innerText = "WAITING FOR AI...";
        return;
    }

    btn.disabled = true;
    readout.innerText = "CAPTURING OPTICAL FEED...";
    
    // Reset the confidence bar
    bar.style.width = "0%";
    bar.style.backgroundColor = "#0f0";

    // Take a "screenshot" of the map div
    html2canvas(document.getElementById("map"), {
        useCORS: true, // Allow cross-origin images
        allowTaint: true,
        ignoreElements: (element) => element.id === 'ui-overlay' // Don't scan the UI itself
    }).then(async canvas => {
        
        readout.innerText = "ANALYZING STRUCTURE...";
        
        // Feed the screenshot to the AI
        const prediction = await model.predict(canvas);
        
        // Find the probability for "Abandoned"
        // (This loop finds the class named "Abandoned" regardless of order)
        let abandonP = 0;
        for (let i = 0; i < prediction.length; i++) {
            if (prediction[i].className === "Abandoned") {
                abandonP = prediction[i].probability;
            }
        }

        // Update UI
        const percent = (abandonP * 100).toFixed(1);
        bar.style.width = percent + "%";
        
        if (abandonP > 0.70) {
            // HIGH CONFIDENCE
            readout.innerText = `TARGET CONFIRMED (${percent}%)`;
            bar.style.backgroundColor = "#f00"; // Red
            markLocation(abandonP); // Save to database
        } else if (abandonP > 0.40) {
            // MEDIUM CONFIDENCE
            readout.innerText = `UNCERTAIN MATCH (${percent}%)`;
            bar.style.backgroundColor = "orange";
        } else {
            // LOW CONFIDENCE
            readout.innerText = "SECTOR CLEAR";
            bar.style.backgroundColor = "#0f0"; // Green
        }
        
        btn.disabled = false;
        
    }).catch(err => {
        console.error(err);
        readout.innerText = "SENSOR ERROR (CORS)";
        btn.disabled = false;
    });
};

// --- MARKER SYSTEM ---
function markLocation(confidence) {
    const center = map.getCenter();
    
    // Create a unique ID for this find
    const locId = Date.now();
    
    // Send to Firebase
    firebase.database().ref('targets/' + locId).set({
        lat: center.lat,
        lng: center.lng,
        confidence: confidence,
        finder: "Agent_" + Math.floor(Math.random() * 999), // Random Agent ID
        timestamp: Date.now()
    });
}

// --- TEAM SYNC (LISTEN FOR UPDATES) ---
// This runs whenever ANYONE on the team finds something
firebase.database().ref('targets/').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        Object.keys(data).forEach(key => {
            const t = data[key];
            
            // Add a red marker to the map
            L.circleMarker([t.lat, t.lng], {
                color: '#f00',
                fillColor: '#f00',
                fillOpacity: 0.5,
                radius: 20
            }).addTo(map)
            .bindPopup(`<b>TARGET DETECTED</b><br>Confidence: ${(t.confidence*100).toFixed(0)}%<br>Time: ${new Date(t.timestamp).toLocaleTimeString()}`);
        });
    }
});
