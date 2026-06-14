let timeDistanceChart = null;
let timeDistanceShapeRows = [];
let timeDistanceStationTicks = [];
let timeDistanceRefreshRetryTimer = null;

const timeDistancePalette = [
  '#0b84a5', '#f6c85f', '#6f4e7c', '#9dd866', '#ca472f',
  '#ffa056', '#8dddd0', '#af4b91', '#345995', '#03cea4'
];

function tdTimeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
}

function tdFormatTime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function tdShapePointSequence(point) {
  if (!point) return 0;
  return Number(point.sequence ?? point.shape_pt_sequence ?? 0);
}

function tdGetStopsMap() {
  if (stopsById && typeof stopsById.get === 'function') return stopsById;
  return new Map(Object.entries(stopsById || {}));
}

function tdBuildTripStopMap(tripIds) {
  const tripIdSet = tripIds instanceof Set ? tripIds : new Set(tripIds || []);
  const map = new Map();

  stopTimes.forEach(stopTime => {
    const tripId = String(stopTime.trip_id);
    if (!tripIdSet.has(tripId)) return;
    if (!map.has(tripId)) map.set(tripId, []);
    map.get(tripId).push(stopTime);
  });

  map.forEach(stopsArr => {
    stopsArr.sort((a, b) => (Number(a.stop_sequence) || 0) - (Number(b.stop_sequence) || 0));
  });

  return map;
}

function tdGetStopName(stopId, stopsMap) {
  const stop = stopsMap.get ? stopsMap.get(stopId) : (stopsMap || {})[stopId];
  return stop ? (stop.name || stop.stop_name || String(stopId)) : String(stopId);
}

function tdGetStopRecord(stopId, stopsMap) {
  return stopsMap.get ? stopsMap.get(stopId) : (stopsMap || {})[stopId];
}

function tdGetParentStationIdentity(stopId, stopsMap) {
  const stop = tdGetStopRecord(stopId, stopsMap);
  if (!stop) {
    return {
      key: String(stopId),
      name: String(stopId),
      stop
    };
  }

  const parentId = stop.parent_station ? String(stop.parent_station).trim() : '';
  if (!parentId) {
    return {
      key: String(stop.id || stopId),
      name: stop.name || stop.stop_name || String(stopId),
      stop
    };
  }

  const parentStop = tdGetStopRecord(parentId, stopsMap);
  return {
    key: parentId,
    name: parentStop ? (parentStop.name || parentStop.stop_name || parentId) : parentId,
    stop: parentStop || stop
  };
}

function tdBuildCanonicalStationStops(tripStops, stopsMap) {
  const canonicalStops = [];

  (tripStops || []).forEach((stopTime, index) => {
    const station = tdGetParentStationIdentity(stopTime.stop_id, stopsMap);
    const arrivalTime = stopTime.arrival_time || stopTime.departure_time || null;
    const departureTime = stopTime.departure_time || stopTime.arrival_time || null;
    const shapeDistRaw = stopTime.shape_dist_traveled ?? stopTime.shapeDistKm ?? null;
    const shapeDistKm = shapeDistRaw === null || shapeDistRaw === undefined || shapeDistRaw === ''
      ? null
      : Number(shapeDistRaw);

    if (!canonicalStops.length || canonicalStops[canonicalStops.length - 1].stationKey !== station.key) {
      canonicalStops.push({
        stationKey: station.key,
        stationName: station.name,
        sourceStopId: String(stopTime.stop_id),
        arrival_time: arrivalTime,
        departure_time: departureTime,
        stopSequence: Number(stopTime.stop_sequence) || index,
        shapeDistKm: Number.isFinite(shapeDistKm) ? shapeDistKm : null,
        lat: station.stop && Number.isFinite(station.stop.lat) ? station.stop.lat : null,
        lon: station.stop && Number.isFinite(station.stop.lon) ? station.stop.lon : null
      });
      return;
    }

    const existing = canonicalStops[canonicalStops.length - 1];
    if (!existing.arrival_time && arrivalTime) existing.arrival_time = arrivalTime;
    if (departureTime) existing.departure_time = departureTime;
    if (Number.isFinite(shapeDistKm)) existing.shapeDistKm = shapeDistKm;
    if (Number(stopTime.stop_sequence) > existing.stopSequence) {
      existing.stopSequence = Number(stopTime.stop_sequence);
      existing.sourceStopId = String(stopTime.stop_id);
    }
  });

  return canonicalStops;
}

