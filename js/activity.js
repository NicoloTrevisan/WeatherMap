/* -------------------------
 * Enhanced Activity Analysis Functions with Animations
 * ------------------------- */

// Global variables for activity analysis
let activityData = null;
let elevationProfile = [];
let historicalWeatherMarkers = L.layerGroup();
let activitySpecialMarkers = L.layerGroup();
let elevationChart = null;
let journeyMarker = null;
let routeAnimationLayer = null;

/* -------------------------
 * Main Activity Analysis Function
 * ------------------------- */
async function analyzeActivity(triggeringButtonId) {
  showLoading(triggeringButtonId, "Analyzing activity...");
  
  try {
    const file = document.getElementById('activityGpxFile').files[0];
    if (!file) {
      throw new Error('No activity file selected.');
    }

    clearRouteData(); // Clear any existing route data
    document.getElementById('statsContent').innerHTML = '<span class="loading-text">Processing activity data...</span>';

    // Parse the GPX file with timestamps and elevation data
    const activityPoints = await parseActivityGPX(file);
    if (!activityPoints || activityPoints.length < 2) {
      throw new Error("Activity file contains insufficient points.");
    }

    // Store activity data globally
    activityData = {
      points: activityPoints,
      startTime: activityPoints[0].time,
      endTime: activityPoints[activityPoints.length - 1].time,
      fileName: file.name
    };

    // Create route instantly without animation
    drawInstantRoute(activityPoints);
    
    map.fitBounds(L.latLngBounds(activityPoints.map(p => [p.lat, p.lng])), { padding: [30, 30] });

    // Add start/end markers with same icons as planning
    const startMarker = L.marker([activityPoints[0].lat, activityPoints[0].lng], { 
      icon: startIcon, 
      interactive: false 
    }).addTo(map);
    
    const endMarker = L.marker([activityPoints[activityPoints.length - 1].lat, activityPoints[activityPoints.length - 1].lng], { 
      icon: endIcon, 
      interactive: false 
    }).addTo(map);

    // Clear special markers
    activitySpecialMarkers.clearLayers();
    map.addLayer(activitySpecialMarkers);

    // Perform comprehensive analysis
    await performActivityAnalysis(activityPoints);

    // Hide menu on mobile after successful analysis (if setting enabled)
    if (window.innerWidth <= 600 && typeof shouldAutoHideMenu === 'function' && shouldAutoHideMenu()) { 
      hideMenu(); 
    }

  } catch (error) {
    showError(error.message);
    document.getElementById('statsContent').innerHTML = 'Activity analysis failed.';
  } finally {
    hideLoading();
  }
}

/* -------------------------
 * Animated Route Drawing
 * ------------------------- */
