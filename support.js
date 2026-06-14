function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + 
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findClosestShapePointIndex(stopLat, stopLon, shapePoints) {
  if (!shapePoints || shapePoints.length === 0) return -1;
  let minDist = Infinity;
  let closestIdx = -1;
  for (let i = 0; i < shapePoints.length; i++) {
    const pt = shapePoints[i];
    const dist = haversineDistance(stopLat, stopLon, pt.lat, pt.lon);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }
  return closestIdx;
}

function getDistanceBetweenShapePoints(shapePoints, fromIdx, toIdx) {
  if (!shapePoints || fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) return 0;
  
  let totalDist = 0;
  for (let i = fromIdx; i < toIdx; i++) {
    const p1 = shapePoints[i];
    const p2 = shapePoints[i + 1];
    totalDist += haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
  }
  return totalDist;
}

async function generateSubshapesForShapeId(shapeId) {
  // Access globals from main.js
  const globalTrips = typeof window !== 'undefined' ? window.trips : [];
  const globalStopsById = typeof window !== 'undefined' ? window.stopsById : new Map();
  const globalShapesById = typeof window !== 'undefined' ? window.shapesById : {};
  const globalShapeIdToDistance = typeof window !== 'undefined' ? window.shapeIdToDistance : {};

  if (!globalTrips || !globalStopsById || !globalShapesById) {
    console.error('GTFS data not loaded');
    return [];
  }

  // Find first trip with this shapeId
  const trip = globalTrips.find(t => t.shape_id && t.shape_id.trim() === shapeId);
  if (!trip) {
    console.error(`No trip found with shape_id: ${shapeId}`);
    return [];
  }

  // Get the full shape
  const fullShape = globalShapesById[shapeId];
  if (!fullShape || fullShape.length === 0) {
    console.error(`No shape found for shape_id: ${shapeId}`);
    return [];
  }

  // Fetch stop times for this trip from worker using the existing requestFilteredStopTimesFromWorker
  let stopTimesForTrip = [];
  try {
    stopTimesForTrip = await window.requestFilteredStopTimesFromWorker([trip.trip_id]);
    stopTimesForTrip = stopTimesForTrip.filter(st => st.stop_id);
  } catch (err) {
    console.error(`Failed to fetch stop times for trip_id ${trip.trip_id}:`, err);
    return [];
  }

  if (stopTimesForTrip.length === 0) {
    console.error(`No stop times found for trip_id: ${trip.trip_id}`);
    return [];
  }

  // Sort by stop_sequence to ensure order
  stopTimesForTrip.sort((a, b) => (parseInt(a.stop_sequence) || 0) - (parseInt(b.stop_sequence) || 0));

  // Generate subshapes for each consecutive stop pair
  const subshapes = [];
  
  for (let i = 0; i < stopTimesForTrip.length - 1; i++) {
    const currentStopTime = stopTimesForTrip[i];
    const nextStopTime = stopTimesForTrip[i + 1];
    
    // stopsById is a Map, so use .get() method; fallback to bracket notation if plain object
    const originStop = globalStopsById.get ? globalStopsById.get(currentStopTime.stop_id) : globalStopsById[currentStopTime.stop_id];
    const destStop = globalStopsById.get ? globalStopsById.get(nextStopTime.stop_id) : globalStopsById[nextStopTime.stop_id];

    if (!originStop || !destStop) continue;

    let startIdx, endIdx;

    // For first stop, use first shape point
    if (i === 0) {
      startIdx = 0;
    } else {
      startIdx = findClosestShapePointIndex(originStop.lat, originStop.lon, fullShape);
      if (startIdx < 0) startIdx = 0;
    }

    // For last stop, use last shape point; otherwise find closest
    if (i === stopTimesForTrip.length - 2) {
      endIdx = fullShape.length - 1;
    } else {
      endIdx = findClosestShapePointIndex(destStop.lat, destStop.lon, fullShape);
      if (endIdx < 0) endIdx = fullShape.length - 1;
      // Ensure we don't go backwards, but at least past the start
      if (endIdx <= startIdx) endIdx = Math.min(startIdx + 1, fullShape.length - 1);
    }

    // Extract subshape coordinates
    const subshapeCoords = [];
    for (let j = startIdx; j <= endIdx; j++) {
      subshapeCoords.push({
        lat: fullShape[j].lat,
        lon: fullShape[j].lon
      });
    }

    // Calculate distance (reusing logic from analysis.js shapeDistance function)
    let distance = 0;
    
    // Check if shape has non-zero shape_dist_traveled values
    const traveledValues = fullShape
      .map(pt => pt.shape_dist_traveled)
      .filter(val => val !== undefined && val !== null);
    const hasValidDistanceData = traveledValues.some(val => val > 0);
    
    if (hasValidDistanceData) {
      // Use shape_dist_traveled difference
      const startDistTraveled = fullShape[startIdx].shape_dist_traveled || 0;
      const endDistTraveled = fullShape[endIdx].shape_dist_traveled || 0;
      distance = Math.abs(endDistTraveled - startDistTraveled);
    } else {
      // Calculate using Haversine (returns meters), then convert to km
      const distanceMeters = getDistanceBetweenShapePoints(fullShape, startIdx, endIdx);
      distance = distanceMeters * 0.001;  // Convert meters to km
    }

    subshapes.push({
      origin_station: originStop.name,
      destination_station: destStop.name,
      distance: Number(distance.toFixed(3)),
      coordinates: subshapeCoords
    });
  }

  console.log(`[GTFS] SubShapes for ${shapeId}:`, subshapes);
  return subshapes;
}