function tdMakeUndirectedSegmentKey(fromStationKey, toStationKey) {
  const a = String(fromStationKey);
  const b = String(toStationKey);
  return a <= b ? `${a}__${b}` : `${b}__${a}`;
}

function tdGetRepresentativeTrip(tripsArr, tripStopMap) {
  return (tripsArr || []).find(trip => {
    const tripStops = tripStopMap.get(String(trip.trip_id)) || [];
    return tripStops.length >= 2;
  }) || null;
}

function tdClearRefreshRetryTimer() {
  if (timeDistanceRefreshRetryTimer) {
    window.clearTimeout(timeDistanceRefreshRetryTimer);
    timeDistanceRefreshRetryTimer = null;
  }
}

function tdBuildShapeOptionRows() {
  const stopsMap = tdGetStopsMap();
  const tripsByShape = new Map();

  filteredTrips.forEach(trip => {
    const shapeId = (trip.shape_id || '').trim();
    if (!shapeId) return;
    if (!tripsByShape.has(shapeId)) tripsByShape.set(shapeId, []);
    tripsByShape.get(shapeId).push(trip);
  });

  const tripStopMap = tdBuildTripStopMap(new Set(filteredTrips.map(trip => String(trip.trip_id))));
  const rows = [];

  tripsByShape.forEach((tripsArr, shapeId) => {
    const representativeTrip = tdGetRepresentativeTrip(tripsArr, tripStopMap);
    const representativeStopsRaw = representativeTrip ? (tripStopMap.get(String(representativeTrip.trip_id)) || []) : [];
    const representativeStops = tdBuildCanonicalStationStops(representativeStopsRaw, stopsMap);
    if (!representativeTrip || representativeStops.length < 2) return;

    const firstStation = representativeStops[0] ? representativeStops[0].stationName : null;
    const lastStation = representativeStops.length ? representativeStops[representativeStops.length - 1].stationName : null;
    if (!firstStation || !lastStation) return;

    const routeName = representativeTrip && representativeTrip.route
      ? `${representativeTrip.route.route_short_name}-${representativeTrip.route.route_long_name}`
      : shapeId;

    rows.push({
      shapeId,
      label: `${firstStation} -> ${lastStation}`,
      routeName,
      firstStation,
      lastStation,
      representativeTripId: representativeTrip ? representativeTrip.trip_id : null
    });
  });

  rows.sort((a, b) => {
    return a.routeName.localeCompare(b.routeName) ||
      a.label.localeCompare(b.label) ||
      a.shapeId.localeCompare(b.shapeId);
  });

  return rows;
}

function tdSetEmptyState(message) {
  const emptyState = document.getElementById('timeDistanceEmptyState');
  const chartWrapper = document.getElementById('timeDistanceChartWrapper');
  if (emptyState) {
    emptyState.textContent = message;
    emptyState.style.display = 'block';
  }
  if (chartWrapper) chartWrapper.style.display = 'none';
  if (timeDistanceChart) {
    timeDistanceChart.data.datasets = [];
    timeDistanceChart.update();
  }
}

function tdSetSummary(message) {
  const summary = document.getElementById('timeDistanceSummary');
  if (!summary) return;
  summary.textContent = message || '';
  summary.style.display = message ? 'block' : 'none';
}

function tdSetShapeSelectPlaceholder(message) {
  const select = document.getElementById('timeDistanceShapeSelect');
  if (!select) return;
  select.innerHTML = `<option value="">${message}</option>`;
  select.value = '';
  select.disabled = true;
}

