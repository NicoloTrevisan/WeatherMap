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

    let statsHTML = `
      <div><strong>Total Distance:</strong> ${totalDistanceKm.toFixed(1)} km</div>
      <div><strong>Est. Duration:</strong> ${formatDuration(estimatedDurationMs)}</div>
      <div><strong>Est. Arrival:</strong> ${estimatedEndTime.toLocaleDateString()} ${estimatedEndTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div><strong>Avg. Speed Setting:</strong> ${avgSpeed} km/h</div>
      <hr>
      <div id="weatherErrorDisplay" class="error-message" style="font-size: 0.9em;"></div>
      <div id="tailwindScoreDisplay"></div>
    `;
    document.getElementById('statsContent').innerHTML = statsHTML;

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
       document.getElementById('weatherErrorDisplay').innerHTML = `<i class="fas fa-exclamation-triangle"></i> Failed to load weather for ${weatherErrorCount} point(s).`;
    }

    const tailwindScoreDisplay = document.getElementById('tailwindScoreDisplay');
    if (tailwindScoreDisplay) {
        tailwindScoreDisplay.innerHTML = '<span class="loading-text">Calculating tailwind score...</span>';
        try {
            const tailwindScore = await computeTailwindScore(points, startTime, avgSpeed);
            const tooltipText = `Average headwind (-) or tailwind (+) component in km/h based on forecast along the route. Positive values indicate tailwind (helpful), negative values indicate headwind (hindering). Higher positive values are better.`;
            tailwindScoreDisplay.innerHTML = `
                <div>
                   <strong>Tailwind Score:</strong> ${tailwindScore.toFixed(1)} km/h
                   <i class="fas fa-info-circle" title="${tooltipText}"></i>
                </div>`;
        } catch (tailwindError) {
            console.error("Error computing tailwind score:", tailwindError);
            tailwindScoreDisplay.innerHTML = '<div><strong>Tailwind Score:</strong> <i style="color: orange;">Unavailable</i></div>';
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
         let routePoints = data.paths[0].points.coordinates.map(c => L.latLng(c[1], c[0]));
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

    if (window.innerWidth <= 600) { hideMenu(); }

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