async function generateAllSubshapes(statsRows) {
  if (!statsRows || statsRows.length === 0) {
    console.error('No statistics rows available to process');
    return [];
  }

  // Get unique shape IDs from stats rows
  const uniqueShapeIds = [...new Set(statsRows.map(row => row.shape_id))];
  console.log(`[GTFS] Processing ${uniqueShapeIds.length} unique shapes...`);

  // Track deduplicated subshapes using a Set with key "originName|destinationName"
  const seenPairs = new Set();
  const allSubshapes = [];

  // Process each shape
  for (let i = 0; i < uniqueShapeIds.length; i++) {
    const shapeId = uniqueShapeIds[i];
    try {
      console.log(`[GTFS] Generating subshapes for shape ${i + 1}/${uniqueShapeIds.length}: ${shapeId}`);
      const subshapes = await generateSubshapesForShapeId(shapeId);

      // Deduplicate and add
      for (const subshape of subshapes) {
        const pairKey = `${subshape.origin_station}|${subshape.destination_station}`;
        if (seenPairs.has(pairKey)) {
          console.log(`[GTFS] Duplicate detected: ${subshape.origin_station} → ${subshape.destination_station}`);
        } else {
          seenPairs.add(pairKey);
          allSubshapes.push(subshape);
        }
      }
    } catch (err) {
      console.error(`[GTFS] Error processing shape ${shapeId}:`, err);
    }
  }

  console.log(`[GTFS] Generated ${allSubshapes.length} unique subshapes (before deduplication, processed ${uniqueShapeIds.length} shapes)`);
  return allSubshapes;
}