function refreshTimeDistanceShapeOptions() {
  const select = document.getElementById('timeDistanceShapeSelect');
  if (!select) return [];

  tdClearRefreshRetryTimer();
  const previousValue = select.value;
  timeDistanceShapeRows = tdBuildShapeOptionRows();

  if (!filteredTrips || filteredTrips.length === 0) {
    tdSetShapeSelectPlaceholder('No filtered trips available');
    tdSetSummary('');
    tdSetEmptyState('No filtered trips available for the current selection.');
    return [];
  }

  if (timeDistanceShapeRows.length === 0) {
    tdSetShapeSelectPlaceholder('Loading shape labels...');
    tdSetSummary('');
    tdSetEmptyState('Preparing shape labels from representative trips...');
    timeDistanceRefreshRetryTimer = window.setTimeout(refreshTimeDistanceShapeOptions, 1200);
    return [];
  }

  select.disabled = false;
  select.innerHTML = timeDistanceShapeRows.map(row => {
    const label = `${row.label} (${row.routeName})`;
    return `<option value="${row.shapeId}">${label}</option>`;
  }).join('');

  const hasPrevious = timeDistanceShapeRows.some(row => row.shapeId === previousValue);
  select.value = hasPrevious ? previousValue : timeDistanceShapeRows[0].shapeId;
  tdSetSummary('');

  return timeDistanceShapeRows;
}

function tdCalculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const toRadians = deg => deg * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tdBuildShapeDistancesKm(shapePoints) {
  const sorted = (shapePoints || []).slice().sort((a, b) => tdShapePointSequence(a) - tdShapePointSequence(b));
  const traveledValues = sorted
    .map(point => Number(point.shape_dist_traveled))
    .filter(value => Number.isFinite(value) && value > 0);

  if (traveledValues.length > 0) {
    return sorted.map(point => {
      const value = Number(point.shape_dist_traveled);
      return Number.isFinite(value) ? value : 0;
    });
  }

  const distances = [];
  let cumulativeKm = 0;
  sorted.forEach((point, index) => {
    if (index > 0) {
      const prev = sorted[index - 1];
      cumulativeKm += tdCalculateDistanceMeters(prev.lat, prev.lon, point.lat, point.lon) / 1000;
    }
    distances.push(cumulativeKm);
  });
  return distances;
}

