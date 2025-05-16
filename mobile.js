"use strict";

Q3D.Config.AR = {
	DH: 1.5,
	FOV: 70,
	MND: 0,
	COMPASS_SIZE: 60,  // pixels
	OPACITY_STEP: 0.1  // layer opacity increment
};

var app = Q3D.application,
	ARMode = false,
	batteryLevel = null;
var orbitControls, devControls, oldFOV;
var lastPosition = null, gpsSignalStrength = 0;

// Utility function for error handling
function handleError(error, message) {
	console.error(message, error);
	Q3D.gui.popup.show(`Error: ${message}`, "Error", false, 5000);
}

// Compass display
function updateCompass(heading) {
	const compass = Q3D.E("compass");
	if (!compass) return;
	
	compass.style.transform = `rotate(${heading}deg)`;
	compass.style.display = ARMode ? "block" : "none";
}

// Battery monitoring
function monitorBattery() {
	if (navigator.getBattery) {
		navigator.getBattery().then(battery => {
			batteryLevel = battery.level * 100;
			updateBatteryDisplay();
			battery.addEventListener('levelchange', () => {
				batteryLevel = battery.level * 100;
				updateBatteryDisplay();
			});
		}).catch(err => handleError(err, "Battery monitoring failed"));
	}
}

function updateBatteryDisplay() {
	const battery = Q3D.E("battery-indicator");
	if (battery) {
		battery.textContent = `${Math.round(batteryLevel)}%`;
		battery.style.color = batteryLevel < 20 ? "#ff4444" : "#ffffff";
	}
}

// GPS signal strength
function updateGPSSignal(accuracy) {
	gpsSignalStrength = accuracy > 50 ? 'weak' : 
						accuracy > 20 ? 'medium' : 'strong';
	const indicator = Q3D.E("gps-signal");
	if (indicator) {
		indicator.className = `gps-signal ${gpsSignalStrength}`;
	}
}

app.start = function () {
	if (ARMode) {
		devControls.connect();
		monitorBattery();
	} else {
		orbitControls.enabled = true;
	}
};

app.pause = function () {
	if (ARMode) devControls.disconnect();
	else orbitControls.enabled = false;
};

app.resume = function () {
	if (ARMode) {
		devControls.connect();
		monitorBattery();
	} else {
		orbitControls.enabled = true;
	}
};

app.eventListener.resize = function () {
	var width, height;
	if (ARMode) {
		var v = Q3D.E("video"),
			asp = window.innerWidth / window.innerHeight,
			vasp = v.videoWidth / v.videoHeight;
		if (vasp > asp) {
			width = window.innerWidth;
			height = parseInt(width / vasp);
		} else {
			height = window.innerHeight;
			width = parseInt(height * vasp);
		}
	} else {
		width = window.innerWidth;
		height = window.innerHeight;
	}
	app.setCanvasSize(width, height);
	app.render();
};

app.cameraAction._move = app.cameraAction.move;
app.cameraAction.move = function (x, y, z) {
	app.cameraAction._move(x, y, z + Q3D.Config.AR.DH * app.scene.userData.zScale);
};

app._setRotateAnimationMode = app.setRotateAnimationMode;
app.setRotateAnimationMode = function (enabled) {
	app._setRotateAnimationMode(enabled);
	Q3D.E("stop-button").style.display = enabled ? "block" : "none";
};

function init() {
	orbitControls = app.controls;
	devControls = new THREE.DeviceOrientationControls(app.camera);
	devControls.alphaOffset = -Q3D.Config.AR.MND * Math.PI / 180;

	oldFOV = app.camera.fov;

	// Load settings
	try {
		var data = JSON.parse(localStorage.getItem("Qgis2threejs"));
		if (data) {
			Q3D.Config.AR.FOV = data.fov;
			Q3D.Config.AR.DH = data.deviceHeight || Q3D.Config.AR.DH;
		}
	} catch (e) {
		handleError(e, "Failed to load settings");
	}

	// Create UI elements
	createUIElements();

	// Event listeners
	setupEventListeners();

	// Touch gestures
	setupTouchGestures();
}

