function degreesToCompass(degrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  // Ensure degrees are within 0-360 range
  const normalizedDegrees = ((degrees % 360) + 360) % 360;
  // Calculate the index (add half-segment width 11.25 for correct rounding)
  const index = Math.round((normalizedDegrees + 11.25) / 22.5) % 16;
  return directions[index];
}

async function analyzeRoute(points) {
  document.getElementById('statsContent').innerHTML = '<span class="loading-text">Analyzing route, fetching weather...</span>';
  let weatherErrorCount = 0;

  try {
    const startTimeInput = document.getElementById('startTime').value;
    const startTime = new Date(startTimeInput);
    if (isNaN(startTime.getTime())) throw new Error("Invalid departure date/time selected.");

    const avgSpeedInput = document.getElementById('avgSpeed').value;
    const avgSpeed = parseInt(avgSpeedInput) || CONFIG.DEFAULTS.AVG_SPEED;
    if (avgSpeed <= 0) throw new Error("Invalid average speed selected.");

    if (!trackLayer || typeof trackLayer.getDistance !== 'function') {
        const tempPolyline = L.polyline(points);
        if (typeof tempPolyline.getDistance !== 'function') {
             throw new Error("Route data invalid for analysis (cannot calculate distance).");
        }
        trackLayer = tempPolyline; 
    }

    const totalDistance = trackLayer.getDistance();
    const totalDistanceKm = totalDistance / 1000;
    const estimatedDurationMs = (totalDistanceKm > 0 && avgSpeed > 0) ? (totalDistanceKm / avgSpeed) * 3600 * 1000 : 0;
    const estimatedEndTime = new Date(startTime.getTime() + estimatedDurationMs);

    // Calculate elevation metrics for the dashboard
    const elevationMetrics = calculatePlanningElevationMetrics(points);

    // Create planning dashboard with similar style to activity analysis
    createPlanningStatsDashboard({
      totalDistance: totalDistanceKm,
      estimatedDuration: estimatedDurationMs,
      estimatedEndTime: estimatedEndTime,
      startTime: startTime,
      avgSpeed: avgSpeed,
      ...elevationMetrics
    });
    
    // Add stats animation
    if (typeof animateStatsUpdate === 'function') {
      animateStatsUpdate();
    }

    // Create elevation profile for planned routes
    createElevationProfile(points, false);
    
    // Also create interactive elevation chart for planning if elevation data is available
    await createPlanningElevationChart(points);

    const numPointsInput = document.getElementById('datapointsCount').value;
    const numPoints = parseInt(numPointsInput) || CONFIG.DEFAULTS.WEATHER_POINTS;
    const distancesToMark = [];

    if (numPoints >= 1 && totalDistance > 0) {
        distancesToMark.push(0);
        if (numPoints >= 2) {
            for (let i = 1; i < numPoints - 1; i++) {
                distancesToMark.push((totalDistance * i) / (numPoints - 1));
            }
            distancesToMark.push(totalDistance);
        } else {
            distancesToMark.push(totalDistance / 2);
        }
    }

    windLayerGroup.clearLayers(); tempLayerGroup.clearLayers(); precipLayerGroup.clearLayers();

    const weatherPromises = distancesToMark.map(async (dist, index) => {
      const point = trackLayer.getPointAtDistance(dist);
      if (!point) return;

      const km = dist / 1000;
      const estTimeEpoch = startTime.getTime() + ((km / avgSpeed) * 3600000);
      const estTime = new Date(estTimeEpoch);

      try {
        await new Promise(resolve => setTimeout(resolve, index * CONFIG.DEFAULTS.API_STAGGER_MS));

        const forecastResponse = await fetch(`${CONFIG.API_URLS.OPENWEATHER_FORECAST}?lat=${point.lat}&lon=${point.lng}&units=metric&appid=${CONFIG.API_KEYS.OPENWEATHER}`);
        if (!forecastResponse.ok) {
          const error = await forecastResponse.json().catch(() => ({ message: `HTTP ${forecastResponse.status}` }));
          throw new Error(`Forecast API: ${error.message || 'Unknown error'}`);
        }
        const forecastData = await forecastResponse.json();
        const estTimestamp = Math.floor(estTimeEpoch / 1000);
        let closestForecast = forecastData.list.reduce((prev, curr) => (Math.abs(curr.dt - estTimestamp) < Math.abs(prev.dt - estTimestamp) ? curr : prev));

        if (!closestForecast || Math.abs(closestForecast.dt - estTimestamp) > 3 * 3600 + 1800 ) {
          console.warn(`No suitable forecast found for ${km.toFixed(0)} km mark.`);
           L.marker(point, { icon: L.divIcon({ html: '<i class="fas fa-question-circle" style="color: orange;"></i>', className: '', iconSize: [16, 16] }) })
             .addTo(map).bindPopup(`<b>${km.toFixed(0)} km Mark</b><hr>Forecast time mismatch.`);
          return;
        }
        createWeatherMarkers(closestForecast, point, km, estTime);
      } catch (error) {
        weatherErrorCount++;
        console.error(`Forecast error at ${km.toFixed(1)} km:`, error);
         L.marker(point, { icon: L.divIcon({ html: '<i class="fas fa-exclamation-triangle" style="color: orange;"></i>', className: '', iconSize: [16, 16] }) })
           .addTo(map).bindPopup(`<b>${km.toFixed(0)} km Mark</b><hr>Forecast unavailable:<br>${error.message}`);
      }
    });

    await Promise.all(weatherPromises);

    if (weatherErrorCount > 0) {
       const weatherErrorDisplay = document.getElementById('weatherErrorDisplay');
       if (weatherErrorDisplay) {
         weatherErrorDisplay.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Failed to load weather for ${weatherErrorCount} point(s).`;
       }
    }

    const tailwindScoreDisplay = document.getElementById('tailwindScoreDisplay');
    if (tailwindScoreDisplay) {
        tailwindScoreDisplay.innerHTML = '<span class="loading-text">Calculating tailwind score...</span>';
        try {
            const tailwindScore = await computeTailwindScore(points, startTime, avgSpeed);
            const tooltipText = `Average headwind (-) or tailwind (+) component in km/h based on forecast along the route. Positive values indicate tailwind (helpful), negative values indicate headwind (hindering). Higher positive values are better.`;
            tailwindScoreDisplay.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; padding: 12px; background: var(--background-color); border: 1px solid var(--border-color); border-radius: 8px;">
                <i class="fas fa-wind" style="color: var(--primary-color); font-size: 18px;"></i>
                <div>
                  <strong>Tailwind Score:</strong> ${tailwindScore.toFixed(1)} km/h
                  <i class="fas fa-info-circle" title="${tooltipText}" style="color: var(--text-color-light); margin-left: 4px;"></i>
                </div>
              </div>`;
        } catch (tailwindError) {
            console.error("Error computing tailwind score:", tailwindError);
            tailwindScoreDisplay.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; padding: 12px; background: var(--background-color); border: 1px solid var(--border-color); border-radius: 8px;">
                <i class="fas fa-wind" style="color: var(--text-color-light); font-size: 18px;"></i>
                <div>
                  <strong>Tailwind Score:</strong> <i style="color: orange;">Unavailable</i>
                </div>
              </div>`;
        }
    }

    map.addLayer(windLayerGroup);
    currentWeatherLayer = 'wind';
    updateWeatherToggleIcon();

  } catch (error) {
    console.error("Error during route analysis:", error);
    showError(`Analysis failed: ${error.message}`);
    document.getElementById('statsContent').innerHTML = `Route analysis failed: ${error.message}`;
    windLayerGroup.clearLayers(); tempLayerGroup.clearLayers(); precipLayerGroup.clearLayers();
  }
}

/* -------------------------
 * Planning Stats Dashboard (similar to activity analysis)
 * ------------------------- */
function createPlanningStatsDashboard(metrics) {
  const routeType = getCurrentRouteType(); // Determine if it's regular planning, random, or GPX
  const icon = routeType === 'random' ? 'fa-random' : routeType === 'gpx' ? 'fa-file-code' : 'fa-route';
  const title = routeType === 'random' ? 'Random Route' : routeType === 'gpx' ? 'GPX Route' : 'Planned Route';
  const subtitle = routeType === 'random' ? 'Best Tailwind Route Generated' : routeType === 'gpx' ? 'Route Planning' : 'Route Planning';

  const statsHtml = `
    <div class="journey-stats-dashboard">
      <div style="display: flex; align-items: center; margin-bottom: 15px;">
        <i class="fas ${icon}" style="color: var(--primary-color); font-size: 24px; margin-right: 12px;"></i>
        <div>
          <h4 style="margin: 0; color: var(--primary-color); font-size: 18px;">${title}</h4>
          <p style="margin: 0; color: var(--text-color-light); font-size: 13px;">${subtitle}</p>
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-road"></i></div>
          <div class="stat-value">${metrics.totalDistance.toFixed(1)} km</div>
          <div class="stat-label">Distance</div>
        </div>
        
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-clock"></i></div>
          <div class="stat-value">${formatDuration(metrics.estimatedDuration)}</div>
          <div class="stat-label">Est. Duration</div>
        </div>
        
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-tachometer-alt"></i></div>
          <div class="stat-value">${metrics.avgSpeed} km/h</div>
          <div class="stat-label">Planned Speed</div>
        </div>
        
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-flag-checkered"></i></div>
          <div class="stat-value">${metrics.estimatedEndTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div class="stat-label">Est. Arrival</div>
        </div>
        
        ${metrics.hasElevation ? `
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-mountain"></i></div>
          <div class="stat-value">${metrics.totalAscent.toFixed(0)} m</div>
          <div class="stat-label">Elevation Gain</div>
        </div>
        
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-angle-down"></i></div>
          <div class="stat-value">${metrics.totalDescent.toFixed(0)} m</div>
          <div class="stat-label">Elevation Loss</div>
        </div>
        
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
          <div class="stat-value">${metrics.maxElevation.toFixed(0)} m</div>
          <div class="stat-label">Max Altitude</div>
        </div>
        
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-arrows-alt-v"></i></div>
          <div class="stat-value">${(metrics.maxElevation - metrics.minElevation).toFixed(0)} m</div>
          <div class="stat-label">Elevation Range</div>
        </div>
        ` : ''}
      </div>
      
      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color); font-size: 13px; color: var(--text-color-light);">
        <i class="fas fa-play-circle"></i> Departure: ${metrics.startTime.toLocaleString()}<br>
        <i class="fas fa-flag-checkered"></i> Est. Arrival: ${metrics.estimatedEndTime.toLocaleString()}
      </div>
      
      <div id="weatherErrorDisplay" class="error-message" style="font-size: 0.9em; margin-top: 10px;"></div>
      <div id="tailwindScoreDisplay" style="margin-top: 15px;"></div>
    </div>
  `;
  
  document.getElementById('statsContent').innerHTML = statsHtml;
}

/* -------------------------
 * Helper function to determine current route type
 * ------------------------- */
function getCurrentRouteType() {
  // Check if we're in random tab
  const randomTab = document.getElementById('generateRandom');
  if (randomTab && randomTab.style.display !== 'none') {
    return 'random';
  }
  
  // Check if a GPX file was loaded
  const gpxFile = document.getElementById('gpxFile');
  if (gpxFile && gpxFile.files.length > 0) {
    return 'gpx';
  }
  
  // Default to regular planning
  return 'planning';
}

/* -------------------------
 * Calculate elevation metrics for planning routes
 * ------------------------- */
function calculatePlanningElevationMetrics(points) {
  let totalAscent = 0;
  let totalDescent = 0;
  let maxElevation = -Infinity;
  let minElevation = Infinity;
  let hasElevation = false;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    // Check for elevation data in various formats
    const prevEle = prev.alt || prev.elevation || prev.ele || null;
    const currEle = curr.alt || curr.elevation || curr.ele || null;

    if (prevEle !== null && currEle !== null && !isNaN(prevEle) && !isNaN(currEle)) {
      hasElevation = true;
      
      const elevationDiff = currEle - prevEle;
      if (elevationDiff > 0) {
        totalAscent += elevationDiff;
      } else {
        totalDescent += Math.abs(elevationDiff);
      }
      
      maxElevation = Math.max(maxElevation, currEle);
      minElevation = Math.min(minElevation, currEle, prevEle);
    }
  }

  return {
    hasElevation: hasElevation,
    totalAscent: hasElevation ? totalAscent : 0,
    totalDescent: hasElevation ? totalDescent : 0,
    maxElevation: hasElevation ? maxElevation : 0,
    minElevation: hasElevation ? minElevation : 0
  };
}

function createWeatherMarkers(forecast, point, km, estTime) {
  const tempC = Math.round(forecast.main.temp);
  const windSpeed = forecast.wind.speed * 3.6;
  const windDeg = forecast.wind.deg;
  const weatherDesc = forecast.weather[0].description;
  const weatherMain = forecast.weather[0].main || '';
  const rain = forecast.rain && forecast.rain['3h'] ? forecast.rain['3h'] : 0;
  const snow = forecast.snow && forecast.snow['3h'] ? forecast.snow['3h'] : 0;
  const forecastTime = new Date(forecast.dt * 1000);
  const directionStr = degreesToCompass(windDeg);

  let precipAmount = 0, precipIconClass = "fa-sun", precipColor = "gold", precipType = '';
  if (rain > 0) {
      precipAmount = rain;
      precipIconClass = rain > 1 ? "fa-cloud-showers-heavy" : "fa-cloud-rain";
      precipColor = "#4682B4";
      precipType = '(Rain)';
  } else if (snow > 0) {
      precipAmount = snow;
      precipIconClass = "fa-snowflake";
      precipColor = "#ADD8E6";
      precipType = '(Snow)';
  } else if (weatherMain.toLowerCase().includes('cloud')) {
      precipIconClass = "fa-cloud";
      precipColor = "#A9A9A9";
  }

  const popupContent = `<b>${km.toFixed(0)} km Mark</b><hr>
    <strong>Temp:</strong> ${tempC}°C<br>
    <strong>Conditions:</strong> ${weatherDesc}<br>
    <strong>Wind:</strong> ${windSpeed.toFixed(1)} km/h ${directionStr} (${windDeg}°)<br>
    <strong>Precip (3h):</strong> ${precipAmount.toFixed(1)} mm ${precipType}
    <hr style="margin: 3px 0;">
    <i>Est. Arrival: ${estTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</i><br>
    <i>Forecast for: ${forecastTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</i>`;

  const windIcon = L.divIcon({
      className: 'wind-marker',
      iconSize: [40, 40],
      iconAnchor: [20, 45],
      popupAnchor: [0, -40],
      html: `<div style="text-align:center; position: relative;">
               <div style="transform: rotate(${windDeg}deg); display:inline-block; position: absolute; top: -15px; left: 12px; transform-origin: center bottom;">
                 <i class="fas fa-long-arrow-alt-down" style="font-size: 20px; color: #0056b3;"></i>
               </div>
               <span style="position: absolute; top: 5px; left: 0; width: 100%; font-size: 12px; font-weight: bold; color: #333;">${windSpeed.toFixed(0)}</span>
             </div>`
  });
  windLayerGroup.addLayer(L.marker(point, { icon: windIcon }).bindPopup(popupContent));

  const tempIcon = L.divIcon({
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20],
      html: `<div style="text-align: center; background: rgba(255,255,255,0.75); border-radius: 50%; padding: 5px; border: 1px solid #ccc; width: 40px; height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 1px 1px 3px rgba(0,0,0,0.2);">
               <i class="fas fa-thermometer-half" style="color: ${tempC > 25 ? '#dc3545' : tempC < 5 ? '#007bff' : '#ffc107'}; font-size: 16px; margin-bottom: 2px;"></i>
               <span style="font-weight:bold; font-size:12px; color: #333; line-height: 1;">${tempC}°</span>
             </div>`
  });
  tempLayerGroup.addLayer(L.marker(point, { icon: tempIcon }).bindPopup(popupContent));

  const precipIcon = L.divIcon({
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20],
      html: `<div style="text-align: center; background: rgba(255,255,255,0.75); border-radius: 50%; padding: 5px; border: 1px solid #ccc; width: 40px; height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 1px 1px 3px rgba(0,0,0,0.2);">
               <i class="fas ${precipIconClass}" style="color:${precipColor}; font-size: 16px; margin-bottom: 2px;"></i>
               <span style="font-size:11px; color: #333; line-height: 1;">${precipAmount > 0 ? precipAmount.toFixed(precipAmount < 1 ? 1 : 0) + 'mm' : '-'}</span>
             </div>`
  });
  precipLayerGroup.addLayer(L.marker(point, { icon: precipIcon }).bindPopup(popupContent));
}

function formatDuration(milliseconds) {
    if (isNaN(milliseconds) || milliseconds < 0) return "N/A";
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    let durationString = "";
    if (hours > 0) durationString += `${hours} hr${hours > 1 ? 's' : ''} `;
    if (minutes > 0 || hours === 0) durationString += `${minutes} min${minutes !== 1 ? 's' : ''}`;
    return durationString.trim() || "0 mins";
}

async function bestRandomRouteGenerator(triggeringButtonId) {
  document.querySelectorAll('.autocomplete-items').forEach(el => el.remove());
  showLoading(triggeringButtonId, "Generating...");

  try {
    let locInput = document.getElementById('randomLocation').value.trim();
    let center;
    document.getElementById('statsContent').innerHTML = `<span class="loading-text">${locInput ? `Geocoding "${locInput}"...` : 'Using map center...'}</span>`;

    if (locInput) {
        center = await geocodeLocation(locInput);
    } else {
        center = map.getCenter();
    }

    const routeLengthKm = parseInt(document.getElementById('routeLengthSlider').value) || CONFIG.DEFAULTS.RANDOM_ROUTE_LENGTH;
    const routeLengthMeters = routeLengthKm * 1000;
    const startTimeInput = document.getElementById('startTime').value;
    const startTime = new Date(startTimeInput);
    if (isNaN(startTime.getTime())) throw new Error("Invalid departure date/time selected.");
    const avgSpeedInput = document.getElementById('avgSpeed').value;
    const avgSpeed = parseInt(avgSpeedInput) || CONFIG.DEFAULTS.AVG_SPEED;
    if (avgSpeed <= 0) throw new Error("Invalid average speed selected.");

    clearRouteData();

    const numCandidates = CONFIG.DEFAULTS.RANDOM_ROUTE_CANDIDATES;
    document.getElementById('statsContent').innerHTML = `<span class="loading-text">Generating ${numCandidates} candidate routes (approx ${routeLengthKm} km)...</span>`;

    const candidatePromises = Array.from({ length: numCandidates }, (_, i) => (async () => {
       let seed = Math.floor(Math.random() * 100000);
       let url = `${CONFIG.API_URLS.GRAPHHOPPER}?vehicle=bike&points_encoded=false&algorithm=round_trip&point=${center.lat},${center.lng}&round_trip.distance=${routeLengthMeters}&round_trip.seed=${seed}&key=${CONFIG.API_KEYS.GRAPHHOPPER}&elevation=true`;
       try {
         let response = await fetch(url);
         if (!response.ok) {
           const errorText = await response.text();
           console.error(`Candidate ${i+1} generation failed (Seed: ${seed}): ${response.status} ${errorText}`);
           return null;
         }
         let data = await response.json();
         if (!data.paths || data.paths.length === 0 || !data.paths[0].points || data.paths[0].points.coordinates.length < 2) {
           console.error(`Candidate ${i+1} (Seed: ${seed}) returned no valid path.`);
           return null;
         }
         let routePoints = data.paths[0].points.coordinates.map(c => {
           const latLng = L.latLng(c[1], c[0]);
           // Add elevation data if available (GraphHopper returns [lng, lat, elevation])
           if (c.length > 2 && c[2] !== null && !isNaN(c[2])) {
             latLng.alt = c[2];
             latLng.elevation = c[2];
             latLng.ele = c[2];
           }
           return latLng;
         });
         let actualDistance = computeTotalDistance(routePoints);
         if (Math.abs(actualDistance - routeLengthMeters) / routeLengthMeters > 0.5) {
           console.warn(`Candidate ${i+1} (Seed: ${seed}) distance ${Math.round(actualDistance/1000)}km differs >50% from target ${routeLengthKm}km.`);
         }
         return { route: routePoints, seed: seed, distance: actualDistance };
       } catch (e) {
         console.error(`Error generating candidate ${i+1} (Seed: ${seed}):`, e);
         return null;
       }
    })());

    const results = await Promise.all(candidatePromises);
    const validCandidates = results.filter(r => r !== null);

    if (validCandidates.length === 0) {
       throw new Error(`Could not generate any valid round-trip routes near ${locInput || 'map center'} for ${routeLengthKm} km.`);
    }

    document.getElementById('statsContent').innerHTML = `<span class="loading-text">Analyzing ${validCandidates.length} routes for best tailwind...</span>`;

    const scoredCandidates = [];
    for (const candidate of validCandidates) {
       try {
         let score = await computeTailwindScore(candidate.route, startTime, avgSpeed);
         scoredCandidates.push({ ...candidate, score });
       } catch (e) {
         console.error(`Error computing tailwind score for candidate (Seed: ${candidate.seed}):`, e);
         scoredCandidates.push({ ...candidate, score: -Infinity });
       }
    }

    scoredCandidates.sort((a, b) => b.score - a.score);
    const bestCandidate = scoredCandidates[0];

    document.getElementById('statsContent').innerHTML = `<span class="loading-text">Displaying best route (Seed: ${bestCandidate.seed}, Score: ${bestCandidate.score.toFixed(1)})...</span>`;

    trackLayer = L.polyline(bestCandidate.route, { className: 'route-line' }).addTo(map);
    map.fitBounds(trackLayer.getBounds(), { padding: [30, 30] });

    L.marker(center, { icon: startIcon, interactive: false }).addTo(map);
    L.marker(center, { icon: endIcon, interactive: false }).addTo(map);
    waypoints = [];

    await analyzeRoute(bestCandidate.route);

    if (window.innerWidth <= 600 && typeof shouldAutoHideMenu === 'function' && shouldAutoHideMenu()) { 
      hideMenu(); 
    }

  } catch (error) {
    showError(error.message);
    document.getElementById('statsContent').innerHTML = 'Random route generation failed.';
  } finally {
    hideLoading();
  }
}

function computeTotalDistance(points) {
  let total = 0;
  if (!points || points.length < 2) return 0;
  for (let i = 1; i < points.length; i++) {
      if (points[i-1] && points[i] && typeof points[i-1].distanceTo === 'function') {
          total += points[i-1].distanceTo(points[i]);
      } else {
          console.warn("Invalid point data encountered in computeTotalDistance at index", i-1);
      }
  }
  return total;
}

function getPointAtDistanceFromRoute(points, targetDistance) {
    if (!points || points.length < 2 || targetDistance < 0) return null;
    const tempPolyline = L.polyline(points);
    const totalDist = tempPolyline.getDistance();
    if (targetDistance === 0) return points[0];
    if (targetDistance >= totalDist) return points[points.length - 1];
    return tempPolyline.getPointAtDistance(targetDistance);
}

function computeBearing(start, end) {
   if (!start || !end || typeof start.lat !== 'number' || typeof start.lng !== 'number' || typeof end.lat !== 'number' || typeof end.lng !== 'number') {
       console.warn("Invalid input for computeBearing:", start, end);
       return 0;
   }
   const lat1 = start.lat * Math.PI / 180;
   const lat2 = end.lat * Math.PI / 180;
   const dLng = (end.lng - start.lng) * Math.PI / 180;

   const y = Math.sin(dLng) * Math.cos(lat2);
   const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

   const brngRad = Math.atan2(y, x);
   const brngDeg = brngRad * 180 / Math.PI;

   return (brngDeg + 360) % 360;
}

async function computeTailwindScore(routePoints, startTime, avgSpeed) {
  if (!routePoints || routePoints.length < 2 || avgSpeed <= 0 || !(startTime instanceof Date) || isNaN(startTime.getTime())) {
       console.warn("Invalid input for computeTailwindScore.");
       return 0;
   }

  const totalDistance = computeTotalDistance(routePoints);
  if (totalDistance <= 0) return 0;

  const sampleFractions = CONFIG.TAILWIND_SAMPLE_FRACTIONS;
  let totalTailwindComponent = 0;
  let validSamples = 0;

  const weatherPromises = sampleFractions.map(async (frac, index) => {
    const targetDistance = totalDistance * frac;
    const samplePoint = getPointAtDistanceFromRoute(routePoints, targetDistance);
    const nextPoint = getPointAtDistanceFromRoute(routePoints, Math.min(targetDistance + 500, totalDistance));

    if (!samplePoint || !nextPoint || samplePoint.equals(nextPoint)) {
      console.warn(`Could not determine bearing at ${frac*100}% distance for tailwind score.`);
      return null;
    }

    const bearing = computeBearing(samplePoint, nextPoint);
    const travelTimeMs = (targetDistance / 1000 / avgSpeed) * 3600 * 1000;
    const sampleTime = new Date(startTime.getTime() + travelTimeMs);
    const sampleTimestamp = Math.floor(sampleTime.getTime() / 1000);

    try {
      await new Promise(resolve => setTimeout(resolve, index * CONFIG.DEFAULTS.TAILWIND_STAGGER_MS));

      const forecastResponse = await fetch(`${CONFIG.API_URLS.OPENWEATHER_FORECAST}?lat=${samplePoint.lat}&lon=${samplePoint.lng}&units=metric&appid=${CONFIG.API_KEYS.OPENWEATHER}`);
      if (!forecastResponse.ok) {
        console.warn(`Weather fetch failed for tailwind score at ${frac*100}% distance.`);
        return null;
      }
      const forecastData = await forecastResponse.json();

      if (!forecastData.list || forecastData.list.length === 0) {
           console.warn(`No forecast list received for tailwind score at ${frac*100}% distance.`);
           return null;
       }
      let bestEntry = forecastData.list.reduce((prev, curr) => (Math.abs(curr.dt - sampleTimestamp) < Math.abs(prev.dt - sampleTimestamp) ? curr : prev));

      if (!bestEntry || Math.abs(bestEntry.dt - sampleTimestamp) > 3 * 3600 + 1800) {
        console.warn(`No suitable forecast time found for tailwind score at ${frac*100}% distance.`);
        return null;
      }

      const windSpd_ms = bestEntry.wind.speed;
      const windDir = bestEntry.wind.deg;
      if (typeof windSpd_ms !== 'number' || typeof windDir !== 'number') {
           console.warn(`Invalid wind data received for tailwind score at ${frac*100}% distance.`);
           return null;
       }
      const windSpd_kmh = windSpd_ms * 3.6;

      let angleDiffDegrees = windDir - bearing;
      while (angleDiffDegrees <= -180) angleDiffDegrees += 360;
      while (angleDiffDegrees > 180) angleDiffDegrees -= 360;

      const tailwindComponent = windSpd_kmh * Math.cos(angleDiffDegrees * Math.PI / 180);
      return tailwindComponent;

    } catch (e) {
      console.error(`Error computing tailwind at sample ${frac*100}%:`, e);
      return null;
    }
  });

  const results = await Promise.all(weatherPromises);

  results.forEach(component => {
    if (component !== null && typeof component === 'number') {
      totalTailwindComponent += component;
      validSamples++;
    }
  });

  return validSamples > 0 ? totalTailwindComponent / validSamples : 0;
}

function displayRecommendedHeading() {
   if (window.recommendedMarker) {
       map.removeLayer(window.recommendedMarker);
       window.recommendedMarker = null;
   }
}

/* -------------------------
 * Elevation Profile Creation
 * ------------------------- */
function createElevationProfile(points, isAnalysis = false) {
  const profileContainer = document.getElementById('elevationProfile');
  if (!profileContainer) return;

  // Check if we have elevation data
  let elevationData = [];
  let cumulativeDistance = 0;
  let hasElevation = false;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const prev = points[i - 1];
      const curr = points[i];
      const segmentDistance = calculateDistanceForProfile(prev.lat, prev.lng, curr.lat, curr.lng);
      cumulativeDistance += segmentDistance / 1000; // Convert to km
    }

    // For planned routes, we need to extract elevation from the point if available
    let elevation = null;
    if (isAnalysis) {
      elevation = points[i].ele;
    } else {
      // For planned routes, elevation might be in different format
      elevation = points[i].alt || points[i].elevation || null;
    }

    if (elevation !== null && !isNaN(elevation)) {
      hasElevation = true;
      elevationData.push({
        distance: cumulativeDistance,
        elevation: elevation
      });
    }
  }

  if (!hasElevation || elevationData.length < 2) {
    profileContainer.style.display = 'none';
    return;
  }

  // Show and populate the elevation profile
  profileContainer.style.display = 'block';
  
  const minElevation = Math.min(...elevationData.map(d => d.elevation));
  const maxElevation = Math.max(...elevationData.map(d => d.elevation));
  const totalDistance = elevationData[elevationData.length - 1].distance;
  
  const elevationRange = maxElevation - minElevation;
  const padding = elevationRange * 0.1; // 10% padding
  const chartMin = minElevation - padding;
  const chartMax = maxElevation + padding;
  const chartRange = chartMax - chartMin;

  // Create SVG path
  const chartWidth = 260; // Fixed width for sidebar
  const chartHeight = 100;
  
  let pathData = '';
  let areaData = '';
  
  elevationData.forEach((point, index) => {
    const x = (point.distance / totalDistance) * chartWidth;
    const y = chartHeight - ((point.elevation - chartMin) / chartRange) * chartHeight;
    
    if (index === 0) {
      pathData += `M ${x} ${y}`;
      areaData += `M ${x} ${chartHeight} L ${x} ${y}`;
    } else {
      pathData += ` L ${x} ${y}`;
      areaData += ` L ${x} ${y}`;
    }
  });
  
  // Close the area path
  areaData += ` L ${chartWidth} ${chartHeight} Z`;

  const analysisClass = isAnalysis ? 'elevation-analyzed' : '';
  
  profileContainer.innerHTML = `
    <h4><i class="fas fa-chart-area"></i> Elevation Profile</h4>
    <div class="elevation-chart ${analysisClass}">
      <svg width="100%" height="100%" viewBox="0 0 ${chartWidth} ${chartHeight}">
        <path class="elevation-area" d="${areaData}"></path>
        <path class="elevation-line" d="${pathData}"></path>
      </svg>
    </div>
    <div class="elevation-labels">
      <span>0 km</span>
      <span>${minElevation.toFixed(0)}m - ${maxElevation.toFixed(0)}m</span>
      <span>${totalDistance.toFixed(1)} km</span>
    </div>
  `;
}

/* -------------------------
 * Interactive Planning Elevation Chart
 * ------------------------- */
async function createPlanningElevationChart(points) {
  const chartSection = document.getElementById('elevationChartSection');
  const chartCanvas = document.getElementById('elevationChart');
  
  if (!chartSection || !chartCanvas || !window.Chart) {
    console.warn('Chart.js not available or chart elements not found');
    return;
  }

  // Check if we have elevation data
  let elevationData = [];
  let cumulativeDistance = 0;
  let hasElevation = false;

  console.log(`Planning chart: Processing ${points.length} points for elevation data`);

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const prev = points[i - 1];
      const curr = points[i];
      const segmentDistance = calculateDistanceForProfile(prev.lat, prev.lng, curr.lat, curr.lng);
      cumulativeDistance += segmentDistance / 1000; // Convert to km
    }

    // For planned routes, elevation might be in different format
    let elevation = points[i].alt || points[i].elevation || points[i].ele || null;

    if (elevation !== null && !isNaN(elevation)) {
      hasElevation = true;
      elevationData.push({
        distance: cumulativeDistance,
        elevation: elevation,
        lat: points[i].lat,
        lng: points[i].lng
      });
    }
  }

  console.log(`Planning chart: Found ${elevationData.length} points with elevation data out of ${points.length} total points`);

  // If we don't have enough elevation data from GraphHopper, try to get it from an external service
  if (!hasElevation || elevationData.length < 5) {
    console.log('Not enough elevation data from GraphHopper, trying external elevation service...');
    
    try {
      const enhancedPoints = await addElevationDataToPoints(points);
      
      // Re-process with enhanced elevation data
      elevationData = [];
      cumulativeDistance = 0;
      hasElevation = false;

      for (let i = 0; i < enhancedPoints.length; i++) {
        if (i > 0) {
          const prev = enhancedPoints[i - 1];
          const curr = enhancedPoints[i];
          const segmentDistance = calculateDistanceForProfile(prev.lat, prev.lng, curr.lat, curr.lng);
          cumulativeDistance += segmentDistance / 1000;
        }

        let elevation = enhancedPoints[i].alt || enhancedPoints[i].elevation || enhancedPoints[i].ele || null;

        if (elevation !== null && !isNaN(elevation)) {
          hasElevation = true;
          elevationData.push({
            distance: cumulativeDistance,
            elevation: elevation,
            lat: enhancedPoints[i].lat,
            lng: enhancedPoints[i].lng
          });
        }
      }
      
      console.log(`Planning chart: After external service, found ${elevationData.length} points with elevation data`);
    } catch (error) {
      console.warn('External elevation service failed:', error);
    }
  }

  if (!hasElevation || elevationData.length < 5) {
    console.log('Still not enough elevation data for chart, hiding elevation section');
    chartSection.style.display = 'none';
    return;
  }

  // ==== Peak detection & naming (async, non-blocking) ====
  const peakIndices = detectPeaks(elevationData, 50); // 50 m prominence
  // Prepare a set for quick lookup when drawing points
  const peakIndexSet = new Set(peakIndices);

  // ensure layer group for map peaks exists
  if (!window.peaksLayerGroup) {
    window.peaksLayerGroup = L.layerGroup().addTo(map);
  } else {
    window.peaksLayerGroup.clearLayers();
  }
  
  // helper to create flag marker
  function addPeakMarker(p, name) {
     const flagIcon = L.divIcon({
        className: '',
        iconSize: [18, 18],
        iconAnchor: [9, 18],
        html: `<i class="fas fa-flag" style="color:#dc3545;font-size:18px;"></i>`
     });
     L.marker([p.lat, p.lng], { icon: flagIcon, interactive: false }).addTo(window.peaksLayerGroup).bindTooltip(name, { direction: 'top', offset: [0,-10] });
  }

  async function enrichPeaks() {
     for (let i = 0; i < peakIndices.length; i++) {
        const idx = peakIndices[i];
        const pt = elevationData[idx];
        await sleep(1100); // throttle ~1 req/s
        const name = await fetchPeakName(pt.lat, pt.lng);
        if (name) {
           pt.peakName = name;
           addPeakMarker(pt, name);
           elevationChart.update();
        }
     }
  }
  enrichPeaks(); // fire without awaiting
  // ==== End peak logic ====

  // Show the chart section
  chartSection.style.display = 'block';
  chartSection.classList.remove('collapsed'); // Start expanded
  
  // Set the correct icon on the toggle button
  const toggleBtn = document.getElementById('toggleElevationChart');
  if (toggleBtn) {
    toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
  }
  
  // Initialize toggle functionality (defined in activity.js)
  if (typeof initElevationChartToggle === 'function') {
    initElevationChartToggle();
  }

  // Destroy existing chart if it exists
  if (typeof elevationChart !== 'undefined' && elevationChart) {
    elevationChart.destroy();
  }

  // Prepare chart data
  const labels = elevationData.map(p => p.distance.toFixed(1));
  const chartElevationData = elevationData.map(p => p.elevation);
  
  const ctx = chartCanvas.getContext('2d');
  
  elevationChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Elevation (m)',
        data: chartElevationData,
        borderColor: '#007bff', // Blue color for planned routes
        backgroundColor: 'rgba(0, 123, 255, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.2,
        pointRadius: (ctx) => {
          const idx = ctx.dataIndex;
          const pt = elevationData[idx];
          return pt && pt.peakName ? 4 : 0;
        },
        pointBackgroundColor: (ctx) => {
          const idx = ctx.dataIndex;
          const pt = elevationData[idx];
          return pt && pt.peakName ? '#dc3545' : 'rgba(0,123,255,0)';
        },
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#007bff',
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        title: {
          display: false
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: function(context) {
              return `Distance: ${context[0].label} km`;
            },
            label: function(context) {
              const idx = context.dataIndex;
              const pt = elevationData[idx];
              const lines = [`Elevation: ${context.parsed.y.toFixed(0)} m`];
              if (pt && pt.peakName) {
                lines.push(`Peak: ${pt.peakName}`);
              }
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Distance (km)',
            color: '#6c757d'
          },
          grid: {
            color: 'rgba(0,0,0,0.1)'
          }
        },
        y: {
          display: true,
          title: {
            display: true,
            text: 'Elevation (m)',
            color: '#6c757d'
          },
          grid: {
            color: 'rgba(0,0,0,0.1)'
          }
        }
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      onHover: function(event, activeElements) {
        if (activeElements && activeElements.length > 0) {
          const dataIndex = activeElements[0].index;
          const profilePoint = elevationData[dataIndex];
          
          if (profilePoint && map) {
            // Create a temporary marker if it doesn't exist
            if (!window.planningElevationMarker) {
              const markerIcon = L.divIcon({
                className: 'planning-elevation-marker',
                iconSize: [16, 16],
                iconAnchor: [8, 8],
                html: `<div style="background: #007bff; border-radius: 50%; width: 16px; height: 16px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`
              });
              
              window.planningElevationMarker = L.marker([profilePoint.lat, profilePoint.lng], { 
                icon: markerIcon,
                zIndexOffset: 1000
              }).addTo(map);
            } else {
              // Move existing marker
              window.planningElevationMarker.setLatLng([profilePoint.lat, profilePoint.lng]);
            }
            
            // Simple visual highlight without altering Leaflet's translate3d transform
            const el = window.planningElevationMarker.getElement();
            if (el) {
              el.classList.add('elev-hover-active');
              setTimeout(() => el.classList.remove('elev-hover-active'), 200);
            }
          }
        }
      }
    }
  });
}

