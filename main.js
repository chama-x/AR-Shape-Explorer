import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// --- Global Data & State ---
const SHAPE_DATA = {
    cube: {
        name: "Cube", faces: "6", edges: "12", vertices: "8",
        vol: "a³ (side cubed)", sa: "6a²"
    },
    sphere: {
        name: "Sphere", faces: "1", edges: "0", vertices: "0",
        vol: "⁴⁄₃πr³", sa: "4πr²"
    },
    cone: {
        name: "Cone", faces: "2", edges: "1", vertices: "1",
        vol: "⅓πr²h", sa: "πr(r + l)"
    },
    cylinder: {
        name: "Cylinder", faces: "3", edges: "2", vertices: "0",
        vol: "πr²h", sa: "2πrh + 2πr²"
    }
};

const COLOR_PALETTE = [0x4F46E5, 0x10B981, 0xF59E0B, 0xEC4899, 0x8B5CF6, 0x06B6D4];

let camera, scene, renderer;
let hitTestSource = null;
let hitTestSourceRequested = false;
let reticle;
let activeShapes = []; // Array of placed shapes
let currentSelectedShape = null; // The shape currently being manipulated

// UI Elements
const ui = {
    startScreen: document.getElementById('start-screen'),
    loadingContainer: document.getElementById('loading-container'),
    arButtonContainer: document.getElementById('ar-button-container'),
    launchIosBtn: document.getElementById('launch-ios-btn'),
    arWarning: document.getElementById('ar-warning'),
    statusBar: document.getElementById('status-bar'),
    statusText: document.getElementById('status-text'),
    pulseDot: document.querySelector('.pulse-dot'),
    trackingPrompt: document.getElementById('tracking-prompt'),
    trackingPromptText: document.getElementById('tracking-prompt-text'),
    instructions: document.getElementById('ar-instructions'),
    controls: document.getElementById('controls'),
    dangerControls: document.getElementById('danger-controls'),
    infoCard: document.getElementById('info-card'),
    shapeName: document.getElementById('shape-name'),
    shapeFaces: document.getElementById('shape-faces'),
    shapeEdges: document.getElementById('shape-edges'),
    shapeVertices: document.getElementById('shape-vertices'),
    shapeVol: document.getElementById('shape-vol'),
    shapeSa: document.getElementById('shape-sa')
};

let selectedShapeType = 'cube';

// Gesture State
let isDragging = false;
let previousTouchPos = { x: 0, y: 0 };
let initialPinchDistance = 0;
let initialScale = 1;

init();

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0x444455, 2);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(-1, 2, 1);
    scene.add(dirLight);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    
    document.body.appendChild(renderer.domElement);

    // Variant Launch Initialization
    window.addEventListener('vlaunch-initialized', (event) => {
        ui.loadingContainer.style.display = 'none';
        const { launchRequired, webXRStatus } = event.detail;

        if (webXRStatus === 'supported') {
            ui.arButtonContainer.classList.remove('hidden');
            setupNativeAR();
        } else if (webXRStatus === 'launch-required' || launchRequired) {
            ui.launchIosBtn.classList.remove('hidden');
            ui.launchIosBtn.addEventListener('click', () => {
                window.location.href = VLaunch.getLaunchUrl(window.location.href);
            });
        } else {
            showARUnavailable();
        }
    });

    setTimeout(() => {
        if (ui.loadingContainer.style.display !== 'none' && !window.VLaunch) {
            showARUnavailable();
        }
    }, 5000);

    setupReticle();
    window.addEventListener('resize', onWindowResize);
}

function setupNativeAR() {
    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ['local', 'hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.getElementById('overlay') }
    });
    ui.arButtonContainer.appendChild(arButton);

    const controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', onSessionEnd);
    document.addEventListener('vlaunch-ar-tracking', handleTrackingQuality);

    renderer.setAnimationLoop(animate);
    setupUIControls();
    
    // Setup gestures on the AR hit-test canvas area
    setupGestures();
}

