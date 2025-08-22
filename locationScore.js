// ...existing code...

/**
 * Calculate the transit accessibility score for a given lat/lon location.
 * This function is NOT called anywhere yet.
 * @param {number} lat - Latitude of the location
 * @param {number} lon - Longitude of the location
 * @returns {number} Accessibility score (0-100)
 */
async function calculateTransitAccessibilityScore(lat, lon, filteredStops, filteredStopTimes, filteredTrips) {
  const alpha = 0.18;
  const searchRadiusMeters = 1000;

  // 1. Find all stops within 1km
  const stopsWithinRadius = filteredStops
    .map(stop => ({
      stop,
      distance: calculateDistance(lat, lon, stop.lat, stop.lon)
    }))
    .filter(obj => obj.distance <= searchRadiusMeters);

  // 2. Build shapeIdToClosestStop map
  const shapeIdToClosestStop = new Map();
  for (const { stop, distance } of stopsWithinRadius) {
    // Get all trip_ids serving this stop
    const tripIds = filteredStopTimes
      .filter(st => st.stop_id === stop.id)
      .map(st => st.trip_id);

    // For each trip, get its shape_id
    for (const tripId of tripIds) {
      const trip = filteredTrips.find(t => t.trip_id === tripId);
      if (trip && trip.shape_id) {
        const current = shapeIdToClosestStop.get(trip.shape_id);
        if (!current || distance < current.distance) {
          shapeIdToClosestStop.set(trip.shape_id, { stop, distance });
        }
      }
    }
  }
  console.log(`Found ${shapeIdToClosestStop.size} shape_ids with closest stops.`);

  // Helper: get all trips serving a stop
  function tripsForStop(stopId) {
    return filteredStopTimes.filter(st => st.stop_id === stopId).map(st => st.trip_id);
  }

  // Helper: get all stop_times for a stop, grouped by trip
  function stopTimesForStop(stopId) {
    return filteredStopTimes.filter(st => st.stop_id === stopId);
  }

  // Helper: get all departure times (in seconds) for a stop
  function departureTimesForStop(stopId) {
    return stopTimesForStop(stopId).map(st => timeToSeconds(st.departure_time));
  }

  // Helper: get all service_ids for a stop
  function serviceIdsForStop(stopId) {
    return new Set(stopTimesForStop(stopId).map(st => {
      const trip = filteredTrips.find(t => t.trip_id === st.trip_id);
      return trip ? trip.service_id : null;
    }).filter(Boolean));
  }

  // Helper: for a stop, get all departures for the day (across all trips)
  function allDeparturesForStop(stopId) {
    return stopTimesForStop(stopId).map(st => ({
      time: timeToSeconds(st.departure_time),
      trip_id: st.trip_id
    }));
  }

  // Helper: for a stop, get the highest hourly frequency in the day
  function highestHourlyFrequency(stopId, shapeId) {
      // Only include stop_times for trips with this shape_id
      const departures = stopTimesForStop(stopId)
          .filter(st => {
              const trip = filteredTrips.find(t => t.trip_id === st.trip_id);
              return trip && trip.shape_id === shapeId;
          })
          .map(st => timeToSeconds(st.departure_time));

      if (departures.length === 0) return 0;

      // Count departures per hour
      const hourCounts = {};
      for (const sec of departures) {
          const hour = Math.floor(sec / 3600);
          hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }

      // Get array of counts, sort descending
      const counts = Object.values(hourCounts).sort((a, b) => b - a);

      // Take top 6 hours (or fewer), average
      const topCounts = counts.slice(0, 6);
      const avg = topCounts.length ? topCounts.reduce((a, b) => a + b, 0) / topCounts.length : 0;

      return avg;
  }

  // Helper: for a stop, get total service hours with at least one trip
  function totalServiceHours(stopId, shapeId) {
    const departures = stopTimesForStop(stopId)
      .filter(st => {
        const trip = filteredTrips.find(t => t.trip_id === st.trip_id);
        return trip && trip.shape_id === shapeId;
      })
      .map(st => timeToSeconds(st.departure_time));

    if (departures.length === 0) return 0;
    const uniqueHours = new Set(departures.map(sec => Math.floor(sec / 3600)));
    return uniqueHours.size;
  }

  // 2. For each stop, calculate stop score
  let sumStopScores = 0;
  for (const [shapeId, { stop, distance }] of shapeIdToClosestStop.entries()) {
    const d = distance;
    const f = highestHourlyFrequency(stop.id, shapeId);
    const s = totalServiceHours(stop.id, shapeId);
       
    // Find a trip with this shapeId
    const trip = filteredTrips.find(t => t.shape_id === shapeId);
    let routeId = trip ? trip.route_id : 'unknown';
    // If you have routes loaded globally:
    let routeName = '';
    if (typeof routes !== 'undefined' && routes.length && trip) {
      const route = routes.find(r => r.route_id === trip.route_id);
      routeName = route ? `${route.route_short_name} & ${route.route_long_name}` : '';
    }

    // Stop Score formula
    const stopScore = calculateStopScore(alpha, f, s, d);
    sumStopScores += stopScore;

    console.log(`Stop ${stop.name} (${stop.id}) for shapeID ${shapeId} and route_name=${routeName}: d=${d.toFixed(1)}m, f=${f}, s=${s.toFixed(1)}h, score=${stopScore.toFixed(4)}`);
    }

  // 3. Compute default perfect stop score
  const defaultAlpha = 0.18, defaultF = 12, defaultS = 18, defaultD = 150;
  const defaultStopScore = calculateStopScore(defaultAlpha, defaultF, defaultS, defaultD);

  // 4. Final score
  const accessibilityScore = 100 * Math.min(1, sumStopScores / (2 * defaultStopScore));

  console.log(`total sum of stop scores ${sumStopScores.toFixed(4)}`);
  return accessibilityScore;
}

