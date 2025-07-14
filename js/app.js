const CONFIG = {
  API_KEYS: {
     // WARNING: Keys exposed client-side. Secure via backend proxy in production.
     GRAPHHOPPER: '594dca35-3715-43ea-ac3b-fd23dc58808a',
     OPENWEATHER: '154dc010adbb10c0549d6d077e64b073'
  },
  API_URLS: {
     GRAPHHOPPER: 'https://graphhopper.com/api/1/route',
     OPENWEATHER_FORECAST: 'https://api.openweathermap.org/data/2.5/forecast',
     NOMINATIM_SEARCH: 'https://nominatim.openstreetmap.org/search',
     OPENMETEO_HISTORICAL: 'https://archive-api.open-meteo.com/v1/archive'
  },
  DEFAULTS: {
      AVG_SPEED: 22,
      WEATHER_POINTS: 10,
      MAP_CENTER: [51.8426, 5.8528], // Nijmegen
      MAP_ZOOM_DESKTOP: 13,
      MAP_ZOOM_MOBILE: 12,
      RANDOM_ROUTE_LENGTH: 50,
      RANDOM_ROUTE_CANDIDATES: 3,
      AUTOCOMPLETE_THRESHOLD: 3,
      AUTOCOMPLETE_DEBOUNCE: 300,
      API_STAGGER_MS: 60, // Delay between weather API calls in analyzeRoute
      TAILWIND_STAGGER_MS: 75 // Delay between weather API calls in computeTailwindScore
  },
  TAILWIND_SAMPLE_FRACTIONS: [0.25, 0.5, 0.75],
  AUTOCOMPLETE_TYPES: {
      SHORT_QUERY: 'city,town,village',
      LONG_QUERY: 'city,town,village,locality,road'
  }
};

/* -------------------------
 * Global Variables & Initialization
 * ------------------------- */
let map, trackLayer;
let waypoints = []; // L.Marker objects
let windLayerGroup = L.layerGroup();
let tempLayerGroup = L.layerGroup();
let precipLayerGroup = L.layerGroup();
let currentWeatherLayer = 'wind';
let activeButtons = {}; // Store original button content { 'buttonId': 'originalHTML' }

// --- Help Popup Elements ---
let helpButton, helpPopup, closeHelpPopup, popupOverlay;

/* -------------------------
 * API Keys & Endpoints (IMPORTANT: Hide these in production!)
 * ------------------------- */
// REMOVED OLD CONSTANTS - Now using CONFIG object above
// const GRAPHHOPPER_KEY = '594dca35-3715-43ea-ac3b-fd23dc58808a';
// const OPENWEATHER_KEY = '154dc010adbb10c0549d6d077e64b073';
// const GRAPHHOPPER_URL = 'https://graphhopper.com/api/1/route';
// const OPENWEATHER_FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';
// const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/* -------------------------
 * Map Initialization
 * ------------------------- */