function showARUnavailable() {
    ui.loadingContainer.style.display = 'none';
    ui.arWarning.style.display = 'block';
}

function setupReticle() {
    const geometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    reticle = new THREE.Mesh(geometry, material);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
}

// --- Logic ---

function onSelect() {
    // If we are actively interacting with an object via gestures, don't place a new one
    // Hit-testing standard WebXR select
    if (reticle.visible && !isDragging) {
        if (!ui.instructions.classList.contains('hidden')) {
            ui.instructions.classList.add('hidden');
            ui.infoCard.classList.remove('hidden');
        }

        placeShape(selectedShapeType, reticle.matrix);
        updateEducationalInfo(selectedShapeType);
        
        if (navigator.vibrate) navigator.vibrate(20);
    }
}

function updateEducationalInfo(type) {
    const data = SHAPE_DATA[type];
    ui.shapeName.innerText = data.name;
    ui.shapeFaces.innerText = data.faces;
    ui.shapeEdges.innerText = data.edges;
    ui.shapeVertices.innerText = data.vertices;
    ui.shapeVol.innerText = data.vol;
    ui.shapeSa.innerText = data.sa;
}

function placeShape(type, matrix) {
    let geometry;
    switch (type) {
        case 'cube': geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2); break;
        case 'sphere': geometry = new THREE.SphereGeometry(0.12, 32, 16); break;
        case 'cone': geometry = new THREE.ConeGeometry(0.12, 0.25, 32); break;
        case 'cylinder': geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.25, 32); break;
    }

    const material = new THREE.MeshStandardMaterial({ 
        color: COLOR_PALETTE[0],
        roughness: 0.2,
        metalness: 0.1
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.setFromMatrixPosition(matrix);
    
    // Add wireframe for educational clarity
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
    mesh.add(line);
    
    // Store metadata
    mesh.userData = {
        type: type,
        colorIndex: 0
    };

    scene.add(mesh);
    activeShapes.push(mesh);
    
    // Automatically select the newest placed shape for manipulation
    currentSelectedShape = mesh;
}

// --- Gestures (Drag, Pinch, Tap) ---
function setupGestures() {
    const domElement = renderer.domElement;
    
    domElement.addEventListener('touchstart', (e) => {
        if (!currentSelectedShape) return;
        
        if (e.touches.length === 1) {
            // Potential drag or tap
            isDragging = false;
            previousTouchPos = { x: e.touches[0].pageX, y: e.touches[0].pageY };
        } else if (e.touches.length === 2) {
            // Pinch
            const dx = e.touches[0].pageX - e.touches[1].pageX;
            const dy = e.touches[0].pageY - e.touches[1].pageY;
            initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
            initialScale = currentSelectedShape.scale.x;
        }
    });

    domElement.addEventListener('touchmove', (e) => {
        if (!currentSelectedShape) return;

        if (e.touches.length === 1) {
            // Drag to rotate
            isDragging = true;
            const deltaX = e.touches[0].pageX - previousTouchPos.x;
            const deltaY = e.touches[0].pageY - previousTouchPos.y;
            
            // Rotate shape
            currentSelectedShape.rotation.y += deltaX * 0.01;
            currentSelectedShape.rotation.x += deltaY * 0.01;
            
            previousTouchPos = { x: e.touches[0].pageX, y: e.touches[0].pageY };
        } else if (e.touches.length === 2) {
            // Pinch to scale
            const dx = e.touches[0].pageX - e.touches[1].pageX;
            const dy = e.touches[0].pageY - e.touches[1].pageY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const scaleFactor = distance / initialPinchDistance;
            let newScale = initialScale * scaleFactor;
            
            // Clamp scale bounds (min 0.2x, max 3.0x default)
            newScale = Math.max(0.2, Math.min(newScale, 3.0));
            currentSelectedShape.scale.set(newScale, newScale, newScale);
        }
    });

    domElement.addEventListener('touchend', (e) => {
        if (!currentSelectedShape) return;
        
        // If it was a quick tap without dragging, change color
        if (!isDragging && e.changedTouches.length === 1) {
            // Raycast to check if they tapped the shape or just the screen
            const touch = e.changedTouches[0];
            const mouse = new THREE.Vector2(
                (touch.pageX / window.innerWidth) * 2 - 1,
                -(touch.pageY / window.innerHeight) * 2 + 1
            );
            
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, camera);
            
            const intersects = raycaster.intersectObjects(activeShapes);
            if (intersects.length > 0) {
                const tappedShape = intersects[0].object;
                currentSelectedShape = tappedShape; // Make it active
                
                // Cycle color
                tappedShape.userData.colorIndex = (tappedShape.userData.colorIndex + 1) % COLOR_PALETTE.length;
                tappedShape.material.color.setHex(COLOR_PALETTE[tappedShape.userData.colorIndex]);
                
                // Update info card to match tapped shape
                updateEducationalInfo(tappedShape.userData.type);
                
                if (navigator.vibrate) navigator.vibrate(10);
            }
        }
        isDragging = false;
    });
}