function tdFindClosestShapePointIndex(stop, shapePoints, startIndex) {
  if (!stop || !shapePoints || shapePoints.length === 0) return -1;
  let bestIndex = -1;
  let bestDistance = Infinity;

  for (let index = Math.max(0, startIndex || 0); index < shapePoints.length; index += 1) {
    const point = shapePoints[index];
    const distance = tdCalculateDistanceMeters(stop.lat, stop.lon, point.lat, point.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function tdBuildBaseShapeDefinition(shapeId, baseTripStops, stopsMap) {
  const shapePoints = (shapesById[shapeId] || []).slice().sort((a, b) => tdShapePointSequence(a) - tdShapePointSequence(b));
  if (shapePoints.length < 2) return null;

  const shapeDistancesKm = tdBuildShapeDistancesKm(shapePoints);
  const stations = [];
  const stationByKey = new Map();
  let lastShapeIndex = 0;

  baseTripStops.forEach((stopTime, sequenceIndex) => {
    const stop = {
      lat: stopTime.lat,
      lon: stopTime.lon
    };
    if (!stop) return;
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;

    const closestIndex = tdFindClosestShapePointIndex(stop, shapePoints, lastShapeIndex);
    if (closestIndex < 0) return;

    let distanceKm = Number.isFinite(stopTime.shapeDistKm) ? stopTime.shapeDistKm : (shapeDistancesKm[closestIndex] || 0);
    lastShapeIndex = closestIndex;

    // Preserve every parent station in sequence even if the upstream GTFS distance
    // is flat or the fallback shape snap lands on the same cumulative point.
    if (stations.length > 0 && distanceKm <= stations[stations.length - 1].distanceKm) {
      distanceKm = stations[stations.length - 1].distanceKm + 0.001;
    }

    const station = {
      stationKey: String(stopTime.stationKey),
      stopName: stopTime.stationName || String(stopTime.stationKey),
      distanceKm,
      stopSequence: Number(stopTime.stop_sequence) || sequenceIndex,
      shapePointIndex: closestIndex
    };

    if (stations.length && stations[stations.length - 1].stationKey === station.stationKey) {
      return;
    }

    stations.push(station);
    if (!stationByKey.has(station.stationKey)) {
      stationByKey.set(station.stationKey, station);
    }
  });

  if (stations.length < 2) return null;

  const segmentKeys = new Set();
  for (let index = 0; index < baseTripStops.length - 1; index += 1) {
    const fromStopId = String(baseTripStops[index].stationKey);
    const toStopId = String(baseTripStops[index + 1].stationKey);
    if (!stationByKey.has(fromStopId) || !stationByKey.has(toStopId)) continue;

    const fromDistance = stationByKey.get(fromStopId).distanceKm;
    const toDistance = stationByKey.get(toStopId).distanceKm;

    segmentKeys.add(tdMakeUndirectedSegmentKey(fromStopId, toStopId));
  }

  if (segmentKeys.size === 0) return null;

  return {
    stations,
    stationByKey,
    segmentKeys
  };
}

function tdColorForKey(key, alpha) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(index);
    hash |= 0;
  }
  const color = timeDistancePalette[Math.abs(hash) % timeDistancePalette.length];
  if (alpha === undefined) return color;

  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function tdChooseSmartTimeStep(minTime, maxTime) {
  const range = Math.max(60, maxTime - minTime);
  const candidateSteps = [
    60, 5 * 60, 10 * 60, 15 * 60, 30 * 60,
    60 * 60, 2 * 60 * 60, 3 * 60 * 60
  ];

  let bestStep = candidateSteps[0];
  let bestScore = Infinity;

  candidateSteps.forEach(step => {
    const roundedMin = tdRoundTimeFloor(minTime, step);
    const roundedMax = tdRoundTimeCeil(maxTime, step);
    const tickCount = Math.max(2, Math.round((roundedMax - roundedMin) / step) + 1);
    const withinTarget = tickCount >= 5 && tickCount <= 10 ? 0 : Math.min(Math.abs(tickCount - 5), Math.abs(tickCount - 10)) + 3;
    const score = withinTarget * 100 + Math.abs(tickCount - 7);
    if (score < bestScore) {
      bestScore = score;
      bestStep = step;
    }
  });

  return bestStep;
}

function tdRoundTimeFloor(value, step) {
  return Math.floor(value / step) * step;
}

function tdRoundTimeCeil(value, step) {
  return Math.ceil(value / step) * step;
}

function tdBuildTimeTicks(minTime, maxTime, step) {
  const roundedMin = tdRoundTimeFloor(minTime, step);
  const roundedMax = tdRoundTimeCeil(maxTime, step);
  const ticks = [];

  for (let value = roundedMin; value <= roundedMax; value += step) {
    ticks.push(value);
  }

  return ticks;
}

function tdBuildTripSegmentsForDiagram(trip, tripStops, baseDefinition) {
  const matchedPoints = [];

  tripStops.forEach(stop => {
    const baseStation = baseDefinition.stationByKey.get(String(stop.stationKey));
    if (!baseStation) return;

    const timeSec = tdTimeToSeconds(stop.departure_time || stop.arrival_time);
    if (timeSec === null) return;

    matchedPoints.push({
      stopId: String(stop.stationKey),
      stopName: baseStation.stopName,
      timeSec,
      distanceKm: baseStation.distanceKm
    });
  });

  if (matchedPoints.length < 2) {
    return { datasets: [], segmentCount: 0 };
  }

  const routeLabel = trip.route ? `${trip.route.route_short_name}-${trip.route.route_long_name}` : trip.route_id;
  const dataset = {
    label: `${routeLabel} | trip ${trip.trip_id}`,
    data: matchedPoints.map(point => ({
      x: point.timeSec,
      y: point.distanceKm,
      stopName: point.stopName,
      stopId: point.stopId
    })),
    borderColor: tdColorForKey(trip.shape_id || trip.trip_id),
    backgroundColor: tdColorForKey(trip.shape_id || trip.trip_id, 0.18),
    borderWidth: String(trip.shape_id).trim() === String(baseDefinition.shapeId).trim() ? 2.6 : 1.6,
    pointRadius: 1.5,
    pointHoverRadius: 4,
    pointBackgroundColor: tdColorForKey(trip.shape_id || trip.trip_id),
    tension: 0,
    fill: false
  };

  return { datasets: [dataset], segmentCount: 1 };
}

function tdEnsureChart() {
  const canvas = document.getElementById('timeDistancePlot');
  if (!canvas) return null;

  if (timeDistanceChart) return timeDistanceChart;

  timeDistanceChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { datasets: [] },
    options: {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      normalized: true,
      parsing: false,
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Scheduled Time (HH:MM)' },
          afterBuildTicks: axis => {
            const axisMin = Number.isFinite(axis.min) ? axis.min : 0;
            const axisMax = Number.isFinite(axis.max) ? axis.max : axisMin + 3600;
            const dynamicStep = tdChooseSmartTimeStep(axisMin, axisMax);
            const dynamicTicks = tdBuildTimeTicks(axisMin, axisMax, dynamicStep);
            axis.ticks = dynamicTicks.map(value => ({ value }));
          },
          ticks: {
            stepSize: 3600,
            autoSkip: false,
            maxTicksLimit: 10,
            callback: value => tdFormatTime(value)
          }
        },
        y: {
          type: 'linear',
          title: { display: true, text: 'Distance Along Base Shape (km)' },
          afterBuildTicks: axis => {
            axis.ticks = timeDistanceStationTicks.map(station => ({ value: station.distanceKm }));
          },
          ticks: {
            autoSkip: false,
            callback: value => {
              const station = timeDistanceStationTicks.find(item => Math.abs(item.distanceKm - value) < 0.001);
              return station ? `${station.stopName} (${station.distanceKm.toFixed(2)} km)` : '';
            },
            color: '#294660',
            font: {
              size: 10
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Scheduled Time-Distance Diagram',
          font: { size: 14 }
        },
        tooltip: {
          callbacks: {
            title: context => context.length ? context[0].dataset.label : '',
            label: context => {
              const point = context.raw || {};
              const stopName = point.stopName || '';
              const stopTime = tdFormatTime(point.x);
              const distance = Number(point.y || 0).toFixed(3);
              return `${stopName} | ${stopTime} | ${distance} km`;
            }
          }
        },
        zoom: {
          pan: {
            enabled: false,
            mode: 'x'
          },
          zoom: {
            drag: {
              enabled: true,
              backgroundColor: 'rgba(0, 120, 215, 0.12)',
              borderColor: 'rgba(0, 120, 215, 0.45)',
              borderWidth: 1
            },
            wheel: {
              enabled: true
            },
            pinch: {
              enabled: true
            },
            mode: 'x'
          },
          limits: {
            y: {
              min: 0,
              max: 1
            }
          }
        }
      }
    }
  });

  return timeDistanceChart;
}

