/* -------------------------
 * Define Custom Icons
 * ------------------------- */
const startIcon = L.divIcon({
  html: '<i class="fas fa-flag" style="color: green; font-size: 24px; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);"></i>',
  iconSize: [24, 24], className: '', iconAnchor: [12, 24], popupAnchor: [0, -24]
});
const endIcon = L.divIcon({
  html: '<i class="fas fa-flag-checkered" style="color: red; font-size: 24px; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);"></i>',
  iconSize: [24, 24], className: '', iconAnchor: [12, 24], popupAnchor: [0, -24]
});
// Default Leaflet blue marker used for intermediate waypoints

/* -------------------------
 * Polyline Extension
 * ------------------------- */
L.Polyline.include({
  getDistance: function() {
    return this.getLatLngs().reduce((acc, pt, i, arr) =>
      i > 0 ? acc + arr[i-1].distanceTo(pt) : acc, 0);
  },
  getPointAtDistance: function(target) {
    let dist = 0;
    const pts = this.getLatLngs();
    if (!pts || pts.length === 0) return null;
    if (target <= 0) return pts[0];
    const totalDist = this.getDistance();
    if (target >= totalDist) return pts[pts.length - 1];

    for (let i = 1; i < pts.length; i++) {
      const segment = pts[i-1].distanceTo(pts[i]);
      if (segment > 1e-9 && dist + segment >= target) { // Avoid division by zero/tiny segments
        const frac = (target - dist) / segment;
        return L.latLng(
          pts[i-1].lat + frac * (pts[i].lat - pts[i-1].lat),
          pts[i-1].lng + frac * (pts[i].lng - pts[i-1].lng)
        );
      }
      dist += segment;
    }
    return pts[pts.length - 1]; // Fallback
  }
});

/* -------------------------
 * Route Generation Functions
 * ------------------------- */
async function processInput(triggeringButtonId) {
  document.querySelectorAll('.autocomplete-items').forEach(el => el.remove()); // Clear autocomplete
  showLoading(triggeringButtonId, triggeringButtonId === 'loadGpxButton' ? "Loading GPX..." : "Generating...");

  try {
    const file = document.getElementById('gpxFile').files[0];
    const start = document.getElementById('startLocation').value.trim();
    const end = document.getElementById('endLocation').value.trim();

    clearRouteData(); // Clear previous route, markers, stats
    document.getElementById('statsContent').innerHTML = '<span class="loading-text">Processing...</span>';

    if (file) { // --- GPX File Processing ---
      const points = await parseGPX(file);
      if (!points || points.length < 2) throw new Error("GPX file contains insufficient points.");
      trackLayer = L.polyline(points, { className: 'route-line' }).addTo(map);
      map.fitBounds(trackLayer.getBounds(), { padding: [30, 30] });
      // Add non-interactive start/end markers for GPX
      L.marker(points[0], { icon: startIcon, interactive: false }).addTo(map);
      L.marker(points[points.length - 1], { icon: endIcon, interactive: false }).addTo(map);
      waypoints = []; // Clear waypoints array as GPX routes aren't editable this way
      await analyzeRoute(points);
    } else if (start && end) { // --- Address Input Processing ---
      // Geocode start and end locations
      const startCoords = await geocodeLocation(start);
      const endCoords = await geocodeLocation(end);

      // Add draggable start marker
      const startMarker = L.marker(startCoords, { draggable: true, icon: startIcon }).addTo(map);
      startMarker.options.isFixed = true; // Mark as fixed start
      startMarker.on('dragend', () => { waypoints[0] = startMarker; recalcRoute(); });
      waypoints.push(startMarker); // Add to the beginning of waypoints array

      // Add draggable end marker
      const endMarker = L.marker(endCoords, { draggable: true, icon: endIcon }).addTo(map);
      endMarker.options.isFixed = true; // Mark as fixed end
      endMarker.on('dragend', () => { waypoints[waypoints.length - 1] = endMarker; recalcRoute(); });
      waypoints.push(endMarker); // Add to the end of waypoints array

      map.fitBounds(L.latLngBounds([startCoords, endCoords]), { padding: [30, 30] });
      await recalcRoute(); // Calculate the initial route
    } else {
      // Handle cases where neither file nor addresses are provided
      if (triggeringButtonId === 'loadGpxButton' && !file) {
         throw new Error('No GPX file selected to load.');
      } else if (triggeringButtonId === 'generateRouteButton' && (!start || !end)) {
         throw new Error('Please provide both start and end addresses.');
      } else {
         // Generic error if triggered unexpectedly
         throw new Error('Please provide a GPX file OR both start and end addresses.');
      }
    }
    // Hide menu on mobile after successful generation/load (if setting enabled)
    if (window.innerWidth <= 600 && typeof shouldAutoHideMenu === 'function' && shouldAutoHideMenu()) { 
      hideMenu(); 
    }
  } catch (error) {
    showError(error.message);
    document.getElementById('statsContent').innerHTML = 'Route generation failed.';
  } finally {
    hideLoading();
    // Reset file input specifically if GPX loading was attempted but failed before parsing
     if (triggeringButtonId === 'loadGpxButton' && !trackLayer && document.getElementById('gpxFile').files.length > 0) {
        document.getElementById('gpxFile').value = ""; // Clear the selection
        document.getElementById('fileName').textContent = "No file selected";
     }
  }
}