// --- Lifecycle ---

function onSessionStart() {
    ui.startScreen.style.display = 'none';
    setTimeout(() => {
        ui.statusBar.classList.remove('hidden');
        ui.instructions.classList.remove('hidden');
        ui.controls.classList.remove('hidden');
        ui.dangerControls.classList.remove('hidden');
        updateStatus("Scanning for surfaces...", "scanning");
        updateEducationalInfo(selectedShapeType);
    }, 500);
}

function onSessionEnd() {
    ui.startScreen.style.display = 'flex';
    ui.statusBar.classList.add('hidden');
    ui.instructions.classList.add('hidden');
    ui.controls.classList.add('hidden');
    ui.dangerControls.classList.add('hidden');
    ui.trackingPrompt.classList.add('hidden');
    ui.infoCard.classList.add('hidden');
    reticle.visible = false;
}

function handleTrackingQuality(event) {
    const state = event.detail.state;
    if (state === 'normal') {
        ui.trackingPrompt.classList.add('hidden');
    } else {
        ui.trackingPrompt.classList.remove('hidden');
        switch (state) {
            case 'limited-excessive-motion': ui.trackingPromptText.innerText = "Moving too fast. Slow down."; break;
            case 'limited-initializing': ui.trackingPromptText.innerText = "Initializing AR Tracking..."; break;
            case 'limited-insufficient-features': ui.trackingPromptText.innerText = "Point at a textured flat surface."; break;
            case 'limited-relocalizing': ui.trackingPromptText.innerText = "Relocalizing... hold still."; break;
            case 'not-available': ui.trackingPromptText.innerText = "Tracking lost."; break;
        }
    }
}

// --- Render Loop ---

function animate(timestamp, frame) {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then((referenceSpace) => {
                session.requestHitTestSource({ space: referenceSpace }).then((source) => {
                    hitTestSource = source;
                });
            });
            session.addEventListener('end', () => {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
                updateStatus("Surface found. Tap to place.", "ready");
            } else {
                reticle.visible = false;
                updateStatus("Scanning for flat surfaces...", "scanning");
            }
        }
    }

    renderer.render(scene, camera);
}

// --- Helpers ---

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateStatus(text, state) {
    if (ui.statusText.innerText !== text) {
        ui.statusText.innerText = text;
        ui.pulseDot.className = 'pulse-dot ' + state;
    }
}

function setupUIControls() {
    const btns = document.querySelectorAll('.control-btn:not(.danger)');
    btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            btns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectedShapeType = e.currentTarget.getAttribute('data-shape');
            updateEducationalInfo(selectedShapeType);
            if (navigator.vibrate) navigator.vibrate(10);
        });
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
        activeShapes.forEach(shape => scene.remove(shape));
        activeShapes = [];
        currentSelectedShape = null;
        ui.infoCard.classList.add('hidden');
        if (!ui.statusBar.classList.contains('hidden')) {
            ui.instructions.classList.remove('hidden');
        }
        if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
    });
}