function drawInstantRoute(points) {
  // Create the route polyline with dashed style for activities - instantly
  const routePoints = points.map(p => [p.lat, p.lng]);
  routeAnimationLayer = L.polyline(routePoints, { 
    className: 'route-line',
    color: '#28a745', // Green color for analyzed activities
    dashArray: '8, 4', // Dashed line
    weight: 4
  }).addTo(map);

  // Create journey marker at the end of the route
  const bikeIcon = L.divIcon({
    className: 'journey-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `<div style="background: #28a745; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
             <i class="fas fa-bicycle" style="color: white; font-size: 16px;"></i>
           </div>`
  });

  // Place journey marker at the end of the route
  const endPoint = points[points.length - 1];
  journeyMarker = L.marker([endPoint.lat, endPoint.lng], { icon: bikeIcon }).addTo(map);
  
  // Make marker globally accessible for chart interaction
  window.journeyMarker = journeyMarker;
}

/* -------------------------
 * GPX Parsing with Timestamps and Elevation
 * ------------------------- */
async function parseActivityGPX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const gpx = new DOMParser().parseFromString(e.target.result, "text/xml");
        let points = [];
        
        // Try to get track points first (most common for activities)
        const trkpts = Array.from(gpx.getElementsByTagName('trkpt'));
        if (trkpts.length > 0) {
          points = trkpts.map(pt => ({
            lat: parseFloat(pt.getAttribute('lat')),
            lng: parseFloat(pt.getAttribute('lon')),
            ele: pt.getElementsByTagName('ele')[0] ? parseFloat(pt.getElementsByTagName('ele')[0].textContent) : null,
            time: pt.getElementsByTagName('time')[0] ? new Date(pt.getElementsByTagName('time')[0].textContent) : null
          }));
        } else {
          // Fallback to route points
          const rtepts = Array.from(gpx.getElementsByTagName('rtept'));
          if (rtepts.length > 0) {
            points = rtepts.map(pt => ({
              lat: parseFloat(pt.getAttribute('lat')),
              lng: parseFloat(pt.getAttribute('lon')),
              ele: pt.getElementsByTagName('ele')[0] ? parseFloat(pt.getElementsByTagName('ele')[0].textContent) : null,
              time: pt.getElementsByTagName('time')[0] ? new Date(pt.getElementsByTagName('time')[0].textContent) : null
            }));
          }
        }

        // Filter out invalid points
        const validPoints = points.filter(p => 
          p && !isNaN(p.lat) && !isNaN(p.lng) && 
          p.lat >= -90 && p.lat <= 90 && 
          p.lng >= -180 && p.lng <= 180
        );

        if (validPoints.length < 2) {
          reject(new Error('Activity file needs at least two valid points with coordinates.'));
          return;
        }

        // Check if we have timestamps
        const hasTimestamps = validPoints.some(p => p.time && !isNaN(p.time.getTime()));
        if (!hasTimestamps) {
          console.warn('No timestamps found in activity file. Speed analysis will be limited.');
        }

        resolve(validPoints);
      } catch (error) {
        reject(new Error(`Invalid or unreadable activity file format: ${error.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read the activity file.'));
    reader.readAsText(file);
  });
}

/* -------------------------
 * Activity Analysis Functions
 * ------------------------- */
async function performActivityAnalysis(points) {
  document.getElementById('statsContent').innerHTML = '<span class="loading-text">Calculating metrics...</span>';

  try {
    // Calculate basic metrics
    const metrics = calculateActivityMetrics(points);
    
    // Calculate elevation profile
    elevationProfile = calculateElevationProfile(points);
    
    // Create enhanced journey stats dashboard
    createJourneyStatsDashboard(metrics);
    
    // Create interactive elevation chart if we have elevation data
    if (metrics.hasElevation && elevationProfile.length > 10) {
      createInteractiveElevationChart(elevationProfile);
    }
    
    // Add special markers for highest point and fastest speed
    addSpecialMarkers(points, metrics);

    // Calculate tailwind score if we have timestamps
    if (metrics.hasTimestamps && activityData.startTime) {
      document.getElementById('statsContent').innerHTML += '<br><span class="loading-text">Calculating tailwind score...</span>';
      const tailwindScore = await calculateActivityTailwindScore(points);
      updateStatsWithTailwind(tailwindScore);
    }

    // Fetch historical weather data if we have timestamps
    if (metrics.hasTimestamps && activityData.startTime) {
      document.getElementById('statsContent').innerHTML += '<br><span class="loading-text">Fetching historical weather...</span>';
      await fetchHistoricalWeather(points);
    } else {
      console.warn('No timestamps available - skipping weather analysis');
    }

  } catch (error) {
    console.error('Error during activity analysis:', error);
    showError(`Analysis failed: ${error.message}`);
  }
}

/* -------------------------
 * Enhanced Journey Stats Dashboard
 * ------------------------- */
function createJourneyStatsDashboard(metrics) {
  const statsHtml = `
    <div class="journey-stats-dashboard">
      <div style="display: flex; align-items: center; margin-bottom: 15px;">
        <i class="fas fa-route" style="color: var(--success-color); font-size: 24px; margin-right: 12px;"></i>
        <div>
          <h4 style="margin: 0; color: var(--success-color); font-size: 18px;">${activityData.fileName}</h4>
          <p style="margin: 0; color: var(--text-color-light); font-size: 13px;">Journey Analysis</p>
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-road"></i></div>
          <div class="stat-value">${metrics.totalDistance.toFixed(1)} km</div>
          <div class="stat-label">Distance</div>
        </div>
        
        ${metrics.hasTimestamps && metrics.movingTime > 0 ? `
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-clock"></i></div>
          <div class="stat-value">${formatDuration(metrics.movingTime * 1000)}</div>
          <div class="stat-label">Moving Time</div>
        </div>
        ` : ''}
        
        ${metrics.avgSpeed ? `
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-tachometer-alt"></i></div>
          <div class="stat-value">${metrics.avgSpeed.toFixed(1)} km/h</div>
          <div class="stat-label">Avg Speed</div>
        </div>
        ` : ''}
        
        ${metrics.maxSpeed ? `
        <div class="stat-item">
          <div class="stat-icon"><i class="fas fa-rocket"></i></div>
          <div class="stat-value">${metrics.maxSpeed.toFixed(1)} km/h</div>
          <div class="stat-label">Max Speed</div>
        </div>
        ` : ''}
        
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
          <div class="stat-icon"><i class="fas fa-flag-checkered"></i></div>
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
      
      ${metrics.hasTimestamps ? `
      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color); font-size: 13px; color: var(--text-color-light);">
        <i class="fas fa-play-circle"></i> Started: ${metrics.startTime.toLocaleString()}<br>
        <i class="fas fa-stop-circle"></i> Finished: ${metrics.endTime.toLocaleString()}
      </div>
      ` : ''}
      
      <div id="tailwindScoreDisplay" style="margin-top: 15px;"></div>
      <div id="weatherAnalysisDisplay" style="margin-top: 10px;"></div>
    </div>
  `;
  
  document.getElementById('statsContent').innerHTML = statsHtml;
  
  // Add stats animation
  if (typeof animateStatsUpdate === 'function') {
    animateStatsUpdate();
  }
}