function createUIElements() {
	// Compass
	const compass = document.createElement("div");
	compass.id = "compass";
	compass.style.cssText = `
		position: absolute;
		top: 10px;
		right: 10px;
		width: ${Q3D.Config.AR.COMPASS_SIZE}px;
		height: ${Q3D.Config.AR.COMPASS_SIZE}px;
		background: url('compass.png') no-repeat;
		display: none;
	`;
	Q3D.E("view").appendChild(compass);

	// GPS Signal Indicator
	const gpsSignal = document.createElement("div");
	gpsSignal.id = "gps-signal";
	gpsSignal.style.cssText = `
		position: absolute;
		top: 10px;
		left: 10px;
		width: 20px;
		height: 20px;
	`;
	Q3D.E("view").appendChild(gpsSignal);

	// Battery Indicator
	const battery = document.createElement("div");
	battery.id = "battery-indicator";
	battery.style.cssText = `
		position: absolute;
		bottom: 10px;
		right: 10px;
		color: white;
	`;
	Q3D.E("view").appendChild(battery);
}

function setupEventListeners() {
	// AR mode switch
	Q3D.E("ar-checkbox").addEventListener("change", function () {
		try {
			if (this.checked) startARMode();
			else stopARMode();
		} catch (e) {
			handleError(e, "Failed to switch AR mode");
		}
	});

	// Current location
	Q3D.E("current-location").addEventListener("click", function () {
		if (ARMode) moveToCurrentLocation();
		else zoomToCurrentLocation();
	});

	// Layers button
	Q3D.E("layers-button").addEventListener("click", function () {
		var panel = Q3D.gui.layerPanel;
		if (!panel.initialized) panel.init();
		var visible = panel.isVisible();
		hideAll();
		if (visible) panel.hide();
		else {
			panel.show();
			Q3D.E("layers-button").classList.add("pressed");
			updateLayerControls();
		}
	});

	// Settings button
	Q3D.E("settings-button").addEventListener("click", function () {
		var visible = Q3D.E("settings").classList.contains("visible");
		hideAll();
		if (!visible) {
			Q3D.E("fov").value = Q3D.Config.AR.FOV;
			Q3D.E("device-height").value = Q3D.Config.AR.DH;
			Q3D.E("settings").classList.add("visible");
			Q3D.E("settings-button").classList.add("pressed");
		}
	});

	// Snapshot button
	Q3D.E("snapshot-button").addEventListener("click", captureSnapshot);

	// Device orientation
	window.addEventListener('deviceorientation', (event) => {
		if (ARMode && event.webkitCompassHeading) {
			updateCompass(event.webkitCompassHeading);
		}
	});
}

function setupTouchGestures() {
	let lastTouchDistance = 0;
	
	Q3D.E("view").addEventListener('touchstart', (e) => {
		if (e.touches.length === 2) {
			const dx = e.touches[0].pageX - e.touches[1].pageX;
			const dy = e.touches[0].pageY - e.touches[1].pageY;
			lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
		}
	});

	Q3D.E("view").addEventListener('touchmove', (e) => {
		if (e.touches.length === 2) {
			epreventDefault();
			const dx = e.touches[0].pageX - e.touches[1].pageX;
			const dy = e.touches[0].pageY - e.touches[1].pageY;
			const distance = Math.sqrt(dx * dx + dy * dy);
			
			if (lastTouchDistance > 0) {
				const selectedLayer = app.scene.mapLayers[Q3D.gui.layerPanel.selectedLayerId];
				if (selectedLayer) {
					const change = (distance - lastTouchDistance) * 0.01;
					adjustLayerOpacity(selectedLayer, change);
				}
			}
			lastTouchDistance = distance;
		}
	});

	Q3D.E("view").addEventListener('touchend', () => {
		lastTouchDistance = 0;
	});
}

function updateLayerControls() {
	const panel = Q3D.gui.layerPanel;
	Object.values(app.scene.mapLayers).forEach(layer => {
		const container = panel.getLayerContainer(layer.id);
		if (!container.querySelector('.opacity-control')) {
			const opacityControl = document.createElement('input');
			opacityControl.type = 'range';
			opacityControl.min = 0;
			opacityControl.max = 1;
			opacityControl.step = Q3D.Config.AR.OPACITY_STEP;
			opacityControl.value = layer.opacity || 1;
			opacityControl.className = 'opacity-control';
			opacityControl.addEventListener('input', () => {
				adjustLayerOpacity(layer, parseFloat(opacityControl.value));
			});
			container.appendChild(opacityControl);
		}
	});
}