function downloadSubshapesJSON(subshapes) {
  if (!subshapes || subshapes.length === 0) {
    alert('No subshapes to download');
    return;
  }

  const jsonData = JSON.stringify(subshapes, null, 2);
  const blob = new Blob([jsonData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `subshapes_${new Date().getTime()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`[GTFS] Downloaded ${subshapes.length} subshapes to JSON`);
}

/**
 * Exports a timetable (schedule) for all trips on a selected route and service date.
 * 
 * Usage: Call this from browser console as exportTimetable()
 * 
 * Requirements:
 * - A single route must be selected in Route Name dropdown
 * - A single service date/ID must be selected in Service-Date or Service Pattern ID dropdown
 * - Will load missing stop times automatically
 * - Returns: void (logs errors to console if any)
 * - Side effect: Triggers automatic download of JSON file
 */
async function exportTimetable() {
  try {
    // Basic checks
    if (!window.trips) {
      console.error('[exportTimetable] GTFS data not loaded: window.trips is missing.');
      return;
    }
    if (!window.requestFilteredStopTimesFromWorker) {
      console.error('[exportTimetable] GTFS worker request API not available.');
      return;
    }

    // Ensure a single route is selected (export is per-route)
    const routeShortNameSelect = document.getElementById('routeShortNameSelect');
    if (!routeShortNameSelect) {
      console.error('[exportTimetable] Route Name dropdown not found.');
      return;
    }
    const selectedRoutes = Array.from(routeShortNameSelect.selectedOptions).map(o => o.value);
    if (selectedRoutes.length !== 1) {
      console.error('[exportTimetable] Select exactly ONE route in Route Name before exporting.');
      return;
    }
    const selectedRouteKey = selectedRoutes[0];

    // Mirror Play Animation: run the same filtering pass to determine the trips to export
    // This uses the UI selections (route type, route name, service-date or service id) exactly like filterTrips()
    if (typeof filterTrips !== 'function') {
      console.error('[exportTimetable] filterTrips() not available in global scope.');
      return;
    }

    await filterTrips(false); // useAllServiceDates = false to match Play Animation filtering

    const allFiltered = window.filteredTrips || filteredTrips || [];
    const tripsToExport = allFiltered.filter(t => t.route && `${t.route.route_short_name}-${t.route.route_long_name}` === selectedRouteKey);

    if (!tripsToExport.length) {
      console.error(`[exportTimetable] No trips found for selected route '${selectedRouteKey}' with current filters.`);
      return;
    }

    console.log(`[exportTimetable] Preparing to export ${tripsToExport.length} trips for route ${selectedRouteKey}`);

    // Load missing stop_times the same way Update Map does
    window.stopTimes = window.stopTimes || [];
    const haveTrips = new Set(window.stopTimes.map(st => String(st.trip_id)));
    const missingTripIds = tripsToExport.filter(t => !haveTrips.has(String(t.trip_id))).map(t => t.trip_id);

    if (missingTripIds.length > 0) {
      try {
        const newStopTimes = await requestFilteredStopTimesFromWorker(missingTripIds);
        window.stopTimes = window.stopTimes.concat(newStopTimes);
        console.log(`[exportTimetable] Loaded ${newStopTimes.length} stop times for ${missingTripIds.length} trips.`);
      } catch (err) {
        console.error('[exportTimetable] Failed to load stop times:', err);
        return;
      }
    }

    // Build timetable JSON from tripsToExport
    const timetableData = {
      route_id: tripsToExport[0].route_id,
      route_short_name: tripsToExport[0].route.route_short_name,
      route_long_name: tripsToExport[0].route.route_long_name,
      service_ids: [...new Set(tripsToExport.map(t => t.service_id))],
      export_timestamp: new Date().toISOString(),
      trips: []
    };

    for (const trip of tripsToExport) {
      const tripStopTimes = window.stopTimes
        .filter(st => st.trip_id === trip.trip_id)
        .sort((a, b) => (parseInt(a.stop_sequence) || 0) - (parseInt(b.stop_sequence) || 0));

      if (!tripStopTimes.length) {
        console.warn(`[exportTimetable] Skipping trip ${trip.trip_id} - no stop times available.`);
        continue;
      }

      timetableData.trips.push({
        trip_id: trip.trip_id,
        route_id: trip.route_id,
        block_id: trip.block_id || null,
        stops: tripStopTimes.map(st => {
          const stopsById = window.stopsById || null;
          let stopName = null;
          if (stopsById && typeof stopsById.get === 'function') {
            const s = stopsById.get(st.stop_id);
            stopName = s ? s.name : null;
          } else if (Array.isArray(window.stops)) {
            const s = window.stops.find(x => x.id === st.stop_id);
            stopName = s ? s.name : null;
          }
          return {
            stop_name: stopName || st.stop_id,
            stop_sequence: st.stop_sequence,
            arrival_time: st.arrival_time || null,
            departure_time: st.departure_time || null
          };
        })
      });
    }

    const jsonString = JSON.stringify(timetableData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const serviceIdStr = timetableData.service_ids.join('-') || 'nosvc';
    const filename = `timetable_${selectedRouteKey.replace(/[^a-zA-Z0-9_-]/g, '_')}_${serviceIdStr}_${Date.now()}.json`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[exportTimetable] Exported ${timetableData.trips.length} trips to ${filename}`);

  } catch (err) {
    console.error('[exportTimetable] Unexpected error:', err);
  }
}

/**
 * Temporary subshape visualization state
 * Stores reference to the temp layer and original opacity values
 */
let temporarySubshapeLayer = null;
let originalShapesOpacity = {}; // Track original opacity of each shape for restoration