function initMap() {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  map = L.map('map', { zoomControl: false }).setView(
      CONFIG.DEFAULTS.MAP_CENTER,
      isMobile ? CONFIG.DEFAULTS.MAP_ZOOM_MOBILE : CONFIG.DEFAULTS.MAP_ZOOM_DESKTOP
  );
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);

  document.getElementById('startTime').value = new Date().toISOString().slice(0, 16);

  document.getElementById('routeLengthSlider').addEventListener('input', function(e) {
    document.getElementById('routeLengthValue').textContent = e.target.value + " km";
  });

  // Setup autocomplete
  ['startLocation', 'endLocation', 'randomLocation'].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', debounce(e => handleAutocomplete(e.target.value, input), CONFIG.DEFAULTS.AUTOCOMPLETE_DEBOUNCE));
      input.addEventListener('focusout', e => {
        // Use timeout to allow clicking on autocomplete items
        setTimeout(() => {
          const listForThisInput = input.parentNode.querySelector('.autocomplete-items');
           // Check if focus moved to an element within the autocomplete list *for this input*
           const relatedTargetIsAutocompleteItem = e.relatedTarget && e.relatedTarget.closest('.autocomplete-items');
          if (!relatedTargetIsAutocompleteItem || (relatedTargetIsAutocompleteItem && relatedTargetIsAutocompleteItem !== listForThisInput)) {
             if(listForThisInput) listForThisInput.remove();
          }
        }, 150);
      });
    }
  });

  // GPX file handling
  document.getElementById('gpxFile').addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
       document.getElementById('fileName').textContent = e.target.files[0].name;
       // Trigger processing via the button's function to handle loading state
       processInput(document.getElementById('loadGpxButton').id);
    } else {
       document.getElementById('fileName').textContent = "No file selected";
    }
  });

  // Map interaction
  map.on('contextmenu', handleMapContextMenu);
  setupLongPressHandler();

  // Window resize
  window.addEventListener('resize', handleResize);

  // Show default tab
  showTab('plan', document.getElementById('tabPlanBtn'));

  // Global click listener for autocomplete (alternative closing mechanism)
  document.addEventListener('click', function(event) {
    const isClickInsideInput = event.target.matches('#startLocation, #endLocation, #randomLocation');
    const isClickInsideAutocomplete = event.target.closest('.autocomplete-items');
    if (!isClickInsideInput && !isClickInsideAutocomplete) {
       document.querySelectorAll('.autocomplete-items').forEach(el => el.remove());
    }
  });

  // Store original button states
  [
    'generateRouteButton', 'generateRandomButton', 'loadGpxButton', 
    'saveGpxButton', 'clearMapButton', 'loadActivityButton', 
    'analyzeActivityButton', 'planDemoButton', 'analyzeDemoButton', 'randomDemoButton'
  ].forEach(id => {
     const btn = document.getElementById(id);
     if (btn) activeButtons[id] = btn.innerHTML;
  });

  // Activity GPX file handling
  document.getElementById('activityGpxFile').addEventListener('change', function(e) {
    const analyzeBtn = document.getElementById('analyzeActivityButton');
    if (e.target.files.length > 0) {
       document.getElementById('activityFileName').textContent = e.target.files[0].name;
       analyzeBtn.disabled = false;
    } else {
       document.getElementById('activityFileName').textContent = "No file selected";
       analyzeBtn.disabled = true;
    }
  });

  // --- Initialize Help Popup ---
  helpButton = document.getElementById('helpButton');
  helpPopup = document.getElementById('helpPopup');
  closeHelpPopup = document.getElementById('closeHelpPopup');
  popupOverlay = document.getElementById('popupOverlay');

  if (helpButton && helpPopup && closeHelpPopup && popupOverlay) {
      helpButton.addEventListener('click', toggleHelpPopup);
      closeHelpPopup.addEventListener('click', hideHelpPopup);
      popupOverlay.addEventListener('click', hideHelpPopup); // Close when clicking overlay
  } else {
      console.error("Help popup elements not found!");
  }

  // Initial resize handler call
  handleResize();

  // Initialize welcome modal
  initWelcomeModal();
  
  // Initialize settings
  initSettings();
}

/* -------------------------
 * Settings Management
 * ------------------------- */
function initSettings() {
  // Animation toggle
  const animationToggle = document.getElementById('showAnimations');
  if (animationToggle) {
    // Load saved setting
    const savedAnimations = localStorage.getItem('showAnimations');
    if (savedAnimations !== null) {
      animationToggle.checked = savedAnimations === 'true';
    }
    
    // Apply animation setting
    updateAnimationSetting(animationToggle.checked);
    
    // Listen for changes
    animationToggle.addEventListener('change', (e) => {
      localStorage.setItem('showAnimations', e.target.checked);
      updateAnimationSetting(e.target.checked);
    });
  }
  
  // Auto-hide menu toggle
  const autoHideToggle = document.getElementById('autoHideMenu');
  if (autoHideToggle) {
    // Load saved setting
    const savedAutoHide = localStorage.getItem('autoHideMenu');
    if (savedAutoHide !== null) {
      autoHideToggle.checked = savedAutoHide === 'true';
    }
    
    // Listen for changes
    autoHideToggle.addEventListener('change', (e) => {
      localStorage.setItem('autoHideMenu', e.target.checked);
    });
  }
}

function updateAnimationSetting(enabled) {
  const body = document.body;
  if (enabled) {
    body.classList.remove('no-animations');
  } else {
    body.classList.add('no-animations');
  }
}

function shouldAutoHideMenu() {
  const autoHideToggle = document.getElementById('autoHideMenu');
  return autoHideToggle ? autoHideToggle.checked : true; // Default to true
}

/* -------------------------
 * Welcome Modal Functions
 * ------------------------- */