async function parseGPX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const gpx = new DOMParser().parseFromString(e.target.result, "text/xml");
        let latlngs = [];
        // Prefer <trkpt> elements
        const trkpts = Array.from(gpx.getElementsByTagName('trkpt'));
        if (trkpts.length > 0) {
           latlngs = trkpts.map(pt => L.latLng(parseFloat(pt.getAttribute('lat')), parseFloat(pt.getAttribute('lon'))));
        } else { // Fallback to <rtept>
           const rtepts = Array.from(gpx.getElementsByTagName('rtept'));
           if (rtepts.length > 0) {
               latlngs = rtepts.map(pt => L.latLng(parseFloat(pt.getAttribute('lat')), parseFloat(pt.getAttribute('lon'))));
           }
        }
        // Filter out any invalid points (NaN latitude or longitude)
        const validLatLngs = latlngs.filter(ll => ll && !isNaN(ll.lat) && !isNaN(ll.lng));
        if (validLatLngs.length < 2) reject(new Error('GPX file needs at least two valid track/route points.'));
        resolve(validLatLngs);
      } catch (error) { reject(new Error(`Invalid or unreadable GPX file format: ${error.message}`)); }
    };
    reader.onerror = () => reject(new Error('Failed to read the GPX file.'));
    reader.readAsText(file);
  });
}

async function recalcRoute() {
  if (waypoints.length < 2) return; // Need at least start and end

  // No separate loading state needed here as it's called by user interaction (drag)
  // or internally by processInput/addStopMarker which handle loading states.
  document.getElementById('statsContent').innerHTML = '<span class="loading-text">Recalculating...</span>';
  document.getElementById('errorDisplay').innerHTML = ''; // Clear previous errors

  // Clear existing route and weather layers
  if (trackLayer) map.removeLayer(trackLayer);
  windLayerGroup.clearLayers(); tempLayerGroup.clearLayers(); precipLayerGroup.clearLayers();

  const coordsArray = waypoints.map(m => m.getLatLng());

  try {
    const points = await calculateCyclingRoute(coordsArray);
    trackLayer = L.polyline(points, { className: 'route-line' }).addTo(map);
    await analyzeRoute(points);
    // displayRecommendedHeading(); // Keep this if you implement the heading feature
  } catch (e) {
    showError(`Route recalculation failed: ${e.message}`);
    document.getElementById('statsContent').innerHTML = 'Route recalculation failed.';
    // Optional: Restore previous trackLayer if recalculation fails? Could be complex.
  }
  // No hideLoading() here, handled by parent calls or lack of initial showLoading()
}

async function calculateCyclingRoute(coordsArray) {
    const params = new URLSearchParams({
        vehicle: 'bike',
        elevation: 'true',
        points_encoded: 'false',
        key: CONFIG.API_KEYS.GRAPHHOPPER // Use config
    });
    let url = `${CONFIG.API_URLS.GRAPHHOPPER}?`; // Use config
    coordsArray.forEach(coord => {
        url += `point=${coord.lat},${coord.lng}&`;
    });
    url += params.toString();

    const response = await fetch(url);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP ${response.status} ${response.statusText}` }));
        console.error("GraphHopper Error:", errorData);
        // Provide a more specific error message if available
        throw new Error(`Routing API Error: ${errorData.message || 'Unknown error fetching route'}`);
    }
    const data = await response.json();
    if (!data.paths || data.paths.length === 0 || !data.paths[0].points || data.paths[0].points.coordinates.length === 0) {
        throw new Error("Routing API Error: No route found or invalid response structure.");
    }
    // Map the coordinates [lng, lat] from GraphHopper to Leaflet's L.latLng(lat, lng)
    return data.paths[0].points.coordinates.map(c => L.latLng(c[1], c[0]));
}

async function geocodeLocation(query) {
    const url = `${CONFIG.API_URLS.NOMINATIM_SEARCH}?format=json&limit=1&q=${encodeURIComponent(query)}&accept-language=en`; // Use config
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Geocoding failed for "${query}" (Network error: ${response.status})`);
    }
    const data = await response.json();
    if (!data || data.length === 0 || !data[0].lat || !data[0].lon) {
        throw new Error(`Location not found or invalid coordinates for: "${query}"`);
    }
    // Parse coordinates, ensuring they are numbers
    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (isNaN(lat) || isNaN(lon)) {
         throw new Error(`Invalid coordinates received for: "${query}"`);
    }
    return L.latLng(lat, lon);
}