/**
 * Generates and visualizes a subshape between two specific stations on a given shape route.
 * 
 * Usage: Call from browser console as:
 *   generateSubshapeByStations(shapeId, originStationName, destinationStationName)
 * 
 * Parameters:
 * - shapeId: The shape_id to use (string)
 * - originStationName: Name of the origin station (string) - will find closest shape point
 * - destinationStationName: Name of the destination station (string) - will find closest shape point
 * 
 * Returns: Subshape object with { origin_station, destination_station, distance, coordinates }
 * 
 * Side effects:
 * - Hides all other shapes visually (opacity 0.1)
 * - Displays the subshape as a red polyline on the map
 * - Temp visualization persists until user changes filters or calls clearTemporarySubshape()
 */
async function generateSubshapeByStations(shapeId, originStationName, destinationStationName) {
  try {
    // Access globals
    const globalStopsById = typeof window !== 'undefined' ? window.stopsById : new Map();
    const globalShapesById = typeof window !== 'undefined' ? window.shapesById : {};
    const globalShapesLayer = typeof window !== 'undefined' ? window.shapesLayer : null;
    const globalMap = typeof window !== 'undefined' ? window.map : null;

    if (!globalStopsById || !globalShapesById || !globalShapesLayer || !globalMap) {
      console.error('[generateSubshapeByStations] GTFS data or map not loaded');
      return null;
    }

    // Clear any existing temporary subshape first
    clearTemporarySubshape();

    // Get the full shape
    const fullShape = globalShapesById[shapeId];
    if (!fullShape || fullShape.length === 0) {
      console.error(`[generateSubshapeByStations] No shape found for shape_id: ${shapeId}`);
      return null;
    }

    // Find origin station by name
    let originStop = null;
    if (globalStopsById.get) {
      // stopsById is a Map
      for (const [, stop] of globalStopsById) {
        if (stop.name === originStationName) {
          originStop = stop;
          break;
        }
      }
    } else {
      // stopsById is a plain object
      for (const key in globalStopsById) {
        if (globalStopsById[key].name === originStationName) {
          originStop = globalStopsById[key];
          break;
        }
      }
    }

    if (!originStop) {
      console.error(`[generateSubshapeByStations] Origin station not found: ${originStationName}`);
      return null;
    }

    // Find destination station by name
    let destStop = null;
    if (globalStopsById.get) {
      // stopsById is a Map
      for (const [, stop] of globalStopsById) {
        if (stop.name === destinationStationName) {
          destStop = stop;
          break;
        }
      }
    } else {
      // stopsById is a plain object
      for (const key in globalStopsById) {
        if (globalStopsById[key].name === destinationStationName) {
          destStop = globalStopsById[key];
          break;
        }
      }
    }

    if (!destStop) {
      console.error(`[generateSubshapeByStations] Destination station not found: ${destinationStationName}`);
      return null;
    }

    // Find closest shape point indices
    let startIdx = findClosestShapePointIndex(originStop.lat, originStop.lon, fullShape);
    if (startIdx < 0) startIdx = 0;

    let endIdx = findClosestShapePointIndex(destStop.lat, destStop.lon, fullShape);
    if (endIdx < 0) endIdx = fullShape.length - 1;

    // Ensure we're going forward (origin before destination on shape)
    // If endIdx <= startIdx, extend endIdx
    if (endIdx <= startIdx) {
      endIdx = Math.min(startIdx + 1, fullShape.length - 1);
    }

    // Extract subshape coordinates
    const subshapeCoords = [];
    for (let j = startIdx; j <= endIdx; j++) {
      subshapeCoords.push({
        lat: fullShape[j].lat,
        lon: fullShape[j].lon
      });
    }

    // Calculate distance
    let distance = 0;
    const traveledValues = fullShape
      .map(pt => pt.shape_dist_traveled)
      .filter(val => val !== undefined && val !== null);
    const hasValidDistanceData = traveledValues.some(val => val > 0);

    if (hasValidDistanceData) {
      const startDistTraveled = fullShape[startIdx].shape_dist_traveled || 0;
      const endDistTraveled = fullShape[endIdx].shape_dist_traveled || 0;
      distance = Math.abs(endDistTraveled - startDistTraveled);
    } else {
      const distanceMeters = getDistanceBetweenShapePoints(fullShape, startIdx, endIdx);
      distance = distanceMeters * 0.001;  // Convert meters to km
    }

    // Create subshape object (same structure as generateSubshapesForShapeId)
    const subshapeObject = {
      origin_station: originStop.name,
      destination_station: destStop.name,
      distance: Number(distance.toFixed(3)),
      coordinates: subshapeCoords
    };

    // Hide all other shapes by reducing opacity
    originalShapesOpacity = {}; // Reset tracking
    if (globalShapesLayer && globalShapesLayer.eachLayer) {
      globalShapesLayer.eachLayer(layer => {
        if (layer instanceof L.Polyline) {
          // Store original opacity
          originalShapesOpacity[layer._leaflet_id] = {
            color: layer.options.color,
            weight: layer.options.weight,
            opacity: layer.options.opacity || 1
          };
          // Set to very dim
          layer.setStyle({ opacity: 0.1 });
        }
      });
    }

    // Create and display temporary polyline (red, thick)
    const tempPolylineCoords = subshapeCoords.map(pt => [pt.lat, pt.lon]);
    temporarySubshapeLayer = L.polyline(tempPolylineCoords, {
      color: '#ff0000',
      weight: 5,
      opacity: 1,
      dashArray: '10, 5',
      interactive: true,
      touchTolerance: 80
    });

    temporarySubshapeLayer.addTo(globalMap);

    // Fit map bounds to show the subshape
    const bounds = L.latLngBounds(tempPolylineCoords);
    globalMap.fitBounds(bounds);

    console.log(`[generateSubshapeByStations] Created temp subshape: ${originStop.name} → ${destStop.name}`);
    console.log(`[generateSubshapeByStations] Subshape data:`, subshapeObject);

    // Download the subshape data
    const jsonData = JSON.stringify(subshapeObject, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `subshape_${originStop.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_to_${destStop.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[generateSubshapeByStations] Downloaded subshape to JSON`);

    return subshapeObject;

  } catch (err) {
    console.error('[generateSubshapeByStations] Unexpected error:', err);
    return null;
  }
}

