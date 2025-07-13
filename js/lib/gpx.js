/* -------------------------
 * GPX Parser Library
 * Simple GPX file parsing for route planning
 * ------------------------- */

/**
 * Parse GPX file content and extract track/route points
 * @param {string} gpxContent - XML content of GPX file
 * @returns {Array} Array of {lat, lng, ele?, time?} objects
 */
function parseGPXContent(gpxContent) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxContent, "text/xml");
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Invalid XML format');
    }
    
    let points = [];
    
    // Try to get track points first (most common for GPS tracks)
    const trkpts = Array.from(xmlDoc.getElementsByTagName('trkpt'));
    if (trkpts.length > 0) {
      points = trkpts.map(extractPointData);
    } else {
      // Fallback to route points
      const rtepts = Array.from(xmlDoc.getElementsByTagName('rtept'));
      if (rtepts.length > 0) {
        points = rtepts.map(extractPointData);
      } else {
        // Last fallback to waypoints
        const wpts = Array.from(xmlDoc.getElementsByTagName('wpt'));
        if (wpts.length > 0) {
          points = wpts.map(extractPointData);
        }
      }
    }
    
    // Filter out invalid points
    const validPoints = points.filter(point => 
      point && 
      !isNaN(point.lat) && 
      !isNaN(point.lng) && 
      point.lat >= -90 && point.lat <= 90 && 
      point.lng >= -180 && point.lng <= 180
    );
    
    return validPoints;
    
  } catch (error) {
    console.error('GPX parsing error:', error);
    throw new Error(`Failed to parse GPX file: ${error.message}`);
  }
}

/**
 * Extract point data from a GPX point element
 * @param {Element} pointElement - XML element representing a point
 * @returns {Object} Point data object
 */
function extractPointData(pointElement) {
  const lat = parseFloat(pointElement.getAttribute('lat'));
  const lng = parseFloat(pointElement.getAttribute('lon'));
  
  const point = { lat, lng };
  
  // Extract elevation if available
  const eleElement = pointElement.querySelector('ele');
  if (eleElement && eleElement.textContent) {
    const elevation = parseFloat(eleElement.textContent);
    if (!isNaN(elevation)) {
      point.ele = elevation;
      point.elevation = elevation; // Alternative property name
    }
  }
  
  // Extract timestamp if available
  const timeElement = pointElement.querySelector('time');
  if (timeElement && timeElement.textContent) {
    try {
      const timestamp = new Date(timeElement.textContent);
      if (!isNaN(timestamp.getTime())) {
        point.time = timestamp;
      }
    } catch (e) {
      // Ignore invalid timestamps
    }
  }
  
  // Extract name if available (for waypoints)
  const nameElement = pointElement.querySelector('name');
  if (nameElement && nameElement.textContent) {
    point.name = nameElement.textContent.trim();
  }
  
  return point;
}

/**
 * Simple GPX file validator
 * @param {string} gpxContent - XML content to validate
 * @returns {boolean} True if appears to be valid GPX
 */
function isValidGPX(gpxContent) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxContent, "text/xml");
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) return false;
    
    // Check for GPX root element
    const gpxElement = xmlDoc.querySelector('gpx');
    if (!gpxElement) return false;
    
    // Check for at least some points
    const hasPoints = xmlDoc.querySelector('trkpt, rtept, wpt');
    return !!hasPoints;
    
  } catch (error) {
    return false;
  }
}

/**
 * Get GPX file metadata
 * @param {string} gpxContent - XML content of GPX file
 * @returns {Object} Metadata object
 */
function getGPXMetadata(gpxContent) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxContent, "text/xml");
    
    const metadata = {};
    
    // Get basic metadata
    const metadataElement = xmlDoc.querySelector('metadata');
    if (metadataElement) {
      const nameEl = metadataElement.querySelector('name');
      if (nameEl) metadata.name = nameEl.textContent.trim();
      
      const descEl = metadataElement.querySelector('desc');
      if (descEl) metadata.description = descEl.textContent.trim();
      
      const timeEl = metadataElement.querySelector('time');
      if (timeEl) {
        try {
          metadata.time = new Date(timeEl.textContent);
        } catch (e) {
          // Ignore invalid time
        }
      }
    }
    
    // Count points
    const trkpts = xmlDoc.querySelectorAll('trkpt').length;
    const rtepts = xmlDoc.querySelectorAll('rtept').length;
    const wpts = xmlDoc.querySelectorAll('wpt').length;
    
    metadata.pointCount = {
      trackPoints: trkpts,
      routePoints: rtepts,
      waypoints: wpts,
      total: trkpts + rtepts + wpts
    };
    
    return metadata;
    
  } catch (error) {
    console.error('Error reading GPX metadata:', error);
    return {};
  }
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseGPXContent,
    extractPointData,
    isValidGPX,
    getGPXMetadata
  };
}

// Make functions available globally for browser use
if (typeof window !== 'undefined') {
  window.GPXParser = {
    parseGPXContent,
    extractPointData,
    isValidGPX,
    getGPXMetadata
  };
}