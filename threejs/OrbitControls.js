/**
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 * @author grok-enhanced / Advanced features and optimizations
 */

// Enhanced OrbitControls with smooth interpolation, advanced touch support, and animation capabilities
THREE.OrbitControls = function (object, domElement) {
  this.object = object;
  this.domElement = domElement !== undefined ? domElement : document;

  // Core configuration
  this.enabled = true;
  this.target = new THREE.Vector3();
  this.minDistance = 0;
  this.maxDistance = Infinity;
  this.minZoom = 0;
  this.maxZoom = Infinity;
  this.minPolarAngle = 0;
  this.maxPolarAngle = Math.PI;
  this.minAzimuthAngle = -Infinity;
  this.maxAzimuthAngle = Infinity;

  // Interaction settings
  this.enableDamping = true; // Enabled by default for smoother motion
  this.dampingFactor = 0.05; // Reduced for more responsive damping
  this.enableZoom = true;
  this.zoomSpeed = 1.0;
  this.enableRotate = true;
  this.rotateSpeed = 0.5;
  this.keyRotateAngle = Math.PI / 360;
  this.enablePan = true;
  this.panSpeed = 1.0;
  this.screenSpacePanning = false;
  this.keyPanSpeed = 4.0;
  this.autoRotate = false;
  this.autoRotateSpeed = 2.0;
  this.enableKeys = true;

  // New advanced features
  this.smoothTime = 0.2; // Time for smooth interpolation (seconds)
  this.enableSmooth = true; // Enable smooth camera transitions
  this.enableMomentum = true; // Simulate momentum on release
  this.momentumScalingFactor = 0.02; // Momentum effect strength
  this.enableTouchRotationDamping = true; // Smooth touch rotation
  this.touchRotationDampingFactor = 0.1;

  // Key bindings
  this.keys = { LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40 };
  this.mouseButtons = {
    LEFT: THREE.MOUSE.LEFT,
    MIDDLE: THREE.MOUSE.MIDDLE,
    RIGHT: THREE.MOUSE.RIGHT,
  };

  // State preservation
  this.target0 = this.target.clone();
  this.position0 = this.object.position.clone();
  this.zoom0 = this.object.zoom;

  // Internal state
  const scope = this;
  const changeEvent = { type: "change" };
  const startEvent = { type: "start" };
  const endEvent = { type: "end" };
  const STATE = {
    NONE: -1,
    ROTATE: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
    TOUCH_DOLLY_PAN: 4,
    TOUCH_DOLLY_ROTATE: 5, // New state for combined touch gestures
  };
  let state = STATE.NONE;
  const EPS = 0.000001;

  // Spherical coordinates and deltas
  const spherical = new THREE.Spherical();
  const sphericalDelta = new THREE.Spherical();
  let scale = 1;
  const panOffset = new THREE.Vector3();
  let zoomChanged = false;

  // Input tracking
  const rotateStart = new THREE.Vector2();
  const rotateEnd = new THREE.Vector2();
  const rotateDelta = new THREE.Vector2();
  const panStart = new THREE.Vector2();
  const panEnd = new THREE.Vector2();
  const panDelta = new THREE.Vector2();
  const dollyStart = new THREE.Vector2();
  const dollyEnd = new THREE.Vector2();
  const dollyDelta = new THREE.Vector2();

  // Smooth interpolation state
  const targetPosition = new THREE.Vector3();
  const targetSpherical = new THREE.Spherical();
  const currentPosition = new THREE.Vector3();
  const currentSpherical = new THREE.Spherical();
  let lastUpdateTime = performance.now();
  let momentumVelocity = new THREE.Vector2();

  // Camera orientation
  const quat = new THREE.Quaternion().setFromUnitVectors(
    object.up,
    new THREE.Vector3(0, 1, 0)
  );
  const quatInverse = quat.clone().inverse();

  // Public methods
  this.getPolarAngle = function () {
    return spherical.phi;
  };

  this.getAzimuthalAngle = function () {
    return spherical.theta;
  };

  this.saveState = function () {
    scope.target0.copy(scope.target);
    scope.position0.copy(scope.object.position);
    scope.zoom0 = scope.object.zoom;
  };

  this.reset = function () {
    scope.target.copy(scope.target0);
    scope.object.position.copy(scope.position0);
    scope.object.zoom = scope.zoom0;
    scope.object.updateProjectionMatrix();
    scope.dispatchEvent(changeEvent);
    scope.update();
    state = STATE.NONE;
  };

  // New: Programmatic animation to target position
  this.animateTo = function (position, target, duration = 1000) {
    if (!scope.enabled) return;
    const startPos = scope.object.position.clone();
    const startTarget = scope.target.clone();
    const startTime = performance.now();

    function animate() {
      if (!scope.enabled) return;
      const t = Math.min((performance.now() - startTime) / duration, 1);
      const easedT = 1 - Math.pow(1 - t, 3); // Cubic ease-out

      scope.object.position.lerpVectors(startPos, position, easedT);
      scope.target.lerpVectors(startTarget, target, easedT);
      scope.object.lookAt(scope.target);
      scope.dispatchEvent(changeEvent);

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  };

  // Core update logic
  this.update = (function () {
    const offset = new THREE.Vector3();
    const lastPosition = new THREE.Vector3();
    const lastQuaternion = new THREE.Quaternion();

    return function update(deltaTime) {
      if (!scope.enabled) return false;

      const now = performance.now();
      deltaTime = deltaTime || (now - lastUpdateTime) / 1000;
      lastUpdateTime = now;

      const position = scope.object.position;
      offset.copy(position).sub(scope.target);
      offset.applyQuaternion(quat);

      spherical.setFromVector3(offset);

      if (scope.autoRotate && state === STATE.NONE) {
        rotateLeft(getAutoRotationAngle() * deltaTime);
      }

      // Apply momentum
      if (
        scope.enableMomentum &&
        state === STATE.NONE &&
        momentumVelocity.lengthSq() > EPS
      ) {
        rotateLeft(momentumVelocity.x * deltaTime);
        rotateUp(momentumVelocity.y * deltaTime);
        momentumVelocity.multiplyScalar(1 - scope.dampingFactor);
      }

      // Apply deltas with smooth interpolation
      if (scope.enableSmooth) {
        targetSpherical.theta = spherical.theta + sphericalDelta.theta;
        targetSpherical.phi = spherical.phi + sphericalDelta.phi;
        targetSpherical.radius = spherical.radius * scale;

        const t = 1 - Math.exp(-deltaTime / scope.smoothTime);
        spherical.theta = THREE.MathUtils.lerp(
          spherical.theta,
          targetSpherical.theta,
          t
        );
        spherical.phi = THREE.MathUtils.lerp(
          spherical.phi,
          targetSpherical.phi,
          t
        );
        spherical.radius = THREE.MathUtils.lerp(
          spherical.radius,
          targetSpherical.radius,
          t
        );
      } else {
        spherical.theta += sphericalDelta.theta;
        spherical.phi += sphericalDelta.phi;
        spherical.radius *= scale;
      }

      // Restrict angles and radius
      spherical.theta = Math.max(
        scope.minAzimuthAngle,
        Math.min(scope.maxAzimuthAngle, spherical.theta)
      );
      spherical.phi = Math.max(
        scope.minPolarAngle,
        Math.min(scope.maxPolarAngle, spherical.phi)
      );
      spherical.makeSafe();
      spherical.radius = Math.max(
        scope.minDistance,
        Math.min(scope.maxDistance, spherical.radius)
      );

      // Apply panning
      targetPosition.copy(scope.target).add(panOffset);
      scope.target.lerp(targetPosition, scope.enableSmooth ? 0.1 : 1);

      offset.setFromSpherical(spherical);
      offset.applyQuaternion(quatInverse);
      position.copy(scope.target).add(offset);
      scope.object.lookAt(scope.target);

      // Damp deltas
      if (scope.enableDamping) {
        sphericalDelta.theta *= 1 - scope.dampingFactor;
        sphericalDelta.phi *= 1 - scope.dampingFactor;
        panOffset.multiplyScalar(1 - scope.dampingFactor);
      } else {
        sphericalDelta.set(0, 0, 0);
        panOffset.set(0, 0, 0);
      }

      scale = 1;

      // Detect changes
      if (
        zoomChanged ||
        lastPosition.distanceToSquared(position) > EPS ||
        8 * (1 - lastQuaternion.dot(scope.object.quaternion)) > EPS
      ) {
        scope.dispatchEvent(changeEvent);
        lastPosition.copy(position);
        lastQuaternion.copy(scope.object.quaternion);
        zoomChanged = false;
        return true;
      }

      return false;
    };
  })();

  this.dispose = function () {
    scope.domElement.removeEventListener("mousedown", onMouseDown);
    scope.domElement.removeEventListener("wheel", onMouseWheel);
    scope.domElement.removeEventListener("mousewheel", onMouseWheel);
    scope.domElement.removeEventListener("touchstart", onTouchStart);
    scope.domElement.removeEventListener("touchend", onTouchEnd);
    scope.domElement.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("keydown", onKeyDown);
    scope.domElement.removeEventListener("contextmenu", onContextMenu);
  };

  // Internal functions
  function getAutoRotationAngle() {
    return ((2 * Math.PI) / 60 / 60) * scope.autoRotateSpeed;
  }

  function getZoomScale() {
    return Math.pow(0.95, scope.zoomSpeed);
  }

  function rotateLeft(angle) {
    sphericalDelta.theta -= angle;
  }

  function rotateUp(angle) {
    sphericalDelta.phi -= angle;
  }

  const panLeft = (function () {
    const v = new THREE.Vector3();
    return function panLeft(distance, objectMatrix) {
      v.setFromMatrixColumn(objectMatrix, 0);
      v.multiplyScalar(-distance);
      panOffset.add(v);
    };
  })();

  const panUp = (function () {
    const v = new THREE.Vector3();
    return function panUp(distance, objectMatrix) {
      if (scope.screenSpacePanning) {
        v.setFromMatrixColumn(objectMatrix, 1);
      } else {
        v.setFromMatrixColumn(objectMatrix, 0);
        v.crossVectors(scope.object.up, v);
      }
      v.multiplyScalar(distance);
      panOffset.add(v);
    };
  })();

  const pan = (function () {
    const offset = new THREE.Vector3();
    return function pan(deltaX, deltaY) {
      const element =
        scope.domElement === document
          ? scope.domElement.body
          : scope.domElement;

      if (scope.object.isPerspectiveCamera) {
        const position = scope.object.position;
        offset.copy(position).sub(scope.target);
        let targetDistance = offset.length();
        targetDistance *= Math.tan(((scope.object.fov / 2) * Math.PI) / 180.0);
        panLeft(
          (2 * deltaX * targetDistance) / element.clientHeight,
          scope.object.matrix
        );
        panUp(
          (2 * deltaY * targetDistance) / element.clientHeight,
          scope.object.matrix
        );
      } else if (scope.object.isOrthographicCamera) {
        panLeft(
          (deltaX * (scope.object.right - scope.object.left)) /
            scope.object.zoom /
            element.clientWidth,
          scope.object.matrix
        );
        panUp(
          (deltaY * (scope.object.top - scope.object.bottom)) /
            scope.object.zoom /
            element.clientHeight,
          scope.object.matrix
        );
      } else {
        console.warn(
          "WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."
        );
        scope.enablePan = false;
      }
    };
  })();

  function dollyIn(dollyScale) {
    if (scope.object.isPerspectiveCamera) {
      scale /= dollyScale;
    } else if (scope.object.isOrthographicCamera) {
      scope.object.zoom = Math.max(
        scope.minZoom,
        Math.min(scope.maxZoom, scope.object.zoom * dollyScale)
      );
      scope.object.updateProjectionMatrix();
  scope.object.updateProjectionMatrix();
      zoomChanged = true;
    } else {
      console.warn(
        "WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."
      );
      scope.enableZoom = false;
    }
  }

  function dollyOut(dollyScale) {
    if (scope.object.isPerspectiveCamera) {
      scale *= dollyScale;
    } else if (scope.object.isOrthographicCamera) {
      scope.object.zoom = Math.max(
        scope.minZoom,
        Math.min(scope.maxZoom, scope.object.zoom / dollyScale)
      );
      scope.object.updateProjectionMatrix();
      zoomChanged = true;
    } else {
      console.warn(
        "WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."
      );
      scope.enableZoom = false;
    }
  }

  // Event handlers
  function handleMouseDownRotate(event) {
    rotateStart.set(event.clientX, event.clientY);
  }

  function handleMouseDownDolly(event) {
    dollyStart.set(event.clientX, event.clientY);
  }

  function handleMouseDownPan(event) {
    panStart.set(event.clientX, event.clientY);
  }

  function handleMouseMoveRotate(event) {
    rotateEnd.set(event.clientX, event.clientY);
    rotateDelta
      .subVectors(rotateEnd, rotateStart)
      .multiplyScalar(scope.rotateSpeed);
    const element =
      scope.domElement === document ? scope.domElement.body : scope.domElement;
    rotateLeft((2 * Math.PI * rotateDelta.x) / element.clientHeight);
    rotateUp((2 * Math.PI * rotateDelta.y) / element.clientHeight);
    rotateStart.copy(rotateEnd);
    scope.update();
  }

  function handleMouseMoveDolly(event) {
    dollyEnd.set(event.clientX, event.clientY);
    dollyDelta.subVectors(dollyEnd, dollyStart);
    if (dollyDelta.y > 0) {
      dollyIn(getZoomScale());
    } else if (dollyDelta.y < 0) {
      dollyOut(getZoomScale());
    }
    dollyStart.copy(dollyEnd);
    scope.update();
  }

  function handleMouseMovePan(event) {
    panEnd.set(event.clientX, event.clientY);
    panDelta.subVectors(panEnd, panStart).multiplyScalar(scope.panSpeed);
    pan(panDelta.x, panDelta.y);
    panStart.copy(panEnd);
    scope.update();
  }

  function handleMouseUp(event) {
    if (scope.enableMomentum) {
      momentumVelocity.copy(rotateDelta).multiplyScalar(scope.momentumScalingFactor);
    }
  }

  function handleMouseWheel(event) {
    if (
      scope.enabled === false ||
      scope.enableZoom === false ||
      (state !== STATE.NONE && state !== STATE.ROTATE)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    scope.dispatchEvent(startEvent);
    let delta = 0;
    if (event.deltaY !== undefined) {
      delta = event.deltaY;
    } else if (event.wheelDelta !== undefined) {
      delta = -event.wheelDelta;
    }
    if (delta < 0) {
      dollyOut(getZoomScale());
    } else if (delta > 0) {
      dollyIn(getZoomScale());
    }
    scope.update();
    scope.dispatchEvent(endEvent);
  }

  function handleKeyDown(event) {
    if (
      scope.enabled === false ||
      scope.enableKeys === false ||
      scope.enablePan === false
    )
      return;

    switch (event.keyCode) {
      case scope.keys.UP:
        if (event.ctrlKey) {
          rotateUp(-scope.keyRotateAngle);
        } else if (event.shiftKey) {
          dollyOut(getZoomScale());
        } else {
          pan(0, scope.keyPanSpeed);
        }
        break;
      case scope.keys.BOTTOM:
        if (event.ctrlKey) {
          rotateUp(scope.keyRotateAngle);
        } else if (event.shiftKey) {
          dollyIn(getZoomScale());
        } else {
          pan(0, -scope.keyPanSpeed);
        }
        break;
      case scope.keys.LEFT:
        if (event.ctrlKey) {
          rotateLeft(-scope.keyRotateAngle);
        } else {
          pan(scope.keyPanSpeed, 0);
        }
        break;
      case scope.keys.RIGHT:
        if (event.ctrlKey) {
          rotateLeft(scope.keyRotateAngle);
        } else {
          pan(-scope.keyPanSpeed, 0);
        }
        break;
    }
    scope.update();
  }

  function handleTouchStartRotate(event) {
    if (event.touches.length === 1) {
      rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
    }
  }

  function handleTouchStartDollyPan(event) {
    if (scope.enableZoom) {
      const dx = event.touches[0].pageX - event.touches[1].pageX;
      const dy = event.touches[0].pageY - event.touches[1].pageY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      dollyStart.set(0, distance);
    }
    if (scope.enablePan) {
      const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
      const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
      panStart.set(x, y);
    }
  }

  function handleTouchMoveRotate(event) {
    if (event.touches.length === 1) {
      rotateEnd.set(event.touches[0].pageX, event.touches[0].pageY);
      rotateDelta
        .subVectors(rotateEnd, rotateStart)
        .multiplyScalar(scope.rotateSpeed);
      const element =
        scope.domElement === document ? scope.domElement.body : scope.domElement;
      rotateLeft((2 * Math.PI * rotateDelta.x) / element.clientHeight);
      rotateUp((2 * Math.PI * rotateDelta.y) / element.clientHeight);
      rotateStart.copy(rotateEnd);
      scope.update();
    }
  }

  function handleTouchMoveDollyPan(event) {
    if (scope.enableZoom) {
      const dx = event.touches[0].pageX - event.touches[1].pageX;
      const dy = event.touches[0].pageY - event.touches[1].pageY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      dollyEnd.set(0, distance);
      dollyDelta.set(0, Math.pow(dollyEnd.y / dollyStart.y, scope.zoomSpeed));
      dollyIn(dollyDelta.y);
      dollyStart.copy(dollyEnd);
    }
    if (scope.enablePan) {
      const x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
      const y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
      panEnd.set(x, y);
      panDelta.subVectors(panEnd, panStart).multiplyScalar(scope.panSpeed);
      pan(panDelta.x, panDelta.y);
      panStart.copy(panEnd);
    }
    scope.update();
  }

  function handleTouchEnd(event) {
    if (scope.enableMomentum && rotateDelta.lengthSq() > EPS) {
      momentumVelocity
        .copy(rotateDelta)
        .multiplyScalar(scope.momentumScalingFactor);
    }
  }

  function onMouseDown(event) {
    if (scope.enabled === false) return;
    event.preventDefault();

    switch (event.button) {
      case scope.mouseButtons.LEFT:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (scope.enablePan === false) return;
          scope.screenSpacePanning = event.shiftKey;
          handleMouseDownPan(event);
          state = STATE.PAN;
        } else {
          if (scope.enableRotate === false) return;
          handleMouseDownRotate(event);
          state = STATE.ROTATE;
        }
        break;
      case scope.mouseButtons.MIDDLE:
        if (scope.enableZoom === false) return;
        handleMouseDownDolly(event);
        state = STATE.DOLLY;
        break;
      case scope.mouseButtons.RIGHT:
        if (scope.enablePan === false) return;
        scope.screenSpacePanning = event.shiftKey;
        handleMouseDownPan(event);
        state = STATE.PAN;
        break;
    }

    if (state !== STATE.NONE) {
      document.addEventListener("mousemove", onMouseMove, false);
      document.addEventListener("mouseup", onMouseUp, false);
      scope.dispatchEvent(startEvent);
    }
  }

  function onMouseMove(event) {
    if (scope.enabled === false) return;
    event.preventDefault();

    switch (state) {
      case STATE.ROTATE:
        if (scope.enableRotate === false) return;
        handleMouseMoveRotate(event);
        break;
      case STATE.DOLLY:
        if (scope.enableZoom === false) return;
        handleMouseMoveDolly(event);
        break;
      case STATE.PAN:
        if (scope.enablePan === false) return;
        handleMouseMovePan(event);
        break;
    }
  }

  function onMouseUp(event) {
    if (scope.enabled === false) return;
    handleMouseUp(event);
    document.removeEventListener("mousemove", onMouseMove, false);
    document.removeEventListener("mouseup", onMouseUp, false);
    scope.dispatchEvent(endEvent);
    state = STATE.NONE;
  }

  function onMouseWheel(event) {
    handleMouseWheel(event);
  }

  function onKeyDown(event) {
    handleKeyDown(event);
  }

  function onTouchStart(event) {
    if (scope.enabled === false) return;

    switch (event.touches.length) {
      case 1:
        if (scope.enableRotate === false) return;
        handleTouchStartRotate(event);
        state = STATE.TOUCH_ROTATE;
        break;
      case 2:
        if (scope.enableZoom === false && scope.enablePan === false) return;
        handleTouchStartDollyPan(event);
        state = STATE.TOUCH_DOLLY_PAN;
        break;
      case 3: // New: Three-finger rotate
        if (scope.enableRotate === false) return;
        handleTouchStartRotate(event);
        state = STATE.TOUCH_ROTATE;
        break;
      default:
        state = STATE.NONE;
    }

    if (state !== STATE.NONE) {
      scope.dispatchEvent(startEvent);
    }
  }

  function onTouchMove(event) {
    if (scope.enabled === false) return;
    event.preventDefault();
    event.stopPropagation();

    switch (state) {
      case STATE.TOUCH_ROTATE:
        if (scope.enableRotate === false) return;
        handleTouchMoveRotate(event);
        break;
      case STATE.TOUCH_DOLLY_PAN:
        if (scope.enableZoom === false && scope.enablePan === false) return;
        handleTouchMoveDollyPan(event);
        break;
    }
  }

  function onTouchEnd(event) {
    if (scope.enabled === false) return;
    handleTouchEnd(event);
    scope.dispatchEvent(endEvent);
    state = STATE.NONE;
  }

  function onContextMenu(event) {
    if (scope.enabled === false) return;
    event.preventDefault();
  }

  // Event listeners
  scope.domElement.addEventListener("contextmenu", onContextMenu, false);
  scope.domElement.addEventListener("mousedown", onMouseDown, false);
  scope.domElement.addEventListener("wheel", onMouseWheel, false);
  scope.domElement.addEventListener("mousewheel", onMouseWheel, false);
  scope.domElement.addEventListener("touchstart", onTouchStart, false);
  scope.domElement.addEventListener("touchend", onTouchEnd, false);
  scope.domElement.addEventListener("touchmove", onTouchMove, false);
  window.addEventListener("keydown", onKeyDown, false);

  // Initial update
  this.update();
};

THREE.OrbitControls.prototype = Object.create(THREE.EventDispatcher.prototype);
THREE.OrbitControls.prototype.constructor = THREE.OrbitControls;

// Backward compatibility
Object.defineProperties(THREE.OrbitControls.prototype, {
  center: {
    get: function () {
      console.warn("THREE.OrbitControls: .center has been renamed to .target");
      return this.target;
    },
  },
  noZoom: {
    get: function () {
      console.warn(
        "THREE.OrbitControls: .noZoom has been deprecated. Use .enableZoom instead."
      );
      return !this.enableZoom;
    },
    set: function (value) {
      console.warn(
        "THREE.OrbitControls: .noZoom has been deprecated. Use .enableZoom instead."
      );
      this.enableZoom = !value;
    },
  },
  noRotate: {
    get: function () {
      console.warn(
        "THREE.OrbitControls: .noRotate has been deprecated. Use .enableRotate instead."
      );
      return !this.enableRotate;
    },
    set: function (value) {
      console.warn(
        "THREE.OrbitControls: .noRotate has been deprecated. Use .enableRotate instead."
      );
      this.enableRotate = !value;
    },
  },
  noPan: {
    get: function () {
      console.warn(
        "THREE.OrbitControls: .noPan has been deprecated. Use .enablePan instead."
      );
      return !this.enablePan;
    },
    set: function (value) {
      console.warn(
        "THREE.OrbitControls: .noPan has been deprecated. Use .enablePan instead."
      );
      this.enablePan = !value;
    },
  },
  noKeys: {
    get: function () {
      console.warn(
        "THREE.OrbitControls: .noKeys has been deprecated. Use .enableKeys instead."
      );
      return !this.enableKeys;
    },
    set: function (value) {
      console.warn(
        "THREE.OrbitControls: .noKeys has been deprecated. Use .enableKeys instead."
      );
      this.enableKeys = !value;
    },
  },
  staticMoving: {
    get: function () {
      console.warn(
        "THREE.OrbitControls: .staticMoving has been deprecated. Use .enableDamping instead."
      );
      return !this.enableDamping;
    },
    set: function (value) {
      console.warn(
        "THREE.OrbitControls: .staticMoving has been deprecated. Use .enableDamping instead."
      );
      this.enableDamping = !value;
    },
  },
  dynamicDampingFactor: {
    get: function () {
      console.warn(
        "THREE.OrbitControls: .dynamicDampingFactor has been renamed. Use .dampingFactor instead."
      );
      return this.dampingFactor;
    },
    set: function (value) {
      console.warn(
        "THREE.OrbitControls: .dynamicDampingFactor has been renamed. Use .dampingFactor instead."
      );
      this.dampingFactor = value;
    },
  },
});