function adjustLayerOpacity(layer, value) {
	if (typeof value === 'number') {
		layer.opacity = Math.max(0, Math.min(1, value));
	} else {
		layer.opacity = Math.max(0, Math.min(1, (layer.opacity || 1) + value));
	}
	layer.visibleObjects().forEach(obj => {
		if (obj.material) {
			obj.material.opacity = layer.opacity;
			obj.material.transparent = layer.opacity < 1;
		}
	});
}

function captureSnapshot() {
	try {
		const canvas = app.renderer.domElement;
		const dataURL = canvas.toDataURL('image/png');
		const link = document.createElement('a');
		link.download = `ar-snapshot-${new Date().toISOString()}.png`;
		link.href = dataURL;
		link.click();
		Q3D.gui.popup.show("Snapshot saved", "", false, 2000);
	} catch (e) {
		handleError(e, "Failed to capture snapshot");
	}
}

function startARMode(position) {
	try {
		ARMode = true;
		app.camera.fov = Q3D.Config.AR.FOV;
		app.camera.updateProjectionMatrix();

		if (typeof position === "undefined") {
			app.camera.position.set(0, 0, 30);
			Q3D.E("current-location").classList.add("touchme");
		} else {
			app.camera.position.copy(position);
		}

		if (Q3D.Config.bgColor !== null) {
			app.renderer.setClearColor(0, 0);
		}

		if (orbitControls.autoRotate) {
			app.setRotateAnimationMode(false);
		}
		orbitControls.enabled = false;

		app.controls = devControls;
		app.controls.connect();

		app.animation.start();

		navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}}).then(stream => {
			const v = Q3D.E("video");
			v.addEventListener("loadedmetadata", () => app.eventListener.resize());
			v.srcObject = stream;
			Q3D.E("view").classList.add("transparent");
		}).catch(err => handleError(err, "Camera access failed"));

		document.querySelectorAll(".action-move").forEach(elm => elm.classList.toggle("hidden"));
		document.querySelector(".action-zoom").classList.add("hidden");
		document.querySelector(".action-orbit").classList.add("hidden");
	} catch (e) {
		handleError(e, "Failed to start AR mode");
	}
}

// ... (rest of the existing functions remain largely unchanged, with added error handling)

function getCurrentPosition(callback) {
	Q3D.gui.popup.show("Fetching current location...");
	
	try {
		navigator.geolocation.getCurrentPosition(position => {
			const pos = position.coords;
			if (!pos.longitude || !pos.latitude || !pos.altitude) {
				Q3D.gui.popup.show("Could not fetch current location.", "", false, 3000);
				return;
			}

			updateGPSSignal(pos.accuracy);
			const pt = app.scene.toWorldCoordinates({x: pos.longitude, y: pos.latitude, z: pos.altitude}, true);
			let vec3 = new THREE.Vector3().copy(pt);
			const ray = new THREE.Raycaster();
			vec3.z = 99999;
			ray.set(vec3, new THREE.Vector3(0, 0, -1));

			const objects = Object.values(app.scene.mapLayers)
				.filter(layer => layer instanceof Q3DDEMLayer)
				.flatMap(layer => layer.visibleObjects());
			
			const objs = ray.intersectObjects(objects);
			if (objs.length) {
				pt.z = (objs[0].point.z + Q3D.Config.AR.DH) * app.scene.userData.zScale;
			}

			lastPosition = pt;
			callback(pt);

			const acc = Number.parseFloat(pos.accuracy);
			const msg = `Accuracy: <span class='accuracy'>${acc > 2 ? acc.toFixed(0) : acc.toFixed(1)}</span>m`;
			Q3D.gui.popup.show(msg, "Current location", false, 5000);
		}, error => {
			Q3D.gui.popup.hide();
			handleError(error, "Cannot get current location");
		}, {enableHighAccuracy: true});
	} catch (e) {
		handleError(e, "Location services unavailable");
	}
}