/* -------------------------
 * Elevation Chart Toggle & Interaction
 * ------------------------- */
function initElevationChartToggle() {
  const chartSection = document.getElementById('elevationChartSection');
  const header = chartSection.querySelector('.elevation-header');
  
  if (header) {
    header.addEventListener('click', () => {
      chartSection.classList.toggle('collapsed');
    });
  }
}

/* -------------------------
 * Interactive Elevation Chart with Chart.js
 * ------------------------- */
function createInteractiveElevationChart(profile) {
  const chartSection = document.getElementById('elevationChartSection');
  const chartCanvas = document.getElementById('elevationChart');
  
  if (!chartSection || !chartCanvas || !window.Chart) {
    console.warn('Chart.js not available or chart elements not found');
    return;
  }

  // Show the chart section
  chartSection.style.display = 'block';
  chartSection.classList.remove('collapsed'); // Start expanded
  
  // Set the correct icon on the toggle button
  const toggleBtn = document.getElementById('toggleElevationChart');
  if (toggleBtn) {
    toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
  }
  
  // Initialize toggle functionality
  initElevationChartToggle();

  // Destroy existing chart if it exists
  if (elevationChart) {
    elevationChart.destroy();
  }

  // Prepare chart data
  const labels = profile.map(p => p.distance.toFixed(1));
  const elevationData = profile.map(p => p.elevation);
  
  const ctx = chartCanvas.getContext('2d');
  
  elevationChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Elevation (m)',
        data: elevationData,
        borderColor: '#28a745',
        backgroundColor: 'rgba(40, 167, 69, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.2,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#28a745',
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
              return `Elevation: ${context.parsed.y.toFixed(0)} m`;
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
      onHover: (event, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          const dataIndex = activeElements[0].index;
          const profilePoint = profile[dataIndex];
          const marker = window.journeyMarker || journeyMarker;
          
          if (marker && profilePoint && typeof profilePoint.lat === 'number' && typeof profilePoint.lng === 'number') {
            // Move the journey marker to the corresponding position on the map
            marker.setLatLng([profilePoint.lat, profilePoint.lng]);
            
            // Add a subtle animation
            const markerElement = marker.getElement();
            if (markerElement) {
              markerElement.style.transition = 'transform 0.1s ease';
              markerElement.style.transform = 'scale(1.2)';
            }
          }
        } else {
          // Reset marker scale when not hovering
          const marker = window.journeyMarker || journeyMarker;
          if (marker) {
            const markerElement = marker.getElement();
            if (markerElement) {
              markerElement.style.transform = 'scale(1)';
            }
          }
        }
      }
    }
  });
}