/**
 * Clears the temporary subshape visualization and restores all shapes to their original appearance.
 * Called automatically when filters change or can be called manually.
 */
function clearTemporarySubshape() {
  try {
    const globalShapesLayer = typeof window !== 'undefined' ? window.shapesLayer : null;
    const globalMap = typeof window !== 'undefined' ? window.map : null;

    // Remove temporary polyline from map
    if (temporarySubshapeLayer && globalMap) {
      globalMap.removeLayer(temporarySubshapeLayer);
      temporarySubshapeLayer = null;
    }

    // Restore original opacity to all shapes
    if (globalShapesLayer && globalShapesLayer.eachLayer) {
      globalShapesLayer.eachLayer(layer => {
        if (layer instanceof L.Polyline) {
          const leafletId = layer._leaflet_id;
          if (originalShapesOpacity[leafletId]) {
            const original = originalShapesOpacity[leafletId];
            layer.setStyle({
              color: original.color,
              weight: original.weight,
              opacity: original.opacity
            });
          }
        }
      });
    }

    originalShapesOpacity = {};
    console.log('[clearTemporarySubshape] Temp subshape cleared and shapes restored');
  } catch (err) {
    console.error('[clearTemporarySubshape] Error during cleanup:', err);
  }
}

/**
 * Helper function to convert time string (HH:MM:SS) to minutes since midnight
 */
function timeStringToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length !== 3) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);
  return hours * 60 + minutes + seconds / 60;
}

/**
 * Enumerates and logs all trip IDs for the selected route and service date.
 * 
 * Usage: Call from browser console as: enumerateFilteredTrips()
 * 
 * No input required. Uses UI selections from:
 * - Route Name dropdown (routeShortNameSelect)
 * - Service Date / Service Pattern ID (via filterTrips)
 * 
 * Returns array of trip IDs, and logs them to console.
 */