function showWelcomeModal() {
  const welcomeOverlay = document.getElementById('welcomeOverlay');
  if (welcomeOverlay) {
    welcomeOverlay.classList.remove('hidden');
  }
}

function hideWelcomeModal() {
  const welcomeOverlay = document.getElementById('welcomeOverlay');
  if (welcomeOverlay) {
    welcomeOverlay.classList.add('hidden');
  }
}

function initWelcomeModal() {
  const welcomeOverlay = document.getElementById('welcomeOverlay');
  const startPlanningButton = document.getElementById('startPlanningButton');
  const startAnalyzingButton = document.getElementById('startAnalyzingButton');
  const skipWelcomeButton = document.getElementById('skipWelcomeButton');
  const planDemoButton = document.getElementById('planDemoButton');
  const analyzeDemoButton = document.getElementById('analyzeDemoButton');
  const startRandomButton = document.getElementById('startRandomButton');
  const randomDemoButton = document.getElementById('randomDemoButton');

  // For demonstration, we always show the welcome modal.
  if (welcomeOverlay) {
    setTimeout(() => showWelcomeModal(), 500);
  }

  // New Demo Buttons
  if (planDemoButton) {
    planDemoButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent card click event
      loadDemo('plan');
    });
  }
  if (analyzeDemoButton) {
    analyzeDemoButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent card click event
      loadDemo('analyze');
    });
  }
  if (randomDemoButton) {
    randomDemoButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent card click event
      loadDemo('random');
    });
  }

  // Start planning button
  if (startPlanningButton) {
    startPlanningButton.addEventListener('click', () => {
      hideWelcomeModal();
      showTab('plan', document.getElementById('tabPlanBtn'));
      showSubTab('generateRoute', document.getElementById('subTabGenerateBtn'));
      setTimeout(() => document.getElementById('startLocation').focus(), 300);
    });
  }

  // Start analyzing button
  if (startAnalyzingButton) {
    startAnalyzingButton.addEventListener('click', () => {
      hideWelcomeModal();
      showTab('analyze', document.getElementById('tabAnalyzeBtn'));
      setTimeout(() => {
        const uploadSection = document.querySelector('#analyze .section');
        if (uploadSection) {
          uploadSection.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
          setTimeout(() => {
            uploadSection.style.backgroundColor = '';
          }, 2000);
        }
      }, 300);
    });
  }

  // Start random button
  if (startRandomButton) {
    startRandomButton.addEventListener('click', () => {
      hideWelcomeModal();
      showTab('plan', document.getElementById('tabPlanBtn'));
      showSubTab('generateRandom', document.getElementById('subTabGenerateBtn'));
    });
  }

  // Skip button
  if (skipWelcomeButton) {
    skipWelcomeButton.addEventListener('click', () => {
      hideWelcomeModal();
    });
  }
}

/* -------------------------
 * Loading State Management
 * ------------------------- */
function showLoading(triggeringButtonId, loadingText = "Loading...") {
  // Disable all action buttons and store original content if not already stored
  Object.keys(activeButtons).forEach(id => {
     const btn = document.getElementById(id);
     if (btn) {
        btn.disabled = true;
        // If this is the button that triggered the action, show spinner and text
        if (id === triggeringButtonId) {
           btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
        }
     }
  });
  document.getElementById('errorDisplay').innerHTML = ''; // Clear previous errors
  console.log(loadingText);
}

function hideLoading() {
  Object.keys(activeButtons).forEach(id => {
     const btn = document.getElementById(id);
     if (btn) {
        btn.disabled = false;
        // Check if original content exists before restoring
        if (activeButtons[id]) {
            btn.innerHTML = activeButtons[id];
        }
        // Special case: keep analyze button disabled if no file is selected
        if (id === 'analyzeActivityButton' && !document.getElementById('activityGpxFile').files.length) {
            btn.disabled = true;
        }
     }
  });
}

/* -------------------------
 * Menu Toggle Functions
 * ------------------------- */