/* -------------------------
 * External Elevation Service
 * ------------------------- */
async function addElevationDataToPoints(points) {
  // Sample points along the route (max 50 points to avoid API limits)
  const maxPoints = 50;
  let sampledPoints = points;
  
  if (points.length > maxPoints) {
    const sampleEvery = Math.floor(points.length / maxPoints);
    sampledPoints = points.filter((_, index) => index % sampleEvery === 0);
    // Always include the last point
    if (sampledPoints[sampledPoints.length - 1] !== points[points.length - 1]) {
      sampledPoints.push(points[points.length - 1]);
    }
  }

  console.log(`Fetching elevation for ${sampledPoints.length} sampled points using Open-Elevation API`);

  try {
    // Use Open-Elevation API (free, no API key required)
    const locations = sampledPoints.map(p => ({ latitude: p.lat, longitude: p.lng }));
    
    const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locations })
    });

    if (!response.ok) {
      throw new Error(`Open-Elevation API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.results || data.results.length === 0) {
      throw new Error('No elevation data returned from Open-Elevation API');
    }

    // Map the elevation data back to the sampled points
    const enhancedPoints = sampledPoints.map((point, index) => {
      const elevationResult = data.results[index];
      return {
        ...point,
        alt: elevationResult.elevation,
        elevation: elevationResult.elevation,
        ele: elevationResult.elevation
      };
    });

    console.log(`Successfully enhanced ${enhancedPoints.length} points with elevation data`);
    return enhancedPoints;

  } catch (error) {
    console.error('Failed to fetch elevation data:', error);
    
    // Fallback: try to interpolate elevation data if we have some points with elevation
    const pointsWithElevation = points.filter(p => 
      (p.alt !== null && !isNaN(p.alt)) || 
      (p.elevation !== null && !isNaN(p.elevation)) || 
      (p.ele !== null && !isNaN(p.ele))
    );
    
    if (pointsWithElevation.length >= 2) {
      console.log(`Interpolating elevation for ${points.length} points based on ${pointsWithElevation.length} points with existing elevation`);
      return interpolateElevationData(points, pointsWithElevation);
    }
    
    throw error;
  }
}

function interpolateElevationData(allPoints, elevationPoints) {
  // Simple linear interpolation between known elevation points
  return allPoints.map(point => {
    // If this point already has elevation, keep it
    const existingElevation = point.alt || point.elevation || point.ele;
    if (existingElevation !== null && !isNaN(existingElevation)) {
      return {
        ...point,
        alt: existingElevation,
        elevation: existingElevation,
        ele: existingElevation
      };
    }

    // Find the two closest elevation points
    let beforePoint = null;
    let afterPoint = null;
    
    for (let i = 0; i < elevationPoints.length; i++) {
      const elevPoint = elevationPoints[i];
      const distance = calculateDistanceForProfile(point.lat, point.lng, elevPoint.lat, elevPoint.lng);
      
      if (elevPoint.lat <= point.lat || elevPoint.lng <= point.lng) {
        beforePoint = elevPoint;
      } else if (!afterPoint) {
        afterPoint = elevPoint;
        break;
      }
    }

    // Interpolate elevation
    let interpolatedElevation = 0;
    if (beforePoint && afterPoint) {
      const beforeElev = beforePoint.alt || beforePoint.elevation || beforePoint.ele || 0;
      const afterElev = afterPoint.alt || afterPoint.elevation || afterPoint.ele || 0;
      interpolatedElevation = (beforeElev + afterElev) / 2;
    } else if (beforePoint) {
      interpolatedElevation = beforePoint.alt || beforePoint.elevation || beforePoint.ele || 0;
    } else if (afterPoint) {
      interpolatedElevation = afterPoint.alt || afterPoint.elevation || afterPoint.ele || 0;
    }

    return {
      ...point,
      alt: interpolatedElevation,
      elevation: interpolatedElevation,
      ele: interpolatedElevation
    };
  });
}

function calculateDistanceForProfile(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// === Peak detection & naming helpers ===
const peakNameCache = new Map(); // key: "lat,lng" rounded, value: name|null
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Detect local maxima with a simple prominence check (≥50 m by default)
function detectPeaks(elevArr, prominence = 50) {
  const peakIdx = [];
  for (let i = 1; i < elevArr.length - 1; i++) {
    const prev = elevArr[i - 1].elevation;
    const curr = elevArr[i].elevation;
    const next = elevArr[i + 1].elevation;
    if (curr > prev && curr > next) {
      const drop = Math.min(curr - prev, curr - next);
      if (drop >= prominence) peakIdx.push(i);
    }
  }
  return peakIdx;
}

// Query Overpass API for a named peak near the coordinate (300 m radius)
async function fetchPeakName(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (peakNameCache.has(key)) return peakNameCache.get(key);

  const radius = 300; // metres
  const query = `[out:json][timeout:25];(node(around:${radius},${lat},${lng})[natural=peak][name];node(around:${radius},${lat},${lng})[mountain_pass=yes][name];);out tags 1;`;
  try {
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Overpass ${resp.status}`);
    const data = await resp.json();
    if (!data.elements || data.elements.length === 0) {
      peakNameCache.set(key, null);
      return null;
    }
    // Use the first returned element with a valid name
    const name = data.elements[0].tags && data.elements[0].tags.name ? data.elements[0].tags.name.trim() : null;
    if (!name || /^unnamed/i.test(name)) {
      peakNameCache.set(key, null);
      return null;
    }
    peakNameCache.set(key, name);
    return name;
  } catch (e) {
    console.warn("Overpass query failed:", e);
    peakNameCache.set(key, null);
    return null;
  }
}
// === End peak helpers ===