function calculateActivityMetrics(points) {
  let totalDistance = 0;
  let totalAscent = 0;
  let totalDescent = 0;
  let maxElevation = -Infinity;
  let minElevation = Infinity;
  let movingTime = 0;
  let maxSpeed = 0;
  let speeds = [];
  let highestPoint = null;
  let fastestSegment = null;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    // Calculate distance between points
    const segmentDistance = calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    totalDistance += segmentDistance;

    // Elevation calculations
    if (prev.ele !== null && curr.ele !== null) {
      const elevationDiff = curr.ele - prev.ele;
      if (elevationDiff > 0) {
        totalAscent += elevationDiff;
      } else {
        totalDescent += Math.abs(elevationDiff);
      }
      
      if (curr.ele > maxElevation) {
        maxElevation = curr.ele;
        highestPoint = curr;
      }
      minElevation = Math.min(minElevation, curr.ele);
    }

    // Speed and time calculations
    if (prev.time && curr.time && !isNaN(prev.time.getTime()) && !isNaN(curr.time.getTime())) {
      const timeDiff = (curr.time.getTime() - prev.time.getTime()) / 1000; // seconds
      if (timeDiff > 0 && timeDiff < 300) { // Ignore gaps > 5 minutes (stops)
        movingTime += timeDiff;
        const speed = (segmentDistance / 1000) / (timeDiff / 3600); // km/h
        if (speed > 0 && speed < 100) { // Filter out unrealistic speeds
          speeds.push(speed);
          if (speed > maxSpeed) {
            maxSpeed = speed;
            fastestSegment = curr;
          }
        }
      }
    }
  }

  const hasTimestamps = points.some(p => p.time && !isNaN(p.time.getTime()));
  const hasElevation = points.some(p => p.ele !== null);
  
  return {
    totalDistance: totalDistance / 1000, // Convert to km
    totalAscent: hasElevation ? totalAscent : null,
    totalDescent: hasElevation ? totalDescent : null,
    maxElevation: hasElevation ? maxElevation : null,
    minElevation: hasElevation ? minElevation : null,
    movingTime: movingTime, // seconds
    maxSpeed: maxSpeed,
    avgSpeed: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
    hasTimestamps: hasTimestamps,
    hasElevation: hasElevation,
    startTime: points[0].time,
    endTime: points[points.length - 1].time,
    highestPoint: highestPoint,
    fastestSegment: fastestSegment
  };
}

function addSpecialMarkers(points, metrics) {
  // Add highest elevation marker
  if (metrics.highestPoint) {
    const highestIcon = L.divIcon({
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16],
      html: `<div style="text-align: center; background: rgba(255,255,255,0.9); border-radius: 50%; padding: 4px; border: 2px solid #dc3545; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; box-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
               <i class="fas fa-mountain" style="color: #dc3545; font-size: 16px;"></i>
             </div>`
    });

    const highestMarker = L.marker([metrics.highestPoint.lat, metrics.highestPoint.lng], { icon: highestIcon })
      .bindPopup(`<b>Highest Point</b><hr><strong>Elevation:</strong> ${metrics.maxElevation.toFixed(0)} m<br><strong>Time:</strong> ${metrics.highestPoint.time ? metrics.highestPoint.time.toLocaleTimeString() : 'N/A'}`);
    
    activitySpecialMarkers.addLayer(highestMarker);
  }

  // Add fastest speed marker
  if (metrics.fastestSegment) {
    const fastestIcon = L.divIcon({
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16],
      html: `<div style="text-align: center; background: rgba(255,255,255,0.9); border-radius: 50%; padding: 4px; border: 2px solid #ffc107; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; box-shadow: 2px 2px 4px rgba(0,0,0,0.3);">
               <i class="fas fa-bolt" style="color: #ffc107; font-size: 16px;"></i>
             </div>`
    });

    const fastestMarker = L.marker([metrics.fastestSegment.lat, metrics.fastestSegment.lng], { icon: fastestIcon })
      .bindPopup(`<b>Fastest Speed</b><hr><strong>Speed:</strong> ${metrics.maxSpeed.toFixed(1)} km/h<br><strong>Time:</strong> ${metrics.fastestSegment.time ? metrics.fastestSegment.time.toLocaleTimeString() : 'N/A'}`);
    
    activitySpecialMarkers.addLayer(fastestMarker);
  }
}

function calculateElevationProfile(points) {
  const profile = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const distance = calculateDistance(
        points[i - 1].lat, points[i - 1].lng,
        points[i].lat, points[i].lng
      );
      cumulativeDistance += distance / 1000; // Convert to km
    }

    if (points[i].ele !== null) {
      profile.push({
        distance: cumulativeDistance,
        elevation: points[i].ele,
        lat: points[i].lat,
        lng: points[i].lng,
        time: points[i].time
      });
    }
  }

  return profile;
}