/* -------------------------
 * Waypoint Management
 * ------------------------- */
function handleMapContextMenu(e) {
   e.originalEvent.preventDefault(); // Prevent default browser context menu
   let foundMarkerToRemove = null;
   const clickPt = map.latLngToContainerPoint(e.latlng); // Convert click location to pixel coordinates

   // Check if click is near an existing *intermediate* waypoint
   map.eachLayer(layer => {
     // Check if it's a marker and marked as an 'extra' (intermediate) waypoint
     if (layer instanceof L.Marker && layer.options.isExtra) {
       const markerPt = map.latLngToContainerPoint(layer.getLatLng());
       // Check distance between click point and marker point (adjust threshold as needed)
       if (markerPt.distanceTo(clickPt) < 20) { // 20 pixels tolerance
         foundMarkerToRemove = layer;
       }
     }
   });

   if (foundMarkerToRemove) {
     removeWaypoint(foundMarkerToRemove); // Remove the clicked intermediate waypoint
   } else if (waypoints.length >= 2) {
     // Only add a new waypoint if start and end points already exist
     addStopMarker(e.latlng); // Add a new intermediate waypoint at the click location
   } else {
     console.log("Add start/end points using the input fields before adding intermediate waypoints via map click.");
     showError("Please generate a route first before adding waypoints."); // User feedback
   }
}

function setupLongPressHandler() {
   let touchTimer;
   const longPressDuration = 800; // milliseconds for long press

   const mapContainer = map.getContainer();

   mapContainer.addEventListener('touchstart', e => {
       // Only trigger for single touch
       if (e.touches.length === 1) {
           const touch = e.touches[0];
           // Clear any existing timer
           if (touchTimer) clearTimeout(touchTimer);

           touchTimer = setTimeout(() => {
               touchTimer = null; // Clear timer flag
               // Convert touch coordinates to LatLng
               const point = map.containerPointToLatLng([touch.clientX, touch.clientY]);

               let foundMarkerToRemove = null;
               const pressPt = map.latLngToContainerPoint(point); // Convert press location to pixel coordinates

               // Check proximity to existing intermediate waypoints
               map.eachLayer(layer => {
                   if (layer instanceof L.Marker && layer.options.isExtra) {
                       const markerPt = map.latLngToContainerPoint(layer.getLatLng());
                       if (markerPt.distanceTo(pressPt) < 25) { // Slightly larger tolerance for touch
                           foundMarkerToRemove = layer;
                       }
                   }
               });

               if (foundMarkerToRemove) {
                   removeWaypoint(foundMarkerToRemove);
               } else if (waypoints.length >= 2) {
                   addStopMarker(point);
               } else {
                   console.log("Long press ignored: Add start/end points first.");
                   showError("Please generate a route first before adding waypoints.");
               }
               // Prevent default context menu or other actions after long press is handled
               e.preventDefault();

           }, longPressDuration);
       }
   }, { passive: false }); // Need passive: false to call preventDefault

   mapContainer.addEventListener('touchend', e => {
       // Clear timer if touch ends before long press duration
       if (touchTimer) clearTimeout(touchTimer);
       touchTimer = null;
       // Invalidate size after a short delay to ensure map redraws correctly after potential UI shifts
       // setTimeout(() => { map.invalidateSize(); }, 300);
   });

   mapContainer.addEventListener('touchmove', e => {
       // Clear timer if finger moves significantly during touch
       if (touchTimer) clearTimeout(touchTimer);
       touchTimer = null;
   });
}