async function tdSyncFilteredTrips() {
  if (typeof filterTrips !== 'function') return;
  await filterTrips(false);
}

async function generateTimeDistanceDiagram() {
  const select = document.getElementById('timeDistanceShapeSelect');
  if (!select) return;

  await tdSyncFilteredTrips();
  refreshTimeDistanceShapeOptions();

  const shapeId = select.value;
  if (!shapeId) {
    tdSetEmptyState('Select a base shape before generating the diagram.');
    return;
  }

  const stopsMap = tdGetStopsMap();
  const filteredTripStopMap = tdBuildTripStopMap(new Set(filteredTrips.map(trip => String(trip.trip_id))));
  const baseTrips = filteredTrips.filter(trip => String(trip.shape_id).trim() === String(shapeId).trim());
  const representativeTrip = tdGetRepresentativeTrip(baseTrips, filteredTripStopMap);

  if (!representativeTrip) {
    tdSetEmptyState('The selected shape does not have a representative trip with at least two scheduled stops.');
    return;
  }

  const baseTripStopsRaw = filteredTripStopMap.get(String(representativeTrip.trip_id)) || [];
  const baseTripStops = tdBuildCanonicalStationStops(baseTripStopsRaw, stopsMap);
  const baseDefinition = tdBuildBaseShapeDefinition(shapeId, baseTripStops, stopsMap);
  if (!baseDefinition) {
    tdSetEmptyState('The selected shape could not be aligned to its stop sequence for distance plotting.');
    return;
  }

  baseDefinition.shapeId = shapeId;

  const datasets = [];
  let matchingTrips = 0;
  let renderedSegments = 0;

  filteredTrips.forEach(trip => {
    const tripStopsRaw = filteredTripStopMap.get(String(trip.trip_id)) || [];
    const tripStops = tdBuildCanonicalStationStops(tripStopsRaw, stopsMap);
    if (tripStops.length < 2) return;

    const tripSegments = tdBuildTripSegmentsForDiagram(trip, tripStops, baseDefinition);
    if (!tripSegments.datasets.length) return;

    matchingTrips += 1;
    renderedSegments += tripSegments.segmentCount;
    datasets.push(...tripSegments.datasets);
  });

  if (!datasets.length) {
    tdSetEmptyState('No trips in the current filters share any exact stop-to-stop segment with the selected base shape.');
    return;
  }

  const chart = tdEnsureChart();
  if (!chart) return;

  const allPoints = datasets.flatMap(dataset => dataset.data);
  const minTime = Math.min(...allPoints.map(point => point.x));
  const maxTime = Math.max(...allPoints.map(point => point.x));
  const maxDistance = Math.max(...baseDefinition.stations.map(station => station.distanceKm));
  const timeStep = tdChooseSmartTimeStep(minTime, maxTime);
  const roundedMinTime = tdRoundTimeFloor(minTime, timeStep);
  const roundedMaxTime = tdRoundTimeCeil(maxTime, timeStep);

  timeDistanceStationTicks = baseDefinition.stations.slice();

  chart.data.datasets = datasets;
  chart.options.scales.x.min = roundedMinTime;
  chart.options.scales.x.max = roundedMaxTime;
  chart.options.scales.x.ticks.stepSize = timeStep;
  chart.options.scales.y.min = 0;
  chart.options.scales.y.max = maxDistance * 1.02;
  chart.options.plugins.zoom.limits.y.min = 0;
  chart.options.plugins.zoom.limits.y.max = maxDistance * 1.02;
  chart.update();

  const chartWrapper = document.getElementById('timeDistanceChartWrapper');
  const emptyState = document.getElementById('timeDistanceEmptyState');
  if (chartWrapper) chartWrapper.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';
  tdSetSummary('');
}