function handleResize() {
   // Invalidate map size to ensure it redraws correctly
   map.invalidateSize();

   const controls = document.getElementById('controls');
   const menuToggle = document.getElementById('menuToggle');
   const mapElement = document.getElementById('map');

   if (window.innerWidth > 600) { // Desktop view
      // Reset mobile-specific styles that might interfere
      mapElement.style.height = ''; // Allow CSS to control height

      if (!controls.classList.contains('hidden')) {
         mapElement.style.left = "320px";
         menuToggle.style.left = "335px";
      } else {
         mapElement.style.left = "0";
         menuToggle.style.left = "15px"; // Position when menu hidden
      }
   } else { // Mobile view
      // Reset desktop-specific styles
      mapElement.style.left = "0";
      menuToggle.style.left = ""; // Let CSS handle positioning

      // Ensure map takes up remaining space if controls are visible
      // This might need adjustment based on exact flex behavior desired
       mapElement.style.height = `calc(100vh - ${controls.offsetHeight}px)`;
   }
}

function hideMenu() {
  const controls = document.getElementById('controls');
  const menuToggle = document.getElementById('menuToggle');
  const mapElement = document.getElementById('map');

  controls.classList.add('hidden');
  menuToggle.innerText = "Show Menu";

  if (window.innerWidth > 600) { // Desktop
    mapElement.style.left = "0";
    menuToggle.style.left = "15px";
    // Delay invalidateSize until after the transition completes
    setTimeout(() => { map.invalidateSize({ pan: false }); }, 310);
  } else { // Mobile
     // Map should expand to fill space as controls slide up
     mapElement.style.height = '100vh'; // Expand map vertically
    // Delay invalidateSize slightly
    setTimeout(() => { map.invalidateSize({ pan: false }); }, 50);
  }
}

function showMenu() {
  const controls = document.getElementById('controls');
  const menuToggle = document.getElementById('menuToggle');
  const mapElement = document.getElementById('map');

  controls.classList.remove('hidden');
  menuToggle.innerText = "Hide Menu";

  if (window.innerWidth > 600) { // Desktop
     mapElement.style.left = "320px";
     menuToggle.style.left = "335px";
  } else { // Mobile
     mapElement.style.left = "0";
     // Map height needs to be recalculated after controls are shown and rendered
     // Use a small delay to allow rendering
     setTimeout(() => {
         mapElement.style.height = `calc(100vh - ${controls.offsetHeight}px)`;
         map.invalidateSize({ pan: false });
     }, 50); // Adjust delay if needed
  }
  // Delay invalidateSize for desktop transition
   if (window.innerWidth > 600) {
       setTimeout(() => { map.invalidateSize({ pan: false }); }, 310);
   }
}

function toggleMenu() {
  const controls = document.getElementById('controls');
  if (controls.classList.contains('hidden')) { showMenu(); } else { hideMenu(); }
}

/* -------------------------
 * Tab Switching Functions (Legacy - Enhanced versions below)
 * ------------------------- */

/* -------------------------
 * Autocomplete Function
 * ------------------------- */