async function enumerateFilteredTrips() {
  try {
    // Basic checks
    if (!window.trips) {
      console.error('[enumerateFilteredTrips] GTFS data not loaded: window.trips is missing.');
      return [];
    }

    // Ensure a single route is selected
    const routeShortNameSelect = document.getElementById('routeShortNameSelect');
    if (!routeShortNameSelect) {
      console.error('[enumerateFilteredTrips] Route Name dropdown not found.');
      return [];
    }
    const selectedRoutes = Array.from(routeShortNameSelect.selectedOptions).map(o => o.value);
    if (selectedRoutes.length !== 1) {
      console.error('[enumerateFilteredTrips] Select exactly ONE route before enumerating.');
      return [];
    }
    const selectedRouteKey = selectedRoutes[0];

    // Filter trips using the same logic as exportTimetable
    if (typeof filterTrips !== 'function') {
      console.error('[enumerateFilteredTrips] filterTrips() not available in global scope.');
      return [];
    }

    await filterTrips(false); // useAllServiceDates = false to respect current service date filter

    const allFiltered = window.filteredTrips || filteredTrips || [];
    const tripsForRoute = allFiltered.filter(t => t.route && `${t.route.route_short_name}-${t.route.route_long_name}` === selectedRouteKey);

    if (!tripsForRoute.length) {
      console.error(`[enumerateFilteredTrips] No trips found for selected route '${selectedRouteKey}' with current filters.`);
      return [];
    }

    const tripIds = tripsForRoute.map(t => t.trip_id);

    console.log(`\n[enumerateFilteredTrips] ===== FILTERED TRIPS =====`);
    console.log(`Route: ${selectedRouteKey}`);
    console.log(`Total Trips: ${tripIds.length}`);
    console.log(`\n[enumerateFilteredTrips] Trip IDs:`);
    
    for (let i = 0; i < tripIds.length; i++) {
      console.log(`  ${i + 1}. ${tripIds[i]}`);
    }
    
    console.log(`[enumerateFilteredTrips] ===== END LIST =====\n`);

    return tripIds;

  } catch (err) {
    console.error('[enumerateFilteredTrips] Unexpected error:', err);
    return [];
  }
}

/**
 * Summarizes average timetable using a reference trip.
 * 
 * Usage: Call from browser console as: summarizeAverageTimetableUsingReferenceTrip('trip_id')
 * 
 * Process:
 * 1. Filter trips by route and service date (using UI selections, same as exportTimetable)
 * 2. Load stop times for these trips
 * 3. Validate reference trip exists in the filtered trips
 * 4. Extract station-to-station segments from reference trip
 * 5. For each segment, collect travel times from all trips containing it
 * 6. Get subshapes for distances
 * 7. Calculate statistics: avg travel time, variance, speed
 * 8. Console.log results
 */