function calculateStopScore(alpha, f, s, d){
    return  (1 - Math.exp(-alpha * f)) * Math.min(1, s / 18) * Math.exp(-d / 150);
}

// --- Transit Accessibility Score Feature ---
let transitScoreMarker = null;
let transitScoreMapClickHandler = null;

// Show/hide and handle map click only when the canvas is active

function setupTransitScoreMapClickHandler() {
  map.on('click', async function(e) {
    const canvas = document.getElementById('transitScoreCanvas');
    const isActive = canvas && canvas.style.display !== 'none';
    if (!isActive) return;
    
    if (!filteredTrips || filteredTrips.length === 0) {
      // Show no data message
      const valueElem = document.getElementById('transitScoreValue');
      valueElem.innerHTML = `<span style="color:#e53935;">No routes and service patterns selected </span>`;
      return;
    }

    // Remove previous marker
    removeTransitScoreMarker();
    // Show loading
    const valueElem = document.getElementById('transitScoreValue');
    valueElem.innerHTML = `<span style="font-size:1.1em; color:#aaa;">Calculating...</span>`;

    // --- Build filteredStopTimes and filteredStops from filteredTrips ---
    const filteredTripIds = new Set(filteredTrips.map(t => t.trip_id));
    const filteredStopTimes = stopTimes.filter(st => filteredTripIds.has(st.trip_id));
    const filteredStopIds = new Set(filteredStopTimes.map(st => st.stop_id));
    const filteredStops = stops.filter(s => filteredStopIds.has(s.id));
    // ---------------------------------------------------------------

    // Calculate score
    const {lat, lng} = e.latlng;
    const score = await calculateTransitAccessibilityScore(lat, lng,
        filteredStops, filteredStopTimes, filteredTrips
    );
    // Place marker
    transitScoreMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'transit-score-marker',
        html: `<span style="font-size:2em; color:#43cea2;">&#9679;</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(map);
    // Animate score color
    let color = '#185a9d';
    if (score >= 80) color = '#43cea2';
    else if (score >= 50) color = '#0078d7';
    else if (score >= 20) color = '#ff9800';
    else color = '#e53935';
    valueElem.innerHTML = `<span style="color:${color}; font-size:2.5em;">${score.toFixed(1)}</span><span style="font-size:1.1em; color:#888;"></span>`;
  });
}


function removeTransitScoreMarker() {
  if (transitScoreMarker) {
    map.removeLayer(transitScoreMarker);
    transitScoreMarker = null;
  }
}