function addStopMarker(latlng) {
  if (waypoints.length < 2) {
    showError("Define start and end points first before adding stops.");
    return;
  }
  // Create a standard blue draggable marker
  const marker = L.marker(latlng, { draggable: true }).addTo(map);
  marker.options.isExtra = true; // Mark as intermediate waypoint

  // Recalculate route on drag end
  marker.on('dragend', () => recalcRoute());

  // Add context menu (right-click or long-press handled globally) to remove
  marker.on('contextmenu', e => {
      e.originalEvent.preventDefault(); // Prevent browser menu
      removeWaypoint(marker);
  });

  // Insert the new waypoint *before* the end marker in the array
  waypoints.splice(waypoints.length - 1, 0, marker);

  recalcRoute(); // Update the route with the new waypoint
}

function removeWaypoint(markerToRemove) {
   // Remove the marker from the map
   map.removeLayer(markerToRemove);
   // Filter the marker out of the waypoints array
   waypoints = waypoints.filter(m => m !== markerToRemove);
   // Recalculate the route
   recalcRoute();
}

/* -------------------------
 * Clear Map Function
 * ------------------------- */
function clearMap(triggeringButtonId) {
   showLoading(triggeringButtonId, "Clearing...");
   try {
      clearRouteData();
      document.getElementById('startLocation').value = '';
      document.getElementById('endLocation').value = '';
      document.getElementById('randomLocation').value = '';
      document.getElementById('gpxFile').value = "";
      document.getElementById('fileName').textContent = "No file selected";
      
      // Clear activity analysis inputs
      document.getElementById('activityGpxFile').value = "";
      document.getElementById('activityFileName').textContent = "No file selected";
      document.getElementById('analyzeActivityButton').disabled = true;
      
      // Use config for defaults
      document.getElementById('avgSpeed').value = CONFIG.DEFAULTS.AVG_SPEED;
      document.getElementById('datapointsCount').value = CONFIG.DEFAULTS.WEATHER_POINTS;
      document.getElementById('routeLengthSlider').value = CONFIG.DEFAULTS.RANDOM_ROUTE_LENGTH;
      document.getElementById('routeLengthValue').textContent = `${CONFIG.DEFAULTS.RANDOM_ROUTE_LENGTH} km`;
      document.getElementById('startTime').value = new Date().toISOString().slice(0, 16);
      document.querySelectorAll('.autocomplete-items').forEach(el => el.remove());
      document.getElementById('statsContent').innerHTML = 'No route loaded. Use the options above or load a GPX file.';
      document.getElementById('errorDisplay').innerHTML = '';
      console.log("Map cleared.");
   } catch(e) {
      showError("Error clearing map: " + e.message);
   } finally {
      hideLoading();
   }
}

// Helper to clear only route-related data from the map and stats
function clearRouteData() {
   // Remove route line
   if (trackLayer) {
       map.removeLayer(trackLayer);
       trackLayer = null;
   }
   
   // Clear weather layers (used by both planning and analysis)
   windLayerGroup.clearLayers();
   tempLayerGroup.clearLayers();
   precipLayerGroup.clearLayers();
   
   // Remove weather layers from map if they're currently displayed
   if (map.hasLayer(windLayerGroup)) map.removeLayer(windLayerGroup);
   if (map.hasLayer(tempLayerGroup)) map.removeLayer(tempLayerGroup);
   if (map.hasLayer(precipLayerGroup)) map.removeLayer(precipLayerGroup);
   
   // Clear historical weather markers (for activity analysis)
   if (typeof historicalWeatherMarkers !== 'undefined') {
     historicalWeatherMarkers.clearLayers();
     if (map.hasLayer(historicalWeatherMarkers)) map.removeLayer(historicalWeatherMarkers);
   }

   // Clear activity special markers (for activity analysis)
   if (typeof activitySpecialMarkers !== 'undefined') {
     activitySpecialMarkers.clearLayers();
     if (map.hasLayer(activitySpecialMarkers)) map.removeLayer(activitySpecialMarkers);
   }

   // Remove waypoint markers (start, end, intermediate)
   waypoints.forEach(marker => map.removeLayer(marker));
   waypoints = []; // Reset the waypoints array

   // Remove other temporary markers (like weather errors or GPX start/end)
   map.eachLayer(layer => {
       if (layer instanceof L.Marker) {
           // Remove markers that are not part of the core map controls/layers
           // This targets GPX start/end icons and weather error icons specifically
           // Avoid removing markers that might be added by other plugins if integrated later
           const iconHTML = layer._icon ? layer._icon.innerHTML : '';
            if (!layer.options.isFixed && !layer.options.isExtra && // Not draggable waypoints
               (iconHTML.includes('fa-flag') || iconHTML.includes('fa-exclamation-triangle') || iconHTML.includes('fa-question-circle')))
            {
               map.removeLayer(layer);
           }
       }
   });

   // Clear activity data (for activity analysis)
   if (typeof activityData !== 'undefined') {
     activityData = null;
   }
   if (typeof elevationProfile !== 'undefined') {
     elevationProfile = [];
   }

   // Clear elevation profile display
   const elevationProfileContainer = document.getElementById('elevationProfile');
   if (elevationProfileContainer) {
     elevationProfileContainer.style.display = 'none';
     elevationProfileContainer.innerHTML = '';
   }

   // Reset weather layer state
   currentWeatherLayer = 'wind';
   updateWeatherToggleIcon();

   // Clear stats and error display areas
   document.getElementById('statsContent').innerHTML = '';
   document.getElementById('errorDisplay').innerHTML = '';
}