function debounce(func, timeout = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

async function handleAutocomplete(query, inputField) {
  const parentGroup = inputField.parentNode;
  const existingList = parentGroup.querySelector('.autocomplete-items');
  if (existingList) existingList.remove();
  if (query.length < CONFIG.DEFAULTS.AUTOCOMPLETE_THRESHOLD) return;

  const loading = document.createElement('div');
  loading.className = 'autocomplete-items';
  loading.innerHTML = '<div class="autocomplete-item loading-text"><i>Searching...</i></div>';
  parentGroup.appendChild(loading);

  try {
    let typeParam = query.length < 6 ? CONFIG.AUTOCOMPLETE_TYPES.SHORT_QUERY : CONFIG.AUTOCOMPLETE_TYPES.LONG_QUERY;
    const bounds = map.getBounds();
    const viewbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    const url = `${CONFIG.API_URLS.NOMINATIM_SEARCH}?format=json&limit=5&q=${encodeURIComponent(query)}&addressdetails=1&accept-language=en&dedupe=1&polygon_text=0&type=${typeParam}&viewbox=${viewbox}`;

    const response = await fetch(url);
    const data = await response.json();
    loading.remove(); // Remove loading indicator

    // Double check if input field is still focused and has text
    if (document.activeElement !== inputField || inputField.value.length < CONFIG.DEFAULTS.AUTOCOMPLETE_THRESHOLD) return;

    // Remove any list created while waiting for fetch
    const currentList = parentGroup.querySelector('.autocomplete-items');
    if (currentList) currentList.remove();

    // Filter out less relevant types (keeping administrative for potential city results)
    const filteredResults = data.filter(item => !['waterway', 'house', 'pedestrian', 'hotel', 'platform', 'station'].includes(item.type));

    if (filteredResults.length === 0) {
       const noResult = document.createElement('div');
       noResult.className = 'autocomplete-items';
       noResult.innerHTML = '<div class="autocomplete-item loading-text"><i>No results found</i></div>'; // Generic message now
       parentGroup.appendChild(noResult);
       return;
    }

    const list = document.createElement('div');
    list.className = 'autocomplete-items';
    filteredResults.forEach(item => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      const mainText = document.createElement('div');
      // Use item.name if available and different from the first part of display_name, otherwise use first part
      mainText.textContent = (item.name && item.display_name.toLowerCase().startsWith(item.name.toLowerCase())) ? item.name : item.display_name.split(',')[0];

      const subText = document.createElement('div');
      let addressParts = [];
      if (item.address) {
         // Build a sensible address string, avoiding repetition with mainText
         if(item.address.road && item.address.road.toLowerCase() !== mainText.textContent.toLowerCase()) addressParts.push(item.address.road);
         if(item.address.suburb && item.address.suburb.toLowerCase() !== mainText.textContent.toLowerCase()) addressParts.push(item.address.suburb);

         let cityOrTown = item.address.city || item.address.town || item.address.village;
         if(cityOrTown && cityOrTown.toLowerCase() !== mainText.textContent.toLowerCase() && !addressParts.some(p => p.toLowerCase() === cityOrTown.toLowerCase())) addressParts.push(cityOrTown);

         // Add country if available
         if(item.address.country) addressParts.push(item.address.country);
      }
      // Fallback if address parts are sparse
      subText.textContent = addressParts.length > 0 ? addressParts.slice(0, 2).join(', ') : item.display_name.split(',').slice(1).join(',').trim();

      div.appendChild(mainText);
      if (subText.textContent) div.appendChild(subText); // Only add subtext if it has content

      // Use 'mousedown' to register click before 'focusout' hides the list
      div.addEventListener('mousedown', () => {
        inputField.value = item.display_name; // Use full display name for clarity
        list.remove();
      });
      list.appendChild(div);
    });
    parentGroup.appendChild(list);
  } catch (error) {
    const currentLoading = parentGroup.querySelector('.autocomplete-items');
    if (currentLoading) currentLoading.remove(); // Ensure loading is removed on error
    console.error('Address suggestions unavailable:', error);
    // Optionally show a temporary error in the list
    const errorList = document.createElement('div');
    errorList.className = 'autocomplete-items';
    errorList.innerHTML = '<div class="autocomplete-item error-message" style="font-size: 1em;"><i>Suggestions failed</i></div>';
    parentGroup.appendChild(errorList);
    setTimeout(() => errorList.remove(), 2500); // Auto-hide error
  }
}

/* -------------------------
 * Error Handling
 * ------------------------- */
function showError(message) {
  const errorDiv = document.getElementById('errorDisplay');
  if (errorDiv) {
     // Prepend warning icon for visual cue
     errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
  }
  console.error(message); // Log error to console for debugging
}

/* -------------------------
 * Help Popup Functions
 * ------------------------- */
function showHelpPopup() {
    if (helpPopup && popupOverlay) {
        popupOverlay.classList.remove('hidden');
        helpPopup.classList.remove('hidden');
        // Optional: Scroll popup to top when opened
        helpPopup.scrollTop = 0;
    }
}

function hideHelpPopup() {
    if (helpPopup && popupOverlay) {
        popupOverlay.classList.add('hidden');
        helpPopup.classList.add('hidden');
    }
}

function toggleHelpPopup() {
    if (helpPopup && helpPopup.classList.contains('hidden')) {
        showHelpPopup();
    } else {
        hideHelpPopup();
    }
}

/* -------------------------
 * Demo Route Function
 * ------------------------- */