function setupTimeDistanceDiagram() {
  const refreshButton = document.getElementById('refreshTimeDistanceShapesBtn');
  const generateButton = document.getElementById('generateTimeDistanceBtn');
  const select = document.getElementById('timeDistanceShapeSelect');
  const tabButton = document.querySelector('#statsCanvas .tab-btn[data-tab="timeDistanceTab"]');
  const filterIds = ['routeTypeSelect', 'routeShortNameSelect', 'serviceDateSelect', 'serviceIdSelect', 'updateMapBtn'];

  if (refreshButton) {
    refreshButton.addEventListener('click', refreshTimeDistanceShapeOptions);
  }

  if (generateButton) {
    generateButton.addEventListener('click', () => {
      generateTimeDistanceDiagram();
    });
  }

  if (select) {
    select.addEventListener('change', () => {
      tdSetSummary('');
    });
  }

  if (tabButton) {
    tabButton.addEventListener('click', () => {
      window.setTimeout(refreshTimeDistanceShapeOptions, 0);
    });
  }

  filterIds.forEach(filterId => {
    const el = document.getElementById(filterId);
    if (!el) return;
    el.addEventListener('change', () => {
      window.setTimeout(refreshTimeDistanceShapeOptions, 50);
    });
    el.addEventListener('click', () => {
      window.setTimeout(refreshTimeDistanceShapeOptions, 150);
    });
  });

  refreshTimeDistanceShapeOptions();
}

window.addEventListener('DOMContentLoaded', setupTimeDistanceDiagram);