/* -------------------------
 * Save Map Function
 * ------------------------- */
function saveRouteAsGPX() {
  // Check if there is a valid route layer to save
  if (!trackLayer || typeof trackLayer.getLatLngs !== 'function' || trackLayer.getLatLngs().length < 2) {
    showError("No valid route available to save!");
    return;
  }

  const latlngs = trackLayer.getLatLngs();
  // Start building the GPX XML string
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cycling Route Planner - Gemini" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
<metadata>
<name>Cycling Route - ${new Date().toISOString().slice(0,10)}</name>
<desc>Route generated or loaded on ${new Date().toLocaleString()}</desc>
<time>${new Date().toISOString()}</time>
</metadata>
<trk>
<name>Route ${new Date().toISOString().slice(0,16).replace('T',' ')}</name>
<trkseg>
`;
  // Add each point as a <trkpt>
  latlngs.forEach(pt => {
    gpx += `   <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}"></trkpt>\n`;
  });

  // Close the GPX tags
  gpx += `  </trkseg>
</trk>
</gpx>
`;
  // Create a Blob and download link
  const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  // Generate a filename
  const filename = `cycling_route_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.gpx`;
  a.download = filename;
  document.body.appendChild(a);
  a.click(); // Trigger download

  // Clean up
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);

  // Optional: Brief feedback on the button
  const saveBtn = document.getElementById('saveGpxButton');
  if(saveBtn && activeButtons['saveGpxButton']) { // Check if original content exists
     const originalHTML = activeButtons['saveGpxButton'];
     saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
     saveBtn.disabled = true;
     setTimeout(() => {
        // Check if button still exists before restoring
        const currentSaveBtn = document.getElementById('saveGpxButton');
        if (currentSaveBtn) {
            currentSaveBtn.innerHTML = originalHTML;
            currentSaveBtn.disabled = false;
        }
     }, 1500);
  }
}

/* -------------------------
 * Weather Layer Toggle
 * ------------------------- */
function toggleWeatherLayer() {
   // Remove all weather layers first
   map.removeLayer(windLayerGroup);
   map.removeLayer(tempLayerGroup);
   map.removeLayer(precipLayerGroup);

   // Cycle through layers: Wind -> Temp -> Precip -> Wind ...
   if (currentWeatherLayer === 'wind') {
       map.addLayer(tempLayerGroup);
       currentWeatherLayer = 'temp';
   } else if (currentWeatherLayer === 'temp') {
       map.addLayer(precipLayerGroup);
       currentWeatherLayer = 'precip';
   } else { // Was 'precip' or default
       map.addLayer(windLayerGroup);
       currentWeatherLayer = 'wind';
   }
   updateWeatherToggleIcon(); // Update the button appearance
}

function updateWeatherToggleIcon() {
   const iconElement = document.querySelector('#weatherToggle i');
   if (!iconElement) return; // Exit if icon element not found
   const toggleButton = document.getElementById('weatherToggle');

   switch (currentWeatherLayer) {
       case 'wind':
           iconElement.className = 'fas fa-wind'; // Update icon class
           toggleButton.title = 'Showing Wind (Click to toggle Temp)'; // Update tooltip
           break;
       case 'temp':
           iconElement.className = 'fas fa-thermometer-half';
           toggleButton.title = 'Showing Temp (Click to toggle Precip)';
           break;
       case 'precip':
           iconElement.className = 'fas fa-cloud-showers-heavy';
           toggleButton.title = 'Showing Precip (Click to toggle Wind)';
           break;
       default: // Should not happen, but set a default
           iconElement.className = 'fas fa-layer-group';
           toggleButton.title = 'Toggle Weather Layer';
   }
} 