async function loadDemo(mode) {
  const demoFile = 'Demo/From_Nijmegen_to_Maastricht.gpx';
  const buttonId = mode === 'plan' ? 'planDemoButton' : mode === 'analyze' ? 'analyzeDemoButton' : 'randomDemoButton';
  showLoading(buttonId, "Loading Demo...");
  hideWelcomeModal();

  try {
    if (mode === 'random') {
      // For random demo, generate a random route instead of loading GPX
      showTab('plan', document.getElementById('tabPlanBtn'));
      showSubTab('generateRandom', document.getElementById('subTabRandomBtn'));
      
      // Set a demo location and trigger random route generation
      document.getElementById('randomLocation').value = 'Nijmegen, Netherlands';
      document.getElementById('routeLengthSlider').value = '75';
      document.getElementById('routeLengthValue').textContent = '75 km';
      
      // Automatically trigger random route generation
      await bestRandomRouteGenerator('randomDemoButton');
      
    } else {
      // Original demo logic for plan and analyze modes
      const response = await fetch(demoFile);
      if (!response.ok) {
        throw new Error(`Could not fetch demo file: ${response.statusText}`);
      }
      const gpxText = await response.text();
      const file = new File([gpxText], "From_Nijmegen_to_Maastricht.gpx", { type: "application/gpx+xml" });

      clearRouteData();

      if (mode === 'plan') {
        showTab('plan', document.getElementById('tabPlanBtn'));
        const points = await parseGPX(file);
        if (!points || points.length < 2) throw new Error("Demo GPX file contains insufficient points.");
        
        trackLayer = L.polyline(points, { className: 'route-line' }).addTo(map);
        map.fitBounds(trackLayer.getBounds(), { padding: [30, 30] });
        
        L.marker(points[0], { icon: startIcon, interactive: false }).addTo(map);
        L.marker(points[points.length - 1], { icon: endIcon, interactive: false }).addTo(map);
        waypoints = [];
        
        await analyzeRoute(points);
        document.getElementById('fileName').textContent = file.name;

      } else if (mode === 'analyze') {
        showTab('analyze', document.getElementById('tabAnalyzeBtn'));
        
        // Simulate file input
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        const fileInput = document.getElementById('activityGpxFile');
        fileInput.files = dataTransfer.files;
        
        // Manually trigger the change event logic
        document.getElementById('activityFileName').textContent = file.name;
        document.getElementById('analyzeActivityButton').disabled = false;
        
        // Automatically trigger analysis
        await analyzeActivity('analyzeActivityButton');
      }
    }

    if (window.innerWidth <= 600 && shouldAutoHideMenu()) {
      hideMenu();
    }

  } catch (error) {
    showError(`Demo route failed to load: ${error.message}`);
    document.getElementById('statsContent').innerHTML = 'Demo route loading failed.';
  } finally {
    hideLoading();
  }
}

/* -------------------------
 * Enhanced Animation Functions
 * ------------------------- */
function animateStatsUpdate() {
  const statsBox = document.getElementById('stats');
  if (statsBox) {
    statsBox.classList.add('updating');
    setTimeout(() => {
      statsBox.classList.remove('updating');
      statsBox.classList.add('updated');
      setTimeout(() => statsBox.classList.remove('updated'), 500);
    }, 300);
  }
}

/* -------------------------
 * Enhanced Tab Functions with Animations
 * ------------------------- */
function showTab(tabId, buttonElement) {
  const contents = document.getElementsByClassName('tab-content');
  for (let i = 0; i < contents.length; i++) {
    contents[i].style.display = 'none';
  }
  
  const targetContent = document.getElementById(tabId);
  if (targetContent) {
    targetContent.style.display = 'block';
    // Trigger reflow to ensure animation plays
    targetContent.offsetHeight;
  }
  
  const buttons = document.querySelectorAll('.tabs button');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (buttonElement) {
     buttonElement.classList.add('active');
  }
  
  // Update stats title based on active tab
  const statsTitle = document.getElementById('statsTitle');
  if (tabId === 'analyze') {
    statsTitle.textContent = 'Activity Analysis';
  } else {
    statsTitle.textContent = 'Statistics & Weather';
  }
  
  // Clear any lingering autocomplete lists when switching tabs
  document.querySelectorAll('.autocomplete-items').forEach(el => el.remove());
}

function showSubTab(subTabId, buttonElement) {
  const contents = document.getElementsByClassName('sub-tab-content');
  for (let i = 0; i < contents.length; i++) {
    contents[i].style.display = 'none';
  }
  
  const targetContent = document.getElementById(subTabId);
  if (targetContent) {
    targetContent.style.display = 'block';
    // Trigger reflow to ensure animation plays
    targetContent.offsetHeight;
  }
  
  const buttons = document.querySelectorAll('.sub-tabs button');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (buttonElement) {
     buttonElement.classList.add('active');
  }
  // Clear any lingering autocomplete lists when switching sub-tabs
  document.querySelectorAll('.autocomplete-items').forEach(el => el.remove());
}

// Initialize the map when the window loads
window.onload = initMap; 