async function summarizeAverageTimetableUsingReferenceTrip(referenceTripId) {
  try {
    // Basic checks
    if (!window.trips) {
      console.error('[summarizeAverageTimetableUsingReferenceTrip] GTFS data not loaded: window.trips is missing.');
      return;
    }
    if (!window.requestFilteredStopTimesFromWorker) {
      console.error('[summarizeAverageTimetableUsingReferenceTrip] GTFS worker request API not available.');
      return;
    }

    // Step 1: Mirror exportTimetable filtering logic - ensure single route is selected
    const routeShortNameSelect = document.getElementById('routeShortNameSelect');
    if (!routeShortNameSelect) {
      console.error('[summarizeAverageTimetableUsingReferenceTrip] Route Name dropdown not found.');
      return;
    }
    const selectedRoutes = Array.from(routeShortNameSelect.selectedOptions).map(o => o.value);
    if (selectedRoutes.length !== 1) {
      console.error('[summarizeAverageTimetableUsingReferenceTrip] Select exactly ONE route before summarizing.');
      return;
    }
    const selectedRouteKey = selectedRoutes[0];

    // Step 2: Filter trips using the same logic as exportTimetable
    if (typeof filterTrips !== 'function') {
      console.error('[summarizeAverageTimetableUsingReferenceTrip] filterTrips() not available in global scope.');
      return;
    }

    await filterTrips(false); // useAllServiceDates = false to match current filters

    const allFiltered = window.filteredTrips || filteredTrips || [];
    const tripsToAnalyze = allFiltered.filter(t => t.route && `${t.route.route_short_name}-${t.route.route_long_name}` === selectedRouteKey);

    if (!tripsToAnalyze.length) {
      console.error(`[summarizeAverageTimetableUsingReferenceTrip] No trips found for selected route '${selectedRouteKey}' with current filters.`);
      return;
    }

    console.log(`[summarizeAverageTimetableUsingReferenceTrip] Analyzing ${tripsToAnalyze.length} trips for route ${selectedRouteKey}`);

    // Step 3: Find reference trip
    const referenceTrip = tripsToAnalyze.find(t => t.trip_id === referenceTripId);
    if (!referenceTrip) {
      console.error(`[summarizeAverageTimetableUsingReferenceTrip] Reference trip not found: ${referenceTripId}`);
      return;
    }

    console.log(`[summarizeAverageTimetableUsingReferenceTrip] Reference trip found: ${referenceTripId}, shape_id: ${referenceTrip.shape_id}`);

    // Step 4: Load stop times for all trips to analyze
    window.stopTimes = window.stopTimes || [];
    const haveTrips = new Set(window.stopTimes.map(st => String(st.trip_id)));
    const missingTripIds = tripsToAnalyze.filter(t => !haveTrips.has(String(t.trip_id))).map(t => t.trip_id);

    if (missingTripIds.length > 0) {
      try {
        const newStopTimes = await window.requestFilteredStopTimesFromWorker(missingTripIds);
        window.stopTimes = window.stopTimes.concat(newStopTimes);
        console.log(`[summarizeAverageTimetableUsingReferenceTrip] Loaded ${newStopTimes.length} stop times for ${missingTripIds.length} trips.`);
      } catch (err) {
        console.error('[summarizeAverageTimetableUsingReferenceTrip] Failed to load stop times:', err);
        return;
      }
    }

    // Step 5: Extract reference trip's stop_times and build segments
    const referenceStopTimes = window.stopTimes
      .filter(st => st.trip_id === referenceTrip.trip_id)
      .sort((a, b) => (parseInt(a.stop_sequence) || 0) - (parseInt(b.stop_sequence) || 0));

    if (referenceStopTimes.length < 2) {
      console.error(`[summarizeAverageTimetableUsingReferenceTrip] Reference trip has fewer than 2 stops.`);
      return;
    }

    // Build segment array from reference trip
    const segments = [];
    const stopsById = window.stopsById || new Map();
    
    for (let i = 0; i < referenceStopTimes.length - 1; i++) {
      const currentStopTime = referenceStopTimes[i];
      const nextStopTime = referenceStopTimes[i + 1];
      
      // Get stop names
      const originStop = stopsById.get ? stopsById.get(currentStopTime.stop_id) : stopsById[currentStopTime.stop_id];
      const destStop = stopsById.get ? stopsById.get(nextStopTime.stop_id) : stopsById[nextStopTime.stop_id];

      if (!originStop || !destStop) continue;

      segments.push({
        origin_station: originStop.name,
        destination_station: destStop.name,
        travel_times: [] // Will be populated below
      });
    }

    console.log(`[summarizeAverageTimetableUsingReferenceTrip] Extracted ${segments.length} segments from reference trip`);

    // Step 6: Collect travel times from all trips for each segment
    for (const trip of tripsToAnalyze) {
      const tripStopTimes = window.stopTimes
        .filter(st => st.trip_id === trip.trip_id)
        .sort((a, b) => (parseInt(a.stop_sequence) || 0) - (parseInt(b.stop_sequence) || 0));

      // For each segment, check if this trip contains it
      for (let segIdx = 0; segIdx < segments.length; segIdx++) {
        const segment = segments[segIdx];
        
        // Find matching consecutive stops in this trip
        for (let i = 0; i < tripStopTimes.length - 1; i++) {
          const currentStop = stopsById.get ? stopsById.get(tripStopTimes[i].stop_id) : stopsById[tripStopTimes[i].stop_id];
          const nextStop = stopsById.get ? stopsById.get(tripStopTimes[i + 1].stop_id) : stopsById[tripStopTimes[i + 1].stop_id];

          if (!currentStop || !nextStop) continue;

          // Check if this pair matches the segment
          if (currentStop.name === segment.origin_station && nextStop.name === segment.destination_station) {
            const departureTime = timeStringToMinutes(tripStopTimes[i].departure_time);
            const arrivalTime = timeStringToMinutes(tripStopTimes[i + 1].arrival_time);
            
            if (departureTime !== null && arrivalTime !== null) {
              const travelTime = arrivalTime - departureTime;
              // Handle case where time wraps around midnight
              if (travelTime < 0) {
                segment.travel_times.push(travelTime + 24 * 60);
              } else {
                segment.travel_times.push(travelTime);
              }
            }
            break; // Move to next trip
          }
        }
      }
    }

    console.log(`[summarizeAverageTimetableUsingReferenceTrip] Collected travel times for all segments`);

    // Step 7: Get subshapes to determine distances
    const shapeId = referenceTrip.shape_id;
    if (!shapeId) {
      console.error('[summarizeAverageTimetableUsingReferenceTrip] Reference trip has no shape_id');
      return;
    }

    const subshapes = await window.generateSubshapesForShapeId(shapeId);
    if (!subshapes || subshapes.length === 0) {
      console.error(`[summarizeAverageTimetableUsingReferenceTrip] Could not generate subshapes for shape_id: ${shapeId}`);
      return;
    }

    console.log(`[summarizeAverageTimetableUsingReferenceTrip] Generated ${subshapes.length} subshapes`);

    // Step 8: Build result array with statistics
    const results = [];
    
    for (const segment of segments) {
      // Find matching subshape
      let distance = null;
      for (const subshape of subshapes) {
        if (subshape.origin_station === segment.origin_station && 
            subshape.destination_station === segment.destination_station) {
          distance = subshape.distance;
          break;
        }
      }

      if (distance === null) {
        console.warn(`[summarizeAverageTimetableUsingReferenceTrip] Could not find distance for segment: ${segment.origin_station} → ${segment.destination_station}`);
        continue;
      }

      // Calculate statistics
      const travelTimes = segment.travel_times;
      if (travelTimes.length === 0) {
        console.warn(`[summarizeAverageTimetableUsingReferenceTrip] No travel times found for segment: ${segment.origin_station} → ${segment.destination_station}`);
        continue;
      }

      const avgTravelTime = travelTimes.reduce((a, b) => a + b, 0) / travelTimes.length;
      
      // Simplified variance: average of 5 fastest / average of all
      const sortedTimes = [...travelTimes].sort((a, b) => a - b);
      const countForVariance = Math.min(5, sortedTimes.length);
      const avgFastest = sortedTimes.slice(0, countForVariance).reduce((a, b) => a + b, 0) / countForVariance;
      const variance = avgFastest / avgTravelTime;

      // Average speed in km/h (distance is in km, travel time is in minutes)
      const avgTravelTimeHours = avgTravelTime / 60;
      const avgSpeed = distance / avgTravelTimeHours;

      results.push({
        origin: segment.origin_station,
        destination: segment.destination_station,
        distance: Number(distance.toFixed(3)),
        avg_travel_time_min: Number(avgTravelTime.toFixed(2)),
        variance: Number(variance.toFixed(3)),
        avg_speed_kmh: Number(avgSpeed.toFixed(3)),
        sample_size: travelTimes.length
      });
    }

    // Step 9: Console log results
    console.log(`\n[summarizeAverageTimetableUsingReferenceTrip] ===== TIMETABLE SUMMARY =====`);
    console.log(`Route: ${selectedRouteKey}`);
    console.log(`Reference Trip: ${referenceTripId}`);
    console.log(`Total Trips Analyzed: ${tripsToAnalyze.length}`);
    console.log(`Number of Segments: ${results.length}`);
    console.log(`\n[summarizeAverageTimetableUsingReferenceTrip] ===== SEGMENT DETAILS =====`);
    
    for (const result of results) {
      console.log(`${result.origin} → ${result.destination}`);
      console.log(`  Distance: ${result.distance} km`);
      console.log(`  Avg Travel Time: ${result.avg_travel_time_min} min`);
      console.log(`  Variance (fastest 5 / all): ${Number(result.variance).toFixed(3)}`);
      console.log(`  Avg Speed: ${Number(result.avg_speed_kmh).toFixed(3)} km/h`);
      console.log(`  Sample Size: ${result.sample_size} trips`);
      console.log('');
    }

    console.log(`[summarizeAverageTimetableUsingReferenceTrip] ===== END SUMMARY =====\n`);

    return results;

  } catch (err) {
    console.error('[summarizeAverageTimetableUsingReferenceTrip] Unexpected error:', err);
  }
}

// Expose to the global window so it can be called from the browser console
if (typeof window !== 'undefined') {
  window.generateSubshapesForShapeId = generateSubshapesForShapeId;
  window.generateAllSubshapes = generateAllSubshapes;
  window.downloadSubshapesJSON = downloadSubshapesJSON;
  window.exportTimetable = exportTimetable;
  window.generateSubshapeByStations = generateSubshapeByStations;
  window.clearTemporarySubshape = clearTemporarySubshape;
  window.enumerateFilteredTrips = enumerateFilteredTrips;
  window.summarizeAverageTimetableUsingReferenceTrip = summarizeAverageTimetableUsingReferenceTrip;
}