/* -------------------------
 * Tailwind Score Calculation for Activities
 * ------------------------- */
async function calculateActivityTailwindScore(points) {
  if (!points || points.length < 2) return 0;

  // Sample points along the route (similar to planning)
  const samplePoints = sampleRoutePoints(points, 6);
  let totalTailwindComponent = 0;
  let validSamples = 0;

  const weatherPromises = samplePoints.map(async (point, index) => {
    if (!point.time) return null;

    try {
      // Add delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, index * 200));
      
      const weatherData = await fetchOpenMeteoHistorical(
        point.lat, 
        point.lng, 
        point.time.toISOString().split('T')[0], // Date only
        point.time.toISOString().split('T')[0]  // Same date
      );
      
      if (weatherData && weatherData.hourly) {
        const pointWeather = findClosestWeatherData(weatherData.hourly, point.time);
        if (pointWeather && pointWeather.windSpeed && pointWeather.windDirection !== undefined) {
          // Calculate bearing to next point
          const nextIndex = Math.min(points.indexOf(point) + 10, points.length - 1);
          const nextPoint = points[nextIndex];
          
          if (nextPoint && nextPoint.lat !== point.lat && nextPoint.lng !== point.lng) {
            const bearing = computeBearing(
              { lat: point.lat, lng: point.lng },
              { lat: nextPoint.lat, lng: nextPoint.lng }
            );
            
            // Calculate tailwind component
            const windSpeed_kmh = pointWeather.windSpeed * 3.6; // Convert m/s to km/h
            const windDirection = pointWeather.windDirection;
            
            let angleDiff = windDirection - bearing;
            while (angleDiff <= -180) angleDiff += 360;
            while (angleDiff > 180) angleDiff -= 360;
            
            const tailwindComponent = windSpeed_kmh * Math.cos(angleDiff * Math.PI / 180);
            return tailwindComponent;
          }
        }
      }
    } catch (error) {
      console.error(`Tailwind calculation failed for point ${index}:`, error);
    }
    return null;
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

function updateStatsWithTailwind(tailwindScore) {
  const tailwindDisplay = document.getElementById('tailwindScoreDisplay');
  if (tailwindDisplay) {
    const tooltipText = `Average headwind (-) or tailwind (+) component during your ride. Positive values indicate wind helped you, negative values indicate wind hindered you.`;
    tailwindDisplay.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; padding: 12px; background: var(--background-color); border: 1px solid var(--border-color); border-radius: 8px;">
        <i class="fas fa-wind" style="color: var(--primary-color); font-size: 18px;"></i>
        <div>
          <strong>Tailwind Score:</strong> ${tailwindScore.toFixed(1)} km/h
          <i class="fas fa-info-circle" title="${tooltipText}" style="color: var(--text-color-light); margin-left: 4px;"></i>
        </div>
      </div>`;
  }
}

/* -------------------------
 * Historical Weather Analysis using OpenMeteo
 * ------------------------- */
async function fetchHistoricalWeather(points) {
  try {
    historicalWeatherMarkers.clearLayers();
    
    const startTime = activityData.startTime;
    const endTime = activityData.endTime;
    
    if (!startTime || !endTime) {
      throw new Error('No valid timestamps found for weather analysis');
    }

    // Sample points along the route (max 10 points to avoid API limits)
    const samplePoints = sampleRoutePoints(points, 8);
    
    document.getElementById('weatherAnalysisDisplay').innerHTML = '<span class="loading-text">Fetching historical weather data...</span>';

    // Clear existing weather layers for activity analysis
    if (typeof windLayerGroup !== 'undefined') windLayerGroup.clearLayers();
    if (typeof tempLayerGroup !== 'undefined') tempLayerGroup.clearLayers();
    if (typeof precipLayerGroup !== 'undefined') precipLayerGroup.clearLayers();

    const weatherPromises = samplePoints.map(async (point, index) => {
      try {
        // Add small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, index * 200));
        
        const weatherData = await fetchOpenMeteoHistorical(
          point.lat, 
          point.lng, 
          startTime.toISOString().split('T')[0], // Date only
          endTime.toISOString().split('T')[0]
        );
        
        if (weatherData && weatherData.hourly) {
          // Find the closest weather data to the point's timestamp
          const pointWeather = findClosestWeatherData(weatherData.hourly, point.time);
          if (pointWeather) {
            createHistoricalWeatherMarkers(point, pointWeather, index);
          }
        }
      } catch (error) {
        console.error(`Weather fetch failed for point ${index}:`, error);
      }
    });

    await Promise.all(weatherPromises);
    
    // Add weather layers to map - start with wind layer like in planning
    if (typeof windLayerGroup !== 'undefined') {
      map.addLayer(windLayerGroup);
      currentWeatherLayer = 'wind';
      updateWeatherToggleIcon();
    }
    
    document.getElementById('weatherAnalysisDisplay').innerHTML = 
      `<div style="display: flex; align-items: center; gap: 8px; padding: 12px; background: var(--background-color); border: 1px solid var(--border-color); border-radius: 8px;">
        <i class="fas fa-cloud-sun" style="color: var(--success-color); font-size: 18px;"></i>
        <div>
          <strong>Historical Weather:</strong> Weather conditions during your ride are shown on the map. Use the weather toggle to switch between wind, temperature, and precipitation views.
        </div>
      </div>`;

  } catch (error) {
    console.error('Historical weather analysis failed:', error);
    document.getElementById('weatherAnalysisDisplay').innerHTML = 
      '<div style="color: orange;"><strong>Weather Analysis:</strong> Historical weather data unavailable</div>';
  }
}

async function fetchOpenMeteoHistorical(lat, lng, startDate, endDate) {
  const url = `${CONFIG.API_URLS.OPENMETEO_HISTORICAL}?` +
    `latitude=${lat}&longitude=${lng}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation` +
    `&timezone=auto`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenMeteo API error: ${response.status}`);
  }
  
  return await response.json();
}

function sampleRoutePoints(points, maxSamples) {
  if (points.length <= maxSamples) {
    return points.filter(p => p.time); // Only return points with timestamps
  }
  
  const sampledPoints = [];
  const interval = Math.floor(points.length / maxSamples);
  
  for (let i = 0; i < points.length; i += interval) {
    if (points[i].time) {
      sampledPoints.push(points[i]);
    }
  }
  
  return sampledPoints;
}

function findClosestWeatherData(hourlyData, targetTime) {
  if (!hourlyData.time || !targetTime) return null;
  
  const targetTimestamp = targetTime.getTime();
  let closestIndex = 0;
  let minDiff = Infinity;
  
  for (let i = 0; i < hourlyData.time.length; i++) {
    const weatherTime = new Date(hourlyData.time[i]).getTime();
    const diff = Math.abs(weatherTime - targetTimestamp);
    
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  
  // Return null if the closest weather data is more than 3 hours away
  if (minDiff > 3 * 60 * 60 * 1000) return null;
  
  return {
    temperature: hourlyData.temperature_2m[closestIndex],
    humidity: hourlyData.relative_humidity_2m[closestIndex],
    windSpeed: hourlyData.wind_speed_10m[closestIndex],
    windDirection: hourlyData.wind_direction_10m[closestIndex],
    precipitation: hourlyData.precipitation[closestIndex],
    time: new Date(hourlyData.time[closestIndex])
  };
}

function createHistoricalWeatherMarkers(point, weather, index) {
  const temp = Math.round(weather.temperature);
  const windSpeed_ms = weather.windSpeed || 0; // m/s from OpenMeteo
  const windSpeed_kmh = windSpeed_ms * 3.6; // Convert to km/h
  const windDir = weather.windDirection || 0;
  const precipitation = weather.precipitation || 0;
  
  // Calculate more accurate distance from start for display
  let km = 0;
  if (activityData && activityData.points && point.time) {
    // Find the closest point in the activity data to estimate distance
    const pointIndex = activityData.points.findIndex(p => 
      Math.abs(p.lat - point.lat) < 0.001 && Math.abs(p.lng - point.lng) < 0.001
    );
    
    if (pointIndex > 0) {
      // Calculate cumulative distance to this point
      for (let i = 1; i <= pointIndex; i++) {
        const prev = activityData.points[i - 1];
        const curr = activityData.points[i];
        km += calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng) / 1000;
      }
    } else {
      // Fallback: estimate based on sample index
      const totalDistance = activityData.points.length > 1 ? 
        calculateDistance(
          activityData.points[0].lat, activityData.points[0].lng,
          activityData.points[activityData.points.length - 1].lat, 
          activityData.points[activityData.points.length - 1].lng
        ) / 1000 : 0;
      km = (index / 7) * totalDistance; // Approximate based on 8 samples
    }
  }

  // Use compass direction function from weather.js
  const directionStr = typeof degreesToCompass === 'function' ? degreesToCompass(windDir) : `${windDir}°`;

  const popupContent = `
    <b>~${km.toFixed(1)} km Mark</b><hr>
    <strong>Temp:</strong> ${temp}°C<br>
    <strong>Humidity:</strong> ${weather.humidity}%<br>
    <strong>Wind:</strong> ${windSpeed_kmh.toFixed(1)} km/h ${directionStr} (${windDir}°)<br>
    <strong>Precip:</strong> ${precipitation.toFixed(1)} mm
    <hr style="margin: 3px 0;">
    <i>Actual time: ${weather.time.toLocaleTimeString()}</i>
  `;

  // Create wind marker (same style as planning)
  const windIcon = L.divIcon({
    className: 'wind-marker',
    iconSize: [40, 40],
    iconAnchor: [20, 45],
    popupAnchor: [0, -40],
    html: `<div style="text-align:center; position: relative;">
             <div style="transform: rotate(${windDir}deg); display:inline-block; position: absolute; top: -15px; left: 12px; transform-origin: center bottom;">
               <i class="fas fa-long-arrow-alt-down" style="font-size: 20px; color: #28a745;"></i>
             </div>
             <span style="position: absolute; top: 5px; left: 0; width: 100%; font-size: 12px; font-weight: bold; color: #333;">${windSpeed_kmh.toFixed(0)}</span>
           </div>`
  });
  
  if (typeof windLayerGroup !== 'undefined') {
    windLayerGroup.addLayer(L.marker(point, { icon: windIcon }).bindPopup(popupContent));
  }

  // Create temperature marker (same style as planning)
  const tempIcon = L.divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
    html: `<div style="text-align: center; background: rgba(255,255,255,0.75); border-radius: 50%; padding: 5px; border: 1px solid #28a745; width: 40px; height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 1px 1px 3px rgba(0,0,0,0.2);">
             <i class="fas fa-thermometer-half" style="color: ${temp > 25 ? '#dc3545' : temp < 5 ? '#007bff' : '#ffc107'}; font-size: 16px; margin-bottom: 2px;"></i>
             <span style="font-weight:bold; font-size:12px; color: #333; line-height: 1;">${temp}°</span>
           </div>`
  });
  
  if (typeof tempLayerGroup !== 'undefined') {
    tempLayerGroup.addLayer(L.marker(point, { icon: tempIcon }).bindPopup(popupContent));
  }

  // Create precipitation marker (same style as planning)
  let precipIconClass = "fa-sun", precipColor = "gold";
  if (precipitation > 0.1) {
    precipIconClass = precipitation > 1 ? "fa-cloud-showers-heavy" : "fa-cloud-rain";
    precipColor = "#4682B4";
  } else if (temp < 0) {
    precipIconClass = "fa-snowflake";
    precipColor = "#ADD8E6";
  } else {
    precipIconClass = "fa-cloud";
    precipColor = "#A9A9A9";
  }

  const precipIcon = L.divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
    html: `<div style="text-align: center; background: rgba(255,255,255,0.75); border-radius: 50%; padding: 5px; border: 1px solid #28a745; width: 40px; height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 1px 1px 3px rgba(0,0,0,0.2);">
             <i class="fas ${precipIconClass}" style="color:${precipColor}; font-size: 16px; margin-bottom: 2px;"></i>
             <span style="font-size:11px; color: #333; line-height: 1;">${precipitation > 0 ? precipitation.toFixed(precipitation < 1 ? 1 : 0) + 'mm' : '-'}</span>
           </div>`
  });
  
  if (typeof precipLayerGroup !== 'undefined') {
    precipLayerGroup.addLayer(L.marker(point, { icon: precipIcon }).bindPopup(popupContent));
  }
}

/* -------------------------
 * Utility Functions
 * ------------------------- */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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